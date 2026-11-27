import type { MediaItem } from "../types";
import { computePeaks, PEAKS_PER_SECOND } from "./audio";

export type Waveform = { peaks: Float32Array; perSecond: number };

/** Arquivos maiores que isso não são decodificados (memória). */
const MAX_DECODE_BYTES = 300 * 1024 * 1024;

const cache = new Map<string, Promise<Waveform | null>>();
let context: AudioContext | null = null;

async function readBytes(item: MediaItem): Promise<ArrayBuffer> {
  if (item.file) return item.file.arrayBuffer();
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Forma de onda de um áudio/vídeo (lida só para exibição; o arquivo original não é alterado).
 * Fica em cache por mídia; retorna null quando não dá para decodificar.
 */
export function loadWaveform(item: MediaItem): Promise<Waveform | null> {
  const key = `${item.id}|${item.url}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    if (item.kind !== "audio" && item.kind !== "video") return null;
    if (item.size > MAX_DECODE_BYTES || !item.url) return null;
    try {
      const bytes = await readBytes(item);
      context ??= new AudioContext();
      const buffer = await context.decodeAudioData(bytes);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      return { peaks: computePeaks(channels, buffer.sampleRate), perSecond: PEAKS_PER_SECOND };
    } catch {
      return null; // sem trilha de áudio ou formato não suportado
    }
  })();
  cache.set(key, promise);
  return promise;
}
