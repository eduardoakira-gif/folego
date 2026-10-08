// Forma — cálculos puros (sem DOM, sem rede). Testados em tests/forma-calc.test.mjs.
// Todas as fórmulas são referências populacionais, não diagnóstico.

export const KCAL_POR_KG = 7700;

export const ATIVIDADE = {
  sedentario: { fator: 1.2, nome: 'Sedentário (pouco ou nenhum exercício)' },
  leve: { fator: 1.375, nome: 'Leve (1–3 treinos/semana)' },
  moderado: { fator: 1.55, nome: 'Moderado (3–5 treinos/semana)' },
  intenso: { fator: 1.725, nome: 'Intenso (6–7 treinos/semana)' },
  atleta: { fator: 1.9, nome: 'Muito intenso (2x por dia ou trabalho físico)' },
};

export const RITMOS = {
  leve: { kgSemana: 0.25, nome: 'Leve — 0,25 kg/semana' },
  moderado: { kgSemana: 0.5, nome: 'Moderado — 0,5 kg/semana' },
  acelerado: { kgSemana: 0.75, nome: 'Acelerado — 0,75 kg/semana' },
};

const r1 = (x) => Math.round(x * 10) / 10;
const r0 = (x) => Math.round(x);

export function idade(nascimento, hoje = new Date()) {
  const n = new Date(nascimento + 'T12:00:00');
  let a = hoje.getFullYear() - n.getFullYear();
  const m = hoje.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) a--;
  return a;
}

export function imc(pesoKg, alturaCm) {
  const h = alturaCm / 100;
  return pesoKg / (h * h);
}

export function classeImc(v) {
  if (v < 18.5) return 'Abaixo do peso';
  if (v < 25) return 'Peso saudável';
  if (v < 30) return 'Sobrepeso';
  if (v < 35) return 'Obesidade grau I';
  if (v < 40) return 'Obesidade grau II';
  return 'Obesidade grau III';
}

/** Faixa de peso saudável pela altura (IMC 18,5 a 24,9) e um ponto de referência (IMC 22). */
export function pesoIdeal(alturaCm) {
  const h2 = (alturaCm / 100) ** 2;
  return { min: r1(18.5 * h2), max: r1(24.9 * h2), referencia: r1(22 * h2) };
}

/** Taxa metabólica basal (Mifflin-St Jeor). */
export function tmb({ sexo, pesoKg, alturaCm, idadeAnos }) {
  const base = 10 * pesoKg + 6.25 * alturaCm - 5 * idadeAnos;
  return base + (sexo === 'F' ? -161 : 5);
}

/** Gasto energético total estimado por dia. */
export function get(perfil, pesoKg) {
  const b = tmb({ sexo: perfil.sexo, pesoKg, alturaCm: perfil.altura_cm, idadeAnos: idade(perfil.nascimento) });
  return b * (ATIVIDADE[perfil.atividade]?.fator ?? 1.375);
}

/**
 * Meta diária de calorias para perder peso com segurança.
 * - Ritmo limitado a 1% do peso por semana.
 * - Nunca abaixo do piso (TMB, e 1.500 kcal homens / 1.200 kcal mulheres).
 */
export function metaCalorica(perfil, pesoKg, getReal = null) {
  const b = tmb({ sexo: perfil.sexo, pesoKg, alturaCm: perfil.altura_cm, idadeAnos: idade(perfil.nascimento) });
  const gasto = getReal ?? b * (ATIVIDADE[perfil.atividade]?.fator ?? 1.375);
  const alvo = perfil.peso_meta_kg;
  const piso = Math.max(b, perfil.sexo === 'F' ? 1200 : 1500);

  if (!alvo || alvo >= pesoKg - 0.2) {
    return { gasto: r0(gasto), meta: r0(gasto), deficit: 0, kgSemana: 0, piso: r0(piso), limitadoPeloPiso: false, manutencao: true };
  }
  let kgSemana = Math.min(RITMOS[perfil.ritmo]?.kgSemana ?? 0.5, pesoKg * 0.01);
  let deficit = (kgSemana * KCAL_POR_KG) / 7;
  let meta = gasto - deficit;
  let limitadoPeloPiso = false;
  if (meta < piso) {
    meta = piso;
    deficit = Math.max(0, gasto - piso);
    kgSemana = (deficit * 7) / KCAL_POR_KG;
    limitadoPeloPiso = true;
  }
  return { gasto: r0(gasto), meta: r0(meta), deficit: r0(deficit), kgSemana: Math.round(kgSemana * 100) / 100, piso: r0(piso), limitadoPeloPiso, manutencao: false };
}

