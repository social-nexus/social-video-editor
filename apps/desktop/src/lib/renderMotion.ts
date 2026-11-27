import type { AnimationType, ClipMotion, TimelineClip } from "../types";
import { effectiveAnimations } from "./animations";

/**
 * Expressões do ffmpeg (variável `t` = segundos desde o início do clipe) com a mesma
 * matemática do preview: Ken Burns (effects.ts) + entrada/saída (animations.ts).
 */
type Expr = { opacity: string; scale: string; x: string; y: string };

/** Número com precisão suficiente para movimento suave (sem notação científica). */
const n = (value: number) => {
  const fixed = (Math.round(value * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" || fixed === "" ? "0" : fixed;
};
const lerp = (a: number, b: number, p: string) => a === b ? n(a) : `(${n(a)}+${n(b - a)}*${p})`;
const mul = (a: string, b: string) => a === "1" ? b : b === "1" ? a : `(${a})*(${b})`;
const add = (a: string, b: string) => a === "0" ? b : b === "0" ? a : `(${a}+${b})`;

const STILL: Expr = { opacity: "1", scale: "1", x: "0", y: "0" };

/** Ken Burns: quadro interpolado ao longo do clipe (com curva suave opcional). */
function motionExpr(motion: ClipMotion, duration: number): Expr {
  const u = `clip(t/${n(duration)},0,1)`;
  const p = motion.smooth ? `(${u}*${u}*(3-2*${u}))` : u;
  return { opacity: "1", scale: lerp(motion.from.scale, motion.to.scale, p), x: lerp(motion.from.x, motion.to.x, p), y: lerp(motion.from.y, motion.to.y, p) };
}

/** Animação "afastada" `d` do repouso (mesma tabela de animations.ts). */
function displacedExpr(type: AnimationType, d: string, entering: boolean): Expr {
  switch (type) {
    case "fade": return { ...STILL, opacity: `(1-${d})` };
    case "zoom-in": return { ...STILL, opacity: `(1-${d})`, scale: entering ? `(1-0.4*${d})` : `(1+0.4*${d})` };
    case "zoom-out": return { ...STILL, opacity: `(1-${d})`, scale: entering ? `(1+0.4*${d})` : `(1-0.4*${d})` };
    case "pop": return { ...STILL, opacity: `clip(1-1.5*${d},0,1)`, scale: `(1-0.5*${d})` };
    case "slide-left": return { ...STILL, x: entering ? d : `(-${d})` };
    case "slide-right": return { ...STILL, x: entering ? `(-${d})` : d };
    case "slide-up": return { ...STILL, y: entering ? d : `(-${d})` };
    case "slide-down": return { ...STILL, y: entering ? `(-${d})` : d };
    default: return STILL;
  }
}

function entryExpr(type: AnimationType, duration: number): Expr {
  const p = `clip(t/${n(duration)},0,1)`;
  if (type === "pop") {
    // 0,5 + 0,5 × easeOutBack(p): passa um pouco do tamanho e assenta.
    const back = `(1+2.70158*pow(${p}-1,3)+1.70158*pow(${p}-1,2))`;
    return { opacity: `min(1,3*${p})`, scale: `(0.5+0.5*${back})`, x: "0", y: "0" };
  }
  return displacedExpr(type, `pow(1-${p},3)`, true);
}

function exitExpr(type: AnimationType, duration: number, length: number): Expr {
  const p = `clip(1-(${n(length)}-t)/${n(duration)},0,1)`;
  return displacedExpr(type, `pow(${p},3)`, false);
}

const combine = (a: Expr, b: Expr): Expr =>
  ({ opacity: mul(a.opacity, b.opacity), scale: mul(a.scale, b.scale), x: add(a.x, b.x), y: add(a.y, b.y) });

/** Transformação total do clipe: zoom S e deslocamento (X, Y) em fração do quadro. */
export type ClipTransformExpr = { scale: string; x: string; y: string; opacity: string; fades: boolean };

export function clipTransformExpr(clip: Pick<TimelineClip, "duration" | "motion" | "animIn" | "animOut">, length = clip.duration): ClipTransformExpr | null {
  if (!clip.motion && !clip.animIn && !clip.animOut) return null;
  const kb = clip.motion ? motionExpr(clip.motion, length) : STILL;
  const { inDur, outDur } = effectiveAnimations({ ...clip, duration: length });
  let anim = STILL;
  if (clip.animIn && inDur > 0) anim = combine(anim, entryExpr(clip.animIn.type, inDur));
  if (clip.animOut && outDur > 0) anim = combine(anim, exitExpr(clip.animOut.type, outDur, length));
  // CSS: translate(a) scale(as) scale(s) translate(x) → desloca a + as·s·x, zoom as·s.
  const scale = mul(anim.scale, kb.scale);
  return {
    scale,
    x: add(anim.x, mul(scale, kb.x)),
    y: add(anim.y, mul(scale, kb.y)),
    opacity: anim.opacity,
    fades: anim.opacity !== "1",
  };
}

/**
 * Filtros que aplicam a transformação num quadro já enquadrado (W×H).
 * Trabalha em resolução `factor`× maior e reduz no fim, para o movimento não tremer.
 * Retorna as cadeias (uma fonte preta por clipe) e o rótulo de saída.
 */
export function motionFilters(
  expr: ClipTransformExpr, input: string, output: string, id: string,
  size: { width: number; height: number; fps: number; length: number; factor: number },
): string[] {
  const { width, height, fps, length, factor } = size;
  const bigW = width * factor, bigH = height * factor;
  const dim = (base: number) => `max(2,trunc(${base}*${expr.scale}/2)*2)`;
  const chains = [
    `color=c=black:s=${bigW}x${bigH}:r=${fps}:d=${n(length)}[bg${id}]`,
    `[${input}]scale=w='${dim(bigW)}':h='${dim(bigH)}':eval=frame:flags=bicubic[sc${id}]`,
  ];
  let tail = `[bg${id}][sc${id}]overlay=x='(W-w)/2+W*${expr.x}':y='(H-h)/2+H*${expr.y}':eval=frame:shortest=1`;
  if (factor !== 1) tail += `,scale=${width}:${height}:flags=area`;
  tail += ",setsar=1";
  // Opacidade = misturar com o preto: luma e cor multiplicadas por k (vídeo em faixa limitada).
  if (expr.fades) {
    const k = expr.opacity;
    tail += `,eq=contrast='${k}':brightness='0.4375*(${k}-1)':saturation='${k}':eval=frame`;
  }
  chains.push(`${tail}[${output}]`);
  return chains;
}
