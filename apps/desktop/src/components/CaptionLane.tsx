import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Captions, Eye, EyeOff, Plus, X } from "lucide-react";
import type { Caption } from "../types";
import { MIN_CLIP_DURATION, formatSeconds, formatTimecode, parseSeconds, roundTime } from "../lib/time";
import { nearestSnap } from "../lib/timeline";
import { captionBounds } from "../lib/captions";

const SNAP_PX = 8;
const DRAG_START_PX = 3;

type CaptionTimes = Pick<Caption, "start" | "end">;
type CaptionDragMode = "move" | "trim-start" | "trim-end";
type CaptionDrag = {
  id: string; mode: CaptionDragMode; startX: number; moved: boolean;
  original: CaptionTimes; preview: CaptionTimes; minStart: number; maxEnd: number; targets: number[];
};

/** Novo início/fim de uma legenda arrastada `delta` segundos, sem invadir as vizinhas. */
export function dragCaption(mode: CaptionDragMode, original: CaptionTimes, delta: number,
  bounds: { minStart: number; maxEnd: number }, targets: number[], threshold: number): CaptionTimes {
  const length = original.end - original.start;
  if (mode === "move") {
    let start = original.start + delta;
    const snapStart = nearestSnap(start, targets, threshold);
    const snapEnd = nearestSnap(start + length, targets, threshold);
    if (snapStart !== null && (snapEnd === null || Math.abs(snapStart - start) <= Math.abs(snapEnd - start - length))) start = snapStart;
    else if (snapEnd !== null) start = snapEnd - length;
    start = Math.min(Math.max(start, bounds.minStart), bounds.maxEnd - length);
    return { start: roundTime(start), end: roundTime(start + length) };
  }
  if (mode === "trim-start") {
    let start = original.start + delta;
    start = nearestSnap(start, targets, threshold) ?? start;
    start = Math.min(Math.max(start, bounds.minStart), original.end - MIN_CLIP_DURATION);
    return { start: roundTime(start), end: original.end };
  }
  let end = original.end + delta;
  end = nearestSnap(end, targets, threshold) ?? end;
  end = Math.max(Math.min(end, bounds.maxEnd), original.start + MIN_CLIP_DURATION);
  return { start: original.start, end: roundTime(end) };
}

type LaneProps = {
  captions: Caption[];
  selectedCaptionId: string | null;
  visible: boolean;
  pps: number;
  laneWidth: number;
  laneBackground: string;
  playhead: number;
  /** Bordas dos clipes, para as legendas "grudarem" nos cortes. */
  clipEdges: number[];
  onSelect: (id: string | null) => void;
  onChange: (id: string, change: Partial<Caption>) => void;
  onAdd: (at: number) => void;
  onToggleVisible: () => void;
  onPlayheadChange: (seconds: number) => void;
};

/** Faixa de legendas da timeline: arrastar move, bordas aparam, duplo clique no vazio cria. */
export default function CaptionLane(props: LaneProps) {
  const { captions, selectedCaptionId, pps, laneWidth, laneBackground } = props;
  const [drag, setDrag] = useState<CaptionDrag | null>(null);
  const dragRef = useRef<CaptionDrag | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  function begin(event: ReactPointerEvent, caption: Caption, mode: CaptionDragMode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    props.onSelect(caption.id);
    const original = { start: caption.start, end: caption.end };
    const targets = [0, props.playhead, ...props.clipEdges];
    for (const other of captions) if (other.id !== caption.id) targets.push(other.start, other.end);
    const state: CaptionDrag = { id: caption.id, mode, startX: event.clientX, moved: false, original, preview: original,
      ...captionBounds(caption, captions), targets };
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
      const preview = dragCaption(current.mode, current.original, dx / pps, current, current.targets, event.altKey ? 0 : SNAP_PX / pps);
      dragRef.current = { ...current, moved: true, preview };
      setDrag(dragRef.current);
    };
    const finish = (commit: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (commit && current?.moved) propsRef.current.onChange(current.id, current.preview);
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

  const timeAt = (event: React.MouseEvent<HTMLElement>) =>
    roundTime(Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / pps));

  return <div className={`track-row caption-row ${props.visible ? "" : "hidden-track"}`}>
    <div className="track-label caption">
      <b title="Legendas"><Captions size={12} /></b>
      <button className={props.visible ? "" : "active"} title={props.visible ? "Esconder legendas no preview" : "Mostrar legendas no preview"}
        onClick={props.onToggleVisible}>{props.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
      <button title="Nova legenda no playhead" onClick={() => props.onAdd(props.playhead)}><Plus size={12} /></button>
    </div>
    <div className="track-lane caption-lane" style={{ width: laneWidth, backgroundImage: laneBackground }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.button !== 0) return;
        props.onSelect(null);
        props.onPlayheadChange(timeAt(event));
      }}
      onDoubleClick={(event) => { if (event.target === event.currentTarget) props.onAdd(timeAt(event)); }}
      title="Duplo clique para criar uma legenda">
      {captions.map((caption) => {
        const times = drag?.id === caption.id ? drag.preview : caption;
        const width = Math.max(4, (times.end - times.start) * pps);
        const handle = Math.min(6, width / 3);
        return <div key={caption.id} className={`caption-block ${selectedCaptionId === caption.id ? "selected" : ""}`}
          style={{ left: times.start * pps, width }} title={`${formatTimecode(times.start)} → ${formatTimecode(times.end)}\n${caption.text}`}
          onPointerDown={(event) => begin(event, caption, "move")}>
          <div className="clip-handle start" style={{ width: handle }} onPointerDown={(event) => begin(event, caption, "trim-start")} />
          {width > 24 && <span>{caption.text.replace(/\n/g, " / ")}</span>}
          <div className="clip-handle end" style={{ width: handle }} onPointerDown={(event) => begin(event, caption, "trim-end")} />
        </div>;
      })}
    </div>
  </div>;
}