/** Calorias totais a "queimar" para chegar ao peso meta, e tempo estimado. */
export function caloriasParaPerder(pesoKg, metaKg, kgSemana) {
  const kg = Math.max(0, pesoKg - metaKg);
  const total = kg * KCAL_POR_KG;
  const semanas = kgSemana > 0 ? kg / kgSemana : null;
  return { kg: r1(kg), kcal: r0(total), semanas: semanas == null ? null : Math.ceil(semanas) };
}

export function metas(perfil, pesoKg) {
  return {
    proteinaG: r0(1.6 * Math.min(pesoKg, (perfil.peso_meta_kg || pesoKg) + 10)),
    aguaMl: Math.round((35 * pesoKg) / 50) * 50,
  };
}

// ---------- Tendência do peso ----------

const DIA = 86400000;
const toDate = (s) => new Date(s + 'T12:00:00Z');
export const isoDia = (d) => d.toISOString().slice(0, 10);

/**
 * Média móvel exponencial do peso (suaviza água, sal, intestino).
 * Recebe [{data:'YYYY-MM-DD', peso_kg}] em qualquer ordem. Dias sem pesagem são respeitados.
 */
export function tendencia(pesagens, alfa = 0.1) {
  const ord = [...pesagens].sort((a, b) => a.data.localeCompare(b.data));
  let t = null, ultimo = null;
  return ord.map((p) => {
    const peso = Number(p.peso_kg);
    if (t == null) t = peso;
    else {
      const dias = Math.max(1, Math.round((toDate(p.data) - toDate(ultimo)) / DIA));
      const a = 1 - (1 - alfa) ** dias;
      t = t + a * (peso - t);
    }
    ultimo = p.data;
    return { data: p.data, peso, tendencia: Math.round(t * 100) / 100 };
  });
}

/** Inclinação (kg/semana) da tendência nos últimos N dias, por regressão linear. */
export function ritmoSemanal(serie, dias = 14) {
  if (serie.length < 2) return null;
  const fim = toDate(serie[serie.length - 1].data);
  const pts = serie.filter((p) => (fim - toDate(p.data)) / DIA <= dias);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => (toDate(p.data) - fim) / DIA);
  const ys = pts.map((p) => p.tendencia);
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  return Math.round((num / den) * 7 * 100) / 100;
}

/** Data prevista para chegar à meta no ritmo atual (só se estiver perdendo). */
export function projecao(serie, metaKg, ritmoKgSemana) {
  if (!serie.length || !metaKg || ritmoKgSemana == null || ritmoKgSemana >= -0.05) return null;
  const atual = serie[serie.length - 1].tendencia;
  if (atual <= metaKg) return { atingida: true };
  const semanas = (atual - metaKg) / -ritmoKgSemana;
  const d = new Date(toDate(serie[serie.length - 1].data).getTime() + semanas * 7 * DIA);
  return { atingida: false, data: isoDia(d), semanas: Math.ceil(semanas) };
}

/**
 * Gasto real estimado pelos seus dados: média do que comeu menos a variação da tendência.
 * Precisa de 14+ dias com refeições registradas e pesagens no período.
 */
export function gastoAdaptativo(serie, kcalPorDia, dias = 21) {
  if (serie.length < 2) return null;
  const fim = serie[serie.length - 1].data;
  const ini = isoDia(new Date(toDate(fim) - (dias - 1) * DIA));
  const dentro = serie.filter((p) => p.data >= ini);
  const comidos = Object.entries(kcalPorDia).filter(([d, k]) => d >= ini && d <= fim && k > 400);
  if (dentro.length < 7 || comidos.length < 14) return null;
  const mediaKcal = comidos.reduce((s, [, k]) => s + k, 0) / comidos.length;
  const span = (toDate(dentro[dentro.length - 1].data) - toDate(dentro[0].data)) / DIA;
  if (span < 10) return null;
  const variacao = dentro[dentro.length - 1].tendencia - dentro[0].tendencia;
  const balanco = (variacao * KCAL_POR_KG) / span;
  return { gasto: r0(mediaKcal - balanco), diasComRegistro: comidos.length, mediaKcal: r0(mediaKcal) };
}

