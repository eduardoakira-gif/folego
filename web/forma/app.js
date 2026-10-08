// Forma — app (PWA). Telas: Hoje, Peso, Comida, Corpo, Ajustes.
import * as C from './calc.js';
import { SupabaseStore, DemoStore, lerConfig, hojeISO, somarDias } from './db.js';
import { NOMES_MEDIDAS } from './medidas-core.js';

const $app = document.getElementById('app');
let db = null;
let P = null; // perfil

// ------------------------------------------------------------------ utilidades
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kg = C.fmtKg, int = C.fmtInt;
const sinal = (v, casas = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`);
const num = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtData = (iso) => { const [, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]}`; };
const fmtLonga = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const horaLocal = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())) % 24;
const TIPOS = { cafe: 'Café da manhã', almoco: 'Almoço', lanche: 'Lanche', jantar: 'Jantar', ceia: 'Ceia' };
const tipoPelaHora = () => { const h = horaLocal(); return h < 11 ? 'cafe' : h < 15 ? 'almoco' : h < 18 ? 'lanche' : h < 22 ? 'jantar' : 'ceia'; };

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function folha(titulo, html, aoMontar) {
  const fundo = document.createElement('div');
  fundo.className = 'folha-fundo';
  fundo.innerHTML = `<div class="folha" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><div class="folha-topo"><h2 style="margin:0">${esc(titulo)}</h2><button class="fechar" aria-label="Fechar">×</button></div><div class="corpo-folha">${html}</div></div>`;
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = (e) => e.key === 'Escape' && fechar();
  fundo.addEventListener('click', (e) => e.target === fundo && fechar());
  fundo.querySelector('.fechar').onclick = fechar;
  document.addEventListener('keydown', tecla);
  document.body.appendChild(fundo);
  const el = fundo.querySelector('.corpo-folha');
  aoMontar?.(el, fechar);
  fundo.querySelector('input, button:not(.fechar), select')?.focus();
  return { el, fechar };
}
const confirmar = (msg) => window.confirm(msg);
async function tentar(fn, sucesso) { try { await fn(); if (sucesso) toast(sucesso); return true; } catch (e) { console.error(e); toast(e.message || 'Algo deu errado.', 4000); return false; } }
const escolha = (nome, opcoes, valor) => `<div class="escolha" role="radiogroup">${Object.entries(opcoes).map(([v, r]) => `<input type="radio" id="${nome}-${v}" name="${nome}" value="${v}" ${v === valor ? 'checked' : ''}><label for="${nome}-${v}">${esc(r)}</label>`).join('')}</div>`;
const lerForm = (form) => Object.fromEntries(new FormData(form).entries());

const ICONES = {
  hoje: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  peso: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M8 9a4 4 0 0 1 8 0M12 9l1.5-2"/>',
  comida: '<path d="M6 3v8a2 2 0 0 0 2 2v8M10 3v8M6 7h4M16 21V3c2 1 3 4 3 7h-3"/>',
  corpo: '<circle cx="12" cy="4.5" r="2"/><path d="M7 9h10M12 9v6M12 15l-3 6M12 15l3 6M7 9l-2 5M17 9l2 5"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
const icone = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>`;
const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="9" width="28" height="14" rx="3" fill="#F2C230"/><path d="M7 9v6M12 9v4M17 9v6M22 9v4M27 9v6" stroke="#2B2200" stroke-width="1.6"/></svg>';

// ------------------------------------------------------------------ contexto calculado
async function contexto() {
  const hoje = hojeISO();
  const [pesagens, checkins, kcalDia] = await Promise.all([db.pesagens(), db.checkins(somarDias(hoje, -120)), db.kcalPorDia(somarDias(hoje, -35))]);
  const serie = C.tendencia(pesagens);
  const ult = serie[serie.length - 1];
  const pesoRef = ult?.tendencia ?? null;
  const adapt = C.gastoAdaptativo(serie, kcalDia);
  const mc = pesoRef ? C.metaCalorica(P, pesoRef, adapt?.gasto ?? null) : null;
  const mt = pesoRef ? C.metas(P, pesoRef) : { proteinaG: 120, aguaMl: 2500 };
  const kcalMeta = P.kcal_meta_manual || mc?.meta || 2000;
  const gorduraMeta = Math.round((kcalMeta * 0.28) / 9);
  return {
    hoje, pesagens, serie, ult, pesoRef, checkins, kcalDia, adapt, mc,
    ritmo: C.ritmoSemanal(serie),
    metasDia: { kcal: kcalMeta, aguaMl: P.agua_meta_ml || mt.aguaMl, proteinaG: mt.proteinaG, gorduraG: gorduraMeta, carboG: Math.max(0, Math.round((kcalMeta - mt.proteinaG * 4 - gorduraMeta * 9) / 4)) },
    ideal: C.pesoIdeal(P.altura_cm),
  };
}

// ------------------------------------------------------------------ régua (fita métrica)
function regua(inicio, meta, atual) {
  if (inicio == null || meta == null || atual == null) return '';
  const perder = inicio > meta;
  const ini = inicio, fim = meta;
  const total = Math.abs(ini - fim) || 1;
  const prog = Math.max(0, Math.min(1, perder ? (ini - atual) / total : (atual - ini) / total));
  const passo = total > 25 ? 1 : total > 8 ? 0.5 : 0.25;
  const n = Math.floor(total / passo);
  let marcas = '';
  for (let i = 0; i <= n; i++) {
    const x = (i * passo / total) * 100;
    const v = perder ? ini - i * passo : ini + i * passo;
    const inteiro = Math.abs(v - Math.round(v)) < 1e-6;
    const cada = total > 25 ? 5 : total > 8 ? 2 : 1;
    const rotulo = inteiro && Math.round(v) % cada === 0;
    marcas += `<line x1="${x}%" x2="${x}%" y1="0" y2="${rotulo ? 22 : inteiro ? 15 : 9}" stroke="#2B2200" stroke-width="${rotulo ? 1.4 : 1}"/>`;
    if (rotulo && x > 3 && x < 97) marcas += `<text x="${x}%" y="40" text-anchor="middle" font-size="12" font-weight="700" fill="#2B2200">${Math.round(v)}</text>`;
  }
  return `<div class="regua" role="img" aria-label="Progresso: ${kg(atual)} kg, de ${kg(inicio)} até a meta de ${kg(meta)} kg (${Math.round(prog * 100)}%)">
      <div class="feito" style="width:${prog * 100}%"></div><svg>${marcas}</svg><div class="marcador" style="left:${prog * 100}%"></div></div>
    <div class="regua-legenda"><span>Início <b>${kg(inicio)}</b></span><span><b>${Math.round(prog * 100)}%</b> do caminho</span><span>Meta <b>${kg(meta)}</b></span></div>`;
}

// ------------------------------------------------------------------ gráfico do peso
function grafico(serie, { meta, faixa, dias = 90 } = {}) {
  if (serie.length < 2) return '<p class="peq">O gráfico aparece a partir da segunda pesagem.</p>';
  const fim = serie[serie.length - 1].data;
  const ini = dias ? somarDias(fim, -dias) : serie[0].data;
  const pts = serie.filter((p) => p.data >= ini);
  if (pts.length < 2) return '<p class="peq">Poucas pesagens nesse período.</p>';
  const W = 640, H = 260, m = { l: 36, r: 12, t: 12, b: 26 };
  const vals = pts.flatMap((p) => [p.peso, p.tendencia]).concat(meta ? [meta] : []);
  let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
  if (hi - lo < 3) { hi += 1; lo -= 1; }
  const t0 = new Date(pts[0].data).getTime(), t1 = new Date(fim).getTime();
  const X = (d) => m.l + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  let g = '';
  if (faixa) { const a = Math.max(lo, faixa.min), b = Math.min(hi, faixa.max); if (b > a) g += `<rect class="faixa" x="${m.l}" y="${Y(b)}" width="${W - m.l - m.r}" height="${Y(a) - Y(b)}"><title>Faixa saudável para sua altura</title></rect>`; }
  const passo = (hi - lo) > 12 ? 4 : (hi - lo) > 6 ? 2 : 1;
  for (let v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) g += `<line class="grade-l" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="rotulo" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const nRot = 4;
  for (let i = 0; i <= nRot; i++) { const p = pts[Math.round((i / nRot) * (pts.length - 1))]; g += `<text class="rotulo" x="${X(p.data)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nRot ? 'end' : 'middle'}">${fmtData(p.data)}</text>`; }
  if (meta && meta > lo && meta < hi) g += `<line class="meta" x1="${m.l}" x2="${W - m.r}" y1="${Y(meta)}" y2="${Y(meta)}"/><text class="rotulo" x="${W - m.r}" y="${Y(meta) - 6}" text-anchor="end">meta ${kg(meta)}</text>`;
  g += pts.map((p) => `<circle class="ponto" cx="${X(p.data)}" cy="${Y(p.peso)}" r="3"><title>${fmtData(p.data)}: ${kg(p.peso)} kg</title></circle>`).join('');
  g += `<path class="tend" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.data).toFixed(1)},${Y(p.tendencia).toFixed(1)}`).join('')}"/>`;
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Peso diário (pontos) e tendência (linha)">${g}</svg>`;
}