type BarProps = {
  caption: Caption;
  onChange: (id: string, change: Partial<Caption>) => void;
  onRemove: (id: string) => void;
  onNotice: (message: string) => void;
  /** Legenda com posição própria volta para a do estilo. */
  onResetPosition?: (id: string) => void;
};

/** Barra de edição da legenda selecionada: texto, início e fim. */
export function CaptionEditBar({ caption, onChange, onRemove, onNotice, onResetPosition }: BarProps) {
  const [text, setText] = useState(caption.text);
  const [start, setStart] = useState(formatSeconds(caption.start));
  const [end, setEnd] = useState(formatSeconds(caption.end));
  useEffect(() => setText(caption.text), [caption.id, caption.text]);
  useEffect(() => { setStart(formatSeconds(caption.start)); setEnd(formatSeconds(caption.end)); }, [caption.id, caption.start, caption.end]);

  function commitText() {
    const value = text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    if (!value) { setText(caption.text); onNotice("A legenda não pode ficar vazia. Use Remover para apagá-la."); return; }
    if (value !== caption.text) onChange(caption.id, { text: value });
  }

  function commitTime(which: "start" | "end") {
    const value = parseSeconds(which === "start" ? start : end);
    if (!Number.isFinite(value) || value < 0) {
      setStart(formatSeconds(caption.start)); setEnd(formatSeconds(caption.end));
      onNotice("Digite o tempo em segundos, por exemplo 12,5.");
      return;
    }
    if (roundTime(value) !== caption[which]) onChange(caption.id, { [which]: roundTime(value) });
  }

  const timeInput = (label: string, value: string, set: (value: string) => void, which: "start" | "end") =>
    <label>{label} <input type="text" inputMode="decimal" aria-label={`${label} da legenda em segundos`} value={value}
      onChange={(event) => set(event.target.value)} onBlur={() => commitTime(which)}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />s</label>;

  return <div className="clip-edit-controls caption-edit-controls">
    <span className="caption-edit-title"><Captions size={12} /> Legenda</span>
    <textarea aria-label="Texto da legenda" rows={2} value={text} onChange={(event) => setText(event.target.value)} onBlur={commitText}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { setText(caption.text); event.currentTarget.blur(); }
      }} title="Enter confirma · Shift+Enter quebra a linha" />
    {timeInput("Início", start, setStart, "start")}
    {timeInput("Fim", end, setEnd, "end")}
    <span className="clip-edit-hint">{formatSeconds(roundTime(caption.end - caption.start))}s</span>
    {caption.x !== undefined && onResetPosition && <button className="button secondary compact" onClick={() => onResetPosition(caption.id)}
      title="Esta legenda tem posição própria (arrastada). Volta para a posição das outras.">Posição padrão</button>}
    <button className="button secondary compact" onClick={() => onRemove(caption.id)}><X size={12} /> Remover</button>
  </div>;
}
