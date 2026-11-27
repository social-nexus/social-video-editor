import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AudioLines, ChevronDown, Film, Maximize2, Music2, Plus, Scissors, Video, X, ZoomIn, ZoomOut } from "lucide-react";
import type { ClipGeometry, MediaItem, TimelineClip } from "../types";
import { formatSeconds, formatTimecode, parseSeconds, roundTime } from "../lib/time";
import {
  applyClipDrag, clampClipDuration, clipEnd, maxClipDuration, rulerStep, snapTargetsFor, sourceDurationOf,
  type DragMode,
} from "../lib/timeline";

const TRACK_LABEL_PX = 46;
/** Distância, no conteúdo rolável, entre a borda esquerda e o instante 0 (padding + rótulo da trilha). */
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
  preview: ClipGeometry;
  sourceDuration: number | null;
  snapTargets: number[];
};

type Props = {
  media: MediaItem[];
  clips: TimelineClip[];
  selectedClipId: string | null;
  playhead: number;
  ratio: string;
  canAddClip: boolean;
  onRatioChange: (ratio: string) => void;
  onAddClip: () => void;
  onSelectClip: (clip: TimelineClip | null) => void;
  onUpdateClip: (clipId: string, change: Partial<ClipGeometry>) => void;
  onRemoveClip: (clipId: string) => void;
  onPlayheadChange: (seconds: number) => void;
  onNotice: (message: string) => void;
};