// ------------------------------------------------------------------ o que pede atenção
function atencao(ctx, dia, avaliacoes) {
  const out = [];
  const h = horaLocal();
  const pesouHoje = ctx.ult?.data === ctx.hoje;
  if (!pesouHoje && h >= 6) out.push({ n: 'info', t: 'Você ainda não se pesou hoje. O melhor horário é ao acordar.' });
  if (ctx.ritmo != null && ctx.pesoRef) {
    const pct = (-ctx.ritmo / ctx.pesoRef) * 100;
    if (pct > 1.1) out.push({ n: 'importante', t: `Você está perdendo ${kg(-ctx.ritmo)} kg por semana, acima de 1% do peso. Nesse ritmo costuma ir massa muscular junto; vale comer um pouco mais.` });
    else if (P.peso_meta_kg && ctx.pesoRef > P.peso_meta_kg && ctx.ritmo > 0.15 && ctx.serie.length > 14) out.push({ n: 'importante', t: `A tendência subiu ${kg(ctx.ritmo)} kg por semana nas últimas 2 semanas.` });
    else if (P.peso_meta_kg && ctx.pesoRef > P.peso_meta_kg && Math.abs(ctx.ritmo) < 0.08 && ctx.serie.length > 21) out.push({ n: 'info', t: 'Peso estável nas últimas semanas. Confira se as refeições estão sendo registradas completas (óleo, bebidas, beliscos).' });
    else if (ctx.ritmo < -0.1) {
      const pr = C.projecao(ctx.serie, P.peso_meta_kg, ctx.ritmo);
      if (pr && !pr.atingida) out.push({ n: 'bom', t: `No ritmo atual (${kg(-ctx.ritmo)} kg/semana), você chega à meta por volta de ${fmtData(pr.data)} de ${pr.data.slice(0, 4)}.` });
    }
  }
  if (dia) {
    const esperadoAgua = ctx.metasDia.aguaMl * Math.min(1, Math.max(0, (h - 8) / 14));
    if (dia.aguaMl < esperadoAgua - 400) out.push({ n: 'info', t: `Água: ${(dia.aguaMl / 1000).toLocaleString('pt-BR')} L até agora, uns ${((esperadoAgua - dia.aguaMl) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L atrás do ritmo do dia.` });
    if (h >= 17 && dia.proteina < ctx.metasDia.proteinaG * 0.6) out.push({ n: 'info', t: `Proteína em ${dia.proteina} g de ${ctx.metasDia.proteinaG} g. Uma refeição com carne, ovos, frango ou iogurte ajuda a fechar.` });
    if (h >= 21 && dia.kcal > 0 && ctx.mc && dia.kcal < ctx.mc.piso * 0.75) out.push({ n: 'importante', t: `Hoje você comeu bem menos que o mínimo recomendado (${int(ctx.mc.piso)} kcal). Comer pouco demais atrapalha o resultado.` });
  }
  const ultAv = avaliacoes?.[avaliacoes.length - 1];
  if (!ultAv) out.push({ n: 'info', t: 'Faça sua primeira avaliação de medidas por foto (aba Corpo). Ela mostra o que a balança não mostra.' });
  else if (somarDias(ultAv.data, 28) <= ctx.hoje) out.push({ n: 'info', t: `Última avaliação de medidas foi em ${fmtData(ultAv.data)}. Que tal uma nova? O ideal é a cada 4 semanas.` });
  if (avaliacoes?.length >= 2) {
    const [a, b] = avaliacoes.slice(-2);
    const dc = (b.medidas?.cintura ?? 0) - (a.medidas?.cintura ?? 0), dp = (b.peso_kg ?? 0) - (a.peso_kg ?? 0);
    if (a.medidas?.cintura && b.medidas?.cintura && dc <= -1 && Math.abs(dp) < 0.8) out.push({ n: 'bom', t: `A cintura caiu ${kg(-dc)} cm com o peso quase igual: sinal de perder gordura e manter músculo.` });
  }
  return out;
}

// ================================================================== TELAS
const ROTAS = { hoje: telaHoje, peso: telaPeso, comida: telaComida, corpo: telaCorpo, ajustes: telaAjustes };

function casca(atual, html) {
  const nomes = { hoje: 'Hoje', peso: 'Peso', comida: 'Comida', corpo: 'Corpo', ajustes: 'Ajustes' };
  $app.innerHTML = `${db.demo ? '<div class="demo-faixa">Demonstração com dados fictícios. <button id="sair-demo">Usar com minha conta</button></div>' : ''}
  <div class="casca"><nav class="nav" aria-label="Seções"><div class="marca">${LOGO} Forma</div>
  ${Object.entries(nomes).map(([k, n]) => `<a href="#${k}" ${k === atual ? 'aria-current="page"' : ''}>${icone(k)}<span>${n}</span></a>`).join('')}</nav>
  <main class="conteudo" id="main">${html}</main></div>`;
  document.getElementById('sair-demo')?.addEventListener('click', () => { localStorage.removeItem('forma-demo'); location.hash = ''; location.reload(); });
  return document.getElementById('main');
}

// ------------------------------------------------------------------ HOJE
async function telaHoje(sub) {
  const ctx = await contexto();
  const [refs, agua, avaliacoes] = await Promise.all([db.refeicoes(ctx.hoje, ctx.hoje), db.agua(ctx.hoje), db.avaliacoes()]);
  const aguaMl = agua.reduce((s, a) => s + a.ml, 0);
  const ck = ctx.checkins.find((c) => c.data === ctx.hoje) || {};
  const dia = C.resumoDia({ refeicoes: refs, aguaMl, checkin: ck }, ctx.metasDia);
  const pesouHoje = ctx.ult?.data === ctx.hoje;
  const ontem = ctx.serie.length > 1 ? ctx.serie[ctx.serie.length - 2] : null;
  const inicio = ctx.serie[0] ? Math.max(ctx.serie[0].peso, ctx.serie[0].tendencia) : null;
  const seq = C.sequencia(ctx.checkins, ctx.hoje);
  const itensAtencao = atencao(ctx, dia, avaliacoes);
  const copos = Math.max(8, Math.ceil(ctx.metasDia.aguaMl / 250));
  const excesso = dia.kcal > ctx.metasDia.kcal;

  const main = casca('hoje', `
    <h1>Hoje</h1><p class="sub">${esc(fmtLonga(ctx.hoje))}</p>
    <div class="grade duas">
      <div class="grade">
        <section class="painel destaque" id="peso" aria-labelledby="t-peso">
          <div class="linha-topo"><h2 id="t-peso">Peso</h2>${pesouHoje ? '<button class="btn sec peq" id="editar-peso">Corrigir</button>' : ''}</div>
          ${pesouHoje ? `
            <div class="num-g">${kg(ctx.ult.peso)}<span class="unid">kg</span></div>
            <p class="peq" style="margin:8px 0 0">Tendência ${kg(ctx.ult.tendencia)} kg${ontem ? ` · ${sinal(ctx.ult.tendencia - ontem.tendencia, 2)} desde a última pesagem` : ''}${ctx.ritmo != null ? ` · ${sinal(ctx.ritmo, 2)} kg/semana` : ''}</p>`
          : `<form id="form-peso" class="peso-entrada" autocomplete="off">
              <input name="peso" inputmode="decimal" placeholder="${ctx.ult ? kg(ctx.ult.peso) : '00,0'}" aria-label="Peso de hoje em kg" required>
              <button class="btn">Registrar</button></form>
             <p class="peq" style="margin:8px 0 0">Ao acordar, depois do banheiro, antes de comer.${ctx.ult ? ` Última: ${kg(ctx.ult.peso)} kg em ${fmtData(ctx.ult.data)}.` : ''}</p>`}
          ${P.peso_meta_kg && inicio ? regua(inicio, P.peso_meta_kg, ctx.ult.tendencia) : ''}
        </section>

        <section class="painel" aria-labelledby="t-cal">
          <div class="linha-topo"><h2 id="t-cal">Calorias</h2><a class="peq" href="#comida">Ver refeições</a></div>
          <div class="linha-topo" style="align-items:flex-end">
            <div><div class="num-m ${excesso ? 'pos' : ''}">${int(Math.abs(dia.restante))}<span class="unid">kcal</span></div><div class="peq">${excesso ? 'acima da meta' : 'restantes'}</div></div>
            <div class="peq" style="text-align:right">${int(dia.kcal)} de ${int(ctx.metasDia.kcal)} kcal<br>${refs.length} ${refs.length === 1 ? 'refeição' : 'refeições'}</div>
          </div>
          <div class="barra ${excesso ? 'excesso' : ''}" style="margin-top:12px"><i style="width:${Math.min(100, (dia.kcal / ctx.metasDia.kcal) * 100)}%"></i></div>
          <div class="macros">
            ${[['Proteína', dia.proteina, ctx.metasDia.proteinaG], ['Carboidrato', dia.carbo, ctx.metasDia.carboG], ['Gordura', dia.gordura, ctx.metasDia.gorduraG]].map(([n, v, m]) => `<div class="macro"><span>${n}</span><div class="barra"><i style="width:${Math.min(100, (v / m) * 100)}%"></i></div><span>${v}/${m} g</span></div>`).join('')}
          </div>
          <div class="btns cheio" style="margin-top:16px"><button class="btn fita" id="foto-comida">Fotografar refeição</button><button class="btn sec" id="texto-comida">Descrever</button></div>
        </section>
      </div>

      <div class="grade">
        <section class="painel" id="agua" aria-labelledby="t-agua">
          <div class="linha-topo"><h2 id="t-agua">Água</h2><span class="peq">${(dia.aguaMl / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} de ${(ctx.metasDia.aguaMl / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L</span></div>
          <div class="copos" aria-hidden="true">${Array.from({ length: copos }, (_, i) => { const f = Math.max(0, Math.min(1, (dia.aguaMl - i * 250) / 250)); return `<span class="copo"><i style="height:${f * 100}%"></i></span>`; }).join('')}</div>
          <div class="btns"><button class="btn sec" data-agua="250">+250 ml</button><button class="btn sec" data-agua="500">+500 ml</button>${dia.aguaMl > 0 ? '<button class="btn sec peq" data-agua="-250" aria-label="Desfazer 250 ml">Desfazer</button>' : ''}</div>
        </section>

        <section class="painel" id="treino" aria-labelledby="t-treino">
          <div class="linha-topo"><h2 id="t-treino">Treino</h2>${seq ? `<span class="peq">${seq} ${seq === 1 ? 'dia' : 'dias'} seguidos</span>` : ''}</div>
          ${[['treinou', 'Treinou hoje?'], ['cardio', 'Fez cardio?']].map(([k, q]) => `<div class="pergunta"><span>${q}</span><span class="sn" role="group" aria-label="${q}"><button class="sim" data-ck="${k}" data-v="1" aria-pressed="${ck[k] === true}">Sim</button><button class="nao" data-ck="${k}" data-v="0" aria-pressed="${ck[k] === false}">Não</button></span></div>`).join('')}
          ${ck.treinou || ck.cardio ? `<details><summary>Detalhes (opcional)</summary><form id="form-treino" class="duas-col" style="margin-top:8px">
            ${ck.treinou ? `<div class="campo"><label for="tm">Musculação (min)</label><input id="tm" name="treino_min" inputmode="numeric" value="${ck.treino_min ?? ''}"></div>` : ''}
            ${ck.cardio ? `<div class="campo"><label for="cm">Cardio (min)</label><input id="cm" name="cardio_min" inputmode="numeric" value="${ck.cardio_min ?? ''}"></div>` : ''}
            <div class="campo" style="grid-column:1/-1"><button class="btn sec peq">Salvar detalhes</button></div></form></details>` : ''}
        </section>

        ${itensAtencao.length ? `<section class="painel" aria-labelledby="t-at"><h2 id="t-at">Pede atenção</h2><ul class="lista atencao">${itensAtencao.map((a) => `<li class="${a.n}"><span class="ponto" aria-hidden="true"></span><span>${esc(a.t)}</span></li>`).join('')}</ul></section>` : ''}
      </div>
    </div>`);

  main.querySelector('#form-peso')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = num(e.target.peso.value);
    if (!v || v < 25 || v > 350) return toast('Digite o peso em kg, por exemplo 82,4');
    if (ctx.ult && Math.abs(v - ctx.ult.peso) > 5 && !confirmar(`${kg(v)} kg é bem diferente da última pesagem (${kg(ctx.ult.peso)} kg). Confirmar?`)) return;
    if (await tentar(() => db.salvarPesagem(ctx.hoje, v), 'Peso registrado')) telaHoje();
  });
  main.querySelector('#editar-peso')?.addEventListener('click', () => dialogoPeso(ctx.hoje, ctx.ult.peso, telaHoje));
  main.querySelectorAll('[data-agua]').forEach((b) => b.addEventListener('click', async () => {
    const ml = Number(b.dataset.agua);
    if (await tentar(() => db.somarAgua(ctx.hoje, ml), ml > 0 ? `+${ml} ml de água` : 'Desfeito')) telaHoje();
  }));
  main.querySelectorAll('[data-ck]').forEach((b) => b.addEventListener('click', async () => {
    const atual = ck[b.dataset.ck], v = b.dataset.v === '1';
    if (await tentar(() => db.salvarCheckin(ctx.hoje, { [b.dataset.ck]: atual === v ? null : v }))) telaHoje();
  }));
  main.querySelector('#form-treino')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = lerForm(e.target); const campos = {};
    for (const k of ['treino_min', 'cardio_min']) if (k in f) campos[k] = num(f[k]);
    if (await tentar(() => db.salvarCheckin(ctx.hoje, campos), 'Detalhes salvos')) telaHoje();
  });
  main.querySelector('#foto-comida').onclick = () => adicionarRefeicao('foto', ctx.hoje, telaHoje);
  main.querySelector('#texto-comida').onclick = () => adicionarRefeicao('texto', ctx.hoje, telaHoje);
  if (sub) document.getElementById(sub)?.scrollIntoView({ block: 'center' });
}

