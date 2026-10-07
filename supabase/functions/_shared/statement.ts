// Leitura de extratos exportados pelo banco: OFX (padrão de todos os bancos) e CSV.
import { SAME_OWNER } from "./parse.ts";

export type StatementTx = {
  fitid: string;           // id único da transação no arquivo
  date: string;            // AAAA-MM-DD
  amount: number;          // positivo
  type: "income" | "expense" | "transfer";
  description: string;
};
export type Statement = { account: string; isCard: boolean; txs: StatementTx[] };

const tag = (block: string, name: string) =>
  block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";

function money(raw: string): number | null {
  let t = raw.replace(/[R$\s]/g, "");
  if (!t) return null;
  const neg = /^-|-$|^\(.*\)$/.test(t);
  t = t.replace(/[()\-+]/g, "");
  if (t.includes(",") && (!t.includes(".") || t.lastIndexOf(",") > t.lastIndexOf("."))) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function isoDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})/);                        // OFX: 20261007120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function classify(signed: number, desc: string, isCard: boolean): StatementTx["type"] {
  if (SAME_OWNER.test(desc)) return "transfer";
  if (isCard) {
    // na fatura: valor positivo = compra; negativo = pagamento da fatura (transfer) ou estorno (entrada)
    if (signed > 0) return "expense";
    return /estorno|devolu|cashback|reembolso/i.test(desc) ? "income" : "transfer";
  }
  return signed < 0 ? "expense" : "income";
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function parseOFX(text: string): Statement {
  const isCard = /<CCSTMTRS>|<CCACCTFROM>/i.test(text);
  const acct = tag(text, "ACCTID");
  const org = tag(text, "ORG") || tag(text, "BANKID");
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const txs: StatementTx[] = [];
  for (const b of blocks) {
    const amt = money(tag(b, "TRNAMT"));
    const date = isoDate(tag(b, "DTPOSTED"));
    if (amt == null || !date || amt === 0) continue;
    const description = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" — ") || "Lançamento";
    // OFX de cartão também usa negativo para compra (padrão); invertemos para o classificador de cartão
    const signedForCard = isCard ? -amt : amt;
    txs.push({
      fitid: tag(b, "FITID") || hash(`${date}|${amt}|${description}`),
      date, amount: Math.abs(amt), description,
      type: classify(isCard ? signedForCard : amt, description, isCard),
    });
  }
  return { account: [org, acct].filter(Boolean).join(" ") || "Extrato importado", isCard, txs };
}

export function parseCSV(text: string, opts: { isCard?: boolean; name?: string } = {}): Statement {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("Arquivo vazio ou sem cabeçalho.");
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (l: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out.map((c) => c.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iDate = find(/^(data|date|dt)/);
  const iDesc = find(/(descri|title|titulo|historico|lancamento|estabelecimento|memo)/);
  const iAmt = find(/^(valor|amount|quantia|vlr)/);
  const iId = find(/^(identificador|id)$/);
  if (iDate < 0 || iAmt < 0) throw new Error("Não encontrei as colunas de data e valor. O arquivo precisa ter cabeçalho com “Data” e “Valor”.");
  // Fatura do Nubank: date,title,amount com compras positivas
  const isCard = opts.isCard ?? (head.join(",") === "date,title,amount" || /fatura|cartao|card/i.test(opts.name ?? ""));
  const txs: StatementTx[] = [];
  const seen = new Map<string, number>();
  for (const l of lines.slice(1)) {
    const c = split(l);
    const date = isoDate(c[iDate] ?? "");
    const amt = money(c[iAmt] ?? "");
    if (!date || amt == null || amt === 0) continue;
    const description = (iDesc >= 0 ? c[iDesc] : "") || "Lançamento";
    const base = c[iId] || hash(`${date}|${amt}|${description}`);
    const k = seen.get(base) ?? 0; seen.set(base, k + 1);     // linhas idênticas no mesmo dia continuam distintas
    txs.push({ fitid: k ? `${base}-${k}` : base, date, amount: Math.abs(amt), description, type: classify(amt, description, isCard) });
  }
  return { account: (opts.name ?? "Extrato").replace(/\.(csv|ofx)$/i, ""), isCard, txs };
}

export function parseStatement(filename: string, text: string, isCard?: boolean): Statement {
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text)) return parseOFX(text);
  return parseCSV(text, { isCard, name: filename });
}
