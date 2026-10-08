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

const IGNORE = [
  /c[oó]digo|token|senha|verifica[cç][aã]o/i,
  /fatura (fechou|est[aá] (aberta|fechada|dispon)|vence|dispon)/i,
  /limite (dispon|aument|ajust)/i,
  /(oferta|promo[cç][aã]o|cashback dispon|cupom|aproveite|convite|empr[eé]stimo pr[eé]-aprovado)/i,
  /(recusad|negad|n[aã]o autorizad|cancelad|estornad[ao] .*pendente)/i,
  /agendad[oa]/i,
];

const INCOME = /(recebid[oa]|voc[eê] recebeu|recebeu (um|uma)|cr[eé]dito em conta|dep[oó]sito|caiu na (sua )?conta|sal[aá]rio|reembolso de|estorno|devolu[cç][aã]o)/i;
const TRANSFER = /(pagamento (da )?fatura|fatura (foi )?paga|pagamento de fatura|aplica[cç][aã]o|resgate|guardou|caixinha|cofrinho|transfer[eê]ncia entre (suas )?contas|mesma titularidade)/i;
const EXPENSE = /(compra|pagamento|pago|paga|pix enviado|voc[eê] (enviou|pagou|fez)|d[eé]bito|saque|transfer[eê]ncia (enviada|realizada)|boleto)/i;

function cleanMerchant(s: string): string | null {
  const t = s
    .replace(/\s+(aprovad[ao]|realizad[ao]|no (cart[aã]o|cr[eé]dito|d[eé]bito)).*$/i, "")
    .replace(/\s+(com|no|na) (seu )?cart[aã]o.*$/i, "")
    .replace(/\s*(às|as|em) \d{1,2}[:h]\d{2}.*$/i, "")
    .replace(/\s+(em|no dia) \d{1,2}\/\d{1,2}.*$/i, "")
    .replace(/[.!,;]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t.length >= 2 ? t.slice(0, 80) : null;
}

function extractMerchant(text: string): string | null {
  const stop = String.raw`(?=\s+(?:foi|R\$|no valor|valor|via|com|para o|pelo|às|as\s+\d|em\s+\d|no (?:cr[eé]dito|d[eé]bito|cart))|[,!]|\.\s|\.$|$)`;
  const pats = [
    new RegExp(String.raw`\b(?:em|no|na)\s+([A-Z0-9][A-Z0-9*&'./ -]{1,}?)` + stop),       // "em IFOOD *REST"
    new RegExp(String.raw`\s[-–]\s+([A-Z0-9][A-Z0-9*&'./ ]{1,}?)` + stop),                  // "- UBER *TRIP"
    new RegExp(String.raw`\bpara\s+(?!o cart|seu|sua)([^\n]+?)` + stop, "i"),               // "para JOAO"
    new RegExp(String.raw`\bde\s+([A-ZÀ-Ú][^\n]+?)` + stop),                                // "Pix de MARIA"
    new RegExp(String.raw`\b(?:em|no|na)\s+([^\n]+?)` + stop, "i"),
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m) {
      const cand = cleanMerchant(m[1]);
      if (cand && !/^(R\$|\d|seu|sua|conta|cart[aã]o|cr[eé]dito|d[eé]bito)/i.test(cand)) return cand;
    }
  }
  return null;
}

/** Movimentações entre contas do próprio usuário (não são gasto nem renda). */
export const SAME_OWNER = /same person|mesma titularidade|credit card payment|pagamento (de |da )?fatura|pagto fatura|pag fatura|transf(er[eê]ncia)? entre contas|aplica[cç][aã]o|resgate|investment.*(application|redemption)|cofrinho|caixinha|porquinho/i;

/** Notificação de app de banco → transação (ou null se não for movimentação). */
export function parseBankNotification(title: string, body: string): ParsedTx | null {
  const text = `${title ?? ""}. ${body ?? ""}`.replace(/\s+/g, " ").trim();
  if (IGNORE.some((r) => r.test(text))) return null;
  const amount = parseBRL(text);
  if (!amount) return null;

  let type: ParsedTx["type"] | null = null;
  if (TRANSFER.test(text)) type = "transfer";
  else if (INCOME.test(text)) type = "income";
  else if (EXPENSE.test(text)) type = "expense";
  if (!type) return null;

  const inst = text.match(/(\d{1,2})\s*(?:x|\/)\s*(?:de\s*)?(?:R\$)?/i);
  const installment = /parcel|\d+x/i.test(text) && inst ? `1/${inst[1]}` : null;
  return { type, amount, merchant: extractMerchant(body || title), installment };
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