function dialogoPeso(data, valor, depois) {
  folha('Pesagem', `<form id="fp"><div class="duas-col"><div class="campo"><label for="pd">Data</label><input type="date" id="pd" name="data" value="${data}" max="${hojeISO()}" required></div>
    <div class="campo"><label for="pv">Peso (kg)</label><input id="pv" name="peso" inputmode="decimal" value="${valor != null ? kg(valor) : ''}" required></div></div>
    <button class="btn" style="width:100%">Salvar pesagem</button></form>`, (el, fechar) => {
    el.querySelector('#fp').onsubmit = async (e) => {
      e.preventDefault(); const f = lerForm(e.target); const v = num(f.peso);
      if (!v || v < 25 || v > 350) return toast('Peso inválido');
      if (await tentar(() => db.salvarPesagem(f.data, v), 'Pesagem salva')) { fechar(); depois(); }
    };
  });
}

// ------------------------------------------------------------------ PESO
let periodoPeso = 90;
let mostrarPes = 14;
async function telaPeso() {
  const ctx = await contexto();
  const { serie, ult, ideal } = ctx;
  const imcAtual = ult ? C.imc(ult.tendencia, P.altura_cm) : null;
  const inicio = serie[0];
  const pr = ult && P.peso_meta_kg ? C.projecao(serie, P.peso_meta_kg, ctx.ritmo) : null;
  const falta = ult && P.peso_meta_kg ? C.caloriasParaPerder(ult.tendencia, P.peso_meta_kg, ctx.mc?.kgSemana || 0.5) : null;

  const main = casca('peso', `
    <div class="linha-topo"><div><h1>Peso</h1><p class="sub">A linha é a tendência: ela ignora a oscilação de água e sal do dia a dia.</p></div><button class="btn" id="nova-pes">Adicionar pesagem</button></div>
    <div class="grade">
      <section class="painel">
        <div class="linha-topo"><h2>Evolução</h2><div class="periodos escolha" role="radiogroup" aria-label="Período">
          ${[[30, '30 dias'], [90, '90 dias'], [365, '1 ano'], [0, 'Tudo']].map(([d, n]) => `<input type="radio" name="per" id="per${d}" value="${d}" ${periodoPeso === d ? 'checked' : ''}><label for="per${d}">${n}</label>`).join('')}</div></div>
        ${grafico(serie, { meta: P.peso_meta_kg, faixa: ideal, dias: periodoPeso })}
        <p class="peq" style="margin:8px 0 0">Pontos: pesagens · Linha: tendência · Tracejado: meta · Faixa verde: peso saudável para ${P.altura_cm} cm</p>
      </section>
      <div class="grade duas">
        <section class="painel"><h2>Resumo</h2><dl class="kv">
          <dt>Tendência atual</dt><dd>${ult ? kg(ult.tendencia) + ' kg' : '—'}</dd>
          <dt>Desde o início (${inicio ? fmtData(inicio.data) : '—'})</dt><dd>${ult && inicio ? sinal(ult.tendencia - inicio.tendencia) + ' kg' : '—'}</dd>
          <dt>Ritmo (2 semanas)</dt><dd>${ctx.ritmo != null ? sinal(ctx.ritmo, 2) + ' kg/sem' : 'precisa de mais dias'}</dd>
          <dt>Meta</dt><dd>${P.peso_meta_kg ? kg(P.peso_meta_kg) + ' kg' : '—'}</dd>
          <dt>Falta</dt><dd>${falta ? `${kg(falta.kg)} kg` : '—'}</dd>
          <dt>Previsão no ritmo atual</dt><dd>${pr?.atingida ? 'meta atingida' : pr ? `${fmtData(pr.data)} ${pr.data.slice(0, 4)}` : '—'}</dd>
        </dl></section>
        <section class="painel"><h2>Peso ideal para ${P.altura_cm} cm</h2><dl class="kv">
          <dt>Faixa saudável (IMC 18,5–24,9)</dt><dd>${kg(ideal.min)}–${kg(ideal.max)} kg</dd>
          <dt>Ponto médio (IMC 22)</dt><dd>${kg(ideal.referencia)} kg</dd>
          <dt>Seu IMC</dt><dd>${imcAtual ? `${kg(imcAtual)} · ${C.classeImc(imcAtual)}` : '—'}</dd>
          ${falta ? `<dt>Calorias a queimar até a meta</dt><dd>${int(falta.kcal)} kcal</dd><dt>Déficit diário planejado</dt><dd>${int(ctx.mc?.deficit)} kcal</dd>` : ''}
        </dl><p class="peq" style="margin:12px 0 0">O IMC não diferencia músculo de gordura. Use junto com a cintura (aba Corpo).</p></section>
      </div>
    </div>
    <section class="painel" style="margin-top:16px"><h2>Pesagens</h2>
      <ul class="lista">${[...serie].reverse().slice(0, mostrarPes).map((p, i, arr) => { const ant = arr[i + 1]; const id = ctx.pesagens.find((x) => x.data === p.data)?.id; return `<li><span><b>${kg(p.peso)} kg</b> <span class="peq">${fmtData(p.data)}${ant ? ` · ${sinal(p.peso - ant.peso)}` : ''}</span></span><span class="btns"><button class="btn sec peq" data-ed="${p.data}" data-v="${p.peso}">Editar</button><button class="btn sec peq" data-del="${id}" aria-label="Apagar pesagem de ${fmtData(p.data)}">Apagar</button></span></li>`; }).join('') || '<li class="peq">Nenhuma pesagem ainda.</li>'}</ul>
      ${serie.length > mostrarPes ? '<button class="btn sec peq" id="mais-pes">Mostrar mais</button>' : ''}
    </section>`);
  main.querySelector('#mais-pes')?.addEventListener('click', () => { mostrarPes += 30; telaPeso(); });
  main.querySelector('#nova-pes').onclick = () => dialogoPeso(hojeISO(), null, telaPeso);
  main.querySelectorAll('input[name=per]').forEach((r) => r.onchange = () => { periodoPeso = Number(r.value); telaPeso(); });
  main.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => dialogoPeso(b.dataset.ed, Number(b.dataset.v), telaPeso));
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirmar('Apagar esta pesagem?') && await tentar(() => db.apagarPesagem(b.dataset.del), 'Pesagem apagada')) telaPeso(); });
}

