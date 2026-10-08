// Leitura de texto livre em português: notificações de banco e mensagens de WhatsApp.
// Sem dependências — testado em Node e roda no Deno (Edge Functions).

export type ParsedTx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  merchant: string | null;
  installment: string | null;
};

/** "R$ 1.234,56" | "R$45" | "1234.56" → 1234.56 */
export function parseBRL(s: string): number | null {
  const m = s.match(/R\$\s*(-?[\d.]+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i) ??
    s.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+(?:\.\d{1,2})?)(?=\s|$|[^\d])/);
  if (!m) return null;
  let raw = m[1];
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, ""); // "1.500" = mil e quinhentos
  const n = Math.abs(parseFloat(raw));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Mensagens que NÃO são movimentação (mesmo tendo valor em R$)
const IGNORE = [
  /c[oó]digo|token|senha|verifica[cç][aã]o|chave pix/i,
  /fatura (fechou|est[aá] (aberta|fechada|dispon)|vence|dispon)/i,
  /(oferta|promo[cç][aã]o|cashback dispon|cupom|aproveite|convite|empr[eé]stimo pr[eé]-aprovado|cr[eé]dito pr[eé]-aprovado)/i,
  /(recusad|negad|n[aã]o autorizad|cancelad|estornad[ao] .*pendente|falhou|em an[aá]lise)/i,
  /n[aã]o (foi )?(conclu|realiz|efetu|process)/i,
  /(para pagar|aguardando (o )?pagamento|cobran[cç]a (pix )?(recebida|dispon|pendente)|voc[eê] tem uma cobran[cç]a|boleto (dispon|gerado|vence))/i,
];
// Avisos de limite/saldo só são ignorados se não houver movimentação junto
const INFO_ONLY = /(limite|saldo)( pix| noturno| dispon[ií]vel)?.{0,30}(alterad|aument|ajust|dispon|reduzid|atualizad)/i;
// "agendado" só conta quando já foi efetivado
const SCHEDULED = /agendad[oa]/i;
const DONE = /(foi |j[aá] )?(realizad|efetuad|enviad|conclu[ií]d|pag[oa]\b|debitad)/i;

const SELF_REFUND = /voc[eê] devolveu/i;
const INCOME = /(recebid[oa]|voc[eê] recebeu|recebeu (um|uma)|cr[eé]dito em conta|dep[oó]sito|caiu na (sua )?conta|sal[aá]rio|reembolso|estorno|devolu[cç][aã]o|foi devolvid|\bpagador:|\bremetente:)/i;
const TRANSFER = /(pagamento (da )?fatura|fatura (foi )?paga|pagamento de fatura|aplica[cç][aã]o|resgate|guardou|caixinha|cofrinho|porquinho|transfer[eê]ncia entre (suas )?contas|mesma titularidade)/i;
const EXPENSE = /(compra|pagamento|\bpago\b|\bpaga\b|pagou|voc[eê] (enviou|pagou|fez|transferiu)|transferiu|enviad[oa]|realizad[oa]|efetuad[oa]|d[eé]bito|saque|boleto|favorecido|destinat[aá]rio|recebedor|benefici[aá]rio)/i;

/** Primeiro valor que não seja saldo/limite: "Saldo R$ 1.200. Pix de R$ 50" → 50. */
function pickAmount(text: string): number | null {
  const all = [...text.matchAll(/R\$\s*-?[\d.]+(?:,\d{1,2})?/gi)];
  for (const m of all) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 28), m.index).toLowerCase();
    if (/(saldo|limite|dispon[ií]vel|total da fatura)[^.]*$/.test(before)) continue;
    const v = parseBRL(m[0]);
    if (v) return v;
  }
  return parseBRL(text);
}

