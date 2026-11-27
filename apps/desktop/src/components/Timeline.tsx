import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { effectiveAnimations } from "../lib/animations";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AudioLines, ChevronDown, Copy, Eye, EyeOff, Film, Lock, LockOpen, Maximize2, Plus, Redo2, Scissors,
  SquareSplitHorizontal, Trash2, Undo2, Volume2, VolumeX, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { Caption, ClipAudio, ClipGeometry, MediaItem, TimelineClip, Track, TrackKind } from "../types";
import { formatSeconds, formatTimecode, parseSeconds, roundTime } from "../lib/time";
import {
  applyClipDrag, clampClipDuration, clipEnd, clipSpeed, maxClipDuration, rulerStep, snapTargetsFor, sourceDurationOf,
  type DragMode,
} from "../lib/timeline";
import { freeBounds, trackKindFor, trackLabel } from "../lib/tracks";
import { clipVolume, effectiveFades, formatPercent, trackVolume } from "../lib/audio";
import ClipWaveform from "./ClipWaveform";
import CaptionLane, { CaptionEditBar } from "./CaptionLane";

const TRACK_LABEL_PX = 104;
/** Distância, no conteúdo rolável, entre a borda esquerda e o instante 0 (padding + cabeçalho da trilha). */
const LANE_X = 12 + TRACK_LABEL_PX;
const NARROW_CLIP_PX = 48;
const SNAP_PX = 8;
const DRAG_START_PX = 3;
const MIN_PPS = 8;
const MAX_PPS = 400;
export const DEFAULT_PPS = 42;

type DragState = {
  clipId: string;
  mode: DragMode;
  startX: number;
  moved: boolean;
  original: ClipGeometry;
  speed: number;
  preview: ClipGeometry;
  /** Trilha onde o clipe está sendo arrastado (muda ao mover para cima/baixo). */
  trackId: string;
  trackKind: TrackKind;
  sourceDuration: number | null;
  snapTargets: number[];
  minStart: number;
  maxEnd: number;
};

export type TrackFlag = "hidden" | "muted" | "locked";

type Props = {
  media: MediaItem[];
  tracks: Track[];
  clips: TimelineClip[];
  selectedClipId: string | null;
  playhead: number;
  ratio: string;
  canAddClip: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onRatioChange: (ratio: string) => void;
  onAddClip: () => void;
  onSelectClip: (clip: TimelineClip | null) => void;
  onUpdateClip: (clipId: string, change: Partial<ClipGeometry>) => void;
  /** Fim de um arraste "mover": nova posição e (talvez) nova trilha. Sobrescreve o que estiver embaixo. */
  onMoveClip: (clipId: string, geometry: ClipGeometry, trackId: string) => void;
  onRemoveClip: (clipId: string) => void;
  captions: Caption[];
  selectedCaptionId: string | null;
  captionsVisible: boolean;
  onSelectCaption: (id: string | null) => void;
  onUpdateCaption: (id: string, change: Partial<Caption>) => void;
  onAddCaption: (at: number) => void;
  onRemoveCaption: (id: string) => void;
  onToggleCaptions: () => void;
  onUpdateClipAudio: (clipId: string, change: ClipAudio) => void;
  onSetTrackVolume: (trackId: string, volume: number) => void;
  onPlayheadChange: (seconds: number) => void;
  onNotice: (message: string) => void;
  onAddTrack: (kind: TrackKind) => void;
  onRemoveTrack: (trackId: string) => void;
  onToggleTrack: (trackId: string, flag: TrackFlag) => void;
};

