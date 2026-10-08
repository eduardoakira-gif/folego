// Forma — medidas corporais a partir da silhueta (máscara) e dos pontos do corpo (pose).
// Puro: recebe a máscara já calculada no aparelho. Nenhuma foto sai do celular para medir.
//
// Método:
// 1. A altura informada vira a régua: cm por pixel = altura / (topo da cabeça até o pé).
// 2. Foto de frente dá a LARGURA de cada região; foto de lado dá a PROFUNDIDADE na mesma altura relativa.
// 3. Perímetro = elipse com essa largura e profundidade (Ramanujan). Coxa idem; braço como círculo.
// 4. Calibração opcional com fita métrica corrige o viés de cada medida (ver calc.calibrar).

import { perimetroElipse } from './calc.js';

// Índices dos pontos do MediaPipe Pose
export const P = { nariz: 0, ombroE: 11, ombroD: 12, cotoveloE: 13, cotoveloD: 14, quadrilE: 23, quadrilD: 24, joelhoE: 25, joelhoD: 26, tornozeloE: 27, tornozeloD: 28, calcanharE: 29, calcanharD: 30, peE: 31, peD: 32 };

const LIMIAR = 0.5;
const lerp = (a, b, t) => a + (b - a) * t;

/** Trechos contínuos de corpo numa linha da máscara: [[x0, x1], ...] (x1 inclusivo). */
export function trechos(mask, w, y, limiar = LIMIAR) {
  const out = [];
  const base = y * w;
  let ini = -1;
  for (let x = 0; x < w; x++) {
    const on = mask[base + x] >= limiar;
    if (on && ini < 0) ini = x;
    if (!on && ini >= 0) { if (x - ini >= 2) out.push([ini, x - 1]); ini = -1; }
  }
  if (ini >= 0 && w - ini >= 2) out.push([ini, w - 1]);
  return out;
}

/** Trecho que contém xRef (ou o mais próximo, até `tolerancia` px). */
function trechoEm(mask, w, y, xRef, tolerancia = 6) {
  const ts = trechos(mask, w, y);
  let melhor = null, dist = Infinity;
  for (const t of ts) {
    const d = xRef < t[0] ? t[0] - xRef : xRef > t[1] ? xRef - t[1] : 0;
    if (d < dist) { dist = d; melhor = t; }
  }
  return dist <= tolerancia ? melhor : null;
}

/** Largura (px) na altura y, mediana de 5 linhas para tirar ruído. */
export function larguraEm(mask, w, h, y, xRef) {
  const vals = [];
  for (let dy = -2; dy <= 2; dy++) {
    const yy = Math.round(y) + dy;
    if (yy < 0 || yy >= h) continue;
    const t = trechoEm(mask, w, yy, Math.round(xRef));
    if (t) vals.push({ larg: t[1] - t[0] + 1, t });
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a.larg - b.larg);
  return vals[Math.floor(vals.length / 2)];
}

/** Topo e base do corpo (px). */
export function limitesCorpo(mask, w, h, lm) {
  let topo = -1;
  for (let y = 0; y < h && topo < 0; y++) if (trechos(mask, w, y).some((t) => t[1] - t[0] >= 3)) topo = y;
  let base = -1;
  for (let y = h - 1; y >= 0 && base < 0; y--) if (trechos(mask, w, y).some((t) => t[1] - t[0] >= 3)) base = y;
  // O pé às vezes some na máscara (sombra/piso). Usa o ponto mais baixo do pé se for mais baixo.
  if (lm) {
    const pes = [P.calcanharE, P.calcanharD, P.peE, P.peD].map((i) => lm[i]).filter((p) => p && (p.visibility ?? 1) > 0.3);
    if (pes.length) base = Math.max(base, Math.round(Math.max(...pes.map((p) => p.y)) * h));
  }
  return { topo, base: Math.min(base, h - 1), alturaPx: base - topo };
}

const px = (p, w, h) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 1 });

