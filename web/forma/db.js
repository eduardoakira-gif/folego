// Forma — camada de dados. Duas implementações com a mesma interface:
// - SupabaseStore: o banco real (mesmo projeto e login do Fôlego).
// - DemoStore: dados fictícios em memória, para ver o app sem configurar nada.
import { isoDia } from './calc.js';

export const TZ = 'America/Sao_Paulo';
export const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const somarDias = (iso, n) => isoDia(new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000));

// Usa o mesmo config.js do Fôlego (gerado pelo GitHub a partir das Variables do repositório).
export function lerConfig() {
  const C = window.APP_CONFIG || {};
  const ok = (v) => v && !/SEU-PROJETO|SUA_ANON_KEY|^__/.test(String(v));
  if (ok(C.SUPABASE_URL) && ok(C.SUPABASE_ANON_KEY)) return { url: C.SUPABASE_URL.replace(/\/$/, ''), anonKey: C.SUPABASE_ANON_KEY };
  try { const c = JSON.parse(localStorage.getItem('forma-config') || 'null'); if (c?.url && c?.anonKey) return c; } catch {}
  return null;
}

// ------------------------------------------------------------------ Supabase
export class SupabaseStore {
  constructor(sb, cfg) { this.sb = sb; this.cfg = cfg; this.demo = false; }
  static async criar(cfg) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    const sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return new SupabaseStore(sb, cfg);
  }
  async sessao() { const { data } = await this.sb.auth.getSession(); return data.session; }
  async entrar(email, senha) { const { error } = await this.sb.auth.signInWithPassword({ email, password: senha }); if (error) throw traduzir(error); }
  async sair() { await this.sb.auth.signOut(); }
  get uid() { return this._uid; }
  async iniciar() { const s = await this.sessao(); this._uid = s?.user?.id; this.email = s?.user?.email; return !!s; }

  async perfil() { const { data, error } = await this.sb.from('forma_perfil').select('*').maybeSingle(); if (error) throw error; return data; }
  async salvarPerfil(p) { const { data, error } = await this.sb.from('forma_perfil').upsert({ ...p, user_id: this.uid }).select().single(); if (error) throw error; return data; }

  async pesagens(desde = '2000-01-01') { const { data, error } = await this.sb.from('forma_pesagens').select('id,data,peso_kg,gordura_pct,observacao').gte('data', desde).order('data'); if (error) throw error; return data; }
  async salvarPesagem(data, peso_kg, extra = {}) { const { error } = await this.sb.from('forma_pesagens').upsert({ user_id: this.uid, data, peso_kg, ...extra }, { onConflict: 'user_id,data' }); if (error) throw error; }
  async apagarPesagem(id) { const { error } = await this.sb.from('forma_pesagens').delete().eq('id', id); if (error) throw error; }

  async refeicoes(de, ate) { const { data, error } = await this.sb.from('forma_refeicoes').select('*').gte('data', de).lte('data', ate).is('deleted_at', null).order('momento'); if (error) throw error; return data; }
  async recentes() { const { data } = await this.sb.from('forma_refeicoes').select('descricao,itens,kcal,proteina_g,carbo_g,gordura_g,tipo,favorito').is('deleted_at', null).order('momento', { ascending: false }).limit(60); return data || []; }
  async salvarRefeicao(r) { const q = r.id ? this.sb.from('forma_refeicoes').update(r).eq('id', r.id) : this.sb.from('forma_refeicoes').insert({ ...r, user_id: this.uid }); const { error } = await q; if (error) throw error; }
  async apagarRefeicao(id) { const { error } = await this.sb.from('forma_refeicoes').update({ deleted_at: new Date().toISOString() }).eq('id', id); if (error) throw error; }

  async agua(data) { const { data: d } = await this.sb.from('forma_agua').select('ml,created_at').eq('data', data); return d || []; }
  async somarAgua(data, ml) { const { error } = await this.sb.from('forma_agua').insert({ user_id: this.uid, data, ml }); if (error) throw error; }

  async checkins(desde) { const { data } = await this.sb.from('forma_checkins').select('*').gte('data', desde).order('data'); return data || []; }
  async salvarCheckin(data, campos) { const { error } = await this.sb.from('forma_checkins').upsert({ user_id: this.uid, data, ...campos, origem: 'app' }, { onConflict: 'user_id,data' }); if (error) throw error; }

  async kcalPorDia(desde) {
    const { data } = await this.sb.from('forma_refeicoes').select('data,kcal').gte('data', desde).is('deleted_at', null);
    const m = {}; (data || []).forEach((r) => (m[r.data] = (m[r.data] || 0) + Number(r.kcal))); return m;
  }

  async avaliacoes() { const { data, error } = await this.sb.from('forma_avaliacoes').select('*').is('deleted_at', null).order('data'); if (error) throw error; return data; }
  async salvarAvaliacao(a) { const { data, error } = await this.sb.from('forma_avaliacoes').insert({ ...a, user_id: this.uid }).select().single(); if (error) throw error; return data; }
  async apagarAvaliacao(id) { const { error } = await this.sb.from('forma_avaliacoes').update({ deleted_at: new Date().toISOString() }).eq('id', id); if (error) throw error; }

  async enviarFoto(blob, pasta) {
    const caminho = `${this.uid}/${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await this.sb.storage.from('forma-fotos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error; return caminho;
  }
  async urlFoto(caminho) { if (!caminho) return null; const { data } = await this.sb.storage.from('forma-fotos').createSignedUrl(caminho, 3600); return data?.signedUrl || null; }

  async funcao(nome, body, query = '') {
    const s = await this.sessao();
    const r = await fetch(`${this.cfg.url}/functions/v1/${nome}${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', apikey: this.cfg.anonKey, ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || j.error || `Erro ${r.status}`);
    return j;
  }
  analisarRefeicao(payload) { return this.funcao('forma-ia', payload); }
  async chaveVapid() { return (await this.funcao('forma-lembretes', null, '?acao=vapid')).chave; }
  async salvarPush(sub) {
    const j = sub.toJSON();
    const { error } = await this.sb.from('forma_push').upsert({ user_id: this.uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' });
    if (error) throw error;
  }
  async removerPush(endpoint) { await this.sb.from('forma_push').delete().eq('endpoint', endpoint); }
  testarPush() { return this.funcao('forma-lembretes', {}, '?acao=teste'); }

  async apagarTudo() {
    const pastas = ['corpo', 'comida'];
    for (const p of pastas) {
      const { data } = await this.sb.storage.from('forma-fotos').list(`${this.uid}/${p}`, { limit: 1000 });
      if (data?.length) await this.sb.storage.from('forma-fotos').remove(data.map((f) => `${this.uid}/${p}/${f.name}`));
    }
    const { error } = await this.sb.rpc('forma_apagar_meus_dados'); if (error) throw error;
  }
}

function traduzir(e) {
  const m = e.message || '';
  if (/Invalid login/i.test(m)) return new Error('E-mail ou senha incorretos.');
  if (/Email not confirmed/i.test(m)) return new Error('Confirme seu e-mail pelo link que chegou na caixa de entrada.');
  return new Error(m);
}

// ------------------------------------------------------------------ Demonstração
export class DemoStore {
  constructor() {
    this.demo = true; this.email = 'demo@forma'; this._uid = 'demo';
    const hoje = hojeISO();
    this.p = { sexo: 'M', nascimento: '1992-05-10', altura_cm: 178, atividade: 'leve', peso_meta_kg: 80, ritmo: 'moderado', agua_meta_ml: null, kcal_meta_manual: null,
      lembretes: { agua: { ativo: true, inicio: '08:00', fim: '22:00', intervalo_min: 120 }, pesagem: { ativo: true, hora: '07:30' }, treino: { ativo: true, hora: '21:00' } }, calibracao: {}, guardar_fotos: true };
    // 60 dias: começa em 92,4 e desce ~0,45 kg/semana, com oscilação de água/sal
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    this.pes = []; this.ck = []; this.ref = []; this.ag = {};
    for (let i = 59; i >= 0; i--) {
      const d = somarDias(hoje, -i);
      if (rnd() > 0.18 || i === 0) this.pes.push({ id: 'p' + i, data: d, peso_kg: Math.round((92.4 - (59 - i) * 0.064 + (rnd() - 0.5) * 1.1) * 10) / 10 });
      if (i > 0) this.ck.push({ data: d, treinou: rnd() > 0.35, cardio: rnd() > 0.5, treino_min: 60, cardio_min: 25 });
      if (i <= 25 && i > 0) {
        const k = 1950 + Math.round((rnd() - 0.5) * 500);
        this.ref.push({ id: 'r' + i, data: d, momento: d + 'T13:00:00Z', tipo: 'almoco', descricao: 'Dia registrado', itens: [], kcal: k, proteina_g: 120 + Math.round(rnd() * 40), carbo_g: 200, gordura_g: 65, origem: 'manual' });
        this.ag[d] = [{ ml: 2400 + Math.round(rnd() * 900), created_at: d + 'T20:00:00Z' }];
      }
    }
    this.ref.push(
      { id: 'h1', data: hoje, momento: hoje + 'T10:20:00Z', tipo: 'cafe', descricao: 'Pão na chapa, ovos mexidos e café com leite', itens: [
        { nome: 'Pão francês na chapa', quantidade: '1 unidade', gramas: 50, kcal: 180, proteina_g: 5, carbo_g: 29, gordura_g: 5 },
        { nome: 'Ovos mexidos', quantidade: '2 ovos', gramas: 100, kcal: 180, proteina_g: 13, carbo_g: 1, gordura_g: 14 },
        { nome: 'Café com leite', quantidade: '1 xícara', gramas: 200, kcal: 90, proteina_g: 5, carbo_g: 8, gordura_g: 4 } ],
        kcal: 450, proteina_g: 23, carbo_g: 38, gordura_g: 23, origem: 'foto', confianca: 'alta' },
      { id: 'h2', data: hoje, momento: hoje + 'T15:40:00Z', tipo: 'almoco', descricao: 'Arroz, feijão, frango grelhado e salada', itens: [
        { nome: 'Arroz branco', quantidade: '4 col. sopa', gramas: 100, kcal: 128, proteina_g: 2.5, carbo_g: 28, gordura_g: 0.2 },
        { nome: 'Feijão carioca', quantidade: '1 concha', gramas: 90, kcal: 69, proteina_g: 4.3, carbo_g: 12, gordura_g: 0.5 },
        { nome: 'Frango grelhado', quantidade: '1 filé médio', gramas: 120, kcal: 191, proteina_g: 38, carbo_g: 0, gordura_g: 3 },
        { nome: 'Salada com azeite', quantidade: '1 prato raso', gramas: 120, kcal: 75, proteina_g: 1, carbo_g: 4, gordura_g: 6 } ],
        kcal: 463, proteina_g: 45.8, carbo_g: 44, gordura_g: 9.7, origem: 'foto', confianca: 'media' },
    );
    this.ag[hoje] = [{ ml: 500, created_at: new Date().toISOString() }, { ml: 750, created_at: new Date().toISOString() }];
    this.av = [
      { id: 'a1', data: somarDias(hoje, -56), peso_kg: 92.2, altura_cm: 178, medidas: { ombros_largura: 47.5, pescoco: 41.2, peito: 109.4, cintura: 103.8, quadril: 108.1, coxa: 61.5, braco: 35.6 }, indicadores: { gorduraPct: 26.9, rce: 0.58 }, detalhes: { relacaoLadoFrente: { peito: 0.74, cintura: 0.83, quadril: 0.71 } }, fonte: 'foto' },
      { id: 'a2', data: somarDias(hoje, -28), peso_kg: 90.4, altura_cm: 178, medidas: { ombros_largura: 47.3, pescoco: 40.6, peito: 107.9, cintura: 100.9, quadril: 106.6, coxa: 60.6, braco: 35.4 }, indicadores: { gorduraPct: 25.3, rce: 0.57 }, detalhes: { relacaoLadoFrente: { peito: 0.73, cintura: 0.8, quadril: 0.7 } }, fonte: 'foto' },
      { id: 'a3', data: somarDias(hoje, -1), peso_kg: 88.9, altura_cm: 178, medidas: { ombros_largura: 47.4, pescoco: 40.1, peito: 106.8, cintura: 98.2, quadril: 105.3, coxa: 59.8, braco: 35.5 }, indicadores: { gorduraPct: 23.9, rce: 0.55 }, detalhes: { relacaoLadoFrente: { peito: 0.73, cintura: 0.78, quadril: 0.7 } }, fonte: 'foto' },
    ];
  }
  async iniciar() { if (new URLSearchParams(location.search).has('novo')) this.p = null; return true; }
  async sair() {}
  get uid() { return 'demo'; }
  async perfil() { return this.p; }
  async salvarPerfil(p) { this.p = { ...this.p, ...p }; return this.p; }
  async pesagens(desde = '2000-01-01') { return this.pes.filter((p) => p.data >= desde).sort((a, b) => a.data.localeCompare(b.data)); }
  async salvarPesagem(data, peso_kg) { const e = this.pes.find((p) => p.data === data); if (e) e.peso_kg = peso_kg; else this.pes.push({ id: 'n' + Date.now(), data, peso_kg }); }
  async apagarPesagem(id) { this.pes = this.pes.filter((p) => p.id !== id); }
  async refeicoes(de, ate) { return this.ref.filter((r) => r.data >= de && r.data <= ate).sort((a, b) => a.momento.localeCompare(b.momento)); }
  async recentes() { return [...this.ref].reverse().filter((r) => r.itens.length); }
  async salvarRefeicao(r) { if (r.id) Object.assign(this.ref.find((x) => x.id === r.id), r); else this.ref.push({ ...r, id: 'n' + Date.now(), momento: r.momento || new Date().toISOString() }); }
  async apagarRefeicao(id) { this.ref = this.ref.filter((r) => r.id !== id); }
  async agua(data) { return this.ag[data] || []; }
  async somarAgua(data, ml) { (this.ag[data] ||= []).push({ ml, created_at: new Date().toISOString() }); }
  async checkins(desde) { return this.ck.filter((c) => c.data >= desde); }
  async salvarCheckin(data, campos) { const e = this.ck.find((c) => c.data === data); if (e) Object.assign(e, campos); else this.ck.push({ data, ...campos }); }
  async kcalPorDia(desde) { const m = {}; this.ref.filter((r) => r.data >= desde).forEach((r) => (m[r.data] = (m[r.data] || 0) + r.kcal)); return m; }
  async avaliacoes() { return this.av; }
  async salvarAvaliacao(a) { const n = { ...a, id: 'n' + Date.now() }; this.av.push(n); this.av.sort((x, y) => x.data.localeCompare(y.data)); return n; }
  async apagarAvaliacao(id) { this.av = this.av.filter((a) => a.id !== id); }
  async enviarFoto(blob) { return URL.createObjectURL(blob); }
  async urlFoto(c) { return c || null; }
  async analisarRefeicao({ texto }) {
    await new Promise((r) => setTimeout(r, 900));
    return { descricao: texto || 'Prato feito: arroz, feijão, bife e batata frita', confianca: 'media', observacao: 'A batata frita pode variar bastante conforme o óleo.',
      itens: [
        { nome: 'Arroz branco', quantidade: '5 col. sopa', gramas: 125, kcal: 160, proteina_g: 3, carbo_g: 35, gordura_g: 0.3 },
        { nome: 'Feijão', quantidade: '1 concha', gramas: 90, kcal: 69, proteina_g: 4.3, carbo_g: 12, gordura_g: 0.5 },
        { nome: 'Bife acebolado', quantidade: '1 bife médio', gramas: 110, kcal: 245, proteina_g: 30, carbo_g: 2, gordura_g: 13 },
        { nome: 'Batata frita', quantidade: '1 porção pequena', gramas: 80, kcal: 250, proteina_g: 3, carbo_g: 30, gordura_g: 13 } ] };
  }
  async chaveVapid() { return null; }
  async salvarPush() {}
  async removerPush() {}
  async testarPush() { return { enviados: 0 }; }
  async apagarTudo() {}
}
