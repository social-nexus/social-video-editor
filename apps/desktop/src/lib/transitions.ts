import type { ClipTransition, TimelineClip, TransitionType } from "../types";
import { clipEnd } from "./timeline";

/**
 * Transição de entrada de um clipe: do clipe anterior na mesma trilha (que termina exatamente
 * onde este começa) para este. Acontece no começo deste clipe, em [início, início + duração];
 * durante esse trecho o anterior continua por baixo (com os quadros seguintes ou o último parado).
 * Assim a timeline não muda de tamanho.
 */
export const TRANSITION_TYPES: { id: TransitionType; label: string }[] = [
  { id: "dissolve", label: "Dissolver" },
  { id: "fade-black", label: "Escurecer (passa pelo preto)" },
  { id: "wipe-left", label: "Cortina → (da esquerda)" },
  { id: "wipe-right", label: "Cortina ← (da direita)" },
  { id: "wipe-up", label: "Cortina ↑ (de baixo)" },
  { id: "wipe-down", label: "Cortina ↓ (de cima)" },
  { id: "push-left", label: "Empurrar ← (entra pela direita)" },
  { id: "push-right", label: "Empurrar → (entra pela esquerda)" },
  { id: "push-up", label: "Empurrar ↑ (entra por baixo)" },
  { id: "push-down", label: "Empurrar ↓ (entra por cima)" },
  { id: "circle-open", label: "Círculo abrindo" },
  { id: "circle-close", label: "Círculo fechando" },
  { id: "zoom-in", label: "Zoom para dentro" },
  { id: "zoom-out", label: "Zoom para fora" },
  { id: "flip-x", label: "Virar na horizontal" },
  { id: "flip-y", label: "Virar na vertical" },
];

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 3;
/** Folga para considerar dois clipes "colados". */
const TOUCH = 0.02;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function makeTransition(type: TransitionType, duration = DEFAULT_TRANSITION_DURATION): ClipTransition {
  return { type, duration: round3(Math.min(MAX_TRANSITION_DURATION, Math.max(MIN_TRANSITION_DURATION, duration))) };
}

/** Valida o que veio do arquivo do projeto. */
export function validTransition(value: any): ClipTransition | null {
  if (!value || !TRANSITION_TYPES.some((entry) => entry.id === value.type)) return null;
  const duration = Number(value.duration);
  return Number.isFinite(duration) && duration > 0 ? makeTransition(value.type, duration) : null;
}

/** O clipe que termina colado no começo deste, na mesma trilha (o "de onde" da transição). */
export function previousAdjacent(clip: Pick<TimelineClip, "id" | "trackId" | "start">, clips: TimelineClip[]): TimelineClip | null {
  let best: TimelineClip | null = null;
  for (const other of clips) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue;
    if (Math.abs(clipEnd(other) - clip.start) <= TOUCH && (!best || other.start > best.start)) best = other;
  }
  return best;
}

/** Transição que vale de fato: precisa de um clipe anterior colado; não passa da duração do clipe. */
export function effectiveTransition(clip: TimelineClip, clips: TimelineClip[]): { transition: ClipTransition; from: TimelineClip } | null {
  if (!clip.transition) return null;
  const from = previousAdjacent(clip, clips);
  if (!from) return null;
  return { transition: { ...clip.transition, duration: round3(Math.min(clip.transition.duration, clip.duration)) }, from };
}

/** Transição que este clipe faz ao sair (a do próximo clipe colado, se houver). */
export function outgoingTransition(clip: TimelineClip, clips: TimelineClip[]): ClipTransition | null {
  const next = clips.find((other) => other.id !== clip.id && other.trackId === clip.trackId && other.transition
    && Math.abs(other.start - clipEnd(clip)) <= TOUCH && previousAdjacent(other, clips)?.id === clip.id);
  return next ? effectiveTransition(next, clips)?.transition ?? null : null;
}

/** Quanto o clipe anterior precisa continuar aparecendo depois do corte (0 = nada). */
export function extensionAfter(clip: TimelineClip, clips: TimelineClip[]): number {
  return outgoingTransition(clip, clips)?.duration ?? 0;
}

