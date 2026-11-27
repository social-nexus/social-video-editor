import type { ClipGeometry, MediaItem, TimelineClip } from "../types";
import { MIN_CLIP_DURATION, roundTime } from "./time";

export const clipEnd = (clip: Pick<TimelineClip, "start" | "duration">) => clip.start + clip.duration;

/** Duração da mídia de origem que limita o clipe, ou null quando não há limite (imagem / desconhecida). */
export function sourceDurationOf(item: MediaItem | null | undefined): number | null {
  return item && item.kind !== "image" && item.duration ? item.duration : null;
}

/** Duração máxima do clipe: o que resta da mídia depois do ponto de entrada. */
export function maxClipDuration(clip: Pick<TimelineClip, "inPoint">, sourceDuration: number | null) {
  return sourceDuration === null ? Infinity : Math.max(MIN_CLIP_DURATION, sourceDuration - clip.inPoint);
}

export function clampClipDuration(clip: Pick<TimelineClip, "inPoint">, sourceDuration: number | null, value: number) {
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
};

/**
 * Calcula a nova geometria de um clipe ao arrastá-lo `delta` segundos.
 * - move: desloca o clipe inteiro (snap pela borda inicial ou final, a que estiver mais perto).
 * - trim-end: muda o fim; não passa do fim da mídia.
 * - trim-start: muda o início mantendo o fim fixo; ajusta o ponto de entrada na mídia.
 */
export function applyClipDrag(mode: DragMode, original: ClipGeometry, delta: number, options: DragOptions): ClipGeometry {
  const { sourceDuration, snapTargets, snapThreshold } = options;

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
    return { ...original, duration: clampClipDuration(original, sourceDuration, end - original.start) };
  }

  // trim-start: o fim fica parado.
  const end = clipEnd(original);
  let start = original.start + delta;
  const snapped = nearestSnap(start, snapTargets, snapThreshold);
  if (snapped !== null) start = snapped;
  // Não pode voltar antes do começo da mídia de origem (imagens não têm esse limite).
  const earliest = sourceDuration === null ? 0 : Math.max(0, original.start - original.inPoint);
  start = Math.min(Math.max(start, earliest), end - MIN_CLIP_DURATION);
  const inPoint = sourceDuration === null ? 0 : Math.max(0, original.inPoint + (start - original.start));
  return { start: roundTime(start), duration: roundTime(end - start), inPoint: roundTime(inPoint) };
}

/** Passo entre as marcas da régua para que fiquem a pelo menos `minPx` pixels uma da outra. */
const RULER_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
export function rulerStep(pxPerSecond: number, minPx = 56) {
  return RULER_STEPS.find((step) => step * pxPerSecond >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1];
}
