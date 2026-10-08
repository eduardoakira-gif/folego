import { parseBankNotification as p } from "../supabase/functions/_shared/parse.ts";
type C = [string, string, null | { type: string; amount: number; merchant?: string; installment?: string }];
const cases: C[] = [
  // ---- Pix enviado (saída)
  ["Transferência enviada", "Você enviou uma transferência de R$ 50,00 para Maria Silva.", { type: "expense", amount: 50, merchant: "Maria Silva" }],
  ["Pix enviado", "Você enviou um Pix de R$ 50,00 para MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Itaú", "Pix enviado: R$ 50,00 para MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Pix enviado com sucesso!", "Valor: R$ 50,00. Destinatário: MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Pix realizado", "Você transferiu R$ 50,00 para Maria Silva", { type: "expense", amount: 50, merchant: "Maria Silva" }],
  ["Bradesco", "Transferência PIX de R$ 50,00 realizada para MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["BB", "Pix enviado. Valor R$ 50,00. Favorecido: MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Santander", "Pix no valor de R$ 50,00 enviado para MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Mercado Pago", "Você pagou R$ 32,00 para PADARIA PAO QUENTE com Pix", { type: "expense", amount: 32, merchant: "PADARIA PAO QUENTE" }],
  ["Pix agendado", "Seu Pix agendado de R$ 100,00 para MARIA SILVA foi realizado", { type: "expense", amount: 100, merchant: "MARIA SILVA" }],
  ["Pix Automático", "Pagamento de R$ 39,90 para NETFLIX realizado via Pix Automático", { type: "expense", amount: 39.9, merchant: "NETFLIX" }],
  ["PicPay", "Você pagou R$ 20,00 para @maria.silva", { type: "expense", amount: 20, merchant: "@maria.silva" }],
  ["CAIXA", "PIX enviado de R$ 50,00 para MARIA SILVA", { type: "expense", amount: 50, merchant: "MARIA SILVA" }],
  ["Inter", "Saldo disponível R$ 1.200,00. Pix enviado de R$ 50,00 para MARIA", { type: "expense", amount: 50 }],
  ["Nubank", "Pix no crédito de R$ 200,00 para MARIA SILVA realizado em 3x", { type: "expense", amount: 200, merchant: "MARIA SILVA", installment: "1/3" }],
  ["Pix", "Você devolveu R$ 50,00 para JOAO PEREIRA", { type: "expense", amount: 50 }],
  // ---- compras com aviso de limite junto
  ["Nubank", "Compra de R$ 45,90 APROVADA em IFOOD. Limite disponível: R$ 1.200,00", { type: "expense", amount: 45.9, merchant: "IFOOD" }],
  // ---- Pix recebido (entrada)
  ["Pix recebido", "Você recebeu um Pix de R$ 150,00 de JOAO PEREIRA", { type: "income", amount: 150, merchant: "JOAO PEREIRA" }],
  ["Itaú", "Pix recebido de JOAO PEREIRA no valor de R$ 150,00", { type: "income", amount: 150, merchant: "JOAO PEREIRA" }],
  ["BB", "Pix recebido. Valor R$ 150,00. Pagador: JOAO PEREIRA", { type: "income", amount: 150, merchant: "JOAO PEREIRA" }],
  ["Transferência recebida", "Você recebeu uma transferência de R$ 150,00 de João Pereira.", { type: "income", amount: 150, merchant: "João Pereira" }],
  ["Pix devolvido", "Você recebeu uma devolução de Pix de R$ 50,00 de LOJA X", { type: "income", amount: 50 }],
  // ---- não são movimentação
  ["Pix agendado", "Pix de R$ 100,00 agendado para 10/10 para MARIA", null],
  ["Pix", "Seu Pix de R$ 50,00 não foi concluído", null],
  ["Pix", "Limite Pix noturno alterado para R$ 1.000,00", null],
  ["Pix", "Chave Pix cadastrada com sucesso", null],
  ["Pix", "Pix de R$ 50,00 em análise", null],
  ["Cobrança Pix", "Você tem uma cobrança Pix de R$ 80,00 de CLARO para pagar", null],
  ["Nubank", "Seu limite disponível aumentou para R$ 3.000,00", null],
];
let fail = 0;
for (const [t, b, exp] of cases) {
  const r = p(t, b);
  const ok = exp === null ? r === null
    : !!r && r.type === exp.type && r.amount === exp.amount &&
      (exp.merchant === undefined || r.merchant === exp.merchant) &&
      (exp.installment === undefined || r.installment === exp.installment);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", `${t} | ${b}`, "→", JSON.stringify(r));
}
console.log(fail ? `\n${fail} falha(s)` : "\nTodos os casos de Pix passaram.");
if (fail) Deno.exit(1);