/** Movimento de um clipe na transição: zoom (s), achatamento (sx, sy) e deslocamento em fração do quadro. */
export type TransitionMotion = { s: number; sx: number; sy: number; x: number; y: number };
const STILL_MOTION: TransitionMotion = { s: 1, sx: 1, sy: 1, x: 0, y: 0 };

/**
 * Movimento do clipe que sai (out) e do que entra (in) no progresso p.
 * Empurrar: os dois andam juntos; Zoom: o que sai cresce/encolhe e o novo chega se misturando;
 * Virar: o que sai achata até sumir na metade e o novo abre a partir dela.
 */
export function transitionMotion(type: TransitionType, p: number): { out: TransitionMotion; in: TransitionMotion } {
  const m = (part: Partial<TransitionMotion>) => ({ ...STILL_MOTION, ...part });
  switch (type) {
    case "push-left": return { out: m({ x: -p }), in: m({ x: 1 - p }) };
    case "push-right": return { out: m({ x: p }), in: m({ x: p - 1 }) };
    case "push-up": return { out: m({ y: -p }), in: m({ y: 1 - p }) };
    case "push-down": return { out: m({ y: p }), in: m({ y: p - 1 }) };
    case "zoom-in": return { out: m({ s: 1 + p }), in: m({ s: 0.6 + 0.4 * p }) };
    case "zoom-out": return { out: m({ s: 1 - 0.4 * p }), in: m({ s: 1.6 - 0.6 * p }) };
    case "flip-x": return { out: m({ sx: Math.max(0, Math.cos(Math.PI * p)) }), in: m({ sx: Math.max(0, -Math.cos(Math.PI * p)) }) };
    case "flip-y": return { out: m({ sy: Math.max(0, Math.cos(Math.PI * p)) }), in: m({ sy: Math.max(0, -Math.cos(Math.PI * p)) }) };
    default: return { out: STILL_MOTION, in: STILL_MOTION };
  }
}

/** A transição mexe nos clipes (precisa do movimento por quadro na exportação)? */
export const transitionMoves = (type: TransitionType) => /^(push|zoom|flip)-/.test(type);

/** Mesmo movimento em expressões do ffmpeg (P = progresso 0–1 como expressão). */
export function transitionMotionExpr(type: TransitionType, P: string): { out: Record<keyof TransitionMotion, string>; in: Record<keyof TransitionMotion, string> } {
  const m = (part: Partial<Record<keyof TransitionMotion, string>>) => ({ s: "1", sx: "1", sy: "1", x: "0", y: "0", ...part });
  switch (type) {
    case "push-left": return { out: m({ x: `(-${P})` }), in: m({ x: `(1-${P})` }) };
    case "push-right": return { out: m({ x: P }), in: m({ x: `(${P}-1)` }) };
    case "push-up": return { out: m({ y: `(-${P})` }), in: m({ y: `(1-${P})` }) };
    case "push-down": return { out: m({ y: P }), in: m({ y: `(${P}-1)` }) };
    case "zoom-in": return { out: m({ s: `(1+${P})` }), in: m({ s: `(0.6+0.4*${P})` }) };
    case "zoom-out": return { out: m({ s: `(1-0.4*${P})` }), in: m({ s: `(1.6-0.6*${P})` }) };
    case "flip-x": return { out: m({ sx: `max(0,cos(PI*${P}))` }), in: m({ sx: `max(0,-cos(PI*${P}))` }) };
    case "flip-y": return { out: m({ sy: `max(0,cos(PI*${P}))` }), in: m({ sy: `max(0,-cos(PI*${P}))` }) };
    default: return { out: m({}), in: m({}) };
  }
}

/** CSS do movimento (aplicado por fora da animação e do Ken Burns, dentro da camada). */
export function motionTransform(motion: TransitionMotion): string | undefined {
  if (motion.s === 1 && motion.sx === 1 && motion.sy === 1 && motion.x === 0 && motion.y === 0) return undefined;
  return `translate(${round3(motion.x * 100)}%, ${round3(motion.y * 100)}%) scale(${round3(motion.s * motion.sx)}, ${round3(motion.s * motion.sy)})`;
}

/** Sorteia uma transição para cada corte, sem repetir a mesma em cortes seguidos (quando dá). */
export function mixTransitions(picks: TransitionType[], count: number, random: () => number = Math.random): TransitionType[] {
  const result: TransitionType[] = [];
  for (let i = 0; i < count && picks.length; i++) {
    const options = picks.length > 1 && i > 0 ? picks.filter((type) => type !== result[i - 1]) : picks;
    result.push(options[Math.min(options.length - 1, Math.floor(random() * options.length))]);
  }
  return result;
}