function cleanMerchant(s: string): string | null {
  const t = s
    .replace(/\s+(aprovad[ao]|realizad[ao]|efetuad[ao]|enviad[ao]|recebid[ao]|foi .*|no (cart[aã]o|cr[eé]dito|d[eé]bito)).*$/i, "")
    .replace(/\s+(com|no|na|via) (seu |o )?(cart[aã]o|pix).*$/i, "")
    .replace(/\s*(às|as|em) \d{1,2}[:h]\d{2}.*$/i, "")
    .replace(/\s+(em|no dia) \d{1,2}\/\d{1,2}.*$/i, "")
    .replace(/\s+em \d+x.*$/i, "")
    .replace(/[.!,;:]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t.length >= 2 ? t.slice(0, 80) : null;
}

function extractMerchant(text: string): string | null {
  const stop = String.raw`(?=\s+(?:foi|R\$|no valor|valor|via|com|para o|pelo|às|as\s+\d|em\s+\d|no (?:cr[eé]dito|d[eé]bito|cart))|[,!]|\.\s|\.$|$)`;
  const pats = [
    // rótulos explícitos: "Favorecido: MARIA", "Pagador: JOAO", "Destinatário: ..."
    new RegExp(String.raw`(?:favorecido|destinat[aá]rio|recebedor|benefici[aá]rio|pagador|remetente|estabelecimento|loja)\s*:\s*([^\n.;]+?)` + String.raw`(?=[.;]|\s+(?:valor|R\$|cpf|cnpj|chave|em \d)|$)`, "gi"),
    new RegExp(String.raw`\b(?:em|no|na)\s+([A-Z0-9][A-Z0-9*&'./ -]{1,}?)` + stop, "g"),           // "em IFOOD *REST"
    new RegExp(String.raw`\s[-–]\s+([A-Z0-9][A-Za-z0-9*&'./ ]{1,}?)` + stop, "g"),                  // "- UBER *TRIP"
    new RegExp(String.raw`\bpara\s+(?!o cart|seu|sua|pagar)([^\n]+?)` + stop, "gi"),              // "para JOAO"
    new RegExp(String.raw`\bde\s+([A-ZÀ-Ú@][^\n]+?)` + stop, "g"),                                 // "Pix de MARIA"
    new RegExp(String.raw`\b(?:em|no|na)\s+([^\n]+?)` + stop, "gi"),
  ];
  for (const p of pats) {
    for (const m of text.matchAll(p)) {
      const cand = cleanMerchant(m[1]);
      if (cand && !/^(R\$|\d|seu|sua|conta|cart[aã]o|cr[eé]dito|d[eé]bito|pix\b|uma? |sucesso|valor)/i.test(cand)) return cand;
    }
  }
  return null;
}

/** Movimentações entre contas do próprio usuário (não são gasto nem renda). */
export const SAME_OWNER = /same person|mesma titularidade|credit card payment|pagamento (de |da )?fatura|pagto fatura|pag fatura|transf(er[eê]ncia)? entre contas|aplica[cç][aã]o|resgate|investment.*(application|redemption)|cofrinho|caixinha|porquinho/i;

/** É um Pix/transferência para/de pessoa (útil para pedir categoria ao usuário). */
export const isPixLike = (s: string) => /\bpix\b|transfer[eê]ncia|\bted\b|\bdoc\b/i.test(s);

/** Notificação de app de banco → transação (ou null se não for movimentação). */
export function parseBankNotification(title: string, body: string): ParsedTx | null {
  const text = `${title ?? ""}. ${body ?? ""}`.replace(/\s+/g, " ").trim();
  if (IGNORE.some((r) => r.test(text))) return null;
  if (SCHEDULED.test(text) && !DONE.test(text.replace(SCHEDULED, ""))) return null;
  const hasAction = EXPENSE.test(text) || INCOME.test(text) || TRANSFER.test(text) || SELF_REFUND.test(text);
  if (!hasAction || (INFO_ONLY.test(text) && !/(compra|pix|pagamento|transfer)/i.test(text.replace(INFO_ONLY, "")))) return null;

  const amount = pickAmount(text);
  if (!amount) return null;

  let type: ParsedTx["type"] | null = null;
  if (TRANSFER.test(text)) type = "transfer";
  else if (SELF_REFUND.test(text)) type = "expense";
  else if (INCOME.test(text)) type = "income";
  else if (EXPENSE.test(text)) type = "expense";
  if (!type) return null;

  const inst = text.match(/\b(\d{1,2})\s*x\b/i) ?? text.match(/parcela\s*\d+\s*\/\s*(\d+)/i);
  const installment = /parcel|\d+\s*x\b/i.test(text) && inst && Number(inst[1]) > 1 ? `1/${inst[1]}` : null;
  return { type, amount, merchant: extractMerchant(body || title) ?? extractMerchant(text), installment };
}

/** Mensagem livre no WhatsApp: "gastei 45 no mercado", "recebi 300 freela", "uber 23,50". */
export function parseChatEntry(msg: string): (ParsedTx & { description: string }) | null {
  const text = msg.trim();
  const m = text.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const amount = parseBRL(text.includes("R$") ? text : `R$ ${m[1]}`);
  if (!amount) return null;
  const isIncome = /\b(recebi|ganhei|entrou|caiu|recebimento|sal[aá]rio)\b/i.test(text);
  const isExpense = /\b(gastei|paguei|comprei|gasto|pago|almo[cç]o|jantar|uber|ifood|mercado)\b/i.test(text);
  if (!isIncome && !isExpense && !/^\D*\d/.test(text)) return null;
  const description = text
    .replace(/R\$\s*/gi, "")
    .replace(m[1], "")
    .replace(/\b(gastei|paguei|comprei|recebi|ganhei|entrou|caiu|reais|real|de|no|na|em|com|pra|para|o|a)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim() || (isIncome ? "Entrada" : "Gasto");
  return {
    type: isIncome ? "income" : "expense",
    amount,
    merchant: description,
    installment: null,
    description: description.charAt(0).toUpperCase() + description.slice(1),
  };
}

/** Normaliza para comparar estabelecimentos: "PAG*IFOOD SAO PAULO" → "ifood sao paulo" */
export function normalizeMerchant(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^(pag\*|pg \*|mp \*|mercpago\*|ebanx\*|pay\*|ec \*|dl\*|pp\*|iz \*|sumup \*|stone\*)/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Carteira do Google / Google Pay / Samsung Pay: o título é a loja e o texto traz
 * o valor e o cartão, ex.: título "Padaria Real", texto "R$ 45,90 com Santander Visa •••• 1234".
 */
export function parseWalletNotification(app: string, title: string, text: string): ParsedTx | null {
  if (!/wallet|carteira|google pay|gpay|samsung pay|samsung wallet/i.test(app)) return null;
  const full = `${title} ${text}`;
  if (/recusad|negad|n[aã]o autorizad|falhou|cancelad/i.test(full)) return null;
  const amount = parseBRL(text) ?? parseBRL(full);
  if (!amount) return null;
  const refund = /reembolso|estorno|devolu/i.test(full);
  const merchant = (title || "").replace(/^(pagamento|compra)( aprovad[ao])?( em| para)?\s*/i, "").trim().slice(0, 80) || null;
  return { type: refund ? "income" : "expense", amount, merchant, installment: null };
}
