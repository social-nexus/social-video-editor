import type { AnimationType, ClipMotion, ClipTransition, TimelineClip } from "../types";
import { transitionMotionExpr, transitionMoves } from "./transitions";
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

/**
 * Transformação total do clipe: zoom S (com achatamento sx/sy, usado no "virar") e deslocamento (X, Y)
 * em fração do quadro.
 */
export type ClipTransformExpr = { scale: string; sx: string; sy: string; x: string; y: string; opacity: string; fades: boolean };

/** Transições que mexem neste clipe: a de entrada (no começo) e a do próximo clipe (depois do fim). */
export type TransitionTerms = { incoming?: ClipTransition | null; outgoing?: ClipTransition | null };

export function clipTransformExpr(clip: Pick<TimelineClip, "duration" | "motion" | "animIn" | "animOut">, length = clip.duration,
  transitions: TransitionTerms = {}): ClipTransformExpr | null {
  const incoming = transitions.incoming && transitionMoves(transitions.incoming.type) ? transitions.incoming : null;
  const outgoing = transitions.outgoing && transitionMoves(transitions.outgoing.type) ? transitions.outgoing : null;
  if (!clip.motion && !clip.animIn && !clip.animOut && !incoming && !outgoing) return null;
  const kb = clip.motion ? motionExpr(clip.motion, length) : STILL;
  const { inDur, outDur } = effectiveAnimations({ ...clip, duration: length });
  let anim = STILL;
  if (clip.animIn && inDur > 0) anim = combine(anim, entryExpr(clip.animIn.type, inDur));
  if (clip.animOut && outDur > 0) anim = combine(anim, exitExpr(clip.animOut.type, outDur, length));
  // Transição por fora de tudo: translate(tr) scale(ts·sx, ts·sy), depois a animação e o Ken Burns.
  let tr = { s: "1", sx: "1", sy: "1", x: "0", y: "0" };
  const join = (a: typeof tr, b: typeof tr) => ({ s: mul(a.s, b.s), sx: mul(a.sx, b.sx), sy: mul(a.sy, b.sy), x: add(a.x, b.x), y: add(a.y, b.y) });
  if (incoming) tr = join(tr, transitionMotionExpr(incoming.type, `clip(t/${n(incoming.duration)},0,1)`).in);
  if (outgoing) tr = join(tr, transitionMotionExpr(outgoing.type, `clip((t-${n(length)})/${n(outgoing.duration)},0,1)`).out);
  // CSS: translate(a) scale(as) scale(s) translate(x) → desloca a + as·s·x, zoom as·s.
  const inner = mul(anim.scale, kb.scale);
  const innerX = add(anim.x, mul(inner, kb.x));
  const innerY = add(anim.y, mul(inner, kb.y));
  return {
    scale: mul(tr.s, inner),
    sx: tr.sx,
    sy: tr.sy,
    x: add(tr.x, mul(mul(tr.s, tr.sx), innerX)),
    y: add(tr.y, mul(mul(tr.s, tr.sy), innerY)),
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
  const dim = (base: number, squash: string) => `max(2,trunc(${base}*${mul(expr.scale, squash)}/2)*2)`;
  const chains = [
    // Fundo transparente: o que sobra em volta mostra as trilhas de baixo.
    `color=c=black@0:s=${bigW}x${bigH}:r=${fps}:d=${n(length)},format=yuva420p[bg${id}]`,
    `[${input}]scale=w='${dim(bigW, expr.sx)}':h='${dim(bigH, expr.sy)}':eval=frame:flags=bicubic[sc${id}]`,
  ];
  let tail = `[bg${id}][sc${id}]overlay=x='(W-w)/2+W*${expr.x}':y='(H-h)/2+H*${expr.y}':eval=frame:shortest=1`;
  if (factor !== 1) tail += `,scale=${width}:${height}:flags=area`;
  tail += ",setsar=1";
  // A opacidade (fade) não entra aqui: é aplicada ao sobrepor (fadeBlend), revelando as camadas de baixo.
  chains.push(`${tail}[${output}]`);
  return chains;
}

/**
 * Fade de uma camada sobre o que já está montado embaixo: mistura "com a camada" e "sem ela"
 * na proporção da opacidade, só nos trechos de entrada/saída (fora deles, a camada fica inteira).
 * `opacity` usa `t` = segundos desde o início do clipe; aqui vira o tempo da timeline (T − início).
 */
export function fadeBlend(opacity: string, start: number, windows: [number, number][]): { expr: string; enable: string } {
  const local = `(T-${n(start)})`;
  const k = opacity.replace(/\bt\b/g, local);
  return {
    expr: `A*(${k})+B*(1-(${k}))`,
    enable: windows.map(([a, b]) => `between(t,${n(a)},${n(b)})`).join("+"),
  };
}
