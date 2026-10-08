// node tests/forma-calc.test.mjs
import assert from 'node:assert/strict';
import * as C from '../web/forma/calc.js';
import * as M from '../web/forma/medidas-core.js';

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const hoje = new Date('2026-10-07T12:00:00');
const perfil = { sexo: 'M', nascimento: '1992-05-10', altura_cm: 178, atividade: 'leve', peso_meta_kg: 78, ritmo: 'moderado' };

t('idade', () => assert.equal(C.idade('1992-05-10', hoje), 34));
t('IMC e faixa', () => {
  perto(C.imc(90, 178), 28.4, 0.05, 'imc');
  assert.equal(C.classeImc(28.4), 'Sobrepeso');
  const p = C.pesoIdeal(178);
  assert.deepEqual([p.min, p.max, p.referencia], [58.6, 78.9, 69.7]);
});
t('TMB Mifflin', () => {
  perto(C.tmb({ sexo: 'M', pesoKg: 90, alturaCm: 178, idadeAnos: 34 }), 1847.5, 0.01, 'tmb M');
  perto(C.tmb({ sexo: 'F', pesoKg: 70, alturaCm: 165, idadeAnos: 30 }), 1420.25, 0.01, 'tmb F');
});
t('meta calórica com déficit de 0,5 kg/semana', () => {
  const m = C.metaCalorica(perfil, 90);
  assert.equal(m.deficit, 550);
  assert.equal(m.kgSemana, 0.5);
  assert.ok(m.meta >= m.piso);
  assert.equal(m.meta, m.gasto - 550);
});
t('ritmo limitado a 1% do peso', () => {
  const m = C.metaCalorica({ ...perfil, ritmo: 'acelerado', peso_meta_kg: 45 }, 60);
  assert.ok(m.kgSemana <= 0.6);
});
t('piso nunca é ultrapassado', () => {
  const m = C.metaCalorica({ sexo: 'F', nascimento: '1990-01-01', altura_cm: 155, atividade: 'sedentario', peso_meta_kg: 50, ritmo: 'acelerado' }, 58);
  assert.ok(m.meta >= 1200 && m.meta >= m.piso);
  assert.equal(m.limitadoPeloPiso, true);
});
t('manutenção quando já está na meta', () => assert.equal(C.metaCalorica(perfil, 78).manutencao, true));
t('calorias para perder', () => {
  const r = C.caloriasParaPerder(90, 78, 0.5);
  assert.deepEqual(r, { kg: 12, kcal: 92400, semanas: 24 });
});
t('tendência suaviza e respeita dias sem pesagem', () => {
  const s = C.tendencia([{ data: '2026-10-01', peso_kg: 90 }, { data: '2026-10-02', peso_kg: 91 }, { data: '2026-10-05', peso_kg: 89 }]);
  assert.equal(s[0].tendencia, 90);
  assert.equal(s[1].tendencia, 90.1);
  perto(s[2].tendencia, 90.1 + (1 - 0.9 ** 3) * (89 - 90.1), 0.01, 'gap');
});
t('ritmo semanal e projeção', () => {
  const pes = [];
  for (let i = 0; i < 30; i++) pes.push({ data: C.isoDia(new Date(Date.UTC(2026, 8, 1 + i))), peso_kg: 90 - i * 0.07 + (i % 2 ? 0.3 : -0.3) });
  const s = C.tendencia(pes);
  const r = C.ritmoSemanal(s);
  assert.ok(r < -0.3 && r > -0.6, 'ritmo ' + r);
  const p = C.projecao(s, 85, r);
  assert.ok(p && !p.atingida && p.semanas > 5);
});
t('gasto adaptativo', () => {
  const pes = [], kcal = {};
  for (let i = 0; i < 21; i++) {
    const d = C.isoDia(new Date(Date.UTC(2026, 8, 1 + i)));
    pes.push({ data: d, peso_kg: 90 - i * (0.5 / 7) });
    kcal[d] = 2000;
  }
  const g = C.gastoAdaptativo(C.tendencia(pes, 1), kcal);
  perto(g.gasto, 2550, 30, 'gasto');
});
t('elipse = círculo quando iguais', () => perto(C.perimetroElipse(10, 10), Math.PI * 10, 1e-9, 'círculo'));
t('gordura Marinha', () => {
  perto(C.gorduraMarinha({ sexo: 'M', alturaCm: 178, cinturaCm: 95, pescocoCm: 39 }), 22.6, 0.6, 'M');
  assert.equal(C.gorduraMarinha({ sexo: 'F', alturaCm: 165, cinturaCm: 75, pescocoCm: 32 }), null);
});
t('comparar e calibrar', () => {
  assert.deepEqual(C.compararMedidas({ cintura: 95, quadril: 104 }, { cintura: 92.5, quadril: 104 }), { cintura: -2.5, quadril: 0 });
  assert.deepEqual(C.calibrar({ cintura: 90, peito: 100 }, { cintura: 1.05, peito: 2 }), { cintura: 94.5, peito: 100 });
});
t('sequência de treinos', () => {
  const ck = [{ data: '2026-10-04', treinou: true }, { data: '2026-10-05', cardio: true }, { data: '2026-10-06', treinou: true }];
  assert.equal(C.sequencia(ck, '2026-10-07'), 3);
  assert.equal(C.sequencia([...ck, { data: '2026-10-07', treinou: true }], '2026-10-07'), 4);
});

