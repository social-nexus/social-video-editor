import type { MediaItem, TimelineClip, TimelineState } from "../types";
import { clipEnd, clipSpeed } from "./timeline";
import { clipVolume, effectiveFades, trackVolume } from "./audio";
import { clipTransformExpr, motionFilters } from "./renderMotion";

/** Qualidade da exportação (CRF do x264: menor = melhor e maior). */
export const QUALITY_PRESETS = [
  { id: "high", label: "Alta", crf: 18 },
  { id: "good", label: "Boa", crf: 21 },
  { id: "light", label: "Arquivo leve", crf: 26 },
] as const;

/** Velocidade do x264: mais rápido = arquivo um pouco maior com a mesma qualidade. */
export const SPEED_PRESETS = [
  { id: "veryfast", label: "Rápida" },
  { id: "medium", label: "Normal" },
  { id: "slow", label: "Caprichada (lenta)" },
] as const;

export const RESOLUTIONS = [
  { id: 720, label: "720p" },
  { id: 1080, label: "1080p" },
  { id: 1440, label: "1440p" },
  { id: 2160, label: "4K" },
] as const;

export const FRAME_RATES = [24, 25, 30, 60] as const;

export type RenderSettings = {
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
};

export type ProbeInfo = { hasVideo: boolean; hasAudio: boolean };

export type RenderPlan = {
  inputs: string[];
  filter: string;
  outputArgs: string[];
  /** Arquivos de mídia usados (o arquivo final nunca pode ser um deles). */
  sources: string[];
  duration: number;
  warnings: string[];
};

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Tamanho do vídeo: o lado menor recebe a resolução escolhida (1080p em 9:16 = 1080×1920). */
export function outputSize(ratio: string, shortSide: number): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  if (!(w > 0 && h > 0)) return { width: even(shortSide * 16 / 9), height: even(shortSide) };
  return w >= h
    ? { width: even(shortSide * w / h), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide * h / w) };
}

/** Número curto e estável para o ffmpeg (sem notação científica). */
export const num = (value: number) => {
  const fixed = (Math.round(value * 1000) / 1000).toFixed(3);
  return fixed.replace(/\.?0+$/, "") || "0";
};

/** Cadeia de atempo para qualquer velocidade (cada atempo aceita 0,5–100). */
export function tempoChain(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-6) return [];
  const parts: string[] = [];
  let rest = speed;
  while (rest < 0.5) { parts.push("atempo=0.5"); rest /= 0.5; }
  while (rest > 100) { parts.push("atempo=100"); rest /= 100; }
  parts.push(`atempo=${num(rest)}`);
  return parts;
}

