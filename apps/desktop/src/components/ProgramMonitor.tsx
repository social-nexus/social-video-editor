import { useEffect, useMemo, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import type { MediaItem, TimelineClip, Track } from "../types";
import { clipsAt } from "../lib/tracks";

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
  visible: boolean;
};

/** Um <video>/<audio> que segue o playhead da timeline (respeitando o ponto de entrada do clipe). */
function SyncedMedia({ kind, url, clip, playhead, playing, muted, visible }: SyncedMediaProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const expected = Math.max(0, clip.inPoint + (playhead - clip.start));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.muted = muted;
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
    ? <video ref={ref} className={visible ? "preview-media" : "hidden-media"} src={url} preload="auto" playsInline />
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
  const videoTracks = tracks.filter((track) => track.kind === "video");

  // Clipe visível: de cima (última trilha de vídeo) para baixo.
  let visual: TimelineClip | null = null;
  for (let index = videoTracks.length - 1; index >= 0 && !visual; index--) {
    const track = videoTracks[index];
    if (track.hidden) continue;
    visual = active.find((clip) => clip.trackId === track.id && playable(clip)) ?? null;
  }
  const visualItem = visual ? playable(visual) : null;

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
      ? <img className="preview-media" src={visualItem.url} alt="" />
      : <SyncedMedia key={visual.id} kind="video" url={visualItem.url} clip={visual} playhead={playhead} playing={playing}
          muted={Boolean(trackById.get(visual.trackId)?.muted)} visible />}
    {sounds.map((clip) => {
      const item = playable(clip)!;
      return <SyncedMedia key={clip.id} kind={item.kind === "audio" ? "audio" : "video"} url={item.url} clip={clip}
        playhead={playhead} playing={playing} muted={false} visible={false} />;
    })}
  </>;
}
