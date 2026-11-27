import type { ClipGeometry, MediaItem, TimelineClip } from "../types";
import { MIN_CLIP_DURATION, roundTime } from "./time";
import { sliceMotion } from "./effects";

/** Velocidade do clipe (1 quando não definida). */
export const clipSpeed = (clip: { speed?: number }) => clip.speed && clip.speed > 0 ? clip.speed : 1;

export const clipEnd = (clip: Pick<TimelineClip, "start" | "duration">) => clip.start + clip.duration;

/** Duração da mídia de origem que limita o clipe, ou null quando não há limite (imagem / desconhecida). */
export function sourceDurationOf(item: MediaItem | null | undefined): number | null {
  return item && item.kind !== "image" && item.duration ? item.duration : null;
}

/** Duração máxima do clipe: o que resta da mídia depois do ponto de entrada. */
export function maxClipDuration(clip: Pick<TimelineClip, "inPoint" | "speed">, sourceDuration: number | null) {
  return sourceDuration === null ? Infinity : Math.max(MIN_CLIP_DURATION, (sourceDuration - clip.inPoint) / clipSpeed(clip));
}

export function clampClipDuration(clip: Pick<TimelineClip, "inPoint" | "speed">, sourceDuration: number | null, value: number) {
  return roundTime(Math.min(maxClipDuration(clip, sourceDuration), Math.max(MIN_CLIP_DURATION, value)));
}

/** Alvo de snap mais próximo de `value` dentro de `threshold` (segundos), ou null. */
export function nearestSnap(value: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= bestDistance) { best = target; bestDistance = distance; }
  }
  return best;
}

/** Pontos onde as bordas de um clipe "grudam": início da timeline, playhead e bordas dos outros clipes. */
export function snapTargetsFor(clipId: string, clips: TimelineClip[], playhead: number) {
  const targets = [0, playhead];
  for (const clip of clips) if (clip.id !== clipId) targets.push(clip.start, clipEnd(clip));
  return targets;
}

export type DragMode = "move" | "trim-start" | "trim-end";

export type DragOptions = {
  /** Duração da mídia de origem (null = sem limite, ex.: imagem). */
  sourceDuration: number | null;
  snapTargets: number[];
  /** Distância máxima de snap, em segundos (0 desliga). */
  snapThreshold: number;
  /** Ao aparar: até onde o início pode recuar / o fim pode avançar sem invadir o vizinho. */
  minStart?: number;
  maxEnd?: number;
  /** Velocidade do clipe (mídia consumida = duração × velocidade). */
  speed?: number;
};

/**
 * Calcula a nova geometria de um clipe ao arrastá-lo `delta` segundos.
 * - move: desloca o clipe inteiro (snap pela borda inicial ou final, a que estiver mais perto).
 * - trim-end: muda o fim; não passa do fim da mídia.
 * - trim-start: muda o início mantendo o fim fixo; ajusta o ponto de entrada na mídia.
 */
export function applyClipDrag(mode: DragMode, original: ClipGeometry, delta: number, options: DragOptions): ClipGeometry {
  const { sourceDuration, snapTargets, snapThreshold, minStart = 0, maxEnd = Infinity } = options;
  const speed = clipSpeed(options);

  if (mode === "move") {
    let start = Math.max(0, original.start + delta);
    const end = start + original.duration;
    const snapStart = nearestSnap(start, snapTargets, snapThreshold);
    const snapEnd = nearestSnap(end, snapTargets, snapThreshold);
    if (snapStart !== null && (snapEnd === null || Math.abs(snapStart - start) <= Math.abs(snapEnd - end))) start = snapStart;
    else if (snapEnd !== null) start = snapEnd - original.duration;
    return { ...original, start: roundTime(Math.max(0, start)) };
  }

  if (mode === "trim-end") {
    let end = clipEnd(original) + delta;
    const snapped = nearestSnap(end, snapTargets, snapThreshold);
    if (snapped !== null) end = snapped;
    end = Math.min(end, Math.max(maxEnd, clipEnd(original)));
    return { ...original, duration: clampClipDuration({ inPoint: original.inPoint, speed }, sourceDuration, end - original.start) };
  }

  // trim-start: o fim fica parado.
  const end = clipEnd(original);
  let start = original.start + delta;
  const snapped = nearestSnap(start, snapTargets, snapThreshold);
  if (snapped !== null) start = snapped;
  // Não pode voltar antes do começo da mídia de origem (imagens não têm esse limite).
  const earliest = Math.max(minStart > original.start ? 0 : minStart, sourceDuration === null ? 0 : original.start - original.inPoint / speed, 0);
  start = Math.min(Math.max(start, earliest), end - MIN_CLIP_DURATION);
  const inPoint = sourceDuration === null ? 0 : Math.max(0, original.inPoint + (start - original.start) * speed);
  return { start: roundTime(start), duration: roundTime(end - start), inPoint: roundTime(inPoint) };
}

/**
 * Divide um clipe no instante `at` (segundos da timeline).
 * A segunda parte continua a mídia de onde a primeira parou (ponto de entrada avançado).
 * Retorna null se `at` estiver fora do clipe ou perto demais de uma borda.
 */
export function splitClip(clip: TimelineClip, at: number, newId: string, hasSource: boolean): [TimelineClip, TimelineClip] | null {
  const cut = roundTime(at);
  if (cut < clip.start + MIN_CLIP_DURATION || cut > clipEnd(clip) - MIN_CLIP_DURATION) return null;
  const firstDuration = roundTime(cut - clip.start);
  const { fadeOut: _out, animOut: _aOut, ...withoutFadeOut } = clip;
  const { fadeIn: _in, animIn: _aIn, ...withoutFadeIn } = clip;
  const ratio = firstDuration / clip.duration;
  const first: TimelineClip = { ...withoutFadeOut, duration: firstDuration, ...(clip.motion ? { motion: sliceMotion(clip.motion, 0, ratio) } : {}) };
  const second: TimelineClip = {
    ...withoutFadeIn, id: newId, ...(clip.motion ? { motion: sliceMotion(clip.motion, ratio, 1) } : {}), start: cut, duration: roundTime(clipEnd(clip) - cut),
    inPoint: hasSource ? roundTime(clip.inPoint + firstDuration * clipSpeed(clip)) : 0,
  };
  return [first, second];
}

/** Passo entre as marcas da régua para que fiquem a pelo menos `minPx` pixels uma da outra. */
const RULER_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
export function rulerStep(pxPerSecond: number, minPx = 56) {
  return RULER_STEPS.find((step) => step * pxPerSecond >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1];
}
