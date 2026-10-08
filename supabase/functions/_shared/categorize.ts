// Categorização automática, em ordem de prioridade:
//   1. regras do próprio usuário (aprendidas quando ele corrige uma categoria)
//   2. palavras-chave padrão (estabelecimentos comuns no Brasil)
//   3. categoria que o Pluggy/Open Finance já informa
//   4. "Outros gastos" / "Outras entradas"
import { normalizeMerchant } from "./parse.ts";

export type Category = { id: string; name: string; kind: "income" | "expense" };
export type Rule = { pattern: string; category_id: string; mark_reimbursable: boolean };

// Palavras inteiras (ou prefixos, marcados com *), na ordem de prioridade.
// A ordem importa: "amazon prime" (Assinaturas) antes de "amazon" (Compras);
// "mercado livre" (Compras) antes de "mercado" (Mercado).
const KEYWORD_LISTS: [string, string[]][] = [
  ["Assinaturas", ["netflix*", "spotify*", "disney*", "hbo*", "prime video", "amazon prime*", "amazonprime*", "youtube*", "deezer*", "globoplay*", "apple com*", "apple bill", "icloud*", "google one", "google storage", "chatgpt*", "openai*", "claude ai", "anthropic*", "canva*", "adobe*", "microsoft*", "xbox game pass", "playstation plus", "psn*", "crunchyroll*", "paramount*", "smart fit", "smartfit*", "totalpass*", "gympass*", "wellhub*", "linkedin*", "dropbox*", "notion*", "max com"]],
  ["Restaurantes e delivery", ["ifood*", "ifd", "rappi*", "ze delivery", "aiqfome*", "99food*", "mcdonald*", "mc donalds", "burger king", "bk brasil", "subway*", "habib*", "outback*", "starbucks*", "restaurante*", "restaurant*", "lanchonete*", "padaria*", "panificadora*", "pizzaria*", "pizza*", "sushi*", "cafe", "cafes", "cafeteria*", "bar", "boteco*", "churrascaria*", "hamburgueria*", "burger*", "acai*", "sorveteria*", "doceria*", "confeitaria*", "giraffas*", "spoleto*", "coco bambu", "madero*", "lanches", "esfiharia*"]],
  ["Compras", ["mercado livre", "mercadolivre*", "mercadolibre*", "amazon*", "shopee*", "aliexpress*", "shein*", "temu*", "magalu*", "magazine luiza", "americanas*", "casas bahia", "renner*", "riachuelo*", "c a", "cea", "zara*", "centauro*", "netshoes*", "decathlon*", "kabum*", "fast shop", "fastshop*", "leroy*", "tok stok", "tokstok*", "dafiti*", "nike*", "adidas*", "havan*", "pernambucanas*"]],
  ["Mercado", ["carrefour*", "pao de acucar", "extra", "assai*", "atacad*", "atacadao*", "dia", "hirota*", "sonda*", "mambo*", "st marche", "oba hortifruti", "mercado", "mercados", "supermercado*", "supermerc*", "mercadinho*", "minimercado*", "hortifruti*", "sacolao*", "acougue*", "swift*", "max atacadista", "makro*", "sams club", "tenda atacado", "oxxo*", "natural da terra"]],
  ["Transporte", ["uber", "ubertrip*", "uberx", "99 pop", "99app*", "99 taxi", "99 tecnologia", "cabify*", "indrive*", "posto*", "shell*", "ipiranga*", "petrobras*", "br mania", "combustivel*", "estacionamento*", "estapar*", "sem parar", "semparar*", "conectcar*", "veloe*", "metro", "cptm*", "sptrans*", "bilhete unico", "zul", "pedagio*", "ipva", "detran*", "onibus", "buser*", "clickbus*", "localiza*", "movida*", "unidas*"]],
  ["Moradia", ["aluguel*", "condominio*", "quinto andar", "quintoandar*", "imobiliaria*", "iptu"]],
  ["Contas e serviços", ["enel*", "eletropaulo*", "light", "cemig*", "copel*", "sabesp*", "comgas*", "naturgy*", "vivo*", "claro*", "tim", "oi", "net", "internet*", "energia*", "conta de luz", "conta de agua", "agua e esgoto", "sky", "cpfl*", "celesc*", "coelba*", "celpe*", "sanepar*", "copasa*", "embasa*", "ultragaz*", "liquigas*"]],
  ["Saúde", ["drogasil*", "droga raia", "raia*", "drogaria*", "farmacia*", "pague menos", "panvel*", "hospital*", "clinica*", "laborat*", "unimed*", "amil*", "sulamerica*", "bradesco saude", "hapvida*", "dentista*", "odonto*", "psicolog*", "dasa*", "fleury*", "lavoisier*"]],
  ["Educação", ["udemy*", "alura*", "coursera*", "escola*", "faculdade*", "universidade*", "curso*", "livraria*", "saraiva*", "estante virtual", "duolingo*"]],
  ["Lazer", ["steam*", "nuuvem*", "epic games", "playstation*", "xbox*", "nintendo*", "cinema*", "cinemark*", "kinoplex*", "ingresso*", "sympla*", "eventim*", "ticket*", "show", "teatro*", "parque*"]],
  ["Cuidados pessoais", ["barbearia*", "barber*", "salao*", "cabeleireiro*", "estetica*", "manicure*", "boticario*", "natura", "sephora*", "perfumaria*"]],
  ["Taxas e juros", ["iof", "juros", "tarifa*", "anuidade*", "multa", "encargo*", "mora"]],
  ["Reserva e investimentos", ["cdb", "tesouro*", "corretora*", "xp invest*", "rico invest*", "nuinvest*", "btg*", "investimento*", "previdencia*"]],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORDS: [RegExp, string][] = KEYWORD_LISTS.map(([cat, words]) => [
  new RegExp(`(?:^| )(?:${words.map((w) => w.endsWith("*") ? esc(w.slice(0, -1)) + "[a-z0-9]*" : esc(w)).join("|")})(?= |$)`),
  cat,
]);

const INCOME_KEYWORDS: [RegExp, string][] = [
  [/salario|folha|pagto sal|proventos|remuneracao/, "Salário"],
  [/reembolso/, "Reembolsos"],
  [/rendimento|juros sobre|dividendo|jcp/, "Rendimentos"],
  [/estorno|devolucao|cashback/, "Estornos"],
];

// Categorias do Pluggy (em inglês) → nossas
const PLUGGY_MAP: [RegExp, string][] = [
  [/eating out|restaurant|food delivery/i, "Restaurantes e delivery"],
  [/groceries|supermarket/i, "Mercado"],
  [/transport|taxi|ride|gas station|parking|tolls|vehicle|fuel/i, "Transporte"],
  [/rent|housing|condominium/i, "Moradia"],
  [/utilities|electricity|water|internet|telecom|phone/i, "Contas e serviços"],
  [/health|pharmacy|hospital|dentist|insurance - health/i, "Saúde"],
  [/education|school|university|course/i, "Educação"],
  [/leisure|entertainment|games|tickets|culture|sports/i, "Lazer"],
  [/digital services|streaming|subscription/i, "Assinaturas"],
  [/shopping|clothing|electronics|online shopping/i, "Compras"],
  [/beauty|wellness|personal care/i, "Cuidados pessoais"],
  [/interest|bank fees|taxes|iof|late payment/i, "Taxas e juros"],
  [/investment/i, "Reserva e investimentos"],
  [/salary/i, "Salário"],
];

export function pickCategory(
  opts: { type: "income" | "expense" | "transfer"; text: string; providerCategory?: string | null },
  categories: Category[],
  rules: Rule[],
): { category_id: string | null; reimbursable: boolean } {
  if (opts.type === "transfer") return { category_id: null, reimbursable: false };
  const norm = (normalizeMerchant(opts.text) + " ").replace(/\b(mercado ?pago|pagseguro|pagbank|picpay|paypal|stone|cielo|getnet|sumup)\b/g, " ").replace(/\s+/g, " ");
  const byName = (n: string) => categories.find((c) => c.name === n && c.kind === opts.type)?.id ?? null;

  // 1. regras do usuário — a mais longa (mais específica) vence
  const rule = [...rules]
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((r) => norm.includes(normalizeMerchant(r.pattern)));
  if (rule && categories.some((c) => c.id === rule.category_id && c.kind === opts.type)) {
    return { category_id: rule.category_id, reimbursable: rule.mark_reimbursable };
  }

  // 2. palavras-chave
  const list = opts.type === "income" ? INCOME_KEYWORDS : KEYWORDS;
  for (const [re, name] of list) if (re.test(norm)) { const id = byName(name); if (id) return { category_id: id, reimbursable: false }; }

  // 3. categoria do provedor
  if (opts.providerCategory) {
    for (const [re, name] of PLUGGY_MAP) if (re.test(opts.providerCategory)) {
      const id = byName(name); if (id) return { category_id: id, reimbursable: false };
    }
  }

  // 4. Pix/transferência para pessoa sem regra: fica "sem categoria" para você classificar
  //    uma vez (vai para "Revisar"); a escolha vira regra e os próximos Pix para ela já entram certos.
  if (opts.providerCategory && /\bpix\b|transfer/i.test(opts.providerCategory)) return { category_id: null, reimbursable: false };

  // 5. fallback
  return { category_id: byName(opts.type === "income" ? "Outras entradas" : "Outros gastos"), reimbursable: false };
}
