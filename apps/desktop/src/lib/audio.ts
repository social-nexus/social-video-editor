import type { TimelineClip, Track, TrackDucking } from "../types";
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

// ---- Mixagem --------------------------------------------------------------------

/** Trilha que toca som: não silenciada e, se houver solo em alguma, em solo. */
export function trackAudible(track: Pick<Track, "muted" | "solo"> | null | undefined, tracks: Pick<Track, "solo">[]) {
  if (!track || track.muted) return false;
  return !tracks.some((entry) => entry.solo) || Boolean(track.solo);
}

export const DEFAULT_DUCKING: TrackDucking = { amount: 0.25, fade: 0.3 };

/** Ganho ↔ decibéis (para mostrar "−12 dB"). */
export const gainToDb = (gain: number) => gain <= 0 ? -60 : Math.round(20 * Math.log10(gain));
export const dbToGain = (db: number) => Math.round(10 ** (db / 20) * 1000) / 1000;

export function validDucking(value: any): TrackDucking | null {
  if (!value || typeof value !== "object") return null;
  const amount = Number(value.amount), fade = Number(value.fade);
  if (!Number.isFinite(amount) || !Number.isFinite(fade)) return null;
  return { amount: Math.min(1, Math.max(0.02, amount)), fade: Math.min(2, Math.max(0.05, fade)) };
}

/** A abaixada vigente (a mais forte entre as trilhas de voz que tocam). */
export function activeDucking(tracks: Track[]): { ducking: TrackDucking; voiceTracks: Set<string> } | null {
  const voices = tracks.filter((track) => track.ducking && trackAudible(track, tracks));
  if (!voices.length) return null;
  const amount = Math.min(...voices.map((track) => track.ducking!.amount));
  const fade = Math.max(...voices.map((track) => track.ducking!.fade));
  return { ducking: { amount, fade }, voiceTracks: new Set(voices.map((track) => track.id)) };
}

/**
 * Trechos com fala: clipes das trilhas de voz, juntando os que ficam a menos de 2 fades um do outro
 * (para a música não ficar subindo e descendo entre frases).
 */
export function voiceRanges(clips: Pick<TimelineClip, "trackId" | "start" | "duration">[], voiceTracks: Set<string>, fade: number): [number, number][] {
  const ranges = clips.filter((clip) => voiceTracks.has(clip.trackId))
    .map((clip): [number, number] => [clip.start, clip.start + clip.duration])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start - last[1] <= 2 * fade) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([a, b]) => [roundTime(a), roundTime(b)]);
}

/** Quanto está "abaixado" (0–1) no instante t: desce `fade` antes da fala e sobe `fade` depois. */
function duckWeight(ranges: [number, number][], fade: number, time: number) {
  let weight = 0;
  for (const [start, end] of ranges) {
    const rise = Math.min(1, Math.max(0, (time - (start - fade)) / fade));
    const fall = Math.min(1, Math.max(0, ((end + fade) - time) / fade));
    weight = Math.max(weight, Math.min(rise, fall));
  }
  return weight;
}

/** Ganho da abaixada no instante t (1 = normal). */
export const duckGainAt = (ranges: [number, number][], ducking: TrackDucking, time: number) =>
  1 - (1 - ducking.amount) * duckWeight(ranges, ducking.fade, time);

/**
 * Mesmo ganho como expressão do ffmpeg (filtro volume com eval=frame; t = tempo da timeline).
 * Os trechos já vêm separados por mais de 2 fades, então as rampas não se sobrepõem e podem ser somadas.
 */
export function duckGainExpr(ranges: [number, number][], ducking: TrackDucking): string {
  if (!ranges.length) return "1";
  const n = (value: number) => String(Math.round(value * 1000) / 1000);
  const f = n(ducking.fade);
  const parts = ranges.map(([start, end]) => `min(clip((t-${n(start - ducking.fade)})/${f},0,1),clip((${n(end + ducking.fade)}-t)/${f},0,1))`);
  return `1-${n(1 - ducking.amount)}*min(1,${parts.join("+")})`;
}
