import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { MonitorPlay } from "lucide-react";
import { Fragment } from "react";
import type { ClipPlacement, MediaItem, TimelineClip, Track } from "../types";
import { clipsAt } from "../lib/tracks";
import { clipSpeed } from "../lib/timeline";
import { clipGainAt, trackVolume } from "../lib/audio";
import { clipFrameAt, DEFAULT_FIT, frameTransform } from "../lib/effects";
import { animationTransform, clipAnimationAt } from "../lib/animations";
import { effectiveTransition, motionTransform, transitionLook, transitionMotion, transitionProgress, type TransitionMotion } from "../lib/transitions";
import { cleanPlacement, contentSize, hitsPlaced, placedCorners, placementOf, placementTransform, snapRotation, snapValue } from "../lib/placement";

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
  onAspect?: (aspect: number) => void;
};

/** Um <video>/<audio> que segue o playhead da timeline (respeitando o ponto de entrada do clipe). */
function SyncedMedia({ kind, url, clip, playhead, playing, muted, volume, visible, style, onAspect }: SyncedMediaProps) {
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
    ? <video ref={ref} className={visible ? "preview-media" : "hidden-media"} style={style} src={url} preload="auto" playsInline
        onLoadedMetadata={(event) => { const v = event.currentTarget; if (v.videoWidth && v.videoHeight) onAspect?.(v.videoWidth / v.videoHeight); }} />
    : <audio ref={ref} src={url} preload="auto" />;
}

type Props = {
  media: MediaItem[];
  tracks: Track[];
  clips: TimelineClip[];
  playhead: number;
  playing: boolean;
  /** Proporção do quadro (largura / altura). */
  frameAspect: number;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  /** Nova posição durante o arraste; `gesture` junta o arraste inteiro num só passo de desfazer. */
  onPlacement: (clipId: string, placement: ClipPlacement, gesture: string) => void;
};

type Layer = { clip: TimelineClip; item: MediaItem; track: Track };
type Drag = {
  mode: "move" | "scale" | "rotate";
  clipId: string;
  gesture: string;
  start: { x: number; y: number };
  startPlacement: ClipPlacement;
  center: { x: number; y: number };
  startDistance: number;
  startAngle: number;
};

const HANDLE_RADIUS = 9;
const ROTATE_OFFSET = 26;
let gestureCount = 0;

/**
 * Monitor do programa: mostra a composição da timeline no instante do playhead.
 * - Imagem/vídeo: todas as trilhas de vídeo visíveis, empilhadas (a de cima por cima).
 * - Som: vídeos e áudios de todas as trilhas não silenciadas.
 * - Edição direta: clique seleciona o clipe; arraste move, cantos redimensionam, a bolinha de cima gira.
 */