// ------------------------------------------------------------------ COMIDA
let diaComida = null;
async function telaComida() {
  const ctx = await contexto();
  diaComida = diaComida || ctx.hoje;
  const refs = await db.refeicoes(diaComida, diaComida);
  const dia = C.resumoDia({ refeicoes: refs }, ctx.metasDia);
  const urls = await Promise.all(refs.map((r) => (r.foto ? db.urlFoto(r.foto) : null)));
  const grupos = Object.keys(TIPOS).map((t) => [t, refs.map((r, i) => ({ r, url: urls[i] })).filter((x) => x.r.tipo === t)]).filter(([, l]) => l.length);

  const main = casca('comida', `
    <h1>Comida</h1>
    <div class="linha-topo" style="margin:4px 0 18px"><div class="btns"><button class="btn sec peq" id="dia-ant" aria-label="Dia anterior">‹</button><span style="align-self:center;font-weight:650">${diaComida === ctx.hoje ? 'Hoje' : esc(fmtLonga(diaComida))}</span><button class="btn sec peq" id="dia-prox" aria-label="Próximo dia" ${diaComida >= ctx.hoje ? 'disabled' : ''}>›</button></div>
      <span class="peq">${int(dia.kcal)} de ${int(ctx.metasDia.kcal)} kcal · proteína ${dia.proteina}/${ctx.metasDia.proteinaG} g</span></div>
    <div class="grade duas">
      <section class="painel">
        ${grupos.length ? grupos.map(([t, l]) => `<h3 style="margin-top:6px">${TIPOS[t]} <span class="peq">${int(l.reduce((s, x) => s + Number(x.r.kcal), 0))} kcal</span></h3>
          <ul class="lista">${l.map(({ r, url }) => `<li class="ref-item" data-ref="${r.id}" role="button" tabindex="0">${url ? `<img src="${esc(url)}" alt="">` : `<span class="sem-foto" aria-hidden="true">${r.origem === 'foto' ? '📷' : '🍽️'}</span>`}<span><b>${esc(r.descricao)}</b><br><span class="peq">P ${Math.round(r.proteina_g)} g · C ${Math.round(r.carbo_g)} g · G ${Math.round(r.gordura_g)} g</span></span><span class="kcal">${int(r.kcal)}<br><span class="peq">kcal</span></span></li>`).join('')}</ul>`).join('')
          : '<p>Nenhuma refeição neste dia. Tire uma foto do prato antes de comer: a estimativa sai em segundos e você ajusta se precisar.</p>'}
      </section>
      <section class="painel"><h2>Adicionar</h2>
        <div class="grade">
          <button class="btn fita" id="add-foto">Fotografar refeição</button>
          <button class="btn sec" id="add-texto">Descrever o que comeu</button>
          <button class="btn sec" id="add-repetir">Repetir uma refeição</button>
          <button class="btn sec" id="add-manual">Digitar calorias</button>
        </div>
        <p class="peq" style="margin:14px 0 0">A foto é analisada por IA e vira uma lista de alimentos com gramas e calorias. Confira as porções antes de salvar: óleo e molho costumam ficar escondidos.</p>
      </section>
    </div>`);
  main.querySelector('#dia-ant').onclick = () => { diaComida = somarDias(diaComida, -1); telaComida(); };
  main.querySelector('#dia-prox').onclick = () => { diaComida = somarDias(diaComida, 1); telaComida(); };
  main.querySelector('#add-foto').onclick = () => adicionarRefeicao('foto', diaComida, telaComida);
  main.querySelector('#add-texto').onclick = () => adicionarRefeicao('texto', diaComida, telaComida);
  main.querySelector('#add-manual').onclick = () => revisarRefeicao({ data: diaComida, tipo: tipoPelaHora(), descricao: '', itens: [{ nome: '', quantidade: '', gramas: 0, kcal: 0, proteina_g: 0, carbo_g: 0, gordura_g: 0 }], origem: 'manual' }, null, telaComida);
  main.querySelector('#add-repetir').onclick = () => repetirRefeicao(diaComida, telaComida);
  main.querySelectorAll('[data-ref]').forEach((li) => { const abrir = () => { const r = refs.find((x) => x.id === li.dataset.ref); revisarRefeicao({ ...r, itens: r.itens?.length ? r.itens : [{ nome: r.descricao, quantidade: '', gramas: 0, kcal: r.kcal, proteina_g: r.proteina_g, carbo_g: r.carbo_g, gordura_g: r.gordura_g }] }, null, telaComida); }; li.onclick = abrir; li.onkeydown = (e) => e.key === 'Enter' && abrir(); });
}

function escolherFoto() {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment');
    i.onchange = () => res(i.files?.[0] || null);
    i.click();
  });
}

async function adicionarRefeicao(modo, data, depois) {
  const { arquivoParaCanvas, canvasParaBase64, canvasParaBlob } = await import('./medidas.js');
  let canvas = null;
  if (modo === 'foto') {
    const arq = await escolherFoto();
    if (!arq) return;
    canvas = await arquivoParaCanvas(arq, 1600);
  }
  const f = folha(modo === 'foto' ? 'Analisar refeição' : 'Descrever refeição', `
    ${canvas ? '<div id="prev" style="margin-bottom:12px"></div>' : ''}
    <form id="fa"><div class="campo"><label for="tx">${canvas ? 'Algo que a foto não mostra? (opcional)' : 'O que você comeu?'}</label>
      <textarea id="tx" name="texto" placeholder="${canvas ? 'ex.: feito com 1 colher de azeite; tomei um suco de laranja' : 'ex.: 2 ovos mexidos, 1 pão francês com manteiga e café com leite'}" ${canvas ? '' : 'required'}></textarea></div>
      <div class="campo"><span>Refeição</span>${escolha('tipo', TIPOS, tipoPelaHora())}</div>
      <button class="btn" style="width:100%" id="ir">Calcular calorias</button></form>`, (el) => {
    if (canvas) { const c = el.querySelector('#prev'); canvas.style.cssText = 'width:100%;max-height:260px;object-fit:cover;border-radius:12px'; c.appendChild(canvas); }
  });
  f.el.querySelector('#fa').onsubmit = async (e) => {
    e.preventDefault();
    const b = f.el.querySelector('#ir'); b.disabled = true; b.textContent = 'Analisando…';
    const ff = lerForm(e.target);
    try {
      const res = await db.analisarRefeicao({ imagem_base64: canvas ? await canvasParaBase64(canvas) : undefined, media_type: 'image/jpeg', texto: ff.texto, tipo: ff.tipo });
      f.fechar();
      const blob = canvas && P.guardar_fotos ? await canvasParaBlob(canvas, 900, 0.75) : null;
      revisarRefeicao({ data, tipo: ff.tipo, descricao: res.descricao, itens: res.itens, origem: canvas ? 'foto' : 'texto', confianca: res.confianca, observacao: res.observacao }, blob, depois);
    } catch (err) { toast(err.message, 5000); b.disabled = false; b.textContent = 'Tentar de novo'; }
  };
}

function revisarRefeicao(ref, fotoBlob, depois) {
  const itens = ref.itens.map((i) => ({ ...i, _base: { g: Number(i.gramas) || 0, kcal: +i.kcal || 0, p: +i.proteina_g || 0, c: +i.carbo_g || 0, gd: +i.gordura_g || 0 } }));
  const f = folha(ref.id ? 'Editar refeição' : 'Confira antes de salvar', `
    ${ref.confianca ? `<p><span class="confianca">Confiança ${({ alta: 'alta', media: 'média', baixa: 'baixa' })[ref.confianca]}</span>${ref.observacao ? ` <span class="peq">${esc(ref.observacao)}</span>` : ''}</p>` : ''}
    <form id="fr">
      <div class="campo"><label for="ds">Descrição</label><input type="text" id="ds" name="descricao" value="${esc(ref.descricao)}" required></div>
      <div class="campo"><span>Refeição</span>${escolha('tipo', TIPOS, ref.tipo)}</div>
      <div class="campo"><span>Itens <small>— mude os gramas e as calorias se ajustam</small></span>
        <div class="item-edit peq" aria-hidden="true"><span>Alimento</span><span>Gramas</span><span>kcal</span><span></span></div>
        <div class="itens-edit" id="itens"></div>
        <button type="button" class="btn sec peq" id="mais" style="justify-self:start">Adicionar item</button></div>
      <p id="total" style="font-weight:700"></p>
      <div class="btns cheio"><button class="btn">${ref.id ? 'Salvar alterações' : 'Salvar refeição'}</button>${ref.id ? '<button type="button" class="btn perigo" id="apagar">Apagar</button>' : ''}</div>
    </form>`);
  const box = f.el.querySelector('#itens');
  const totais = () => itens.reduce((t, i) => ({ kcal: t.kcal + (+i.kcal || 0), p: t.p + (+i.proteina_g || 0), c: t.c + (+i.carbo_g || 0), g: t.g + (+i.gordura_g || 0) }), { kcal: 0, p: 0, c: 0, g: 0 });
  const atualizarTotal = () => { const t = totais(); f.el.querySelector('#total').textContent = `Total: ${int(t.kcal)} kcal · P ${Math.round(t.p)} g · C ${Math.round(t.c)} g · G ${Math.round(t.g)} g`; };
  const desenhar = () => {
    box.innerHTML = itens.map((i, k) => `<div class="item-edit" data-k="${k}">
      <input aria-label="Alimento" value="${esc(i.nome)}" data-f="nome" placeholder="Alimento">
      <input aria-label="Gramas" inputmode="decimal" value="${i.gramas || ''}" data-f="gramas" placeholder="g">
      <input aria-label="Calorias" inputmode="decimal" value="${Math.round(i.kcal) || ''}" data-f="kcal" placeholder="kcal">
      <button type="button" class="x" aria-label="Remover ${esc(i.nome)}" data-rm="${k}">×</button></div>
      ${i.quantidade ? `<div class="peq" style="margin-top:-6px">${esc(i.quantidade)}</div>` : ''}`).join('');
    box.querySelectorAll('input').forEach((inp) => inp.oninput = () => {
      const i = itens[inp.closest('[data-k]').dataset.k], campo = inp.dataset.f;
      if (campo === 'nome') i.nome = inp.value;
      else if (campo === 'gramas') {
        i.gramas = num(inp.value) || 0;
        if (i._base.g > 0) { const k = i.gramas / i._base.g; i.kcal = i._base.kcal * k; i.proteina_g = i._base.p * k; i.carbo_g = i._base.c * k; i.gordura_g = i._base.gd * k; inp.closest('[data-k]').querySelector('[data-f=kcal]').value = Math.round(i.kcal); }
      } else if (campo === 'kcal') {
        const novo = num(inp.value) || 0; const k = i.kcal > 0 ? novo / i.kcal : 0;
        i.kcal = novo; if (k) { i.proteina_g *= k; i.carbo_g *= k; i.gordura_g *= k; }
      }
      atualizarTotal();
    });
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { itens.splice(Number(b.dataset.rm), 1); desenhar(); });
    atualizarTotal();
  };
  desenhar();
  f.el.querySelector('#mais').onclick = () => { itens.push({ nome: '', quantidade: '', gramas: 0, kcal: 0, proteina_g: 0, carbo_g: 0, gordura_g: 0, _base: { g: 0 } }); desenhar(); box.querySelector('[data-k]:last-of-type input')?.focus(); };
  f.el.querySelector('#apagar')?.addEventListener('click', async () => { if (confirmar('Apagar esta refeição?') && await tentar(() => db.apagarRefeicao(ref.id), 'Refeição apagada')) { f.fechar(); depois(); } });
  f.el.querySelector('#fr').onsubmit = async (e) => {
    e.preventDefault();
    const ff = lerForm(e.target), t = totais();
    const limpos = itens.filter((i) => i.nome || i.kcal).map(({ _base, ...i }) => ({ ...i, kcal: Math.round(i.kcal), proteina_g: Math.round(i.proteina_g * 10) / 10, carbo_g: Math.round(i.carbo_g * 10) / 10, gordura_g: Math.round(i.gordura_g * 10) / 10 }));
    const ok = await tentar(async () => {
      let foto = ref.foto || null;
      if (fotoBlob) foto = await db.enviarFoto(fotoBlob, 'comida');
      const reg = { data: ref.data, tipo: ff.tipo, descricao: ff.descricao, itens: limpos, kcal: Math.round(t.kcal), proteina_g: Math.round(t.p * 10) / 10, carbo_g: Math.round(t.c * 10) / 10, gordura_g: Math.round(t.g * 10) / 10, origem: ref.origem || 'manual', confianca: ref.confianca || null, foto };
      if (ref.id) reg.id = ref.id;
      await db.salvarRefeicao(reg);
    }, ref.id ? 'Refeição atualizada' : `Refeição salva: ${int(t.kcal)} kcal`);
    if (ok) { f.fechar(); depois(); }
  };
}

