// Importa extrato OFX/CSV enviado pelo app (usuário logado).
// Corpo: { filename, content (texto), isCard?, preview? }
//   preview=true  → só lê o arquivo e devolve o resumo, sem gravar
import { admin, handler, HttpError, json, requireUser } from "../_shared/supabase.ts";
import { parseStatement } from "../_shared/statement.ts";
import { checkBudgetAlerts, ingestBatch } from "../_shared/store.ts";

Deno.serve(handler(async (req) => {
  const userId = await requireUser(req);
  const { filename = "extrato", content, isCard, preview } = await req.json();
  if (typeof content !== "string" || !content.trim()) throw new HttpError(400, "Arquivo vazio.");
  if (content.length > 3_000_000) throw new HttpError(413, "Arquivo grande demais (máx. 3 MB). Exporte um período menor.");

  let st;
  try { st = parseStatement(String(filename), content, typeof isCard === "boolean" ? isCard : undefined); }
  catch (e) { throw new HttpError(422, e instanceof Error ? e.message : "Não foi possível ler o arquivo."); }
  if (!st.txs.length) throw new HttpError(422, "Nenhum lançamento encontrado no arquivo.");

  const dates = st.txs.map((t) => t.date).sort();
  const summary = {
    account: st.account, isCard: st.isCard, count: st.txs.length, from: dates[0], to: dates[dates.length - 1],
    expenses: st.txs.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0),
    income: st.txs.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0),
  };
  if (preview) return json(req, summary);

  const db = admin();
  // conta "manual" correspondente ao arquivo (uma por banco/conta)
  const name = st.account.slice(0, 60);
  let { data: acc } = await db.from("accounts").select("id").eq("user_id", userId).eq("type", st.isCard ? "CREDIT" : "MANUAL").eq("name", name).is("connection_id", null).maybeSingle();
  if (!acc) {
    ({ data: acc } = await db.from("accounts").insert({ user_id: userId, name, type: st.isCard ? "CREDIT" : "MANUAL" }).select("id").single());
  }
  const keyBase = `import:${name.toLowerCase().replace(/\s+/g, "-")}`;
  const r = await ingestBatch(db, userId, st.txs.map((t) => ({
    source: "import" as const,
    type: t.type,
    amount: Math.round(t.amount * 100) / 100,
    description: t.description.slice(0, 200),
    merchant: t.description.split(" — ")[0].slice(0, 80),
    occurred_at: `${t.date}T15:00:00.000Z`,      // meio-dia em Brasília
    external_id: `${keyBase}:${t.fitid}`,
    account_id: acc?.id ?? null,
    status: "confirmed" as const,
    raw: { file: String(filename).slice(0, 100), fitid: t.fitid },
  })));
  await db.rpc("detect_internal_transfers", { p_user: userId });
  await checkBudgetAlerts(db, userId);
  return json(req, { ...summary, ...r, ids: undefined });
}));
