// Forma — lembretes por notificação (Web Push) e respostas tocadas na própria notificação.
//
//   GET  ?acao=vapid                         → chave pública para o app assinar as notificações
//   POST ?acao=tick       (x-cron-secret)    → roda a cada 15 min (GitHub Actions): água, pesagem, treino
//   POST ?acao=responder  {token, resposta}  → botão tocado na notificação (sem precisar abrir o app)
//   POST ?acao=teste      (login do usuário) → manda uma notificação de teste para os aparelhos da pessoa
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { admin as adminClient, cors, json as jsonShared, requireUser } from '../_shared/supabase.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const admin = adminClient();
const SEGREDO = Deno.env.get('CRON_SECRET') ?? '';
const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const ORIGENS = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const APP_URL = Deno.env.get('FORMA_APP_URL') || (ORIGENS[0] && ORIGENS[0] !== '*' ? `${ORIGENS[0].replace(/\/$/, '')}/folego/forma/` : '/folego/forma/');
if (VAPID_PUB && VAPID_PRIV) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:forma@example.com', VAPID_PUB, VAPID_PRIV);

const json = (req: Request, b: unknown, s = 200) => jsonShared(req, b, s);

// ---------- token assinado das ações (vale 20 h) ----------
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode('forma-acao:' + SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function criarToken(userId: string, data: string) {
  const base = `${userId}.${data}.${Date.now() + 20 * 3600_000}`;
  return `${base}.${await hmac(base)}`;
}
async function lerToken(t: string) {
  const p = (t ?? '').split('.');
  if (p.length !== 4) return null;
  const base = p.slice(0, 3).join('.');
  if ((await hmac(base)) !== p[3] || Number(p[2]) < Date.now()) return null;
  return { userId: p[0], data: p[1] };
}

// ---------- horário local ----------
function agoraLocal(tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const hh = Number(p.hour) % 24;
  return { data: `${p.year}-${p.month}-${p.day}`, min: hh * 60 + Number(p.minute) };
}
const hm = (s: string) => { const [h, m] = (s ?? '00:00').split(':').map(Number); return h * 60 + (m || 0); };
const litros = (ml: number) => (ml / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Aviso = { tipo: string; titulo: string; corpo: string; acoes?: { action: string; title: string }[]; url: string };

async function enviar(userId: string, aviso: Aviso, data: string) {
  const { data: subs } = await admin.from('forma_push').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  if (!subs?.length) return 0;
  const token = await criarToken(userId, data);
  const payload = JSON.stringify({ ...aviso, tag: `forma-${aviso.tipo}`, token, api: `${URL_SB}/functions/v1/forma-lembretes?acao=responder` });
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'normal' });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('forma_push').delete().eq('id', s.id); // aparelho desinstalou/expirou
      else console.error('push', code, (e as Error).message);
    }
  }
  if (ok) await admin.from('forma_lembretes_log').insert({ user_id: userId, tipo: aviso.tipo, data });
  return ok;
}

async function tick() {
  const { data: subs } = await admin.from('forma_push').select('user_id');
  const usuarios = [...new Set((subs ?? []).map((s) => s.user_id))];
  const enviados: string[] = [];
  for (const uid of usuarios) {
    const { data: perfil } = await admin.from('forma_perfil').select('*').eq('user_id', uid).maybeSingle();
    if (!perfil) continue;
    const { data: hoje, min } = agoraLocal(perfil.timezone ?? 'America/Sao_Paulo');
    const L = perfil.lembretes ?? {};
    const [{ data: logs }, { data: agua }, { data: pes }, { data: ultimoPeso }, { data: ck }] = await Promise.all([
      admin.from('forma_lembretes_log').select('tipo, enviado_em').eq('user_id', uid).eq('data', hoje),
      admin.from('forma_agua').select('ml, created_at').eq('user_id', uid).eq('data', hoje),
      admin.from('forma_pesagens').select('id').eq('user_id', uid).eq('data', hoje).maybeSingle(),
      admin.from('forma_pesagens').select('peso_kg').eq('user_id', uid).order('data', { ascending: false }).limit(1).maybeSingle(),
      admin.from('forma_checkins').select('treinou, cardio').eq('user_id', uid).eq('data', hoje).maybeSingle(),
    ]);
    const ultimoLog = (tipo: string) => (logs ?? []).filter((l) => l.tipo === tipo).map((l) => new Date(l.enviado_em).getTime()).sort().pop();

    // Pesagem: uma vez, na janela de 3 h depois do horário, se ainda não pesou
    if (L.pesagem?.ativo && !pes && min >= hm(L.pesagem.hora) && min < hm(L.pesagem.hora) + 180 && !ultimoLog('pesagem')) {
      if (await enviar(uid, { tipo: 'pesagem', titulo: '⚖️ Hora da pesagem', corpo: 'Ao acordar, depois do banheiro e antes de comer. Leva 10 segundos.', url: `${APP_URL}#hoje/peso` }, hoje)) enviados.push(`${uid}:pesagem`);
    }

    // Água: dentro da janela, a cada intervalo, só se não bebeu recentemente e não bateu a meta
    if (L.agua?.ativo && min >= hm(L.agua.inicio) && min <= hm(L.agua.fim)) {
      const meta = perfil.agua_meta_ml ?? Math.round((35 * Number(ultimoPeso?.peso_kg ?? 70)) / 50) * 50;
      const total = (agua ?? []).reduce((s, a) => s + a.ml, 0);
      const intervalo = (L.agua.intervalo_min ?? 120) * 60_000;
      const ultimaAgua = (agua ?? []).filter((a) => a.ml > 0).map((a) => new Date(a.created_at).getTime()).sort().pop() ?? 0;
      const ultimoAviso = ultimoLog('agua') ?? 0;
      const agora = Date.now();
      // Quanto já deveria ter bebido até agora, proporcional ao dia
      const esperado = meta * Math.min(1, (min - hm(L.agua.inicio)) / Math.max(60, hm(L.agua.fim) - hm(L.agua.inicio)));
      if (total < meta && agora - ultimoAviso >= intervalo && agora - ultimaAgua >= intervalo * 0.75) {
        const atras = total < esperado - 250;
        const corpo = `${litros(total)} de ${litros(meta)} L hoje${atras ? ` — ${litros(esperado - total)} L atrás do ritmo` : ''}. Toque para registrar.`;
        if (await enviar(uid, { tipo: 'agua', titulo: '💧 Bebe uma água', corpo, url: `${APP_URL}#hoje/agua`, acoes: [{ action: 'agua250', title: '+250 ml' }, { action: 'agua500', title: '+500 ml' }] }, hoje)) enviados.push(`${uid}:agua`);
      }
    }

    // Treino: uma vez no horário (e um lembrete final às 23h se ainda não respondeu)
    if (L.treino?.ativo && (ck?.treinou == null)) {
      const primeiro = min >= hm(L.treino.hora) && !ultimoLog('treino');
      const ultimo = min >= 23 * 60 && (logs ?? []).filter((l) => l.tipo === 'treino').length === 1 && ultimoLog('treino')! < Date.now() - 90 * 60_000;
      if (primeiro || ultimo) {
        if (await enviar(uid, { tipo: 'treino', titulo: '🏋️ Treinou hoje?', corpo: 'Responda aqui mesmo. Depois eu pergunto do cardio.', url: `${APP_URL}#hoje/treino`, acoes: [{ action: 'treino_sim', title: 'Treinei ✅' }, { action: 'treino_nao', title: 'Não treinei' }] }, hoje)) enviados.push(`${uid}:treino`);
      }
    }
  }
  return enviados;
}