async function repetirRefeicao(data, depois) {
  const rec = await db.recentes();
  const vistos = new Set();
  const unicos = rec.filter((r) => { const k = r.descricao.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 15);
  const f = folha('Repetir refeição', unicos.length ? `<ul class="lista">${unicos.map((r, i) => `<li><span><b>${esc(r.descricao)}</b><br><span class="peq">${int(r.kcal)} kcal</span></span><button class="btn sec peq" data-i="${i}">Usar</button></li>`).join('')}</ul>` : '<p>Ainda não há refeições para repetir.</p>');
  f.el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { const r = unicos[b.dataset.i]; f.fechar(); revisarRefeicao({ data, tipo: tipoPelaHora(), descricao: r.descricao, itens: r.itens, origem: 'favorito' }, null, depois); });
}

// ------------------------------------------------------------------ CORPO
async function telaCorpo() {
  const avs = await db.avaliacoes();
  const ult = avs[avs.length - 1], ant = avs[avs.length - 2], pri = avs[0];
  if (!ult) {
    const main = casca('corpo', `<h1>Corpo</h1><p class="sub">Medidas por foto: duas fotos de corpo inteiro, uma de frente e uma de lado.</p>
      <section class="painel" style="max-width:640px"><h2>Como funciona</h2>
        <p>Sua altura vira a régua. A foto de frente mede a largura de pescoço, peito, cintura, quadril, coxa e braço; a de lado mede a profundidade nos mesmos pontos. Juntando as duas, o app calcula o contorno de cada região e a diferença entre uma avaliação e a seguinte.</p>
        <p>A leitura acontece no seu celular. As fotos só são guardadas se você quiser comparar visualmente depois (Ajustes → Privacidade).</p>
        <p class="peq">Precisão típica: 2 a 4 cm por medida. Se tiver uma fita métrica, informe a cintura uma vez e o app calibra as próximas.</p>
        <div class="btns"><button class="btn fita" id="nova">Fazer primeira avaliação</button><button class="btn sec" id="fita">Só com fita métrica</button></div></section>`);
    main.querySelector('#nova').onclick = () => novaAvaliacao();
    main.querySelector('#fita').onclick = () => avaliacaoFita();
    return;
  }
  const [fFrente1, fFrente2] = await Promise.all([db.urlFoto(pri?.foto_frente), db.urlFoto(ult?.foto_frente)]);
  const dA = C.compararMedidas(ant?.medidas, ult.medidas), dP = C.compararMedidas(pri?.medidas, ult.medidas);
  const ind = ult.indicadores || {};
  const ordem = ['cintura', 'quadril', 'peito', 'pescoco', 'coxa', 'braco', 'ombros_largura'].filter((k) => ult.medidas?.[k] != null);
  const rel = ult.detalhes?.relacaoLadoFrente || {};
  const cor = (k, v) => (v == null || v === 0 ? '' : (k === 'ombros_largura' || k === 'braco') ? '' : v < 0 ? 'neg' : 'pos');

  const main = casca('corpo', `
    <div class="linha-topo"><div><h1>Corpo</h1><p class="sub">Última avaliação em ${fmtData(ult.data)}${ult.peso_kg ? ` com ${kg(ult.peso_kg)} kg` : ''}.</p></div>
      <div class="btns"><button class="btn fita" id="nova">Nova avaliação</button><button class="btn sec" id="fita">Medir com fita</button></div></div>
    <div class="grade duas">
      <section class="painel"><h2>Medidas (cm)</h2>
        <table class="medidas-tab"><thead><tr><th>Região</th><th>Atual</th><th>${ant ? `vs ${fmtData(ant.data)}` : ''}</th><th>${pri && pri !== ult ? `vs início` : ''}</th></tr></thead>
        <tbody>${ordem.map((k) => `<tr><td>${NOMES_MEDIDAS[k]}</td><td><b>${kg(ult.medidas[k])}</b></td><td class="${cor(k, dA[k])}">${ant ? sinal(dA[k]) : ''}</td><td class="${cor(k, dP[k])}">${pri !== ult ? sinal(dP[k]) : ''}</td></tr>`).join('')}</tbody></table>
        ${ult.fonte !== 'fita' ? `<p class="peq" style="margin:12px 0 0">${Object.keys(P.calibracao || {}).length ? 'Calibrado com sua fita métrica.' : 'Estimativa por foto (±2–4 cm). Informe a cintura com fita uma vez para calibrar.'}</p>` : ''}
      </section>
      <div class="grade">
        <section class="painel"><h2>Indicadores</h2><dl class="kv">
          ${ind.gorduraPct != null ? `<dt>Gordura corporal (Marinha EUA)</dt><dd>${kg(ind.gorduraPct)}%</dd>` : ''}
          ${ind.massaMagraKg != null ? `<dt>Massa magra estimada</dt><dd>${kg(ind.massaMagraKg)} kg</dd>` : ''}
          ${ind.rce != null ? `<dt>Cintura ÷ altura</dt><dd>${ind.rce.toLocaleString('pt-BR')}</dd><dt></dt><dd class="peq" style="font-weight:400">${esc(ind.rceFaixa || (ind.rce < 0.5 ? 'Saudável (abaixo de 0,5)' : 'Atenção (0,5 ou mais)'))}</dd>` : ''}
          ${ind.rcq != null ? `<dt>Cintura ÷ quadril</dt><dd>${ind.rcq.toLocaleString('pt-BR')}</dd>` : ''}
        </dl></section>
        ${Object.keys(rel).length ? `<section class="painel"><h2>Frente × lado</h2><p class="peq" style="margin-top:0">Profundidade dividida pela largura. Abdômen mais "fundo" que largo indica gordura concentrada na barriga; acompanhe a cintura cair.</p><dl class="kv">${Object.entries(rel).map(([k, v]) => `<dt>${NOMES_MEDIDAS[k]}</dt><dd>${v.toLocaleString('pt-BR')}</dd>`).join('')}</dl></section>` : ''}
      </div>
    </div>
    ${fFrente1 && fFrente2 && pri !== ult ? `<section class="painel" style="margin-top:16px"><h2>Antes e agora</h2><div class="fotos-lado"><figure><img src="${esc(fFrente1)}" alt="Foto de frente em ${fmtData(pri.data)}"><figcaption>${fmtData(pri.data)}${pri.peso_kg ? ` · ${kg(pri.peso_kg)} kg` : ''}</figcaption></figure><figure><img src="${esc(fFrente2)}" alt="Foto de frente em ${fmtData(ult.data)}"><figcaption>${fmtData(ult.data)}${ult.peso_kg ? ` · ${kg(ult.peso_kg)} kg` : ''}</figcaption></figure></div></section>` : ''}
    <section class="painel" style="margin-top:16px"><h2>Histórico</h2><ul class="lista">${[...avs].reverse().map((a) => `<li><span><b>${fmtData(a.data)} ${a.data.slice(0, 4)}</b> <span class="peq">${a.medidas?.cintura ? `cintura ${kg(a.medidas.cintura)} cm` : ''}${a.peso_kg ? ` · ${kg(a.peso_kg)} kg` : ''} · ${a.fonte === 'fita' ? 'fita' : 'foto'}</span></span><button class="btn sec peq" data-del="${a.id}">Apagar</button></li>`).join('')}</ul></section>`);
  main.querySelector('#nova').onclick = () => novaAvaliacao();
  main.querySelector('#fita').onclick = () => avaliacaoFita();
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirmar('Apagar esta avaliação?') && await tentar(() => db.apagarAvaliacao(b.dataset.del), 'Avaliação apagada')) telaCorpo(); });
}

const SILHUETA_FRENTE = '<svg viewBox="0 0 60 80" fill="none" stroke="currentColor" stroke-width="2"><circle cx="30" cy="9" r="6"/><path d="M30 15v28M18 22h24M30 43l-9 33M30 43l9 33M18 22l-8 20M42 22l8 20"/></svg>';
const SILHUETA_LADO = '<svg viewBox="0 0 60 80" fill="none" stroke="currentColor" stroke-width="2"><circle cx="30" cy="9" r="6"/><path d="M30 15v28M30 22l2 20M30 43l-2 33M30 43l2 33"/><path d="M26 20c-3 6-3 16 0 22M34 20c4 7 4 15 0 22"/></svg>';

