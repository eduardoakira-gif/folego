// Categorização automática, em ordem de prioridade:
//   1. regras do próprio usuário (aprendidas quando ele corrige uma categoria)
//   2. palavras-chave padrão (estabelecimentos comuns no Brasil)
//   3. categoria que o Pluggy/Open Finance já informa
//   4. "Outros gastos" / "Outras entradas"
import { normalizeMerchant } from "./parse.ts";

export type Category = { id: string; name: string; kind: "income" | "expense" };
export type Rule = { pattern: string; category_id: string; mark_reimbursable: boolean };

const KEYWORDS: [RegExp, string][] = [
  [/ifood|rappi|ze delivery|aiqfome|99food|mcdonald|burger king|bk |subway|habib|outback|starbucks|restaurante|lanchonete|padaria|pizzaria|sushi|cafe|bar /, "Restaurantes e delivery"],
  [/carrefour|pao de acucar|extra |assai|atacad|dia |hirota|sonda|mambo|st marche|oba hortifruti|mercado|supermerc|hortifruti|sacolao|acougue|swift/, "Mercado"],
  [/uber|99 ?(pop|app|taxi)|cabify|indrive|posto|shell|ipiranga|petrobras|br mania|combustivel|estacionamento|estapar|sem parar|conectcar|veloe|metro|cptm|sptrans|bilhete unico|zul |pedagio|ipva|detran|onibus|buser|clickbus/, "Transporte"],
  [/netflix|spotify|disney|hbo|max |prime video|amazon prime|youtube|deezer|globoplay|apple com|icloud|google (one|storage)|chatgpt|openai|claude|anthropic|canva|adobe|microsoft|xbox game pass|playstation plus|psn|crunchyroll|paramount|smart fit|totalpass|gympass|wellhub/, "Assinaturas"],
  [/aluguel|condominio|quinto andar|quintoandar|imobiliaria|iptu/, "Moradia"],
  [/enel|eletropaulo|light |cemig|copel|sabesp|comgas|naturgy|vivo|claro|tim |oi |net |internet|energia|agua|gas /, "Contas e serviços"],
  [/drogasil|droga raia|raia|pague menos|panvel|farmacia|drogaria|hospital|clinica|laborat|unimed|amil|sulamerica|bradesco saude|hapvida|dentista|odonto|psicolog/, "Saúde"],
  [/udemy|alura|coursera|escola|faculdade|universidade|curso|livraria|saraiva|estante virtual|duolingo/, "Educação"],
  [/steam|nuuvem|epic games|playstation|xbox|nintendo|cinema|cinemark|ingresso|sympla|eventim|ticket|show|teatro|parque/, "Lazer"],
  [/amazon|mercado ?livre|mercadolivre|shopee|aliexpress|shein|magalu|magazine luiza|americanas|casas bahia|renner|riachuelo|c&a|cea |zara|centauro|netshoes|decathlon|kabum|fast shop|leroy|tok stok/, "Compras"],
  [/barbearia|salao|cabeleireiro|estetica|manicure|boticario|natura|sephora|perfumaria/, "Cuidados pessoais"],
  [/iof|juros|tarifa|anuidade|multa|encargo|mora /, "Taxas e juros"],
  [/cdb|tesouro|corretora|xp invest|rico |clear |nuinvest|btg|investimento|previdencia/, "Reserva e investimentos"],
];

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
  const norm = normalizeMerchant(opts.text) + " ";
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

  // 4. fallback
  return { category_id: byName(opts.type === "income" ? "Outras entradas" : "Outros gastos"), reimbursable: false };
}