async function responder(token: string, resposta: string) {
  const t = await lerToken(token);
  if (!t) return { erro: 'token inválido ou expirado', status: 401 };
  const { userId, data } = t;
  if (resposta === 'agua250' || resposta === 'agua500') {
    const ml = resposta === 'agua250' ? 250 : 500;
    await admin.from('forma_agua').insert({ user_id: userId, data, ml, origem: 'notificacao' });
    const { data: ag } = await admin.from('forma_agua').select('ml').eq('user_id', userId).eq('data', data);
    const total = (ag ?? []).reduce((s, a) => s + a.ml, 0);
    return { ok: true, mensagem: `💧 +${ml} ml. Total hoje: ${litros(total)} L` };
  }
  if (resposta === 'treino_sim' || resposta === 'treino_nao') {
    await upsertCheckin(admin, userId, data, { treinou: resposta === 'treino_sim' });
    const token2 = await criarToken(userId, data);
    return {
      ok: true,
      proxima: { tipo: 'cardio', titulo: resposta === 'treino_sim' ? '💪 Boa! E cardio, fez?' : 'Tudo bem. Fez cardio hoje?', corpo: 'Caminhada, bike, corrida, escada…', acoes: [{ action: 'cardio_sim', title: 'Fiz cardio' }, { action: 'cardio_nao', title: 'Não fiz' }], token: token2, url: `${APP_URL}#hoje/treino` },
    };
  }
  if (resposta === 'cardio_sim' || resposta === 'cardio_nao') {
    await upsertCheckin(admin, userId, data, { cardio: resposta === 'cardio_sim' });
    return { ok: true, mensagem: resposta === 'cardio_sim' ? '🔥 Registrado. Amanhã tem mais.' : 'Registrado. Amanhã é outro dia.' };
  }
  return { erro: 'resposta desconhecida', status: 400 };
}

async function upsertCheckin(db: SupabaseClient, userId: string, data: string, campos: Record<string, unknown>) {
  await db.from('forma_checkins').upsert({ user_id: userId, data, origem: 'notificacao', ...campos }, { onConflict: 'user_id,data' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  const acao = new URL(req.url).searchParams.get('acao');

  if (acao === 'vapid') return json(req, { chave: VAPID_PUB || null });

  if (acao === 'tick') {
    const dado = req.headers.get('x-cron-secret') ?? (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    if (!SEGREDO || dado !== SEGREDO) return json(req, { erro: 'não autorizado' }, 401);
    if (!VAPID_PUB) return json(req, { erro: 'faltam VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' }, 503);
    return json(req, { enviados: await tick() });
  }

  if (acao === 'responder') {
    const b = await req.json().catch(() => ({}));
    const r = await responder(b.token, b.resposta);
    return json(req, r, (r as { status?: number }).status ?? 200);
  }

  if (acao === 'teste') {
    let userId: string;
    try { userId = await requireUser(req); } catch { return json(req, { erro: 'Entre no app de novo.' }, 401); }
    if (!VAPID_PUB) return json(req, { erro: 'Notificações ainda não configuradas no servidor (chaves VAPID).' }, 503);
    const { data: hoje } = agoraLocal('America/Sao_Paulo');
    const n = await enviar(userId, { tipo: 'teste', titulo: '✅ Notificações ligadas', corpo: 'É assim que vou te lembrar da água, da pesagem e do treino.', url: APP_URL, acoes: [{ action: 'agua250', title: '+250 ml' }] }, hoje);
    return json(req, { enviados: n });
  }

  return json(req, { erro: 'ação desconhecida' }, 404);
});