async function novaAvaliacao() {
  const ctx = await contexto();
  const fotos = { frente: null, lado: null };
  const f = folha('Nova avaliação', `
    <div class="aviso" style="margin-bottom:14px"><b>Para medir bem:</b> roupa justa (top/short ou cueca/sutiã), fundo liso, boa luz. Celular apoiado na altura do umbigo, a uns 2,5 m. Corpo inteiro na foto, da cabeça aos pés. Braços abertos uns 30° e pés na largura do quadril. Use o timer da câmera.</div>
    <div class="grade">
      <label class="guia-foto" id="g-frente" tabindex="0">${SILHUETA_FRENTE}<span><b>Foto de frente</b><br><span class="peq">Olhando para a câmera, braços afastados do corpo.</span></span><input type="file" accept="image/*" capture="environment" class="oculto" data-f="frente"></label>
      <label class="guia-foto" id="g-lado" tabindex="0">${SILHUETA_LADO}<span><b>Foto de lado</b><br><span class="peq">Virado 90°, braços relaxados, postura natural (sem encolher a barriga).</span></span><input type="file" accept="image/*" capture="environment" class="oculto" data-f="lado"></label>
    </div>
    <div class="duas-col" style="margin-top:14px"><div class="campo"><label for="av-peso">Peso de hoje (kg)</label><input id="av-peso" inputmode="decimal" value="${ctx.ult?.data === ctx.hoje ? kg(ctx.ult.peso) : ''}"></div>
      <div class="campo"><label for="av-alt">Altura (cm)</label><input id="av-alt" inputmode="decimal" value="${P.altura_cm}"></div></div>
    <p id="status" class="peq" role="status"></p>
    <button class="btn" style="width:100%" id="medir" disabled>Medir</button>`);
  const { arquivoParaCanvas } = await import('./medidas.js');
  f.el.querySelectorAll('input[type=file]').forEach((inp) => inp.onchange = async () => {
    const arq = inp.files?.[0]; if (!arq) return;
    const k = inp.dataset.f; fotos[k] = await arquivoParaCanvas(arq, 1280);
    const g = f.el.querySelector(`#g-${k}`); g.classList.add('ok');
    const img = document.createElement('img'); img.src = fotos[k].toDataURL('image/jpeg', 0.6); img.alt = ''; g.querySelector('svg, img')?.replaceWith(img);
    f.el.querySelector('#medir').disabled = !fotos.frente;
  });
  f.el.querySelectorAll('.guia-foto').forEach((g) => g.onkeydown = (e) => e.key === 'Enter' && g.querySelector('input').click());
  f.el.querySelector('#medir').onclick = async () => {
    const st = f.el.querySelector('#status'), b = f.el.querySelector('#medir');
    const altura = num(f.el.querySelector('#av-alt').value), peso = num(f.el.querySelector('#av-peso').value);
    if (!altura) return toast('Informe a altura');
    b.disabled = true;
    try {
      const { medirFotos } = await import('./medidas.js');
      const res = await medirFotos({ frente: fotos.frente, lado: fotos.lado, alturaCm: altura, sexo: P.sexo, aoProgresso: (m) => (st.textContent = m) });
      f.fechar();
      resultadoAvaliacao(res, fotos, { altura, peso });
    } catch (e) {
      console.error(e); st.innerHTML = `<span class="aviso erro" style="display:block">${esc(e.message || 'Não consegui medir.')} Tente uma foto com o corpo inteiro e fundo mais liso.</span>`; b.disabled = false;
    }
  };
}

function resultadoAvaliacao(res, fotos, { altura, peso }) {
  const bruto = res.medidas;
  const calibradas = C.calibrar(bruto, P.calibracao || {});
  const chaves = ['pescoco', 'peito', 'cintura', 'quadril', 'coxa', 'braco', 'ombros_largura'].filter((k) => calibradas[k] != null);
  const f = folha('Resultado', `
    ${res.avisos.length ? `<div class="aviso" style="margin-bottom:12px">${res.avisos.map(esc).join('<br>')}</div>` : ''}
    <div class="fotos-lado" id="conf"></div>
    <p class="peq">As linhas amarelas mostram onde cada medida foi tirada. Se alguma estiver no lugar errado, refaça a foto ou corrija o número.</p>
    <form id="fres">
      <table class="medidas-tab"><thead><tr><th>Região</th><th>Pela foto</th><th>Fita (opcional)</th></tr></thead><tbody>
      ${chaves.map((k) => `<tr><td>${NOMES_MEDIDAS[k]}<br><span class="peq">${esc(res.origem[k] || '')}</span></td><td><input name="m_${k}" inputmode="decimal" value="${kg(calibradas[k])}" aria-label="${NOMES_MEDIDAS[k]} pela foto" style="max-width:90px"></td><td>${k === 'ombros_largura' ? '' : `<input name="f_${k}" inputmode="decimal" placeholder="cm" aria-label="${NOMES_MEDIDAS[k]} com fita" style="max-width:90px">`}</td></tr>`).join('')}
      </tbody></table>
      <p class="peq">Medindo com fita, o app aprende a diferença e corrige as próximas avaliações por foto.</p>
      <button class="btn" style="width:100%">Salvar avaliação</button></form>`);
  const conf = f.el.querySelector('#conf');
  for (const [k, c] of Object.entries(res.conferencia)) if (c) { const fig = document.createElement('figure'); c.setAttribute('role', 'img'); c.setAttribute('aria-label', `Conferência da foto de ${k}`); fig.appendChild(c); fig.insertAdjacentHTML('beforeend', `<figcaption>${k === 'frente' ? 'Frente' : 'Lado'}</figcaption>`); conf.appendChild(fig); }
  f.el.querySelector('#fres').onsubmit = async (e) => {
    e.preventDefault();
    const ff = lerForm(e.target);
    const medidas = {}, fita = {}, novaCal = { ...(P.calibracao || {}) };
    for (const k of chaves) {
      const m = num(ff[`m_${k}`]), t = num(ff[`f_${k}`]);
      if (m) medidas[k] = m;
      if (t) { fita[k] = t; medidas[k] = t; if (bruto[k]) novaCal[k] = Math.round((t / bruto[k]) * 1000) / 1000; }
    }
    const ok = await tentar(async () => {
      const salvarFotos = P.guardar_fotos && !db.demo;
      const { canvasParaBlob } = await import('./medidas.js');
      const foto_frente = salvarFotos && fotos.frente ? await db.enviarFoto(await canvasParaBlob(fotos.frente), 'corpo') : (db.demo && fotos.frente ? fotos.frente.toDataURL('image/jpeg', 0.7) : null);
      const foto_lado = salvarFotos && fotos.lado ? await db.enviarFoto(await canvasParaBlob(fotos.lado), 'corpo') : null;
      const hoje = hojeISO();
      await db.salvarAvaliacao({ data: hoje, peso_kg: peso, altura_cm: altura, foto_frente, foto_lado, medidas, medidas_brutas: bruto, fita,
        detalhes: { larguraCm: res.larguraCm, profundidadeCm: res.profundidadeCm, relacaoLadoFrente: res.relacaoLadoFrente, avisos: res.avisos, origem: res.origem },
        indicadores: C.indicadores(P, medidas, peso), fonte: Object.keys(fita).length ? 'foto+fita' : 'foto' });
      if (peso) await db.salvarPesagem(hoje, peso);
      if (Object.keys(fita).length) P = await db.salvarPerfil({ ...P, calibracao: novaCal });
    }, 'Avaliação salva');
    if (ok) { f.fechar(); location.hash = '#corpo'; telaCorpo(); }
  };
}

function avaliacaoFita() {
  const chaves = ['pescoco', 'peito', 'cintura', 'quadril', 'coxa', 'braco'];
  const dicas = { pescoco: 'Logo abaixo do pomo de adão', peito: 'Na linha dos mamilos, expirando', cintura: P.sexo === 'F' ? 'Na parte mais fina do tronco' : 'Na altura do umbigo, sem encolher', quadril: 'Na parte mais larga do bumbum', coxa: 'Logo abaixo do bumbum', braco: 'No meio, entre ombro e cotovelo, relaxado' };
  const f = folha('Medidas com fita', `<form id="ff">${chaves.map((k) => `<div class="campo"><label for="ff-${k}">${NOMES_MEDIDAS[k]} (cm)</label><input id="ff-${k}" name="${k}" inputmode="decimal"><small>${dicas[k]}</small></div>`).join('')}
    <div class="campo"><label for="ff-peso">Peso de hoje (kg)</label><input id="ff-peso" name="peso" inputmode="decimal"></div>
    <button class="btn" style="width:100%">Salvar medidas</button></form>`);
  f.el.querySelector('#ff').onsubmit = async (e) => {
    e.preventDefault(); const ff = lerForm(e.target); const medidas = {};
    chaves.forEach((k) => { const v = num(ff[k]); if (v) medidas[k] = v; });
    if (!Object.keys(medidas).length) return toast('Preencha ao menos uma medida');
    const peso = num(ff.peso);
    if (await tentar(async () => {
      await db.salvarAvaliacao({ data: hojeISO(), peso_kg: peso, altura_cm: P.altura_cm, medidas, fita: medidas, indicadores: C.indicadores(P, medidas, peso), fonte: 'fita' });
      if (peso) await db.salvarPesagem(hojeISO(), peso);
    }, 'Medidas salvas')) { f.fechar(); telaCorpo(); }
  };
}

// ------------------------------------------------------------------ AJUSTES
function camposPerfil(p = {}) {
  return `<div class="campo"><span>Sexo biológico <small>(muda as fórmulas de gasto e gordura)</small></span>${escolha('sexo', { M: 'Masculino', F: 'Feminino' }, p.sexo || 'M')}</div>
  <div class="duas-col"><div class="campo"><label for="nasc">Nascimento</label><input type="date" id="nasc" name="nascimento" value="${p.nascimento || ''}" required></div>
  <div class="campo"><label for="alt">Altura (cm)</label><input id="alt" name="altura_cm" inputmode="decimal" value="${p.altura_cm || ''}" required></div></div>`;
}
function camposObjetivo(p = {}, pesoAtual) {
  const ideal = p.altura_cm ? C.pesoIdeal(p.altura_cm) : null;
  const sugestao = ideal && pesoAtual ? Math.min(pesoAtual - 1, ideal.max) : '';
  return `<div class="campo"><label for="meta">Peso meta (kg)</label><input id="meta" name="peso_meta_kg" inputmode="decimal" value="${p.peso_meta_kg ? kg(p.peso_meta_kg) : sugestao ? kg(sugestao) : ''}">
    ${ideal ? `<small>Faixa saudável para ${p.altura_cm} cm: ${kg(ideal.min)} a ${kg(ideal.max)} kg. Uma meta intermediária (5–10% do peso) costuma ser mais fácil de manter.</small>` : ''}</div>
  <div class="campo"><span>Atividade no dia a dia</span>${escolha('atividade', Object.fromEntries(Object.entries(C.ATIVIDADE).map(([k, v]) => [k, v.nome.split(' (')[0]])), p.atividade || 'leve')}<small>${Object.values(C.ATIVIDADE).map((a) => a.nome).join(' · ')}</small></div>
  <div class="campo"><span>Ritmo de perda</span>${escolha('ritmo', Object.fromEntries(Object.entries(C.RITMOS).map(([k, v]) => [k, v.nome])), p.ritmo || 'moderado')}</div>`;
}

