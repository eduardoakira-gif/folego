// Leitura de comprovantes (print ou PDF de Pix, transferência, boleto, nota) enviados pelo WhatsApp.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { env } from "./supabase.ts";
import { normalizeMerchant } from "./parse.ts";
import { ingestBatch, localDay } from "./store.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Baixa a mídia de uma mensagem do WhatsApp (imagem ou documento). */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const auth = { Authorization: `Bearer ${env("WA_ACCESS_TOKEN")}` };
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: auth }).then((r) => r.json());
  if (!meta?.url) throw new Error("Não consegui baixar o arquivo do WhatsApp.");
  const res = await fetch(meta.url, { headers: auth });
  if (!res.ok) throw new Error("Não consegui baixar o arquivo do WhatsApp.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error("Arquivo grande demais (máx. 8 MB).");
  return { bytes, mime: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type Receipt = {
  is_receipt: boolean;
  type: "expense" | "income" | "transfer";
  amount: number;
  date: string | null;        // AAAA-MM-DD
  time: string | null;        // HH:MM
  counterpart: string | null; // quem recebeu (saída) ou quem pagou (entrada)
  description: string | null;
  method: string | null;      // pix | ted | boleto | cartao | dinheiro | outro
  same_owner: boolean;        // pagador e recebedor são a mesma pessoa
};

/** Usa a IA para extrair os dados do comprovante. */
export async function readReceipt(bytes: Uint8Array, mime: string, ownerName: string | null): Promise<Receipt | null> {
  const isPdf = /pdf/i.test(mime);
  const media = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } }
    : { type: "image", source: { type: "base64", media_type: /png/i.test(mime) ? "image/png" : /webp/i.test(mime) ? "image/webp" : "image/jpeg", data: b64(bytes) } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          media,
          { type: "text", text: `Este arquivo foi enviado por ${ownerName || "o usuário"} para registrar nas finanças pessoais dele.
Extraia os dados e responda SOMENTE com um JSON, sem texto antes ou depois:
{"is_receipt": true se for comprovante/recibo/nota de uma movimentação financeira,
 "type": "expense" se o usuário pagou/enviou, "income" se recebeu, "transfer" se foi entre contas da mesma pessoa,
 "amount": valor em reais como número (ex.: 1234.56),
 "date": "AAAA-MM-DD" ou null, "time": "HH:MM" ou null,
 "counterpart": nome de quem recebeu (se saída) ou de quem pagou (se entrada), ou null,
 "description": resumo curto do que é (ex.: "Pix para Maria Silva", "Conta de luz Enel"), ou null,
 "method": "pix" | "ted" | "boleto" | "cartao" | "dinheiro" | "outro",
 "same_owner": true se pagador e recebedor forem a mesma pessoa}` },
        ],
      }],
    }),
  });
  if (!res.ok) { console.error("anthropic receipt", await res.text()); return null; }
  const data = await res.json();
  const txt: string = data.content?.find((c: any) => c.type === "text")?.text ?? "";
  const json = txt.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const r = JSON.parse(json) as Receipt;
    r.amount = Math.round(Math.abs(Number(r.amount)) * 100) / 100;
    if (r.same_owner) r.type = "transfer";
    return r;
  } catch { return null; }
}

/**
 * Registra o comprovante. Se o mesmo valor já entrou (notificação, banco, extrato) perto da
 * data do comprovante, não duplica: só completa o nome e marca como empresa se for o caso.
 */
export async function registerReceipt(db: SupabaseClient, userId: string, r: Receipt, opts: { reimbursable: boolean; caption: string }) {
  const when = r.date
    ? new Date(`${r.date}T${/^\d{2}:\d{2}$/.test(r.time ?? "") ? r.time : "12:00"}:00-03:00`).toISOString()
    : new Date().toISOString();
  const from = new Date(Date.parse(when) - 2 * 86_400_000).toISOString();
  const to = new Date(Date.parse(when) + 2 * 86_400_000).toISOString();

  const { data: near } = await db.from("transactions")
    .select("id,type,amount,merchant,occurred_at,reimbursable,source")
    .eq("user_id", userId).is("deleted_at", null).eq("amount", r.amount)
    .gte("occurred_at", from).lte("occurred_at", to);
  const key = normalizeMerchant(r.counterpart).slice(0, 6);
  const match = (near ?? [])
    .filter((c: any) => c.type === r.type || c.type === "transfer" || r.type === "transfer")
    .sort((a: any, b: any) => {
      // prefere o mesmo nome; depois o mais próximo no tempo
      const am = key && normalizeMerchant(a.merchant).startsWith(key) ? 0 : 1;
      const bm = key && normalizeMerchant(b.merchant).startsWith(key) ? 0 : 1;
      return am - bm || Math.abs(Date.parse(a.occurred_at) - Date.parse(when)) - Math.abs(Date.parse(b.occurred_at) - Date.parse(when));
    })[0];

  if (match) {
    const patch: Record<string, unknown> = {};
    if (!match.merchant && r.counterpart) patch.merchant = r.counterpart;
    if (opts.reimbursable && !match.reimbursable) patch.reimbursable = true;
    if (opts.caption) patch.note = opts.caption.slice(0, 200);
    // comprovante mostra que foi entre contas suas: corrige o que tinha entrado como gasto/renda
    if (r.type === "transfer" && match.type !== "transfer") { patch.type = "transfer"; patch.category_id = null; }
    if (Object.keys(patch).length) await db.from("transactions").update(patch).eq("id", match.id).eq("user_id", userId);
    return { created: false, id: match.id as string, day: localDay(match.occurred_at) };
  }

  const res = await ingestBatch(db, userId, [{
    source: "whatsapp",
    type: r.type,
    amount: r.amount,
    merchant: r.counterpart,
    description: r.description || r.counterpart || "Comprovante",
    occurred_at: when,
    providerCategory: r.method === "pix" || r.method === "ted" ? "pix" : null,
    raw: { receipt: r, caption: opts.caption },
  }]);
  const id = res.ids[0];
  if (id && opts.reimbursable) await db.from("transactions").update({ reimbursable: true }).eq("id", id);
  if (id && opts.caption) await db.from("transactions").update({ note: opts.caption.slice(0, 200) }).eq("id", id);
  return { created: true, id, day: localDay(when) };
}