export default function Timeline(props: Props) {
  const { media, clips, selectedClipId, playhead, ratio, canAddClip } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomAnchorRef = useRef<{ time: number; offsetX: number } | null>(null);
  const [durationDraft, setDurationDraft] = useState("");
  const [viewportWidth, setViewportWidth] = useState(800);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewportWidth(scroller.clientWidth));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Sempre a versão mais recente dos callbacks, para os listeners globais de arraste.
  const propsRef = useRef(props);
  propsRef.current = props;

  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const isAudioClip = (clip: TimelineClip) => mediaById.get(clip.mediaId)?.kind === "audio";
  const geometryOf = (clip: TimelineClip): ClipGeometry => drag?.clipId === clip.id ? drag.preview : clip;

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedMedia = selectedClip ? mediaById.get(selectedClip.mediaId) ?? null : null;
  const selectedSource = sourceDurationOf(selectedMedia);

  const totalDuration = clips.reduce((max, clip) => Math.max(max, clipEnd(geometryOf(clip))), 0);
  // A faixa ocupa pelo menos a área visível; cresce com o conteúdo (+4 s de folga).
  const laneWidth = Math.max(viewportWidth - LANE_X - 12, (Math.max(totalDuration, playhead) + 4) * pps);
  const step = rulerStep(pps);
  const stepPx = step * pps;
  const tickCount = Math.floor(laneWidth / stepPx) + 1;
  const laneBackground = `repeating-linear-gradient(90deg, transparent 0, transparent ${stepPx - 1}px, #25252e ${stepPx - 1}px, #25252e ${stepPx}px)`;

  useEffect(() => {
    setDurationDraft(selectedClip ? formatSeconds(selectedClip.duration) : "");
  }, [selectedClip?.id, selectedClip?.duration]);

  // ---- Arrastar / aparar clipes -------------------------------------------------
  function beginDrag(event: ReactPointerEvent, clip: TimelineClip, mode: DragMode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    props.onSelectClip(clip);
    const original: ClipGeometry = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint };
    const state: DragState = {
      clipId: clip.id, mode, startX: event.clientX, moved: false, original, preview: original,
      sourceDuration: sourceDurationOf(mediaById.get(clip.mediaId)),
      snapTargets: snapTargetsFor(clip.id, clips, playhead),
    };
    dragRef.current = state;
    setDrag(state);
  }

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      if (!current.moved && Math.abs(dx) < DRAG_START_PX) return;
      // Segurar Alt desliga o snap.
      const preview = applyClipDrag(current.mode, current.original, dx / pps, {
        sourceDuration: current.sourceDuration, snapTargets: current.snapTargets,
        snapThreshold: event.altKey ? 0 : SNAP_PX / pps,
      });
      dragRef.current = { ...current, moved: true, preview };
      setDrag(dragRef.current);
    };
    const finish = (commit: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (commit && current?.moved) propsRef.current.onUpdateClip(current.clipId, current.preview);
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
    const duration = clampClipDuration(selectedClip, selectedSource, value);
    props.onUpdateClip(selectedClip.id, { duration });
    setDurationDraft(formatSeconds(duration));
    if (duration < value) props.onNotice(`Só há ${formatSeconds(duration)}s de mídia a partir do ponto de entrada. A duração foi limitada a esse valor.`);
  }

  function nudgeSelected(delta: number) {
    if (!selectedClip) return;
    props.onUpdateClip(selectedClip.id, { start: roundTime(Math.max(0, selectedClip.start + delta)) });
  }

  // ---- Render --------------------------------------------------------------------
  function renderClip(clip: TimelineClip) {
    const item = mediaById.get(clip.mediaId);
    const audio = item?.kind === "audio";
    const geometry = geometryOf(clip);
    const width = Math.max(4, geometry.duration * pps);
    const narrow = width < NARROW_CLIP_PX;
    const classes = ["timeline-clip", audio ? "audio-clip" : "video-clip",
      selectedClipId === clip.id ? "selected" : "", narrow ? "narrow" : "", drag?.clipId === clip.id ? "dragging" : ""].join(" ");
    const handleWidth = Math.min(7, width / 3);
    return <div key={clip.id} className={classes} style={{ left: geometry.start * pps, width }}
      onPointerDown={(event) => beginDrag(event, clip, "move")}
      title={`${item?.name ?? "Mídia não vinculada"} · ${formatSeconds(geometry.duration)}s`}>
      <div className="clip-handle start" style={{ width: handleWidth }} onPointerDown={(event) => beginDrag(event, clip, "trim-start")} />
      {!narrow && (audio ? <AudioLines size={13} /> : <Film size={13} />)}
      {!narrow && <span>{item?.name ?? (audio ? "Áudio" : "Mídia não vinculada")}</span>}
      {!narrow && <button title="Remover clipe" onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); props.onRemoveClip(clip.id); }}><X size={12} /></button>}
      <div className="clip-handle end" style={{ width: handleWidth }} onPointerDown={(event) => beginDrag(event, clip, "trim-end")} />
    </div>;
  }

  const dragInfo = drag?.moved ? `${formatTimecode(drag.preview.start)} → ${formatTimecode(clipEnd(drag.preview))} · ${formatSeconds(drag.preview.duration)}s` : null;

  return (
    <div className="timeline-panel panel">
      <div className="timeline-toolbar">
        <div><span className="eyebrow">EDIÇÃO</span><h2>Timeline</h2></div>
        <div className="timeline-actions">
          <span className="timeline-timecode" title="Posição do playhead">{formatTimecode(playhead)}</span>
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
        {selectedClip.inPoint > 0 && <span className="clip-edit-hint">entrada na mídia {formatSeconds(selectedClip.inPoint)}s</span>}
        <button className="button secondary compact" title="Remover clipe da timeline" onClick={() => props.onRemoveClip(selectedClip.id)}><X size={12} /> Remover</button>
      </div>}

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-tracks" style={{ width: laneWidth + TRACK_LABEL_PX }}>
          <div className="timeline-ruler" style={{ width: laneWidth }} onPointerDown={scrubStart} onPointerMove={scrubMove}>
            {Array.from({ length: tickCount }, (_, i) => <span key={i} style={{ left: i * stepPx }}>{formatTimecode(i * step)}</span>)}
          </div>
          <div className="track-row"><div className="track-label"><Video size={14} /> V1</div>
            <div className="track-lane" style={{ width: laneWidth, backgroundImage: laneBackground }} onPointerDown={laneClick}>
              {clips.filter((clip) => !isAudioClip(clip)).map(renderClip)}
            </div></div>
          <div className="track-row"><div className="track-label"><Music2 size={14} /> A1</div>
            <div className="track-lane audio-lane" style={{ width: laneWidth, backgroundImage: laneBackground }} onPointerDown={laneClick}>
              {clips.filter(isAudioClip).map(renderClip)}
            </div></div>
          <div className="timeline-playhead" style={{ left: TRACK_LABEL_PX + playhead * pps }} />
        </div>
        {clips.length === 0 && <div className="timeline-empty"><Scissors size={16} /> Importe uma mídia e clique em + para adicioná-la à timeline.</div>}
      </div>

      <div className="timeline-footer">
        <span>{clips.length} clipe(s) · duração {formatTimecode(totalDuration)}</span>
        <span>{dragInfo ?? "Arraste para mover · bordas para aparar · Alt desliga o encaixe · Esc cancela"}</span>
      </div>
    </div>
  );
}
