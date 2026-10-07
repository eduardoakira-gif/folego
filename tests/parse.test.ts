import { parseBankNotification as p, parseChatEntry as c, parseBRL } from "../supabase/functions/_shared/parse.ts";
import { pickCategory } from "../supabase/functions/_shared/categorize.ts";
const cases: [string, string, any][] = [
  ["Nubank", "Compra de R$ 45,90 APROVADA em IFOOD *RESTAURANTE para o cartão com final 1234.", { type: "expense", amount: 45.9 }],
  ["Compra aprovada", "Compra no crédito de R$ 1.299,00 em KABUM em 10x foi aprovada", { type: "expense", amount: 1299 }],
  ["Itaú", "Compra aprovada no seu cartão final 4321 - UBER *TRIP, R$ 23,50 em 06/10 às 21:03", { type: "expense", amount: 23.5 }],
  ["Pix recebido", "Você recebeu um Pix de MARIA SILVA no valor de R$ 150,00", { type: "income", amount: 150 }],
  ["Pix enviado", "Pix de R$ 80,00 enviado para JOAO PEREIRA", { type: "expense", amount: 80 }],
  ["Inter", "Transferência recebida: R$ 4.500,00 de FLUXO GAMING LTDA", { type: "income", amount: 4500 }],
  ["Nubank", "Pagamento da fatura de R$ 2.340,12 realizado", { type: "transfer", amount: 2340.12 }],
  ["Nubank", "Sua fatura fechou! Valor R$ 2.340,12, vence dia 15", null],
  ["Banco", "Seu código de verificação é 123456", null],
  ["C6", "Compra recusada de R$ 50,00 em LOJA X", null],
  ["Mercado Pago", "Você pagou R$ 32,00 para PADARIA PAO QUENTE", { type: "expense", amount: 32 }],
  ["PicPay", "Você guardou R$ 200,00 no Cofrinho", { type: "transfer", amount: 200 }],
  ["Santander", "Compra no débito aprovada: R$ 312,47 - CARREFOUR", { type: "expense", amount: 312.47 }],
];
let fail = 0;
for (const [t, b, exp] of cases) {
  const r = p(t, b);
  const ok = exp === null ? r === null : r && r.type === exp.type && r.amount === exp.amount;
  if (!ok) fail++;
  console.log(ok ? "OK  " : "FAIL", b, "→", JSON.stringify(r));
}
for (const m of ["gastei 45 no mercado", "uber 23,50", "recebi 300 de freela", "paguei R$ 1.200 aluguel", "oi tudo bem"]) console.log("chat:", m, "→", JSON.stringify(c(m)));
const cats = ["Mercado","Restaurantes e delivery","Transporte","Assinaturas","Compras","Outros gastos"].map((n,i)=>({id:"e"+i,name:n,kind:"expense" as const})).concat([{id:"i0",name:"Salário",kind:"income"},{id:"i1",name:"Outras entradas",kind:"income"}]);
const rules = [{ pattern: "padaria pao quente", category_id: "e1", mark_reimbursable: false }];
for (const [t,txt,pc] of [["expense","IFOOD *RESTAURANTE",null],["expense","CARREFOUR",null],["expense","PADARIA PAO QUENTE",null],["expense","APPLE.COM/BILL",null],["expense","LOJA DESCONHECIDA","Groceries"],["income","FLUXO GAMING LTDA",null]] as const)
  console.log("cat:", txt, "→", cats.find(c=>c.id===pickCategory({type:t,text:txt,providerCategory:pc},cats,rules).category_id)?.name);
console.log(parseBRL("R$ 1.500"), parseBRL("R$1.234,56"), parseBRL("12.5"));
if (fail) { console.log(fail, "falhas"); process.exit(1); }