async function telaAjustes() {
  const ctx = await contexto();
  const mc = ctx.mc;
  const b = ctx.pesoRef ? Math.round(C.tmb({ sexo: P.sexo, pesoKg: ctx.pesoRef, alturaCm: P.altura_cm, idadeAnos: C.idade(P.nascimento) })) : null;
  const L = P.lembretes || {};
  const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad/i.test(navigator.userAgent);

  const main = casca('ajustes', `
    <h1>Ajustes</h1><p class="sub">${esc(db.email || '')}</p>
    <div class="grade duas">
      <div class="grade">
        <section class="painel"><h2>Seus dados e objetivo</h2><form id="fperfil">${camposPerfil(P)}${camposObjetivo(P, ctx.pesoRef)}
          <details><summary>Definir metas manualmente</summary>
            <div class="duas-col" style="margin-top:8px"><div class="campo"><label for="km">Calorias por dia</label><input id="km" name="kcal_meta_manual" inputmode="numeric" value="${P.kcal_meta_manual || ''}" placeholder="${mc?.meta ?? ''}"></div>
            <div class="campo"><label for="am">Água por dia (ml)</label><input id="am" name="agua_meta_ml" inputmode="numeric" value="${P.agua_meta_ml || ''}" placeholder="${ctx.metasDia.aguaMl}"></div></div>
            <small class="peq">Deixe em branco para o app calcular.</small></details>
          <button class="btn" style="margin-top:12px">Salvar</button></form></section>

        <section class="painel"><h2>Como suas metas são calculadas</h2>
          ${mc ? `<dl class="kv">
            <dt>Gasto em repouso (TMB, Mifflin-St Jeor)</dt><dd>${int(b)} kcal</dd>
            <dt>Gasto total por dia ${ctx.adapt ? '(medido pelos seus dados)' : '(estimado pela atividade)'}</dt><dd>${int(mc.gasto)} kcal</dd>
            <dt>Déficit para ${kg(mc.kgSemana)} kg/semana</dt><dd>−${int(mc.deficit)} kcal</dd>
            <dt>Sua meta diária</dt><dd>${int(ctx.metasDia.kcal)} kcal</dd>
            <dt>Mínimo seguro</dt><dd>${int(mc.piso)} kcal</dd>
            <dt>Proteína</dt><dd>${ctx.metasDia.proteinaG} g</dd>
            <dt>Água (35 ml/kg)</dt><dd>${(ctx.metasDia.aguaMl / 1000).toLocaleString('pt-BR')} L</dd></dl>
            ${mc.limitadoPeloPiso ? '<p class="aviso" style="margin-top:12px">O ritmo escolhido pediria comer abaixo do mínimo seguro, então a meta foi travada no mínimo e o ritmo real fica um pouco menor.</p>' : ''}
            <p class="peq" style="margin:12px 0 0">${ctx.adapt ? `Com ${ctx.adapt.diasComRegistro} dias de refeições registradas, o app compara o que você comeu com a variação do seu peso e ajusta o gasto real automaticamente.` : 'Depois de 2 a 3 semanas registrando refeições e peso, o app passa a medir o seu gasto real e ajusta a meta sozinho.'} Isto é uma referência, não orientação médica; se tiver alguma condição de saúde, alinhe as metas com seu médico ou nutricionista.</p>` : '<p>Registre seu peso para calcular.</p>'}
        </section>
      </div>
      <div class="grade">
        <section class="painel"><h2>Lembretes</h2>
          ${perm === 'granted' ? '<p class="peq" style="margin-top:0">Notificações ligadas neste aparelho.</p>' : ios && !instalado ? '<p class="aviso">No iPhone, primeiro instale o app: Safari → Compartilhar → Adicionar à Tela de Início. Depois abra por lá e ligue as notificações.</p>' : perm === 'denied' ? '<p class="aviso erro">As notificações estão bloqueadas para este site. Libere nas configurações do navegador.</p>' : ''}
          <form id="flemb">
            <div class="pergunta"><label for="la">Lembrar de beber água</label><input type="checkbox" id="la" name="agua_ativo" ${L.agua?.ativo ? 'checked' : ''}></div>
            <div class="duas-col"><div class="campo"><label for="lai">Das</label><input type="time" id="lai" name="agua_inicio" value="${L.agua?.inicio || '08:00'}"></div><div class="campo"><label for="laf">Até</label><input type="time" id="laf" name="agua_fim" value="${L.agua?.fim || '22:00'}"></div></div>
            <div class="campo"><span>A cada</span>${escolha('agua_intervalo', { 60: '1 h', 90: '1h30', 120: '2 h', 180: '3 h' }, String(L.agua?.intervalo_min || 120))}<small>Se você acabou de registrar água, o lembrete espera.</small></div>
            <div class="pergunta"><label for="lp">Lembrar de se pesar</label><span><input type="time" name="pesagem_hora" value="${L.pesagem?.hora || '07:30'}" aria-label="Horário da pesagem" style="width:120px"> <input type="checkbox" id="lp" name="pesagem_ativo" ${L.pesagem?.ativo ? 'checked' : ''}></span></div>
            <div class="pergunta"><label for="lt">Perguntar do treino e cardio</label><span><input type="time" name="treino_hora" value="${L.treino?.hora || '21:00'}" aria-label="Horário da pergunta do treino" style="width:120px"> <input type="checkbox" id="lt" name="treino_ativo" ${L.treino?.ativo ? 'checked' : ''}></span></div>
            <div class="btns" style="margin-top:12px"><button class="btn">Salvar lembretes</button>${perm !== 'granted' ? '<button type="button" class="btn fita" id="ativar">Ligar notificações</button>' : '<button type="button" class="btn sec" id="testar">Enviar teste</button>'}</div>
          </form></section>

        <section class="painel"><h2>Privacidade</h2>
          <div class="pergunta"><label for="gf">Guardar fotos (corpo e comida) para comparar depois</label><input type="checkbox" id="gf" ${P.guardar_fotos ? 'checked' : ''}></div>
          <p class="peq">As medidas são lidas no seu aparelho. Fotos guardadas ficam numa pasta privada só sua. Fotos de comida são enviadas à IA apenas para estimar calorias.</p>
          <div class="btns" style="margin-top:12px"><button class="btn sec" id="exportar">Exportar meus dados (CSV)</button><button class="btn perigo" id="apagar">Apagar todos os dados do Forma</button></div>
        </section>

        <section class="painel"><h2>Conta</h2>
          <div class="campo"><span>Tema</span>${escolha('tema', { auto: 'Automático', light: 'Claro', dark: 'Escuro' }, localStorage.getItem('forma-tema') || 'auto')}</div>
          <details><summary>Configuração do servidor (só uma vez)</summary>
            <p class="peq">Para as notificações funcionarem, o servidor precisa de um par de chaves. Gere aqui e cole nos Secrets do GitHub como <code>VAPID_PUBLIC_KEY</code> e <code>VAPID_PRIVATE_KEY</code>.</p>
            <button class="btn sec peq" id="vapid">Gerar chaves</button><pre id="vapid-out" style="white-space:pre-wrap;word-break:break-all;font-size:12px"></pre></details>
          <button class="btn sec" id="sair" style="margin-top:12px">Sair</button></section>
      </div>
    </div>`);

  main.querySelector('#fperfil').onsubmit = async (e) => {
    e.preventDefault(); const f = lerForm(e.target);
    const novo = { ...P, sexo: f.sexo, nascimento: f.nascimento, altura_cm: num(f.altura_cm), peso_meta_kg: num(f.peso_meta_kg), atividade: f.atividade, ritmo: f.ritmo, kcal_meta_manual: num(f.kcal_meta_manual) || null, agua_meta_ml: num(f.agua_meta_ml) || null };
    if (await tentar(async () => { P = await db.salvarPerfil(novo); }, 'Dados salvos')) telaAjustes();
  };
  main.querySelector('#flemb').onsubmit = async (e) => {
    e.preventDefault(); const f = lerForm(e.target);
    const lembretes = { agua: { ativo: !!f.agua_ativo, inicio: f.agua_inicio, fim: f.agua_fim, intervalo_min: Number(f.agua_intervalo) }, pesagem: { ativo: !!f.pesagem_ativo, hora: f.pesagem_hora }, treino: { ativo: !!f.treino_ativo, hora: f.treino_hora } };
    await tentar(async () => { P = await db.salvarPerfil({ ...P, lembretes }); }, 'Lembretes salvos');
  };
  main.querySelector('#ativar')?.addEventListener('click', async () => { if (await tentar(ativarNotificacoes, 'Notificações ligadas')) telaAjustes(); });
  main.querySelector('#testar')?.addEventListener('click', () => tentar(async () => { await ativarNotificacoes(); const r = await db.testarPush(); if (!r.enviados) throw new Error('Nenhum aparelho recebeu. Tente desligar e ligar as notificações.'); }, 'Teste enviado'));
  main.querySelector('#gf').onchange = (e) => tentar(async () => { P = await db.salvarPerfil({ ...P, guardar_fotos: e.target.checked }); }, e.target.checked ? 'Fotos serão guardadas' : 'Fotos não serão mais guardadas');
  main.querySelectorAll('input[name=tema]').forEach((r) => r.onchange = () => { localStorage.setItem('forma-tema', r.value); aplicarTema(); });
  main.querySelector('#exportar').onclick = () => tentar(exportarCSV);
  main.querySelector('#apagar').onclick = async () => {
    if (!confirmar('Apagar pesagens, medidas, fotos, refeições, água e treinos do Forma? Isso não pode ser desfeito. (O Fôlego não é afetado.)')) return;
    if (await tentar(() => db.apagarTudo(), 'Dados apagados')) location.reload();
  };
  main.querySelector('#vapid').onclick = gerarVapid;
  main.querySelector('#sair').onclick = async () => { await db.sair(); localStorage.removeItem('forma-demo'); location.reload(); };
}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uParaBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

