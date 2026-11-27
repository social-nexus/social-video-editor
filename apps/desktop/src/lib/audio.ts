import type { TimelineClip, Track } from "../types";
import { roundTime } from "./time";

/** Volume do clipe (0–1); ausente = 100%. */
export const clipVolume = (clip: Pick<TimelineClip, "volume">) =>
  typeof clip.volume === "number" && Number.isFinite(clip.volume) ? Math.min(1, Math.max(0, clip.volume)) : 1;

/** Volume da trilha (0–1); ausente = 100%. */
export const trackVolume = (track: Pick<Track, "volume"> | null | undefined) =>
  track && typeof track.volume === "number" && Number.isFinite(track.volume) ? Math.min(1, Math.max(0, track.volume)) : 1;

/**
 * Fades efetivos do clipe: nunca negativos e, juntos, nunca maiores que a duração
 * (se o clipe for encurtado, os dois diminuem na mesma proporção).
 */
export function effectiveFades(clip: Pick<TimelineClip, "duration" | "fadeIn" | "fadeOut">) {
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const total = fadeIn + fadeOut;
  if (total <= clip.duration || total === 0) return { fadeIn, fadeOut };
  const scale = clip.duration / total;
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

/** Limita um fade ao espaço que o outro fade deixa livre no clipe. */
export function clampFade(clip: Pick<TimelineClip, "duration" | "fadeIn" | "fadeOut">, which: "fadeIn" | "fadeOut", value: number) {
  const other = Math.max(0, (which === "fadeIn" ? clip.fadeOut : clip.fadeIn) ?? 0);
  return roundTime(Math.min(Math.max(0, value), Math.max(0, clip.duration - other)));
}

/** Ganho do clipe (0–1) no instante `time` da timeline: volume × fade de entrada × fade de saída. */
export function clipGainAt(clip: Pick<TimelineClip, "start" | "duration" | "volume" | "fadeIn" | "fadeOut">, time: number) {
  const { fadeIn, fadeOut } = effectiveFades(clip);
  const offset = time - clip.start;
  const remaining = clip.start + clip.duration - time;
  let gain = clipVolume(clip);
  if (fadeIn > 0) gain *= Math.min(1, Math.max(0, offset / fadeIn));
  if (fadeOut > 0) gain *= Math.min(1, Math.max(0, remaining / fadeOut));
  return gain;
}

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

/** Resolução da forma de onda: picos por segundo de mídia. */
export const PEAKS_PER_SECOND = 50;

/**
 * Reduz as amostras a um pico (0–1) por bloco, juntando todos os canais.
 * O resultado é normalizado pelo maior pico, para que áudios baixos também apareçam.
 */
export function computePeaks(channels: ArrayLike<number>[], sampleRate: number, perSecond = PEAKS_PER_SECOND): Float32Array {
  const length = channels[0]?.length ?? 0;
  const block = Math.max(1, Math.round(sampleRate / perSecond));
  const peaks = new Float32Array(Math.ceil(length / block));
  let max = 0;
  for (let index = 0; index < peaks.length; index++) {
    const from = index * block;
    const to = Math.min(length, from + block);
    let peak = 0;
    for (const channel of channels) {
      for (let sample = from; sample < to; sample++) {
        const value = Math.abs(channel[sample]);
        if (value > peak) peak = value;
      }
    }
    peaks[index] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let index = 0; index < peaks.length; index++) peaks[index] /= max;
  return peaks;
}
