// Forma — estima calorias e macros de uma refeição a partir de foto e/ou descrição.
// POST { imagem_base64?, media_type?, texto?, tipo? }  (com o login do usuário)
// Não grava nada: devolve a estimativa para a pessoa revisar e salvar no app.
import { admin as adminClient, cors, json as jsonShared, requireUser } from '../_shared/supabase.ts';

const LIMITE_DIA = Number(Deno.env.get('FORMA_IA_LIMITE_DIA') ?? 40);
const MODELO = Deno.env.get('FORMA_IA_MODELO') ?? 'claude-sonnet-5-5';
const json = (req: Request, body: unknown, status = 200) => jsonShared(req, body, status);

const FERRAMENTA = {
  name: 'registrar_refeicao',
  description: 'Registra a estimativa nutricional da refeição.',
  input_schema: {
    type: 'object',
    properties: {
      e_comida: { type: 'boolean', description: 'false se a imagem/texto não for comida ou bebida' },
      descricao: { type: 'string', description: 'Resumo curto da refeição em português, ex: "Arroz, feijão, frango grelhado e salada"' },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string' },
            quantidade: { type: 'string', description: 'Medida caseira, ex: "4 colheres de sopa", "1 filé médio"' },
            gramas: { type: 'number' },
            kcal: { type: 'number' },
            proteina_g: { type: 'number' },
            carbo_g: { type: 'number' },
            gordura_g: { type: 'number' },
          },
          required: ['nome', 'quantidade', 'gramas', 'kcal', 'proteina_g', 'carbo_g', 'gordura_g'],
        },
      },
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      observacao: { type: 'string', description: 'Uma frase: o que pode mudar a conta (óleo, molho escondido, tamanho do prato). Vazio se nada.' },
    },
    required: ['e_comida', 'descricao', 'itens', 'confianca'],
  },
};

const SISTEMA = `Você é um nutricionista brasileiro estimando calorias de refeições a partir de fotos e descrições.
Regras:
- Use a tabela TACO/IBGE como referência e porções típicas do Brasil (prato feito, marmita, padaria, delivery).
- Estime o tamanho pelo prato, talheres e mãos visíveis. Separe cada alimento em um item.
- Considere óleo de preparo e molhos quando forem prováveis (fritura, refogado, salada temperada) e inclua como item separado.
- Se a pessoa descrever quantidades no texto, o texto manda sobre a foto.
- Prefira números redondos e realistas. Não invente itens que não aparecem.
- Se não for comida, e_comida = false e itens vazio.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { erro: 'método' }, 405);

  const chave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!chave) return json(req, { erro: 'A análise por IA ainda não está ligada (falta ANTHROPIC_API_KEY no servidor).' }, 503);

  let userId: string;
  try { userId = await requireUser(req); } catch { return json(req, { erro: 'Entre no app de novo.' }, 401); }

  let body: { imagem_base64?: string; media_type?: string; texto?: string; tipo?: string };
  try { body = await req.json(); } catch { return json(req, { erro: 'JSON inválido' }, 400); }
  const texto = (body.texto ?? '').slice(0, 600).trim();
  if (!body.imagem_base64 && !texto) return json(req, { erro: 'Mande uma foto ou descreva o que comeu.' }, 400);
  if (body.imagem_base64 && body.imagem_base64.length > 7_000_000) return json(req, { erro: 'Foto grande demais.' }, 413);

  // Limite diário por pessoa
  const admin = adminClient();
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const { data: uso } = await admin.from('forma_ia_uso').select('n').eq('user_id', userId).eq('data', hoje).maybeSingle();
  if ((uso?.n ?? 0) >= LIMITE_DIA) return json(req, { erro: `Limite de ${LIMITE_DIA} análises por dia atingido. Lance manualmente ou amanhã.` }, 429);
  await admin.from('forma_ia_uso').upsert({ user_id: userId, data: hoje, n: (uso?.n ?? 0) + 1 });

  const conteudo: unknown[] = [];
  if (body.imagem_base64) {
    const mt = ['image/jpeg', 'image/png', 'image/webp'].includes(body.media_type ?? '') ? body.media_type : 'image/jpeg';
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: mt, data: body.imagem_base64 } });
  }
  conteudo.push({ type: 'text', text: `Refeição: ${body.tipo ?? 'não informado'}.${texto ? ` Descrição da pessoa: "${texto}"` : ' Sem descrição.'}` });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 1500,
      system: SISTEMA,
      tools: [FERRAMENTA],
      tool_choice: { type: 'tool', name: 'registrar_refeicao' },
      messages: [{ role: 'user', content: conteudo }],
    }),
  });
  if (!r.ok) {
    console.error('anthropic', r.status, await r.text());
    return json(req, { erro: 'A IA não respondeu agora. Tente de novo em instantes.' }, 502);
  }
  const out = await r.json();
  const uso_tool = out.content?.find((c: { type: string }) => c.type === 'tool_use');
  if (!uso_tool) return json(req, { erro: 'Não consegui ler a refeição.' }, 502);
  const e = uso_tool.input;
  if (!e.e_comida) return json(req, { erro: 'Não reconheci comida nessa foto.' }, 422);

  const num = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);
  const itens = (e.itens ?? []).slice(0, 20).map((i: Record<string, unknown>) => ({
    nome: String(i.nome ?? '').slice(0, 80), quantidade: String(i.quantidade ?? '').slice(0, 60),
    gramas: num(i.gramas), kcal: num(i.kcal), proteina_g: num(i.proteina_g), carbo_g: num(i.carbo_g), gordura_g: num(i.gordura_g),
  }));
  return json(req, { descricao: String(e.descricao ?? '').slice(0, 200), itens, confianca: e.confianca, observacao: e.observacao ?? '' });
});