function checarPose(lm, w, h, lim, esperado) {
  const avisos = [];
  const chaves = [P.nariz, P.ombroE, P.ombroD, P.quadrilE, P.quadrilD, P.joelhoE, P.joelhoD, P.tornozeloE, P.tornozeloD];
  if (chaves.some((i) => (lm[i]?.visibility ?? 1) < 0.35) && esperado === 'frente') avisos.push('Parte do corpo não ficou bem visível. Use roupa justa e fundo liso.');
  if (lim.topo <= 2) avisos.push('A cabeça encostou na borda de cima. Afaste o celular.');
  if (lim.base >= h - 2) avisos.push('Os pés encostaram na borda de baixo. Deixe uma margem.');
  if (lim.alturaPx < h * 0.55) avisos.push('Você ficou pequeno na foto. Chegue mais perto (corpo ocupando 70–90% da altura).');
  const oE = px(lm[P.ombroE], w, h), oD = px(lm[P.ombroD], w, h), qE = px(lm[P.quadrilE], w, h), qD = px(lm[P.quadrilD], w, h);
  const tronco = Math.abs((qE.y + qD.y) / 2 - (oE.y + oD.y) / 2);
  const abertura = Math.abs(oE.x - oD.x) / (tronco || 1);
  const pareceLado = abertura < 0.3;
  if (esperado === 'frente' && pareceLado) avisos.push('Essa foto parece ser de lado. Na de frente, fique de frente para a câmera.');
  if (esperado === 'lado' && !pareceLado) avisos.push('Essa foto parece ser de frente. Na de lado, vire 90°.');
  return { avisos, tronco };
}

/**
 * Foto de frente. Retorna larguras em cm e as alturas relativas (0 = topo, 1 = pé) de cada medida,
 * para medir a profundidade no mesmo lugar na foto de lado.
 */
export function analisarFrente({ mask, w, h, lm, alturaCm, sexo }) {
  const lim = limitesCorpo(mask, w, h, lm);
  const escala = alturaCm / lim.alturaPx;
  const { avisos, tronco } = checarPose(lm, w, h, lim, 'frente');
  const g = (i) => px(lm[i], w, h);
  const oE = g(P.ombroE), oD = g(P.ombroD), qE = g(P.quadrilE), qD = g(P.quadrilD), jE = g(P.joelhoE), jD = g(P.joelhoD), n = g(P.nariz), cE = g(P.cotoveloE), cD = g(P.cotoveloD);
  const yOmbro = (oE.y + oD.y) / 2, yQuadril = (qE.y + qD.y) / 2, xCentro = (oE.x + oD.x + qE.x + qD.x) / 4;
  const distOmbros = Math.abs(oE.x - oD.x);
  const frac = (y) => (y - lim.topo) / lim.alturaPx;

  const larg = {}, niveis = {};
  const medirEm = (nome, y, x = xCentro) => { const r = larguraEm(mask, w, h, y, x); if (r) { larg[nome] = r.larg; niveis[nome] = frac(y); } return r; };
  const minimoEntre = (nome, y0, y1, x = xCentro) => {
    let melhor = null, yb = null;
    for (let y = Math.round(y0); y <= Math.round(y1); y += 2) { const r = larguraEm(mask, w, h, y, x); if (r && (!melhor || r.larg < melhor.larg)) { melhor = r; yb = y; } }
    if (melhor) { larg[nome] = melhor.larg; niveis[nome] = frac(yb); }
    return melhor;
  };
  const maximoEntre = (nome, y0, y1, x = xCentro) => {
    let melhor = null, yb = null;
    for (let y = Math.round(y0); y <= Math.round(y1); y += 2) { const r = larguraEm(mask, w, h, y, x); if (r && (!melhor || r.larg > melhor.larg)) { melhor = r; yb = y; } }
    if (melhor) { larg[nome] = melhor.larg; niveis[nome] = frac(yb); }
    return melhor;
  };

  // Pescoço: ponto mais estreito entre o queixo e os ombros
  const pescoco = yOmbro - n.y;
  minimoEntre('pescoco', yOmbro - 0.55 * pescoco, yOmbro - 0.15 * pescoco, (oE.x + oD.x) / 2);
  medirEm('ombros', yOmbro + 0.06 * tronco);
  const peito = medirEm('peito', yOmbro + 0.28 * tronco);
  if (peito && peito.larg > distOmbros * 1.3) avisos.push('Os braços encostaram no tronco na altura do peito. Afaste um pouco mais os braços.');
  if (sexo === 'F') minimoEntre('cintura', yOmbro + 0.45 * tronco, yOmbro + 0.85 * tronco);
  else medirEm('cintura', yOmbro + 0.72 * tronco); // altura do umbigo
  maximoEntre('quadril', yQuadril - 0.05 * tronco, yQuadril + 0.22 * tronco);

  // Coxa (esquerda da pessoa) a 30% do quadril ao joelho
  const yCoxa = lerp(qE.y, jE.y, 0.3), xCoxa = lerp(qE.x, jE.x, 0.3);
  const coxa = medirEm('coxa', yCoxa, xCoxa);
  if (coxa) {
    const xOutra = lerp(qD.x, jD.x, 0.3);
    if (xOutra >= coxa.t[0] && xOutra <= coxa.t[1]) { avisos.push('As pernas ficaram encostadas. Afaste os pés na largura do quadril.'); delete larg.coxa; }
  }
  // Braço (esquerdo) no meio entre ombro e cotovelo
  const braco = medirEm('braco', lerp(oE.y, cE.y, 0.5), lerp(oE.x, cE.x, 0.5));
  if (braco && xCentro >= braco.t[0] && xCentro <= braco.t[1]) { avisos.push('O braço ficou colado no corpo. Abra os braços uns 30°.'); delete larg.braco; }

  const cm = Object.fromEntries(Object.entries(larg).map(([k, v]) => [k, v * escala]));
  return { escala, lim, larguraCm: cm, niveis, avisos, xCentro, distOmbros };
}

