// Recebe notificações de apps de banco enviadas pelo celular.
//   Android: MacroDroid/Tasker → "HTTP Request" POST com JSON { app, title, text }
//   iPhone:  Atalhos → automação "Transação" (Carteira) → { app:"Wallet", merchant, amount, card }
// Autenticação: header X-Ingest-Token (token pessoal exibido no app; pode ser renovado).
import { admin, handler, HttpError, json } from "../_shared/supabase.ts";
import { parseBankNotification, parseBRL, parseWalletNotification } from "../_shared/parse.ts";
import { checkBudgetAlerts, ingestBatch } from "../_shared/store.ts";

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST");
  const body = parseBody(await req.text());
  const token = req.headers.get("x-ingest-token") ?? body.token;
  if (!token || String(token).length < 32) throw new HttpError(401, "Token ausente");

  const db = admin();
  const { data: prof } = await db.from("profiles").select("id").eq("ingest_token", token).maybeSingle();
  if (!prof) throw new HttpError(401, "Token inválido");

  const app = String(body.app ?? "").slice(0, 80);
  const title = String(body.title ?? "").slice(0, 300);
  const text = String(body.text ?? body.body ?? "").slice(0, 1000);

  let parsed = null;
  if (body.amount != null && body.merchant) {
    // formato do Atalhos do iPhone (já vem estruturado)
    const amount = typeof body.amount === "number" ? body.amount : parseBRL(`R$ ${body.amount}`);
    if (amount) parsed = { type: "expense" as const, amount, merchant: String(body.merchant).slice(0, 80), installment: null };
  } else {
    parsed = parseWalletNotification(app, title, text) ?? parseBankNotification(title, text);
  }

  const log = (result: string, transaction_id: string | null = null) =>
    db.from("notification_inbox").insert({ user_id: prof.id, app, title, body: text || JSON.stringify(body).slice(0, 500), result, transaction_id });

  if (!parsed) { await log("ignored"); return json(req, { ok: true, result: "ignored" }); }

  const r = await ingestBatch(db, prof.id, [{
    source: "notification",
    type: parsed.type,
    amount: parsed.amount,
    merchant: parsed.merchant,
    description: parsed.merchant ?? (title || app || "Notificação"),
    occurred_at: new Date().toISOString(),
    installment: parsed.installment,
    raw: { app, title, text },
  }]);

  const result = r.inserted ? "created" : "duplicate";
  await log(result, r.ids[0] ?? null);
  if (r.inserted && parsed.type === "expense") await checkBudgetAlerts(db, prof.id);
  return json(req, { ok: true, result, transaction: parsed });
}));

/**
 * O MacroDroid/Atalhos montam o JSON colando o texto da notificação sem "escapar" aspas e
 * quebras de linha — o que gera JSON inválido. Tentamos JSON normal e, se falhar,
 * extraímos os campos pelo formato conhecido {"app":"…","title":"…","text":"…"}.
 */
function parseBody(raw: string): Record<string, any> {
  try { return JSON.parse(raw); } catch { /* segue */ }
  const field = (name: string, next: string | null) => {
    const re = next
      ? new RegExp(`"${name}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"${next}"`)
      : new RegExp(`"${name}"\\s*:\\s*"([\\s\\S]*)"\\s*}\\s*$`);
    return raw.match(re)?.[1]?.replace(/\s+/g, " ").trim();
  };
  const out: Record<string, any> = {
    app: field("app", "title"), title: field("title", "text"), text: field("text", null),
  };
  if (!out.text) {
    // último recurso: formulário (app=...&title=...&text=...)
    try { const f = new URLSearchParams(raw); for (const k of ["app", "title", "text", "token"]) if (f.get(k)) out[k] = f.get(k); } catch { /* ignora */ }
  }
  return out;
}
