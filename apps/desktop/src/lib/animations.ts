import type { AnimationType, ClipAnimation, TimelineClip } from "../types";

/** Animações de entrada e saída (somam-se ao Ken Burns). O tipo diz a direção do movimento. */
export const ANIMATION_TYPES: { id: AnimationType; in: string; out: string }[] = [
  { id: "fade", in: "Surgir (fade)", out: "Sumir (fade)" },
  { id: "zoom-in", in: "Crescer", out: "Crescer e sumir" },
  { id: "zoom-out", in: "Encolher até o lugar", out: "Encolher e sumir" },
  { id: "pop", in: "Pop", out: "Pop (some encolhendo)" },
  { id: "slide-left", in: "Entrar pela direita", out: "Sair pela esquerda" },
  { id: "slide-right", in: "Entrar pela esquerda", out: "Sair pela direita" },
  { id: "slide-up", in: "Entrar por baixo", out: "Sair por cima" },
  { id: "slide-down", in: "Entrar por cima", out: "Sair por baixo" },
];

export const DEFAULT_ANIMATION_DURATION = 0.5;
export const MIN_ANIMATION_DURATION = 0.1;
export const MAX_ANIMATION_DURATION = 3;

export const isAnimationType = (value: unknown): value is AnimationType =>
  ANIMATION_TYPES.some((entry) => entry.id === value);

/** Estado visual da animação: opacidade, zoom e deslocamento (fração do quadro). */
export type AnimationState = { opacity: number; scale: number; x: number; y: number };
const REST: AnimationState = { opacity: 1, scale: 1, x: 0, y: 0 };

/** Durações efetivas: se entrada + saída passam do clipe, as duas encolhem na mesma proporção. */
export function effectiveAnimations(clip: Pick<TimelineClip, "duration" | "animIn" | "animOut">) {
  const inDur = clip.animIn ? Math.max(0, clip.animIn.duration) : 0;
  const outDur = clip.animOut ? Math.max(0, clip.animOut.duration) : 0;
  const total = inDur + outDur;
  const scale = total > clip.duration && total > 0 ? clip.duration / total : 1;
  return { inDur: inDur * scale, outDur: outDur * scale };
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Estado de uma animação no "afastamento" `d` do repouso (0 = no lugar, 1 = totalmente fora).
 * A entrada vai de d = 1 até 0; a saída de 0 até 1.
 */
function displaced(type: AnimationType, d: number, entering: boolean): AnimationState {
  switch (type) {
    case "fade": return { ...REST, opacity: 1 - d };
    case "zoom-in": return { ...REST, opacity: 1 - d, scale: entering ? 1 - 0.4 * d : 1 + 0.4 * d };
    case "zoom-out": return { ...REST, opacity: 1 - d, scale: entering ? 1 + 0.4 * d : 1 - 0.4 * d };
    case "pop": return { ...REST, opacity: clamp01(1 - d * 1.5), scale: 1 - 0.5 * d };
    case "slide-left": return { ...REST, x: entering ? d : -d };
    case "slide-right": return { ...REST, x: entering ? -d : d };
    case "slide-up": return { ...REST, y: entering ? d : -d };
    case "slide-down": return { ...REST, y: entering ? -d : d };
    default: return REST;
  }
}

/** Estado da entrada na fração `t` (0–1) da sua duração. */
export function entryState(type: AnimationType, t: number): AnimationState {
  const p = clamp01(t);
  // O pop passa um pouco do tamanho final e assenta.
  if (type === "pop") {
    const scale = 0.5 + 0.5 * easeOutBack(p);
    return { opacity: clamp01(p * 3), scale, x: 0, y: 0 };
  }
  return displaced(type, 1 - easeOutCubic(p), true);
}

/** Estado da saída na fração `t` (0–1) da sua duração. */
export function exitState(type: AnimationType, t: number): AnimationState {
  const p = clamp01(t);
  // Começa devagar e acelera para fora (espelho da entrada).
  return displaced(type, p ** 3, false);
}

const combine = (a: AnimationState, b: AnimationState): AnimationState =>
  ({ opacity: a.opacity * b.opacity, scale: a.scale * b.scale, x: a.x + b.x, y: a.y + b.y });

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** Estado das animações do clipe no instante `time` da timeline. */
export function clipAnimationAt(clip: Pick<TimelineClip, "start" | "duration" | "animIn" | "animOut">, time: number): AnimationState {
  if (!clip.animIn && !clip.animOut) return REST;
  const { inDur, outDur } = effectiveAnimations(clip);
  const offset = time - clip.start;
  const remaining = clip.start + clip.duration - time;
  let state = REST;
  if (clip.animIn && inDur > 0 && offset < inDur) state = combine(state, entryState(clip.animIn.type, offset / inDur));
  if (clip.animOut && outDur > 0 && remaining < outDur) state = combine(state, exitState(clip.animOut.type, 1 - remaining / outDur));
  return { opacity: round4(state.opacity), scale: round4(state.scale), x: round4(state.x), y: round4(state.y) };
}

/** CSS da animação, aplicado antes (por fora) do Ken Burns. */
export function animationTransform(state: AnimationState): string | undefined {
  if (state.scale === 1 && state.x === 0 && state.y === 0) return undefined;
  return `translate(${(state.x * 100).toFixed(3)}%, ${(state.y * 100).toFixed(3)}%) scale(${state.scale})`;
}

export const makeAnimation = (type: AnimationType, duration = DEFAULT_ANIMATION_DURATION): ClipAnimation =>
  ({ type, duration: Math.round(Math.min(MAX_ANIMATION_DURATION, Math.max(MIN_ANIMATION_DURATION, duration)) * 100) / 100 });

/** Animação salva no projeto, validada (null se inválida). */
export function validAnimation(value: any): ClipAnimation | null {
  const duration = Number(value?.duration);
  if (!isAnimationType(value?.type) || !Number.isFinite(duration) || duration <= 0) return null;
  return makeAnimation(value.type, duration);
}
