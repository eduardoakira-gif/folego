// WhatsApp Cloud API (oficial da Meta)
import { env } from "./supabase.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

async function post(body: unknown) {
  const res = await fetch(`${GRAPH}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WA_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Envia texto. Fora da janela de 24h desde a última mensagem do usuário, a Meta só aceita
 * template aprovado — então, se der esse erro (131047) e houver template configurado, reenvia como template.
 */
export async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const r = await post({ messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000), preview_url: false } });
  if (r.ok) return true;
  const code = r.data?.error?.code;
  const template = Deno.env.get("WA_NOTIFY_TEMPLATE"); // ex: "aviso_financeiro" com 1 variável {{1}}
  if ((code === 131047 || code === 131026) && template) {
    const t = await post({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: template, language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\n+/g, " • ").slice(0, 1000) }] }],
      },
    });
    if (t.ok) return true;
    console.error("WhatsApp template falhou", JSON.stringify(t.data));
    return false;
  }
  console.error("WhatsApp falhou", JSON.stringify(r.data));
  return false;
}

/** Confere a assinatura X-Hub-Signature-256 (HMAC SHA-256 com o App Secret). */
export async function verifyMetaSignature(raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env("WA_APP_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