/** Enquadramento: "Encaixar" com barras pretas ou "Preencher" cortando as sobras. */
function fitFilter(clip: TimelineClip, width: number, height: number) {
  return clip.fit === "cover"
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

/**
 * Monta o comando do ffmpeg a partir da timeline (função pura, testável).
 * Imagem: trilhas de vídeo visíveis, a de cima cobre a de baixo (como no preview).
 * Som: vídeos e áudios de trilhas não silenciadas, com velocidade, volume e fades.
 */
export function buildRenderPlan(
  state: TimelineState, media: MediaItem[], probes: Map<string, ProbeInfo>, settings: RenderSettings, duration: number,
): RenderPlan {
  const { width, height, fps } = settings;
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const trackById = new Map(state.tracks.map((track) => [track.id, track]));
  const trackOrder = new Map(state.tracks.map((track, index) => [track.id, index]));
  const warnings: string[] = [];
  const inputs: string[] = [];
  const sources = new Set<string>();
  const chains: string[] = [];
  const total = Math.max(0.1, duration);

  // Clipes renderizáveis, de baixo para cima e em ordem de tempo.
  const clips = [...state.clips]
    .filter((clip) => clip.start < total - 1e-6)
    .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) || a.start - b.start);

  let missing = 0;
  let overlays = 0;
  let current = "base";
  const audioLabels: string[] = [];
  chains.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num(total)},format=yuv420p[base]`);

  clips.forEach((clip) => {
    const item = mediaById.get(clip.mediaId);
    const track = trackById.get(clip.trackId);
    if (!item || !track) return;
    if (item.missing || !item.path) { missing++; return; }
    const probe = probes.get(item.path) ?? { hasVideo: item.kind !== "audio", hasAudio: item.kind !== "image" };
    const length = Math.min(clip.duration, total - clip.start);
    const speed = clipSpeed(clip);
    const showsImage = track.kind === "video" && !track.hidden && item.kind !== "audio" && probe.hasVideo;
    const hasSound = !track.muted && item.kind !== "image" && probe.hasAudio;
    if (!showsImage && !hasSound) return;

    const index = inputs.filter((arg) => arg === "-i").length;
    sources.add(item.path);
    if (item.kind === "image") inputs.push("-loop", "1", "-framerate", String(fps), "-t", num(length), "-i", item.path);
    else inputs.push("-ss", num(clip.inPoint), "-t", num(length * speed + 0.5), "-i", item.path);

    if (showsImage) {
      const label = `v${overlays}`;
      const timing = item.kind === "image"
        ? `trim=duration=${num(length)},setpts=PTS-STARTPTS`
        : `trim=duration=${num(length * speed)},setpts=(PTS-STARTPTS)/${num(speed)}`;
      const prepared = `[${index}:v]${timing},fps=${fps},${fitFilter(clip, width, height)},setsar=1,format=yuv420p`;
      const transform = clipTransformExpr(clip, length);
      if (!transform) chains.push(`${prepared},setpts=PTS+${num(clip.start)}/TB[${label}]`);
      else {
        // Ken Burns e entrada/saída: em resolução dobrada (até 1080p) para o movimento não tremer.
        const factor = width * height <= 1920 * 1080 ? 2 : 1;
        chains.push(`${prepared}[f${overlays}]`);
        chains.push(...motionFilters(transform, `f${overlays}`, `m${overlays}`, String(overlays), { width, height, fps, length, factor }));
        chains.push(`[m${overlays}]format=yuv420p,setpts=PTS+${num(clip.start)}/TB[${label}]`);
      }
      const next = `o${overlays}`;
      chains.push(`[${current}][${label}]overlay=eof_action=pass:enable='between(t,${num(clip.start)},${num(clip.start + length)})'[${next}]`);
      current = next;
      overlays++;
    }

    if (hasSound) {
      const gain = clipVolume(clip) * trackVolume(track);
      const fades = effectiveFades({ ...clip, duration: length });
      const filters = [`atrim=duration=${num(length * speed)}`, "asetpts=PTS-STARTPTS", ...tempoChain(speed),
        "aresample=48000", "aformat=channel_layouts=stereo"];
      if (Math.abs(gain - 1) > 1e-6) filters.push(`volume=${num(gain)}`);
      if (fades.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${num(fades.fadeIn)}`);
      if (fades.fadeOut > 0) filters.push(`afade=t=out:st=${num(length - fades.fadeOut)}:d=${num(fades.fadeOut)}`);
      filters.push(`atrim=duration=${num(length)}`);
      if (clip.start > 0) filters.push(`adelay=delays=${Math.round(clip.start * 1000)}:all=1`);
      const label = `a${audioLabels.length}`;
      chains.push(`[${index}:a]${filters.join(",")}[${label}]`);
      audioLabels.push(label);
    }
  });

  chains.push(`[${current}]format=yuv420p[vout]`);
  if (audioLabels.length) {
    // Silêncio até o fim do vídeo, com duração finita (apad sem limite gera tempos inválidos).
    const pad = `apad=whole_dur=${num(total)},atrim=duration=${num(total)},asetpts=N/SR/TB`;
    chains.push(audioLabels.length === 1
      ? `[${audioLabels[0]}]${pad}[aout]`
      : `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,${pad}[aout]`);
  }

  if (missing) warnings.push(`${missing} clipe(s) com mídia não vinculada ficaram de fora.`);
  if (!overlays) warnings.push("Nenhuma imagem visível: o vídeo sairá preto.");

  const outputArgs = [
    "-map", "[vout]",
    ...(audioLabels.length ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-c:v", "libx264", "-preset", settings.preset, "-crf", String(settings.crf), "-pix_fmt", "yuv420p",
    "-r", String(fps), "-t", num(total), "-movflags", "+faststart",
  ];
  return { inputs, filter: chains.join(";\n"), outputArgs, sources: [...sources], duration: total, warnings };
}

/** Clipes sem caminho de arquivo (importados só no navegador) não podem ser exportados. */
export const clipsWithoutFile = (clips: TimelineClip[], media: MediaItem[]) =>
  clips.filter((clip) => { const item = media.find((entry) => entry.id === clip.mediaId); return !item || !item.path || item.missing; });

/** Fim do vídeo: o último clipe (legendas além do último clipe também contam). */
export const renderDuration = (state: TimelineState) =>
  Math.max(0, ...state.clips.map(clipEnd), ...state.captions.map((caption) => caption.end));
