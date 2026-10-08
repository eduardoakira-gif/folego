// Teste da deduplicação entre notificação → Open Finance com um banco em memória.
import { ingestBatch } from "../supabase/functions/_shared/store.ts";

const tables: Record<string, any[]> = {
  categories: [
    { id: "c1", user_id: "u", name: "Restaurantes e delivery", kind: "expense", archived: false },
    { id: "c2", user_id: "u", name: "Outros gastos", kind: "expense", archived: false },
    { id: "c3", user_id: "u", name: "Mercado", kind: "expense", archived: false },
  ],
  category_rules: [], transactions: [],
};
function q(name: string) {
  let rows = () => tables[name];
  const filters: ((r: any) => boolean)[] = [];
  let mode: "select" | "update" = "select"; let patch: any = null;
  const api: any = {
    select() { return api; },
    eq(k: string, v: any) { filters.push((r) => r[k] === v); return api; },
    is(k: string, v: any) { filters.push((r) => (r[k] ?? null) === v); return api; },
    in(k: string, v: any[]) { filters.push((r) => v.includes(r[k])); return api; },
    gte(k: string, v: any) { filters.push((r) => r[k] >= v); return api; },
    or(_expr: string) { filters.push((r) => r.external_id == null || r.source === "import"); return api; },
    update(p: any) { mode = "update"; patch = p; return api; },
    upsert(list: any[]) { for (const r of list) if (!tables[name].some((x) => x.external_id && x.external_id === r.external_id)) tables[name].push({ ...r }); return Promise.resolve({ error: null }); },
    then(res: any) {
      const out = rows().filter((r) => filters.every((f) => f(r)));
      if (mode === "update") out.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: out, error: null }).then(res);
    },
  };
  return api;
}
const db: any = { from: q, rpc: async () => ({ data: null, error: null }) };
const now = "2026-10-06T21:00:00.000Z";
const assert = (c: boolean, m: string) => { if (!c) throw new Error("FALHOU: " + m); console.log("ok -", m); };

