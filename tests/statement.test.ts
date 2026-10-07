import { parseStatement } from "../supabase/functions/_shared/statement.ts";
import { normalizeBankDate } from "../supabase/functions/_shared/pluggy.ts";
const assert = (c: boolean, m: string) => { if (!c) throw new Error("FALHOU: " + m); console.log("ok -", m); };

const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0260<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005000000[-3:BRT]<TRNAMT>-45.90<FITID>a1<MEMO>Compra no débito - IFOOD
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261007000000[-3:BRT]<TRNAMT>4500.00<FITID>a2<MEMO>Transferência recebida - FLUXO GAMING
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-1312.40<FITID>a3<MEMO>Pagamento de fatura
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
let s = parseStatement("NU_extrato.ofx", ofx);
assert(s.txs.length === 3 && !s.isCard, "OFX: lê 3 lançamentos de conta");
assert(s.txs[0].type === "expense" && s.txs[0].amount === 45.9 && s.txs[0].date === "2026-10-05", "OFX: débito vira saída com data certa");
assert(s.txs[1].type === "income" && s.txs[1].amount === 4500, "OFX: crédito vira entrada");
assert(s.txs[2].type === "transfer", "OFX: pagamento de fatura vira transferência");

const nubankCard = `date,title,amount
2026-09-28,Uber *Trip,23.50
2026-09-30,Kabum - Parcela 3/10,129.90
2026-10-02,Pagamento recebido,-2340.12
2026-10-03,Estorno Amazon,-59.90`;
s = parseStatement("Nubank_2026-10-15.csv", nubankCard);
assert(s.isCard, "CSV fatura Nubank detectada como cartão");
assert(s.txs.map((t) => t.type).join(",") === "expense,expense,transfer,income", "fatura: compras, pagamento e estorno classificados");

const nubankConta = `Data,Valor,Identificador,Descrição
05/10/2026,-89.90,x1,Compra no débito - Padaria
07/10/2026,"4.500,00",x2,Transferência recebida pelo Pix - FLUXO
07/10/2026,-200.00,x3,Aplicação RDB`;
s = parseStatement("NU_conta.csv", nubankConta);
assert(s.txs.length === 3 && s.txs[1].amount === 4500 && s.txs[1].type === "income" && s.txs[2].type === "transfer", "CSV conta: valores BR, entrada e aplicação");
assert(s.txs[0].fitid === "x1", "CSV usa o identificador do banco quando existe");

const semicolon = `Data;Histórico;Valor
06/10/2026;SUPERMERCADO DIA;-R$ 87,45
06/10/2026;SUPERMERCADO DIA;-R$ 87,45`;
s = parseStatement("itau.csv", semicolon);
assert(s.txs.length === 2 && s.txs[0].fitid !== s.txs[1].fitid && s.txs[0].amount === 87.45, "CSV com ; e duas compras idênticas no mesmo dia continuam duas");

let threw = false; try { parseStatement("x.csv", "foo,bar\n1,2"); } catch { threw = true; }
assert(threw, "CSV sem colunas de data/valor dá erro explicativo");

assert(normalizeBankDate("2026-10-06T00:00:00.000Z") === "2026-10-06T15:00:00.000Z", "data só-dia do banco fica no dia certo em Brasília");
assert(normalizeBankDate("2026-10-06T21:14:00.000Z") === "2026-10-06T21:14:00.000Z", "data com horário é mantida");
console.log("\nTodos os testes de extrato passaram.");