/** Foto de lado: profundidade em cm nas mesmas alturas relativas da foto de frente. */
export function analisarLado({ mask, w, h, lm, alturaCm, niveis }) {
  const lim = limitesCorpo(mask, w, h, lm);
  const escala = alturaCm / lim.alturaPx;
  const { avisos } = checarPose(lm, w, h, lim, 'lado');
  const g = (i) => px(lm[i], w, h);
  const xCentro = (g(P.ombroE).x + g(P.ombroD).x + g(P.quadrilE).x + g(P.quadrilD).x) / 4;
  const prof = {};
  for (const [nome, f] of Object.entries(niveis)) {
    if (nome === 'ombros' || nome === 'braco') continue;
    const y = lim.topo + f * lim.alturaPx;
    // Procura num pequeno intervalo (a postura muda um pouco entre as fotos)
    const janela = nome === 'pescoco' || nome === 'cintura' ? 'min' : nome === 'quadril' ? 'max' : 'mid';
    let melhor = null;
    for (let dy = -0.012; dy <= 0.012; dy += 0.004) {
      const r = larguraEm(mask, w, h, y + dy * lim.alturaPx, xCentro);
      if (!r) continue;
      if (!melhor || (janela === 'min' && r.larg < melhor.larg) || (janela === 'max' && r.larg > melhor.larg)) melhor = r;
      if (janela === 'mid' && Math.abs(dy) < 1e-9) melhor = r;
    }
    if (melhor) prof[nome] = melhor.larg * escala;
  }
  return { escala, lim, profundidadeCm: prof, avisos };
}

const r1 = (x) => Math.round(x * 10) / 10;

/** Junta frente e lado em perímetros (cm). Sem foto de lado, usa proporções típicas e avisa. */
export function combinar(frente, lado) {
  const L = frente.larguraCm, D = lado?.profundidadeCm || {};
  // Profundidade típica / largura, usada só se faltar a foto de lado
  const proporcao = { pescoco: 0.95, peito: 0.72, cintura: 0.75, quadril: 0.72, coxa: 1.0 };
  const medidas = {}, origem = {};
  for (const k of ['pescoco', 'peito', 'cintura', 'quadril', 'coxa']) {
    if (!L[k]) continue;
    const d = D[k] ?? L[k] * proporcao[k];
    origem[k] = D[k] ? 'frente+lado' : 'só frente (estimado)';
    medidas[k] = r1(perimetroElipse(L[k], d));
  }
  if (L.braco) { medidas.braco = r1(Math.PI * L.braco); origem.braco = 'frente'; }
  if (L.ombros) { medidas.ombros_largura = r1(L.ombros); origem.ombros_largura = 'frente'; }
  // Diferença entre as duas fotos: o quanto o corpo é "fundo" em relação à largura
  const relacao = {};
  for (const k of ['peito', 'cintura', 'quadril']) if (L[k] && D[k]) relacao[k] = Math.round((D[k] / L[k]) * 100) / 100;
  return { medidas, origem, larguraCm: mapR(L), profundidadeCm: mapR(D), relacaoLadoFrente: relacao, avisos: [...frente.avisos, ...(lado?.avisos || [])] };
}

const mapR = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]));

export const NOMES_MEDIDAS = {
  ombros_largura: 'Ombros (largura)', pescoco: 'Pescoço', peito: 'Peito', cintura: 'Cintura', quadril: 'Quadril', coxa: 'Coxa', braco: 'Braço',
};