async function gerarVapid() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', par.publicKey));
  const priv = (await crypto.subtle.exportKey('jwk', par.privateKey)).d;
  document.getElementById('vapid-out').textContent = `VAPID_PUBLIC_KEY\n${pub}\n\nVAPID_PRIVATE_KEY\n${priv}\n\nCopie agora: a chave privada não fica salva em lugar nenhum.`;
}

async function ativarNotificacoes() {
  if (db.demo) throw new Error('Na demonstração as notificações ficam desligadas.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(/iphone|ipad/i.test(navigator.userAgent) ? 'No iPhone, instale o app na Tela de Início e abra por lá.' : 'Este navegador não aceita notificações.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada.');
  const reg = await navigator.serviceWorker.ready;
  const chave = await db.chaveVapid();
  if (!chave) throw new Error('O servidor ainda não tem as chaves de notificação (VAPID). Veja Ajustes → Configuração do servidor.');
  let sub = await reg.pushManager.getSubscription();
  if (sub && b64u(sub.options.applicationServerKey) !== chave) { await sub.unsubscribe(); sub = null; }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uParaBytes(chave) });
  await db.salvarPush(sub);
}

async function exportarCSV() {
  const [pes, refs, avs] = await Promise.all([db.pesagens(), db.refeicoes('2000-01-01', '2999-12-31'), db.avaliacoes()]);
  const linhas = [['tipo', 'data', 'descricao', 'valor', 'kcal', 'proteina_g', 'carbo_g', 'gordura_g']];
  pes.forEach((p) => linhas.push(['peso', p.data, '', p.peso_kg, '', '', '', '']));
  refs.forEach((r) => linhas.push(['refeicao', r.data, r.descricao, '', r.kcal, r.proteina_g, r.carbo_g, r.gordura_g]));
  avs.forEach((a) => Object.entries(a.medidas || {}).forEach(([k, v]) => linhas.push(['medida_' + k, a.data, '', v, '', '', '', ''])));
  const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `forma-${hojeISO()}.csv`; a.click();
}

// ------------------------------------------------------------------ cadastro inicial
function cadastro() {
  let dados = {};
  let passo = 1;
  const desenhar = () => {
    const pesoAtual = num(dados.peso);
    const prev = { ...dados, altura_cm: num(dados.altura_cm), peso_meta_kg: num(dados.peso_meta_kg) };
    let corpo = '';
    if (passo === 1) corpo = `<h1>Vamos começar</h1><p class="sub">Esses dados calculam seu peso ideal e quantas calorias comer.</p>
      <form id="fc">${camposPerfil(prev)}<div class="campo"><label for="pa">Peso de hoje (kg)</label><input id="pa" name="peso" inputmode="decimal" value="${dados.peso || ''}" required></div><button class="btn" style="width:100%">Continuar</button></form>`;
    if (passo === 2) {
      const ideal = C.pesoIdeal(prev.altura_cm), i = C.imc(pesoAtual, prev.altura_cm);
      corpo = `<h1>Seu objetivo</h1><p class="sub">Hoje: ${kg(pesoAtual)} kg, IMC ${kg(i)} (${C.classeImc(i).toLowerCase()}). Peso saudável para ${prev.altura_cm} cm: ${kg(ideal.min)}–${kg(ideal.max)} kg.</p>
      <form id="fc">${camposObjetivo(prev, pesoAtual)}<div class="btns cheio"><button type="button" class="btn sec" id="volta">Voltar</button><button class="btn">Ver meu plano</button></div></form>`;
    }
    if (passo === 3) {
      const mc = C.metaCalorica(prev, pesoAtual), falta = C.caloriasParaPerder(pesoAtual, prev.peso_meta_kg || pesoAtual, mc.kgSemana), mt = C.metas(prev, pesoAtual);
      corpo = `<h1>Seu plano</h1><p class="sub">Dá para ajustar tudo depois em Ajustes.</p>
      <section class="painel"><div class="num-g">${int(mc.meta)}<span class="unid">kcal/dia</span></div>
        <dl class="kv" style="margin-top:16px"><dt>Você gasta por dia (estimado)</dt><dd>${int(mc.gasto)} kcal</dd><dt>Déficit diário</dt><dd>${int(mc.deficit)} kcal</dd>
        ${!mc.manutencao ? `<dt>Perder até a meta</dt><dd>${kg(falta.kg)} kg ≈ ${int(falta.kcal)} kcal</dd><dt>Tempo estimado</dt><dd>${falta.semanas} semanas</dd>` : '<dt>Objetivo</dt><dd>manter o peso</dd>'}
        <dt>Proteína</dt><dd>${mt.proteinaG} g/dia</dd><dt>Água</dt><dd>${(mt.aguaMl / 1000).toLocaleString('pt-BR')} L/dia</dd></dl>
        ${mc.limitadoPeloPiso ? '<p class="aviso">Para não comer abaixo do mínimo seguro, o ritmo real fica um pouco mais lento.</p>' : ''}</section>
      <p class="peq">Agora tire as fotos de frente e de lado para registrar suas medidas iniciais. Elas mostram progresso mesmo quando a balança empaca.</p>
      <div class="btns cheio"><button class="btn sec" id="depois">Depois</button><button class="btn fita" id="fotos">Tirar as fotos agora</button></div>`;
    }
    $app.innerHTML = `${db.demo ? '<div class="demo-faixa">Demonstração</div>' : ''}<div class="entrada"><div class="passos" aria-label="Passo ${passo} de 3">${[1, 2, 3].map((n) => `<i class="${n <= passo ? 'on' : ''}"></i>`).join('')}</div>${corpo}</div>`;
    const fc = $app.querySelector('#fc');
    if (fc) fc.onsubmit = (e) => {
      e.preventDefault(); Object.assign(dados, lerForm(fc));
      if (passo === 1) { const a = num(dados.altura_cm), p = num(dados.peso); if (!a || a < 120 || a > 230) return toast('Altura em cm, ex.: 178'); if (!p || p < 25 || p > 350) return toast('Peso em kg, ex.: 86,5'); if (C.idade(dados.nascimento) < 18) return toast('O Forma é para maiores de 18 anos.'); }
      passo++; desenhar();
    };
    $app.querySelector('#volta')?.addEventListener('click', () => { passo--; desenhar(); });
    const finalizar = async (fotos) => {
      const ok = await tentar(async () => {
        P = await db.salvarPerfil({ sexo: dados.sexo, nascimento: dados.nascimento, altura_cm: num(dados.altura_cm), peso_meta_kg: num(dados.peso_meta_kg), atividade: dados.atividade, ritmo: dados.ritmo });
        await db.salvarPesagem(hojeISO(), num(dados.peso));
      }, 'Tudo pronto');
      if (!ok) return;
      location.hash = fotos ? '#corpo' : '#hoje';
      await rotear();
      if (fotos) novaAvaliacao();
    };
    $app.querySelector('#depois')?.addEventListener('click', () => finalizar(false));
    $app.querySelector('#fotos')?.addEventListener('click', () => finalizar(true));
    $app.querySelector('input')?.focus();
  };
  desenhar();
}

// ------------------------------------------------------------------ entrada
function telaLogin(cfgFaltando) {
  $app.innerHTML = `<div class="entrada"><div class="logo">${LOGO} Forma</div><p class="sub">Peso, medidas, calorias, água e treino. Use a mesma conta do Fôlego.</p>
    ${cfgFaltando ? `<form id="fcfg" class="painel"><h2>Conectar ao servidor</h2><p class="peq">Só aparece se o site ainda não tiver as Variables do GitHub (SUPABASE_URL e SUPABASE_ANON_KEY).</p>
      <div class="campo"><label for="cu">SUPABASE_URL</label><input id="cu" name="url" type="text" placeholder="https://xxxx.supabase.co" required></div>
      <div class="campo"><label for="ck">SUPABASE_ANON_KEY</label><input id="ck" name="anonKey" type="text" required></div><button class="btn" style="width:100%">Conectar</button></form>`
    : `<form id="flogin" class="painel"><div class="campo"><label for="em">E-mail</label><input id="em" name="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="se">Senha</label><input id="se" name="senha" type="password" autocomplete="current-password" required></div><button class="btn" style="width:100%">Entrar</button></form>`}
    <p style="text-align:center"><button class="btn sec" id="demo">Ver demonstração</button></p></div>`;
  $app.querySelector('#demo').onclick = () => { localStorage.setItem('forma-demo', '1'); location.reload(); };
  $app.querySelector('#fcfg')?.addEventListener('submit', (e) => { e.preventDefault(); const f = lerForm(e.target); localStorage.setItem('forma-config', JSON.stringify({ url: f.url.trim().replace(/\/$/, ''), anonKey: f.anonKey.trim() })); location.reload(); });
  $app.querySelector('#flogin')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = lerForm(e.target); if (await tentar(() => db.entrar(f.email, f.senha))) iniciar(); });
}

async function rotear() {
  const [rota, sub] = (location.hash.slice(1) || 'hoje').split('/');
  const fn = ROTAS[rota] || telaHoje;
  try { await fn(sub); window.scrollTo(0, 0); }
  catch (e) { console.error(e); $app.innerHTML = `<div class="entrada"><h1>Não consegui carregar</h1><p class="aviso erro">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`; }
}

function aplicarTema() {
  const t = localStorage.getItem('forma-tema');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

async function iniciar() {
  aplicarTema();
  $app.innerHTML = '<div class="carregando">Carregando…</div>';
  const demo = new URLSearchParams(location.search).has('demo') || localStorage.getItem('forma-demo') === '1';
  if (demo) { db = new DemoStore(); await db.iniciar(); }
  else {
    const cfg = lerConfig();
    if (!cfg) return telaLogin(true);
    db = await SupabaseStore.criar(cfg);
    if (!(await db.iniciar())) return telaLogin(false);
  }
  P = await db.perfil();
  if (!P) return cadastro();
  rotear();
}

window.addEventListener('hashchange', () => { if (db && P) rotear(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
iniciar();
