import type { MediaKind, TimelineClip, Track, TrackKind } from "../types";
import { MIN_CLIP_DURATION, roundTime } from "./time";
import { clipEnd } from "./timeline";

export const trackKindFor = (kind: MediaKind): TrackKind => kind === "audio" ? "audio" : "video";

export const newTrack = (kind: TrackKind, id: string = crypto.randomUUID()): Track =>
  ({ id, kind, hidden: false, muted: false, locked: false });

/** Projeto novo: uma trilha de vídeo (V1) e uma de áudio (A1). */
export const defaultTracks = (): Track[] => [newTrack("video"), newTrack("audio")];

/** Nome exibido: V1, V2… / A1, A2… conforme a ordem dentro do tipo. */
export function trackLabel(track: Track, tracks: Track[]) {
  const sameKind = tracks.filter((entry) => entry.kind === track.kind);
  return `${track.kind === "video" ? "V" : "A"}${sameKind.indexOf(track) + 1}`;
}

/** Primeira trilha do tipo certo que não está travada (para onde vai um clipe novo). */
export function firstTrackFor(tracks: Track[], kind: TrackKind) {
  return tracks.find((track) => track.kind === kind && !track.locked) ?? null;
}

/** Fim do último clipe da trilha. */
export const trackEnd = (clips: TimelineClip[], trackId: string) =>
  clips.filter((clip) => clip.trackId === trackId).reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);

/**
 * Espaço livre em volta de um clipe na trilha dele: até onde ele pode crescer
 * para trás (minStart) e para frente (maxEnd) sem encostar nos vizinhos.
 */
export function freeBounds(clip: TimelineClip, clips: TimelineClip[]) {
  let minStart = 0;
  let maxEnd = Infinity;
  for (const other of clips) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue;
    if (clipEnd(other) <= clip.start + 1e-6) minStart = Math.max(minStart, clipEnd(other));
    else if (other.start >= clipEnd(clip) - 1e-6) maxEnd = Math.min(maxEnd, other.start);
  }
  return { minStart: roundTime(minStart), maxEnd: maxEnd === Infinity ? Infinity : roundTime(maxEnd) };
}

/**
 * Sobrescreve o intervalo [start, end) numa trilha: o que estiver embaixo é removido,
 * aparado ou cortado em dois (como o modo "sobrescrever" de editores profissionais).
 * `hasSource(clip)` diz se o clipe vem de mídia com duração (vídeo/áudio), para ajustar o ponto de entrada.
 */
export function overwriteRange(
  clips: TimelineClip[], trackId: string, start: number, end: number,
  hasSource: (clip: TimelineClip) => boolean, newId: () => string = () => crypto.randomUUID(),
): TimelineClip[] {
  const result: TimelineClip[] = [];
  const keep = (clip: TimelineClip) => { if (clip.duration >= MIN_CLIP_DURATION - 1e-9) result.push(clip); };
  for (const clip of clips) {
    const clipStart = clip.start;
    const clipStop = clipEnd(clip);
    if (clip.trackId !== trackId || clipStop <= start + 1e-9 || clipStart >= end - 1e-9) { result.push(clip); continue; }
    // Parte que sobra à esquerda do intervalo.
    if (clipStart < start) keep({ ...clip, duration: roundTime(start - clipStart) });
    // Parte que sobra à direita do intervalo.
    if (clipStop > end) {
      const cut = end - clipStart;
      keep({
        ...clip,
        id: clipStart < start ? newId() : clip.id,
        start: roundTime(end),
        duration: roundTime(clipStop - end),
        inPoint: hasSource(clip) ? roundTime(clip.inPoint + cut) : 0,
      });
    }
  }
  return result;
}

/** Clipes que estão tocando no instante `time` (início incluso, fim excluso). */
export const clipsAt = (clips: TimelineClip[], time: number) =>
  clips.filter((clip) => clip.start <= time + 1e-9 && clipEnd(clip) > time + 1e-9);
