import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { MonitorPlay } from "lucide-react";
import type { MediaItem, TimelineClip, Track } from "../types";
import { clipsAt } from "../lib/tracks";
import { clipSpeed } from "../lib/timeline";
import { clipGainAt, trackVolume } from "../lib/audio";
import { clipFrameAt, DEFAULT_FIT, frameTransform } from "../lib/effects";
import { animationTransform, clipAnimationAt } from "../lib/animations";

/** Tolerância de dessincronia antes de reposicionar a mídia (segundos). */
const PAUSED_TOLERANCE = 0.04;
const PLAYING_TOLERANCE = 0.3;

type SyncedMediaProps = {
  kind: "video" | "audio";
  url: string;
  clip: TimelineClip;
  playhead: number;
  playing: boolean;
  muted: boolean;
  /** Volume no instante do playhead (0–1), já com fades e volume da trilha. */
  volume: number;
  visible: boolean;
  style?: CSSProperties;
};

/** Um <video>/<audio> que segue o playhead da timeline (respeitando o ponto de entrada do clipe). */
function SyncedMedia({ kind, url, clip, playhead, playing, muted, volume, visible, style }: SyncedMediaProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const speed = clipSpeed(clip);
  const expected = Math.max(0, clip.inPoint + (playhead - clip.start) * speed);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.muted = muted;
    const level = Math.min(1, Math.max(0, volume));
    if (Math.abs(element.volume - level) > 0.001) element.volume = level;
    if (element.playbackRate !== speed) element.playbackRate = speed;
    if (!playing) {
      if (!element.paused) element.pause();
      if (Math.abs(element.currentTime - expected) > PAUSED_TOLERANCE) element.currentTime = expected;
      return;
    }
    if (element.paused) {
      element.currentTime = expected;
      element.play().catch(() => undefined);
    } else if (Math.abs(element.currentTime - expected) > PLAYING_TOLERANCE) {
      element.currentTime = expected;
    }
  });

  useEffect(() => () => ref.current?.pause(), []);

  return kind === "video"
    ? <video ref={ref} className={visible ? "preview-media" : "hidden-media"} style={style} src={url} preload="auto" playsInline />
    : <audio ref={ref} src={url} preload="auto" />;
}

type Props = {
  media: MediaItem[];
  tracks: Track[];
  clips: TimelineClip[];
  playhead: number;
  playing: boolean;
};

/**
 * Monitor do programa: mostra a composição da timeline no instante do playhead.
 * - Imagem/vídeo: a trilha de vídeo visível mais alta que tem clipe nesse instante.
 * - Som: vídeos e áudios de todas as trilhas não silenciadas.
 */
export default function ProgramMonitor({ media, tracks, clips, playhead, playing }: Props) {
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const playable = (clip: TimelineClip) => {
    const item = mediaById.get(clip.mediaId);
    return item && !item.missing && item.url ? item : null;
  };

  const active = clipsAt(clips, playhead);
  const gainOf = (clip: TimelineClip) => clipGainAt(clip, playhead) * trackVolume(trackById.get(clip.trackId));
  const videoTracks = tracks.filter((track) => track.kind === "video");

  // Clipe visível: de cima (última trilha de vídeo) para baixo.
  let visual: TimelineClip | null = null;
  for (let index = videoTracks.length - 1; index >= 0 && !visual; index--) {
    const track = videoTracks[index];
    if (track.hidden) continue;
    visual = active.find((clip) => clip.trackId === track.id && playable(clip)) ?? null;
  }
  const visualItem = visual ? playable(visual) : null;
  // Enquadramento e movimento (Ken Burns) do clipe visível no instante do playhead.
  // A animação de entrada/saída fica por fora do Ken Burns (move e escala a imagem já enquadrada).
  let visualStyle: CSSProperties | undefined;
  if (visual) {
    const anim = clipAnimationAt(visual, playhead);
    const transform = [animationTransform(anim), frameTransform(clipFrameAt(visual, playhead))].filter(Boolean).join(" ");
    visualStyle = { objectFit: visual.fit ?? DEFAULT_FIT, transform: transform || undefined, ...(anim.opacity < 1 ? { opacity: anim.opacity } : {}) };
  }

  // Fontes de som: vídeos (exceto o visível, que já toca no próprio elemento) e áudios.
  const sounds = active.filter((clip) => {
    const item = playable(clip);
    const track = trackById.get(clip.trackId);
    return clip !== visual && item && item.kind !== "image" && track && !track.muted;
  });

  return <>
    {!visual || !visualItem ? <div className="preview-empty program-empty">
      <div className="preview-logo"><MonitorPlay size={31} /></div>
      <strong>{clips.length ? "Nada na timeline neste ponto" : "A timeline está vazia"}</strong>
      <span>{clips.length ? "Mova o playhead para um trecho com clipes." : "Adicione clipes para ver a montagem aqui."}</span>
    </div> : visualItem.kind === "image"
      ? <img className="preview-media" style={visualStyle} src={visualItem.url} alt="" />
      : <SyncedMedia key={visual.id} kind="video" url={visualItem.url} clip={visual} playhead={playhead} playing={playing}
          muted={Boolean(trackById.get(visual.trackId)?.muted)} volume={gainOf(visual)} visible style={visualStyle} />}
    {sounds.map((clip) => {
      const item = playable(clip)!;
      return <SyncedMedia key={clip.id} kind={item.kind === "audio" ? "audio" : "video"} url={item.url} clip={clip}
        playhead={playhead} playing={playing} muted={false} volume={gainOf(clip)} visible={false} />;
    })}
  </>;
}