// ---------- Medidas corporais ----------

/** Perímetro de elipse (Ramanujan II) a partir de largura (frente) e profundidade (lado). */
export function perimetroElipse(largura, profundidade) {
  const a = largura / 2, b = profundidade / 2;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** % de gordura pelo método da Marinha americana (medidas em cm). */
export function gorduraMarinha({ sexo, alturaCm, cinturaCm, pescocoCm, quadrilCm }) {
  if (!cinturaCm || !pescocoCm) return null;
  let v;
  if (sexo === 'F') {
    if (!quadrilCm || cinturaCm + quadrilCm - pescocoCm <= 0) return null;
    v = 495 / (1.29579 - 0.35004 * Math.log10(cinturaCm + quadrilCm - pescocoCm) + 0.221 * Math.log10(alturaCm)) - 450;
  } else {
    if (cinturaCm - pescocoCm <= 0) return null;
    v = 495 / (1.0324 - 0.19077 * Math.log10(cinturaCm - pescocoCm) + 0.15456 * Math.log10(alturaCm)) - 450;
  }
  return v > 2 && v < 70 ? r1(v) : null;
}

/** Indicadores derivados das medidas. */
export function indicadores(perfil, medidas, pesoKg) {
  const out = {};
  if (medidas.cintura) {
    out.rce = Math.round((medidas.cintura / perfil.altura_cm) * 100) / 100; // relação cintura/altura
    out.rceFaixa = out.rce < 0.5 ? 'Saudável (abaixo de 0,5)' : out.rce < 0.6 ? 'Atenção (0,5 a 0,6)' : 'Risco aumentado (acima de 0,6)';
  }
  if (medidas.cintura && medidas.quadril) out.rcq = Math.round((medidas.cintura / medidas.quadril) * 100) / 100;
  const g = gorduraMarinha({ sexo: perfil.sexo, alturaCm: perfil.altura_cm, cinturaCm: medidas.cintura, pescocoCm: medidas.pescoco, quadrilCm: medidas.quadril });
  if (g != null) {
    out.gorduraPct = g;
    if (pesoKg) { out.massaGordaKg = r1((pesoKg * g) / 100); out.massaMagraKg = r1(pesoKg - out.massaGordaKg); }
  }
  return out;
}

/** Diferença medida a medida entre duas avaliações. */
export function compararMedidas(antes, depois) {
  const chaves = new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})]);
  const out = {};
  for (const k of chaves) {
    const a = antes?.[k], d = depois?.[k];
    if (typeof a === 'number' && typeof d === 'number') out[k] = r1(d - a);
  }
  return out;
}

/** Aplica a calibração com fita métrica: fator = fita / estimado, por medida. */
export function calibrar(medidas, calibracao = {}) {
  const out = { ...medidas };
  for (const [k, f] of Object.entries(calibracao)) if (typeof out[k] === 'number' && f > 0.7 && f < 1.3) out[k] = r1(out[k] * f);
  return out;
}

// ---------- Dia ----------

export function resumoDia({ refeicoes = [], aguaMl = 0, checkin = null }, metasDia) {
  const soma = (k) => refeicoes.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const kcal = r0(soma('kcal'));
  return {
    kcal,
    restante: metasDia.kcal - kcal,
    proteina: r0(soma('proteina_g')),
    carbo: r0(soma('carbo_g')),
    gordura: r0(soma('gordura_g')),
    aguaMl,
    aguaPct: Math.min(100, Math.round((aguaMl / metasDia.aguaMl) * 100)),
    treinou: checkin?.treinou ?? null,
    cardio: checkin?.cardio ?? null,
  };
}

/** Sequência de dias seguidos com treino ou cardio (até ontem ou hoje). */
export function sequencia(checkins, hojeIso) {
  const set = new Set(checkins.filter((c) => c.treinou || c.cardio).map((c) => c.data));
  let d = toDate(hojeIso);
  if (!set.has(hojeIso)) d = new Date(d - DIA);
  let n = 0;
  while (set.has(isoDia(d))) { n++; d = new Date(d - DIA); }
  return n;
}

export const fmtKg = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const fmtInt = (v) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'));
