// Forma — roda a detecção do corpo no próprio aparelho (MediaPipe Pose, WebAssembly).
// A foto não sai do celular para ser medida; só é enviada se "guardar fotos" estiver ligado.
import { analisarFrente, analisarLado, combinar } from './medidas-core.js';

const VERSAO = '0.10.14';
const MODELO = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
let detector = null;

export async function carregarDetector(aoProgresso) {
  if (detector) return detector;
  aoProgresso?.('Baixando o leitor de corpo (só na primeira vez, ~10 MB)…');
  const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO}/wasm`);
  const opcoes = (delegate) => ({ baseOptions: { modelAssetPath: MODELO, delegate }, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true });
  try { detector = await vision.PoseLandmarker.createFromOptions(fileset, opcoes('GPU')); }
  catch { detector = await vision.PoseLandmarker.createFromOptions(fileset, opcoes('CPU')); }
  return detector;
}

/** Arquivo → canvas na orientação certa, com no máximo `max` px no lado maior. */
export async function arquivoParaCanvas(arquivo, max = 1280) {
  const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

export const canvasParaBlob = (canvas, max = 1080, q = 0.8) => new Promise((res) => {
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  let c = canvas;
  if (k < 1) { c = document.createElement('canvas'); c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); }
  c.toBlob(res, 'image/jpeg', q);
});

export const canvasParaBase64 = async (canvas, max = 1024) => {
  const b = await canvasParaBlob(canvas, max, 0.78);
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};

function detectar(canvas) {
  const r = detector.detect(canvas);
  if (!r.landmarks?.length || !r.segmentationMasks?.length) { r.segmentationMasks?.forEach((m) => m.close()); throw new Error('Não encontrei uma pessoa inteira na foto.'); }
  const m = r.segmentationMasks[0];
  const out = { lm: r.landmarks[0], mask: m.getAsFloat32Array().slice(), w: m.width, h: m.height };
  r.segmentationMasks.forEach((x) => x.close());
  return out;
}

/** Desenha a silhueta e as linhas de medição por cima da foto (para a pessoa conferir). */
export function desenharConferencia(canvas, det, niveis, lim, cor = '#F2C230') {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const sx = det.w / c.width, sy = det.h / c.height;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const v = det.mask[Math.floor(y * sy) * det.w + Math.floor(x * sx)];
    if (v < 0.5) { const i = (y * c.width + x) * 4; img.data[i] *= 0.35; img.data[i + 1] *= 0.35; img.data[i + 2] *= 0.35; }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = cor; g.lineWidth = Math.max(2, c.width / 240);
  for (const f of Object.values(niveis || {})) {
    const y = (lim.topo + f * lim.alturaPx) / sy;
    g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke();
  }
  return c;
}

/** Fluxo completo: duas fotos → medidas. */
export async function medirFotos({ frente, lado, alturaCm, sexo, aoProgresso }) {
  await carregarDetector(aoProgresso);
  aoProgresso?.('Lendo a foto de frente…');
  const df = detectar(frente);
  const rf = analisarFrente({ ...df, alturaCm, sexo });
  let rl = null, dl = null;
  if (lado) {
    aoProgresso?.('Lendo a foto de lado…');
    dl = detectar(lado);
    rl = analisarLado({ ...dl, alturaCm, niveis: rf.niveis });
  }
  const res = combinar(rf, rl);
  res.conferencia = {
    frente: desenharConferencia(frente, df, rf.niveis, rf.lim),
    lado: lado ? desenharConferencia(lado, dl, rf.niveis, rl.lim) : null,
  };
  return res;
}