/** Progresso 0–1 da transição no instante `time` da timeline (null = fora dela). */
export function transitionProgress(clip: Pick<TimelineClip, "start">, transition: ClipTransition, time: number): number | null {
  if (time < clip.start || time > clip.start + transition.duration) return null;
  return Math.min(1, Math.max(0, (time - clip.start) / transition.duration));
}

/** Como o preview desenha a transição no progresso p. */
export function transitionLook(type: TransitionType, p: number):
  { opacity: number; clipPath?: string; veil: number; hideIncoming: boolean; circle?: { open: boolean; radius: number } } {
  const pct = (value: number) => `${round3(value * 100)}%`;
  switch (type) {
    case "dissolve": return { opacity: p, veil: 0, hideIncoming: false };
    case "fade-black": return p < 0.5 ? { opacity: 1, veil: 2 * p, hideIncoming: true } : { opacity: 1, veil: 2 - 2 * p, hideIncoming: false };
    case "wipe-left": return { opacity: 1, clipPath: `inset(0 ${pct(1 - p)} 0 0)`, veil: 0, hideIncoming: false };
    case "wipe-right": return { opacity: 1, clipPath: `inset(0 0 0 ${pct(1 - p)})`, veil: 0, hideIncoming: false };
    case "wipe-up": return { opacity: 1, clipPath: `inset(${pct(1 - p)} 0 0 0)`, veil: 0, hideIncoming: false };
    case "wipe-down": return { opacity: 1, clipPath: `inset(0 0 ${pct(1 - p)} 0)`, veil: 0, hideIncoming: false };
    // Raio em fração da meia-diagonal do quadro (o preview converte para px).
    case "circle-open": return { opacity: 1, veil: 0, hideIncoming: false, circle: { open: true, radius: p } };
    case "circle-close": return { opacity: 1, veil: 0, hideIncoming: false, circle: { open: false, radius: 1 - p } };
    case "zoom-in": case "zoom-out": return { opacity: p, veil: 0, hideIncoming: false };
    case "flip-x": case "flip-y": return { opacity: 1, veil: 0, hideIncoming: p < 0.5 };
    default: return { opacity: 1, veil: 0, hideIncoming: false };
  }
}

/**
 * Mistura do ffmpeg (filtro blend, por plano de cor): A = quadro com o clipe novo por cima,
 * B = quadro sem ele (o anterior continua embaixo). P = progresso 0–1 (usa T = tempo da timeline).
 * "Escurecer" passa pelo preto: luma 16 e cor 128 (vídeo em faixa limitada).
 */
export function transitionBlendExprs(type: TransitionType, start: number, duration: number): [string, string, string] {
  const P = `clip((T-${round3(start)})/${round3(duration)},0,1)`;
  const same = (expr: string): [string, string, string] => [expr, expr, expr];
  switch (type) {
    case "dissolve": return same(`A*${P}+B*(1-${P})`);
    case "fade-black": {
      const plane = (black: number) => `if(lt(${P},0.5),B*(1-2*${P})+${black}*2*${P},${black}*(2-2*${P})+A*(2*${P}-1))`;
      return [plane(16), plane(128), plane(128)];
    }
    case "wipe-left": return same(`if(lt(X,W*${P}),A,B)`);
    case "wipe-right": return same(`if(gte(X,W*(1-${P})),A,B)`);
    case "wipe-up": return same(`if(gte(Y,H*(1-${P})),A,B)`);
    case "wipe-down": return same(`if(lt(Y,H*${P}),A,B)`);
    case "circle-open": return same(`if(lt(hypot(X-W/2,Y-H/2),hypot(W,H)/2*${P}),A,B)`);
    case "circle-close": return same(`if(gte(hypot(X-W/2,Y-H/2),hypot(W,H)/2*(1-${P})),A,B)`);
    case "zoom-in": case "zoom-out": return same(`A*${P}+B*(1-${P})`);
    case "flip-x": case "flip-y": return same(`if(lt(${P},0.5),B,A)`);
    default: return same("A");
  }
}