// 1. notificação chega
let r = await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 45.9, merchant: "IFOOD *REST", description: "IFOOD *REST", occurred_at: now }]);
assert(r.inserted === 1 && tables.transactions[0].status === "pending" && tables.transactions[0].category_id === "c1", "notificação vira lançamento provisório categorizado");
// 2. mesma notificação repetida
r = await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 45.9, merchant: "IFOOD *REST", description: "x", occurred_at: now }]);
assert(r.skipped === 1 && tables.transactions.length === 1, "notificação duplicada é ignorada");
// 3. Open Finance confirma no dia seguinte
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "expense", amount: 45.9, merchant: null, description: "IFOOD *RESTAURANTE SAO PAULO", occurred_at: "2026-10-07T03:00:00.000Z", external_id: "pl_1", account_id: "a1" }]);
assert(r.merged === 1 && tables.transactions.length === 1 && tables.transactions[0].status === "confirmed" && tables.transactions[0].external_id === "pl_1", "Open Finance junta com a notificação (sem duplicar)");
// 4. reprocessar o mesmo webhook
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "expense", amount: 45.9, description: "x", occurred_at: now, external_id: "pl_1" }]);
assert(r.skipped === 1 && tables.transactions.length === 1, "webhook repetido é idempotente");
// 5. compra só no Open Finance
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "expense", amount: 312.47, description: "CARREFOUR", occurred_at: now, external_id: "pl_2" }]);
assert(r.inserted === 1 && tables.transactions[1].category_id === "c3", "nova transação do banco entra categorizada");
// 6. categoria escolhida pelo usuário não é sobrescrita
tables.transactions.push({ id: "m1", user_id: "u", source: "whatsapp", type: "expense", amount: 20, merchant: "almoço", description: "almoço", occurred_at: now, category_id: "c2", category_locked: true, external_id: null, deleted_at: null });
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "expense", amount: 20, description: "IFOOD", occurred_at: now, external_id: "pl_3" }]);
assert(r.merged === 1 && tables.transactions.find((t) => t.id === "m1").category_id === "c2", "categoria travada pelo usuário é mantida");
// 7. extrato importado não duplica o que já veio do Open Finance (CARREFOUR 312,47 do passo 5)
r = await ingestBatch(db, "u", [
  { source: "import", type: "expense", amount: 312.47, description: "CARREFOUR", occurred_at: "2026-10-06T15:00:00.000Z", external_id: "import:x:1" },
  { source: "import", type: "expense", amount: 15, description: "PADARIA", occurred_at: "2026-10-06T15:00:00.000Z", external_id: "import:x:2" },
  { source: "import", type: "expense", amount: 15, description: "PADARIA", occurred_at: "2026-10-06T15:00:00.000Z", external_id: "import:x:3" },
]);
assert(r.skipped === 1 && r.inserted === 2, "extrato pula o que já veio do banco e mantém duas compras iguais no mesmo dia");
// 8. reimportar o mesmo arquivo não duplica
r = await ingestBatch(db, "u", [{ source: "import", type: "expense", amount: 15, description: "PADARIA", occurred_at: "2026-10-06T15:00:00.000Z", external_id: "import:x:2" }]);
assert(r.skipped === 1, "reimportar o mesmo extrato é idempotente");
// 9. Open Finance chega depois e se junta ao lançamento do extrato
const before = tables.transactions.length;
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "expense", amount: 15, description: "PADARIA PAO", occurred_at: "2026-10-06T18:00:00.000Z", external_id: "pl_9" }]);
assert(r.merged === 1 && tables.transactions.length === before, "Open Finance se junta ao lançamento importado");
// 10. Pix para conta própria: notificação disse "gasto", banco diz "transferência" → vira um só, como transferência
await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 500, merchant: "EDUARDO", description: "Pix enviado", occurred_at: now }]);
r = await ingestBatch(db, "u", [{ source: "open_finance", type: "transfer", amount: 500, description: "PIX ENVIADO EDUARDO", occurred_at: now, external_id: "pl_10" }]);
const pix = tables.transactions.filter((t) => Number(t.amount) === 500);
assert(r.merged === 1 && pix.length === 1 && pix[0].type === "transfer" && pix[0].category_id === null, "Pix entre contas próprias não fica como gasto");
// 11. Mesma compra avisada pela Carteira do Google e pelo app do Santander, com nomes diferentes
const n0 = tables.transactions.length;
await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 87.3, merchant: "iFood", description: "iFood", occurred_at: "2026-10-07T23:00:00.000Z" }]);
r = await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 87.3, merchant: "IFD*RESTAURANTE XYZ", description: "IFD", occurred_at: "2026-10-07T23:01:30.000Z" }]);
assert(r.skipped === 1 && tables.transactions.length === n0 + 1, "Carteira + app do banco = um lançamento só");
// 12. Duas compras de mesmo valor com 3 horas de diferença em lugares diferentes continuam duas
r = await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 87.3, merchant: "Posto Shell", description: "Posto", occurred_at: "2026-10-08T02:00:00.000Z" }]);
assert(r.inserted === 1, "compra igual em outro horário e outro lugar não é descartada");
// 13. Pix entre suas contas avisado pelos dois bancos vira transferência (nem gasto, nem renda)
await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 700, merchant: "EDUARDO AKIRA NISHIKAWA", description: "x", occurred_at: "2026-10-08T12:00:00.000Z" }]);
await ingestBatch(db, "u", [{ source: "notification", type: "income", amount: 700, merchant: "EDUARDO AKIRA N", description: "x", occurred_at: "2026-10-08T12:00:40.000Z" }]);
const p700 = tables.transactions.filter((t) => Number(t.amount) === 700);
assert(p700.length === 2 && p700.every((t) => t.type === "transfer"), "Pix entre suas contas (2 notificações) vira transferência");
// 14. Pix para pessoa desconhecida fica sem categoria (vai para Revisar)
r = await ingestBatch(db, "u", [{ source: "notification", type: "expense", amount: 61, merchant: "JOSE DA SILVA", description: "JOSE DA SILVA", occurred_at: "2026-10-08T15:00:00.000Z", providerCategory: "pix" }]);
assert(tables.transactions.find((t) => t.id === r.ids[0]).category_id === null, "Pix para pessoa sem regra vai para Revisar");
console.log("\nTodos os testes de deduplicação passaram.");