export default function Timeline(props: Props) {
  const { media, tracks, clips, selectedClipId, playhead, ratio, canAddClip } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomAnchorRef = useRef<{ time: number; offsetX: number } | null>(null);
  const [durationDraft, setDurationDraft] = useState("");
  const [fadeInDraft, setFadeInDraft] = useState("");
  const [fadeOutDraft, setFadeOutDraft] = useState("");
  const [viewportWidth, setViewportWidth] = useState(800);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewportWidth(scroller.clientWidth));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Sempre a versão mais recente das props, para os listeners globais de arraste.
  const propsRef = useRef(props);
  propsRef.current = props;

  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  // V2 fica acima de V1 (a de cima aparece por cima no preview); áudio vem depois.
  const orderedTracks = useMemo(() => [
    ...tracks.filter((track) => track.kind === "video").reverse(),
    ...tracks.filter((track) => track.kind === "audio"),
  ], [tracks]);

  const geometryOf = (clip: TimelineClip): ClipGeometry => drag?.clipId === clip.id ? drag.preview : clip;
  const trackOf = (clip: TimelineClip) => drag?.clipId === clip.id ? drag.trackId : clip.trackId;

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedMedia = selectedClip ? mediaById.get(selectedClip.mediaId) ?? null : null;
  const selectedSource = sourceDurationOf(selectedMedia);
  const selectedLocked = selectedClip ? Boolean(trackById.get(selectedClip.trackId)?.locked) : false;

  const totalDuration = Math.max(
    clips.reduce((max, clip) => Math.max(max, clipEnd(geometryOf(clip))), 0),
    props.captions.reduce((max, caption) => Math.max(max, caption.end), 0),
  );
  const selectedCaption = props.captions.find((caption) => caption.id === props.selectedCaptionId) ?? null;
  // A faixa ocupa pelo menos a área visível; cresce com o conteúdo (+4 s de folga).
  const laneWidth = Math.max(viewportWidth - LANE_X - 12, (Math.max(totalDuration, playhead) + 4) * pps);
  const step = rulerStep(pps);
  const stepPx = step * pps;
  const tickCount = Math.floor(laneWidth / stepPx) + 1;
  const laneBackground = `repeating-linear-gradient(90deg, transparent 0, transparent ${stepPx - 1}px, #25252e ${stepPx - 1}px, #25252e ${stepPx}px)`;

  useEffect(() => {
    setDurationDraft(selectedClip ? formatSeconds(selectedClip.duration) : "");
  }, [selectedClip?.id, selectedClip?.duration]);

  useEffect(() => {
    setFadeInDraft(selectedClip ? formatSeconds(selectedClip.fadeIn ?? 0) : "");
    setFadeOutDraft(selectedClip ? formatSeconds(selectedClip.fadeOut ?? 0) : "");
  }, [selectedClip?.id, selectedClip?.fadeIn, selectedClip?.fadeOut]);

  const selectedHasSound = Boolean(selectedMedia && selectedMedia.kind !== "image");

  function commitFade(which: "fadeIn" | "fadeOut") {
    if (!selectedClip) return;
    const draft = which === "fadeIn" ? fadeInDraft : fadeOutDraft;
    const value = draft.trim() === "" ? 0 : parseSeconds(draft);
    const reset = () => (which === "fadeIn" ? setFadeInDraft : setFadeOutDraft)(formatSeconds(selectedClip[which] ?? 0));
    if (!Number.isFinite(value) || value < 0) { reset(); props.onNotice("Digite o fade em segundos, por exemplo 0,5."); return; }
    props.onUpdateClipAudio(selectedClip.id, { [which]: value });
    const other = (which === "fadeIn" ? selectedClip.fadeOut : selectedClip.fadeIn) ?? 0;
    if (value > selectedClip.duration - other + 1e-6) props.onNotice("O fade foi limitado ao espaço livre do clipe.");
  }

  // ---- Arrastar / aparar clipes -------------------------------------------------
  function beginDrag(event: ReactPointerEvent, clip: TimelineClip, mode: DragMode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    props.onSelectClip(clip);
    const track = trackById.get(clip.trackId);
    if (track?.locked) { props.onNotice("Esta trilha está travada. Destrave para editar."); return; }
    const original: ClipGeometry = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint };
    const bounds = freeBounds(clip, clips);
    const state: DragState = {
      clipId: clip.id, mode, startX: event.clientX, moved: false, original, preview: original,
      trackId: clip.trackId, trackKind: track?.kind ?? trackKindFor(mediaById.get(clip.mediaId)?.kind ?? "video"),
      sourceDuration: sourceDurationOf(mediaById.get(clip.mediaId)),
      snapTargets: snapTargetsFor(clip.id, clips, playhead),
      minStart: bounds.minStart, maxEnd: bounds.maxEnd, speed: clipSpeed(clip),
    };
    dragRef.current = state;
    setDrag(state);
  }

  /** Trilha compatível e destravada sob o ponteiro (para mover clipes entre trilhas). */
  function trackUnderPointer(event: PointerEvent, kind: TrackKind) {
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-track-id]");
    const track = lane ? propsRef.current.tracks.find((entry) => entry.id === lane.dataset.trackId) : undefined;
    return track && track.kind === kind && !track.locked ? track.id : null;
  }

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      const trackId = current.mode === "move" ? trackUnderPointer(event, current.trackKind) ?? current.trackId : current.trackId;
      if (!current.moved && Math.abs(dx) < DRAG_START_PX && trackId === current.trackId) return;
      // Segurar Alt desliga o snap.
      const preview = applyClipDrag(current.mode, current.original, dx / pps, {
        sourceDuration: current.sourceDuration, snapTargets: current.snapTargets,
        snapThreshold: event.altKey ? 0 : SNAP_PX / pps,
        minStart: current.minStart, maxEnd: current.maxEnd, speed: current.speed,
      });
      dragRef.current = { ...current, moved: true, preview, trackId };
      setDrag(dragRef.current);
    };
    const finish = (commit: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!commit || !current?.moved) return;
      if (current.mode === "move") propsRef.current.onMoveClip(current.clipId, current.preview, current.trackId);
      else propsRef.current.onUpdateClip(current.clipId, current.preview);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") finish(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [dragging, pps]);

  // ---- Playhead ------------------------------------------------------------------
  function timeAtPointer(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return roundTime(Math.max(0, (event.clientX - rect.left) / pps));
  }

  function scrubStart(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onPlayheadChange(timeAtPointer(event));
  }

  function scrubMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) props.onPlayheadChange(timeAtPointer(event));
  }

  function laneClick(event: ReactPointerEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.button !== 0) return;
    props.onSelectClip(null);
    props.onPlayheadChange(timeAtPointer(event));
  }

  // ---- Zoom ----------------------------------------------------------------------
  function zoomTo(nextPps: number, anchorClientX?: number) {
    const scroller = scrollRef.current;
    const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, nextPps));
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      // Mantém parado o instante sob o cursor (ou o playhead, nos botões).
      const offsetX = anchorClientX !== undefined
        ? anchorClientX - rect.left
        : Math.min(Math.max(playhead * pps - scroller.scrollLeft + LANE_X, 0), scroller.clientWidth);
      const time = Math.max(0, (scroller.scrollLeft + offsetX - LANE_X) / pps);
      zoomAnchorRef.current = { time, offsetX };
    }
    setPps(clamped);
  }

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroller || !anchor) return;
    zoomAnchorRef.current = null;
    scroller.scrollLeft = Math.max(0, anchor.time * pps + LANE_X - anchor.offsetX);
  }, [pps]);

  // Ctrl + roda do mouse = zoom (listener nativo para poder bloquear o zoom da página).
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomRef.current(ppsRef.current * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX);
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  }, []);

  function zoomToFit() {
    const scroller = scrollRef.current;
    if (!scroller || totalDuration <= 0) return;
    // Mesma folga de 4 s usada na largura da faixa, para não sobrar barra de rolagem.
    const available = scroller.clientWidth - LANE_X - 12;
    setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, available / (totalDuration + 4))));
    scroller.scrollLeft = 0;
  }

  // ---- Barra do clipe selecionado ------------------------------------------------
  function commitDurationDraft() {
    if (!selectedClip) return;
    const value = parseSeconds(durationDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setDurationDraft(formatSeconds(selectedClip.duration));
      props.onNotice("Duração inválida. Digite um número em segundos, por exemplo 8 ou 2,5.");
      return;
    }
    const roomToNext = freeBounds(selectedClip, clips).maxEnd - selectedClip.start;
    const duration = roundTime(Math.min(clampClipDuration(selectedClip, selectedSource, value), Math.max(roomToNext, selectedClip.duration)));
    props.onUpdateClip(selectedClip.id, { duration });
    setDurationDraft(formatSeconds(duration));
    if (duration < value) {
      props.onNotice(duration >= roomToNext - 1e-6 && roomToNext < clampClipDuration(selectedClip, selectedSource, value)
        ? `O próximo clipe começa em ${formatTimecode(selectedClip.start + roomToNext)}. A duração foi limitada para não sobrepor.`
        : `Só há ${formatSeconds(duration)}s de mídia a partir do ponto de entrada. A duração foi limitada a esse valor.`);
    }
  }

  function nudgeSelected(delta: number) {
    if (!selectedClip) return;
    // Empurrar para quando encosta no vizinho (não sobrescreve).
    const { minStart, maxEnd } = freeBounds(selectedClip, clips);
    const start = Math.min(Math.max(selectedClip.start + delta, minStart), maxEnd - selectedClip.duration);
    props.onUpdateClip(selectedClip.id, { start: roundTime(Math.max(0, start)) });
  }

  // ---- Render --------------------------------------------------------------------
  function renderClip(clip: TimelineClip, locked: boolean) {
    const item = mediaById.get(clip.mediaId);
    const audio = item?.kind === "audio";
    const geometry = geometryOf(clip);
    const width = Math.max(4, geometry.duration * pps);
    const narrow = width < NARROW_CLIP_PX;
    const classes = ["timeline-clip", audio ? "audio-clip" : "video-clip", item?.kind === "image" ? "image-clip" : "",
      selectedClipId === clip.id ? "selected" : "", narrow ? "narrow" : "", drag?.clipId === clip.id ? "dragging" : ""].join(" ");
    const handleWidth = Math.min(7, width / 3);
    const sound = item && item.kind !== "image";
    const fades = sound ? effectiveFades({ ...clip, duration: geometry.duration }) : { fadeIn: 0, fadeOut: 0 };
    const volume = clipVolume(clip);
    return <div key={clip.id} className={classes} style={{ left: geometry.start * pps, width }}
      onPointerDown={(event) => beginDrag(event, clip, "move")}
      title={`${item?.name ?? "Mídia não vinculada"} · ${formatSeconds(geometry.duration)}s${sound && volume !== 1 ? ` · volume ${formatPercent(volume)}` : ""}`}>
      {sound && item && <ClipWaveform item={item} inPoint={geometry.inPoint} sourceSpan={geometry.duration * clipSpeed(clip)} width={width} height={30} />}
      {fades.fadeIn > 0 && <div className="clip-fade in" style={{ width: fades.fadeIn * pps }} />}
      {fades.fadeOut > 0 && <div className="clip-fade out" style={{ width: fades.fadeOut * pps }} />}
      {!audio && (clip.animIn || clip.animOut) && (() => {
        const anims = effectiveAnimations({ ...clip, duration: geometry.duration });
        return <>
          {anims.inDur > 0 && <div className="clip-anim in" title="Animação de entrada" style={{ width: anims.inDur * pps }} />}
          {anims.outDur > 0 && <div className="clip-anim out" title="Animação de saída" style={{ width: anims.outDur * pps }} />}
        </>;
      })()}
      {!locked && <div className="clip-handle start" style={{ width: handleWidth }} onPointerDown={(event) => beginDrag(event, clip, "trim-start")} />}
      {!narrow && (audio ? <AudioLines size={13} /> : <Film size={13} />)}
      {!narrow && <span>{item?.name ?? (audio ? "Áudio" : "Mídia não vinculada")}</span>}
      {!narrow && sound && volume !== 1 && <em className="clip-volume" title="Volume do clipe">{formatPercent(volume)}</em>}
      {!narrow && clipSpeed(clip) !== 1 && <em className="clip-speed" title="Velocidade do clipe">{Math.round(clipSpeed(clip) * 100)}%</em>}
      {!narrow && !locked && <button title="Remover clipe" onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); props.onRemoveClip(clip.id); }}><X size={12} /></button>}
      {!locked && <div className="clip-handle end" style={{ width: handleWidth }} onPointerDown={(event) => beginDrag(event, clip, "trim-end")} />}
    </div>;
  }

  function renderTrackHeader(track: Track) {
    const sameKind = tracks.filter((entry) => entry.kind === track.kind).length;
    const empty = !clips.some((clip) => clip.trackId === track.id);
    return <div className={`track-label ${track.kind}`}>
      <b>{trackLabel(track, tracks)}</b>
      {track.kind === "video" && <button className={track.hidden ? "active" : ""} title={track.hidden ? "Mostrar trilha no preview" : "Ocultar trilha no preview"}
        onClick={() => props.onToggleTrack(track.id, "hidden")}>{track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>}
      <button className={track.muted ? "active" : ""} title={track.muted ? "Ativar som da trilha" : "Silenciar trilha"}
        onClick={() => props.onToggleTrack(track.id, "muted")}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
      <button className={track.locked ? "active" : ""} title={track.locked ? "Destravar trilha" : "Travar trilha"}
        onClick={() => props.onToggleTrack(track.id, "locked")}>{track.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
      {empty && sameKind > 1 && <button title="Remover trilha vazia" onClick={() => props.onRemoveTrack(track.id)}><Trash2 size={12} /></button>}
      <input className="track-volume" type="range" min={0} max={100} step={1} value={Math.round(trackVolume(track) * 100)}
        disabled={track.locked} aria-label={`Volume da trilha ${trackLabel(track, tracks)}`}
        title={`Volume da trilha: ${formatPercent(trackVolume(track))} (duplo clique volta a 100%)`}
        onChange={(event) => props.onSetTrackVolume(track.id, Number(event.target.value) / 100)}
        onDoubleClick={() => props.onSetTrackVolume(track.id, 1)} />
    </div>;
  }

  const dragInfo = drag?.moved ? `${formatTimecode(drag.preview.start)} → ${formatTimecode(clipEnd(drag.preview))} · ${formatSeconds(drag.preview.duration)}s` : null;

  return (
    <div className="timeline-panel panel">
      <div className="timeline-toolbar">
        <div><span className="eyebrow">EDIÇÃO</span><h2>Timeline</h2></div>
        <div className="timeline-actions">
          <div className="edit-controls">
            <button className="icon-button small" title="Desfazer (Ctrl+Z)" onClick={props.onUndo} disabled={!props.canUndo}><Undo2 size={14} /></button>
            <button className="icon-button small" title="Refazer (Ctrl+Y)" onClick={props.onRedo} disabled={!props.canRedo}><Redo2 size={14} /></button>
            <button className="icon-button small" title="Dividir no playhead (S)" onClick={props.onSplit} disabled={!clips.length}><SquareSplitHorizontal size={14} /></button>
            <button className="icon-button small" title="Duplicar clipe selecionado (Ctrl+D)" onClick={props.onDuplicate} disabled={!selectedClip || selectedLocked}><Copy size={14} /></button>
          </div>
          <span className="timeline-timecode" title="Posição do playhead (← → move, Shift = 1s)">{formatTimecode(playhead)}</span>
          <div className="zoom-controls">
            <button className="icon-button small" title="Diminuir zoom (Ctrl + roda do mouse)" onClick={() => zoomTo(pps / 1.25)} disabled={pps <= MIN_PPS}><ZoomOut size={14} /></button>
            <input type="range" aria-label="Zoom da timeline" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)} onChange={(event) => zoomTo(Math.exp(Number(event.target.value)))} />
            <button className="icon-button small" title="Aumentar zoom (Ctrl + roda do mouse)" onClick={() => zoomTo(pps * 1.25)} disabled={pps >= MAX_PPS}><ZoomIn size={14} /></button>
            <button className="icon-button small" title="Ajustar a timeline à janela" onClick={zoomToFit} disabled={totalDuration <= 0}><Maximize2 size={13} /></button>
          </div>
          <label className="ratio-select"> <span>Formato</span><select value={ratio} onChange={(event) => props.onRatioChange(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>3:4</option><option>4:5</option></select><ChevronDown size={13} /></label>
          <button className="button secondary compact" onClick={props.onAddClip} disabled={!canAddClip}><Plus size={14} /> Adicionar clipe</button>
        </div>
      </div>

      {selectedClip && <div className="clip-edit-controls">
        <span>Clipe selecionado</span>
        <span className="clip-edit-name" title={selectedMedia?.name}>{selectedMedia?.name}</span>
        {selectedLocked ? <span className="clip-edit-hint"><Lock size={11} /> trilha travada</span> : <>
          <button className="button secondary compact" onClick={() => nudgeSelected(-0.5)} disabled={selectedClip.start <= 0}>← 0,5s</button>
          <button className="button secondary compact" onClick={() => nudgeSelected(0.5)}>0,5s →</button>
          <span>Início {formatTimecode(selectedClip.start)}</span>
          <label>Duração <input type="text" inputMode="decimal" aria-label="Duração do clipe em segundos" value={durationDraft}
            onChange={(event) => setDurationDraft(event.target.value)}
            onBlur={commitDurationDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") { setDurationDraft(formatSeconds(selectedClip.duration)); event.currentTarget.blur(); }
            }} />s</label>
          {selectedSource !== null && <span className="clip-edit-hint">máx. {formatSeconds(maxClipDuration(selectedClip, selectedSource))}s</span>}
          {clipSpeed(selectedClip) !== 1 && <span className="clip-edit-hint">velocidade {Math.round(clipSpeed(selectedClip) * 100)}%</span>}
          {selectedClip.inPoint > 0 && <span className="clip-edit-hint">entrada na mídia {formatSeconds(selectedClip.inPoint)}s</span>}
          <button className="button secondary compact" title="Remover clipe da timeline" onClick={() => props.onRemoveClip(selectedClip.id)}><X size={12} /> Remover</button>
        </>}
      </div>}
      {selectedCaption && <CaptionEditBar caption={selectedCaption} onChange={props.onUpdateCaption} onRemove={props.onRemoveCaption} onNotice={props.onNotice} />}
      {selectedClip && selectedHasSound && !selectedLocked && <div className="clip-edit-controls clip-audio-controls">
        <span><Volume2 size={11} /> Som</span>
        <label>Volume <input className="clip-volume-range" type="range" min={0} max={100} step={1} value={Math.round(clipVolume(selectedClip) * 100)}
          aria-label="Volume do clipe" title="Duplo clique volta a 100%"
          onChange={(event) => props.onUpdateClipAudio(selectedClip.id, { volume: Number(event.target.value) / 100 })}
          onDoubleClick={() => props.onUpdateClipAudio(selectedClip.id, { volume: 1 })} />
          <b className="mono">{formatPercent(clipVolume(selectedClip))}</b></label>
        <button className="button secondary compact" title="Silenciar só este clipe"
          onClick={() => props.onUpdateClipAudio(selectedClip.id, { volume: clipVolume(selectedClip) > 0 ? 0 : 1 })}>
          {clipVolume(selectedClip) > 0 ? <><VolumeX size={12} /> Mudo</> : <><Volume2 size={12} /> Som</>}</button>
        <label>Fade in <input type="text" inputMode="decimal" aria-label="Fade de entrada em segundos" value={fadeInDraft}
          onChange={(event) => setFadeInDraft(event.target.value)} onBlur={() => commitFade("fadeIn")}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />s</label>
        <label>Fade out <input type="text" inputMode="decimal" aria-label="Fade de saída em segundos" value={fadeOutDraft}
          onChange={(event) => setFadeOutDraft(event.target.value)} onBlur={() => commitFade("fadeOut")}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />s</label>
      </div>}

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-tracks" style={{ width: laneWidth + TRACK_LABEL_PX }}>
          <div className="ruler-row">
            <div className="ruler-corner" />
            <div className="timeline-ruler" style={{ width: laneWidth }} onPointerDown={scrubStart} onPointerMove={scrubMove}>
              {Array.from({ length: tickCount }, (_, i) => <span key={i} style={{ left: i * stepPx }}>{formatTimecode(i * step)}</span>)}
            </div>
          </div>
          {orderedTracks.map((track) => {
            const dropTarget = drag?.moved && drag.trackId === track.id && drag.mode === "move";
            return <div key={track.id} className={`track-row ${track.locked ? "locked" : ""} ${track.hidden ? "hidden-track" : ""}`}>
              {renderTrackHeader(track)}
              <div className={`track-lane ${track.kind === "audio" ? "audio-lane" : ""} ${dropTarget ? "drop-target" : ""}`} data-track-id={track.id}
                style={{ width: laneWidth, backgroundImage: laneBackground }} onPointerDown={laneClick}>
                {clips.filter((clip) => trackOf(clip) === track.id).map((clip) => renderClip(clip, track.locked))}
              </div>
            </div>;
          })}
          <CaptionLane captions={props.captions} selectedCaptionId={props.selectedCaptionId} visible={props.captionsVisible}
            pps={pps} laneWidth={laneWidth} laneBackground={laneBackground} playhead={playhead}
            clipEdges={clips.flatMap((clip) => [clip.start, clipEnd(clip)])}
            onSelect={(id) => { props.onSelectCaption(id); if (id) props.onSelectClip(null); }}
            onChange={props.onUpdateCaption} onAdd={props.onAddCaption} onToggleVisible={props.onToggleCaptions}
            onPlayheadChange={props.onPlayheadChange} />
          <div className="timeline-playhead" style={{ left: TRACK_LABEL_PX + playhead * pps }} />
        </div>
        {clips.length === 0 && <div className="timeline-empty"><Scissors size={16} /> Importe uma mídia e clique em + para adicioná-la à timeline.</div>}
      </div>

      <div className="timeline-footer">
        <span className="track-add">
          <button onClick={() => props.onAddTrack("video")} title="Adicionar trilha de vídeo"><Plus size={11} /> Vídeo</button>
          <button onClick={() => props.onAddTrack("audio")} title="Adicionar trilha de áudio"><Plus size={11} /> Áudio</button>
          {clips.length} clipe(s) · duração {formatTimecode(totalDuration)}
        </span>
        <span>{dragInfo ?? "Arraste para mover (entre trilhas também) · bordas aparam · S divide · Del remove · Ctrl+Z desfaz"}</span>
      </div>
    </div>
  );
}