export default function ProgramMonitor({ media, tracks, clips, playhead, playing, frameAspect, selectedClipId, onSelectClip, onPlacement }: Props) {
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const [aspects, setAspects] = useState<Map<string, number>>(new Map());
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  /** Área em volta do quadro (o palco), em px a partir do canto do quadro. */
  const [stage, setStage] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [cursor, setCursor] = useState("default");
  const [dragging, setDragging] = useState<Drag["mode"] | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // Tamanho do quadro e do palco na tela (para as alças, que podem ficar fora do quadro).
  useEffect(() => {
    const canvas = surfaceRef.current?.parentElement;
    const stageElement = canvas?.parentElement;
    if (!canvas || !stageElement) return;
    const measure = () => {
      const c = canvas.getBoundingClientRect(), s = stageElement.getBoundingClientRect();
      setFrame({ width: canvas.clientWidth, height: canvas.clientHeight });
      setStage({ left: s.left - c.left - canvas.clientLeft, top: s.top - c.top - canvas.clientTop,
        right: s.right - c.left - canvas.clientLeft, bottom: s.bottom - c.top - canvas.clientTop });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    observer.observe(stageElement);
    return () => observer.disconnect();
  }, []);

  const playable = (clip: TimelineClip) => {
    const item = mediaById.get(clip.mediaId);
    return item && !item.missing && item.url ? item : null;
  };
  const rememberAspect = (mediaId: string, aspect: number) =>
    setAspects((current) => Math.abs((current.get(mediaId) ?? 0) - aspect) < 1e-6 ? current : new Map(current).set(mediaId, aspect));

  const active = clipsAt(clips, playhead);
  const gainOf = (clip: TimelineClip) => clipGainAt(clip, playhead) * trackVolume(trackById.get(clip.trackId));

  // Camadas visíveis, de baixo (primeira trilha de vídeo) para cima.
  const layers: Layer[] = [];
  for (const track of tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    const clip = active.find((entry) => entry.trackId === track.id && playable(entry));
    if (clip) layers.push({ clip, item: playable(clip)!, track });
  }
  const layerIds = new Set(layers.map((layer) => layer.clip.id));

  // Transições: no começo de um clipe com transição, o anterior (colado na mesma trilha) aparece por baixo.
  type Drawn = Layer & { incoming?: ReturnType<typeof transitionLook>; outgoing?: boolean; motion?: TransitionMotion };
  const drawn: Drawn[] = layers.flatMap((layer): Drawn[] => {
    const effective = effectiveTransition(layer.clip, clips);
    const p = effective ? transitionProgress(layer.clip, effective.transition, playhead) : null;
    const fromItem = effective ? playable(effective.from) : null;
    if (!effective || p === null || !fromItem) return [layer];
    const motion = transitionMotion(effective.transition.type, p);
    return [{ clip: effective.from, item: fromItem, track: layer.track, outgoing: true, motion: motion.out },
      { ...layer, incoming: transitionLook(effective.transition.type, p), motion: motion.in }];
  });

  // Fontes de som: vídeos (exceto os visíveis, que já tocam no próprio elemento) e áudios.
  const sounds = active.filter((clip) => {
    const item = playable(clip);
    const track = trackById.get(clip.trackId);
    return !layerIds.has(clip.id) && item && item.kind !== "image" && track && !track.muted;
  });

  // Cortina e círculo: recorte em coordenadas do quadro (raio do círculo em px da meia-diagonal).
  const transitionMask = (look: ReturnType<typeof transitionLook>): CSSProperties => {
    if (look.clipPath) return { clipPath: look.clipPath };
    if (!look.circle) return {};
    const radius = Math.max(0, look.circle.radius * Math.hypot(frame.width, frame.height) / 2);
    if (look.circle.open) return { clipPath: `circle(${radius.toFixed(1)}px at 50% 50%)` };
    const mask = `radial-gradient(circle at 50% 50%, transparent ${radius.toFixed(1)}px, #000 ${(radius + 0.5).toFixed(1)}px)`;
    return { maskImage: mask, WebkitMaskImage: mask };
  };
  const sizeOf = (layer: Layer) => contentSize(layer.clip.fit ?? DEFAULT_FIT, aspects.get(layer.item.id) ?? null, frameAspect);
  const selectedLayer = layers.find((layer) => layer.clip.id === selectedClipId) ?? null;
  const corners = selectedLayer && frame.width ? placedCorners(sizeOf(selectedLayer), placementOf(selectedLayer.clip), frame) : null;
  const editable = Boolean(selectedLayer && !selectedLayer.track.locked);
  /** Com um clipe selecionado e pausado, o quadro deixa ver (esmaecido) o que passa da borda. */
  const editing = Boolean(selectedLayer) && !playing && frame.width > 0;
  useEffect(() => {
    surfaceRef.current?.parentElement?.classList.toggle("editing", editing);
  }, [editing]);
  // Bolinha de girar: acima do meio da borda de cima, na direção "para cima" da mídia.
  const rotateHandle = corners ? (() => {
    const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const bottom = { x: (corners[3].x + corners[2].x) / 2, y: (corners[3].y + corners[2].y) / 2 };
    const length = Math.hypot(top.x - bottom.x, top.y - bottom.y) || 1;
    const out = { x: top.x + (top.x - bottom.x) / length * ROTATE_OFFSET, y: top.y + (top.y - bottom.y) / length * ROTATE_OFFSET };
    const inside = (p: { x: number; y: number }) => p.x >= stage.left + HANDLE_RADIUS && p.y >= stage.top + HANDLE_RADIUS
      && p.x <= stage.right - HANDLE_RADIUS && p.y <= stage.bottom - HANDLE_RADIUS;
    // Sem espaço fora do palco: a bolinha vai para dentro da mídia, para não sumir.
    const handle = inside(out) ? out : { x: top.x - (top.x - bottom.x) / length * ROTATE_OFFSET, y: top.y - (top.y - bottom.y) / length * ROTATE_OFFSET };
    return { ...handle, top };
  })() : null;

  // Pontos sempre em px a partir do canto do quadro (a superfície pode ser maior que ele).
  const pointOf = (event: ReactPointerEvent) => {
    const canvas = surfaceRef.current!.parentElement!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left - canvas.clientLeft, y: event.clientY - rect.top - canvas.clientTop };
  };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= HANDLE_RADIUS + 3;
  const hits = (layer: Layer, point: { x: number; y: number }) => hitsPlaced(point, sizeOf(layer), placementOf(layer.clip), frame);

  function handleAt(point: { x: number; y: number }): Drag["mode"] | null {
    if (!editable || !corners || !rotateHandle) return null;
    if (near(point, rotateHandle)) return "rotate";
    if (corners.some((corner) => near(point, corner))) return "scale";
    return null;
  }
  const layerAt = (point: { x: number; y: number }) => [...layers].reverse().find((layer) => hits(layer, point)) ?? null;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !frame.width) return;
    const point = pointOf(event);
    let mode = handleAt(point);
    let target = mode ? selectedLayer : null;
    if (!target) {
      // A camada de cima sob o cursor (as alças da selecionada já foram vistas acima).
      target = layerAt(point);
      mode = "move";
    }
    if (!target) { onSelectClip(null); return; }
    if (target.clip.id !== selectedClipId) onSelectClip(target.clip.id);
    if (target.track.locked) return;
    const placement = placementOf(target.clip);
    const center = { x: frame.width / 2 + placement.x * frame.width, y: frame.height / 2 + placement.y * frame.height };
    dragRef.current = {
      mode: mode!, clipId: target.clip.id, gesture: `place:${target.clip.id}:${++gestureCount}`, start: point, startPlacement: placement, center,
      startDistance: Math.max(1, Math.hypot(point.x - center.x, point.y - center.y)),
      startAngle: Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI,
    };
    setDragging(mode);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!frame.width) return;
    const point = pointOf(event);
    const drag = dragRef.current;
    if (!drag) {
      const mode = handleAt(point);
      setCursor(mode === "rotate" ? "grab" : mode === "scale" ? "nwse-resize" : layerAt(point) ? "move" : "default");
      return;
    }
    const from = drag.startPlacement;
    let next: ClipPlacement;
    if (drag.mode === "move") {
      // Ímã no centro do quadro (6 px na tela).
      next = { ...from,
        x: snapValue(from.x + (point.x - drag.start.x) / frame.width, [0], 6 / frame.width),
        y: snapValue(from.y + (point.y - drag.start.y) / frame.height, [0], 6 / frame.height) };
    } else if (drag.mode === "scale") {
      const ratio = Math.hypot(point.x - drag.center.x, point.y - drag.center.y) / drag.startDistance;
      next = { ...from, scale: snapValue(from.scale * ratio, [1], 0.02) };
    } else {
      const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180 / Math.PI;
      next = { ...from, rotation: snapRotation(from.rotation + angle - drag.startAngle, event.shiftKey) };
    }
    onPlacement(drag.clipId, cleanPlacement(next), drag.gesture);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <>
    {!layers.length && <div className="preview-empty program-empty">
      <div className="preview-logo"><MonitorPlay size={31} /></div>
      <strong>{clips.length ? "Nada na timeline neste ponto" : "A timeline está vazia"}</strong>
      <span>{clips.length ? "Mova o playhead para um trecho com clipes." : "Adicione clipes para ver a montagem aqui."}</span>
    </div>}
    {drawn.map(({ clip, item, track, incoming, outgoing, motion }) => {
      // Enquadramento e movimento (Ken Burns) no instante do playhead.
      // A animação de entrada/saída fica por fora do Ken Burns; a posição fica por fora de tudo (na camada).
      const anim = clipAnimationAt(clip, playhead);
      const transform = [motion ? motionTransform(motion) : undefined, animationTransform(anim), frameTransform(clipFrameAt(clip, playhead))].filter(Boolean).join(" ");
      const opacity = anim.opacity * (incoming ? (incoming.hideIncoming ? 0 : incoming.opacity) : 1);
      const style: CSSProperties = { objectFit: clip.fit ?? DEFAULT_FIT, transform: transform || undefined, ...(opacity < 1 ? { opacity } : {}) };
      const layer = <div className="preview-layer" style={{ transform: placementTransform(clip.placement) }}>
        {item.kind === "image"
          ? <img className="preview-media" style={style} src={item.url} alt="" draggable={false}
              onLoad={(event) => { const img = event.currentTarget; if (img.naturalWidth && img.naturalHeight) rememberAspect(item.id, img.naturalWidth / img.naturalHeight); }} />
          : <SyncedMedia kind="video" url={item.url} clip={clip} playhead={playhead} playing={playing}
              muted={track.muted || Boolean(outgoing)} volume={gainOf(clip)} visible style={style} onAspect={(aspect) => rememberAspect(item.id, aspect)} />}
      </div>;
      // Cortina: recorta o clipe novo no quadro (fora da posição dele); Escurecer: véu preto por cima.
      return <Fragment key={clip.id}>
        {incoming?.clipPath || incoming?.circle ? <div className="preview-transition-clip" style={transitionMask(incoming)}>{layer}</div> : layer}
        {incoming && incoming.veil > 0 && <div className="preview-transition-veil" style={{ opacity: incoming.veil }} />}
      </Fragment>;
    })}
    {sounds.map((clip) => {
      const item = playable(clip)!;
      return <SyncedMedia key={clip.id} kind={item.kind === "audio" ? "audio" : "video"} url={item.url} clip={clip}
        playhead={playhead} playing={playing} muted={false} volume={gainOf(clip)} visible={false} />;
    })}
    {/* Editando: o que passa do quadro aparece esmaecido em volta (a máscara escurece o palco). */}
    {editing && <div className="frame-mask" />}
    <div ref={surfaceRef} className="preview-surface"
      style={{
        cursor: dragging === "rotate" ? "grabbing" : dragging === "move" ? "move" : cursor,
        ...(editing ? { left: stage.left, top: stage.top, width: stage.right - stage.left, height: stage.bottom - stage.top } : {}),
      }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
    {corners && rotateHandle && <svg className={`placement-box ${editable ? "" : "locked"}`} width={frame.width} height={frame.height}>
      <polygon points={corners.map((corner) => `${corner.x},${corner.y}`).join(" ")} />
      {editable && <>
        <line x1={rotateHandle.top.x} y1={rotateHandle.top.y} x2={rotateHandle.x} y2={rotateHandle.y} />
        <circle className="rotate" cx={rotateHandle.x} cy={rotateHandle.y} r={HANDLE_RADIUS - 2} />
        {corners.map((corner, index) => <rect key={index} x={corner.x - 5} y={corner.y - 5} width={10} height={10} rx={2} />)}
      </>}
    </svg>}
  </>;
}