// ---------- Medição por máscara com um "boneco" sintético ----------
// Imagem 600x1000. Corpo de 900 px = 180 cm → 0,2 cm/px.
function boneco({ lado = false } = {}) {
  const w = 600, h = 1000, mask = new Float32Array(w * h);
  const fill = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = Math.max(0, Math.round(x0)); x <= Math.min(w - 1, Math.round(x1)); x++) mask[y * w + x] = 1; };
  const cx = 300;
  const L = lado ? { cab: 50, pesc: 55, peito: 120, cint: 125, quad: 130, coxa: 75 } : { cab: 45, pesc: 60, peito: 175, cint: 160, quad: 185, coxa: 85 };
  fill(cx - L.cab, cx + L.cab, 50, 175);          // cabeça
  fill(cx - L.pesc / 2, cx + L.pesc / 2, 176, 230); // pescoço
  for (let y = 231; y <= 560; y++) {             // tronco (largura interpolada)
    const f = (y - 231) / (560 - 231);
    const larg = f < 0.35 ? L.peito : f < 0.75 ? L.cint : L.quad;
    fill(cx - larg / 2, cx + larg / 2, y, y);
  }
  if (!lado) {
    for (let y = 561; y <= 940; y++) { fill(cx - 10 - L.coxa, cx - 10, y, y); fill(cx + 10, cx + 10 + L.coxa, y, y); } // pernas separadas
    for (let y = 240; y <= 520; y++) { const off = 110 + (y - 240) * 0.35; fill(cx - off - 40, cx - off, y, y); fill(cx + off, cx + off + 40, y, y); } // braços abertos
  } else {
    fill(cx - L.coxa / 2, cx + L.coxa / 2, 561, 940);
  }
  const lmk = (x, y) => ({ x: x / w, y: y / h, visibility: 0.99 });
  const lm = [];
  lm[0] = lmk(cx, 130);
  // De frente: ombro esquerdo da pessoa fica à direita da imagem (espelho). Ignoramos e usamos simétrico.
  const so = lado ? 15 : 95, sq = lado ? 10 : 65;
  lm[11] = lmk(cx + so, 245); lm[12] = lmk(cx - so, 245);
  lm[13] = lmk(cx + (lado ? 15 : 190), 400); lm[14] = lmk(cx - (lado ? 15 : 190), 400);
  lm[23] = lmk(cx + sq, 545); lm[24] = lmk(cx - sq, 545);
  lm[25] = lmk(cx + (lado ? 5 : 52), 745); lm[26] = lmk(cx - (lado ? 5 : 52), 745);
  lm[27] = lmk(cx + 50, 900); lm[28] = lmk(cx - 50, 900);
  lm[29] = lmk(cx + 50, 940); lm[30] = lmk(cx - 50, 940); lm[31] = lmk(cx + 60, 940); lm[32] = lmk(cx - 60, 940);
  return { mask, w, h, lm };
}

t('medição por silhueta: escala, larguras e perímetros', () => {
  const f = boneco();
  const fr = M.analisarFrente({ ...f, alturaCm: 178, sexo: 'M' });
  perto(fr.escala, 178 / 890, 0.002, 'escala');
  perto(fr.larguraCm.cintura, 161 * fr.escala, 1, 'cintura larg');
  perto(fr.larguraCm.quadril, 186 * fr.escala, 1, 'quadril larg');
  assert.ok(fr.larguraCm.coxa, 'coxa medida');
  assert.ok(fr.larguraCm.braco, 'braço medido');
  const ld = M.analisarLado({ ...boneco({ lado: true }), alturaCm: 178, niveis: fr.niveis });
  perto(ld.profundidadeCm.cintura, 126 * ld.escala, 1.2, 'cintura prof');
  const c = M.combinar(fr, ld);
  const esperado = C.perimetroElipse(161 * fr.escala, 126 * ld.escala);
  perto(c.medidas.cintura, esperado, 1.5, 'perímetro cintura');
  assert.equal(c.origem.cintura, 'frente+lado');
  assert.ok(c.relacaoLadoFrente.cintura > 0.7 && c.relacaoLadoFrente.cintura < 0.85);
  assert.deepEqual(fr.avisos, []);
});
t('avisa quando a foto de frente parece de lado', () => {
  const fr = M.analisarFrente({ ...boneco({ lado: true }), alturaCm: 178, sexo: 'M' });
  assert.ok(fr.avisos.some((a) => a.includes('parece ser de lado')));
});

console.log(`\n${ok} testes passaram`);
