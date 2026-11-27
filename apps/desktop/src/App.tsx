import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AudioLines, Clapperboard, FolderInput, FolderOpen, FolderPlus, Image as ImageIcon,
  Import, Layers3, Music2, Pause, Play, Plus, Save, Settings2, Sparkles,
  Video, WandSparkles, X, MonitorPlay
} from "lucide-react";
import type { Caption, CaptionStyle, ClipAudio, ClipMotion, ClipGeometry, MediaItem, MediaKind, TimelineClip, TimelineState, Track, TrackKind } from "./types";
import { DEFAULT_CAPTION_STYLE } from "./types";
import { DEFAULT_IMAGE_DURATION, formatSeconds, formatTimecode, roundTime } from "./lib/time";
import { fileNameOf, formatSize, kindFromFileName, kindOfFile, MEDIA_EXTENSIONS, probeMediaDuration } from "./lib/media";
import { clipEnd, sourceDurationOf, splitClip } from "./lib/timeline";
import { clampFade, formatPercent } from "./lib/audio";
import { formatCaptions, newCaptionAt, parseCaptions, shiftCaptions, sortCaptions, type CaptionFormat } from "./lib/captions";
import CaptionsPanel, { CaptionOverlay } from "./components/CaptionsPanel";
import EffectsPanel, { type ApplyAllOptions, type EffectsChange } from "./components/EffectsPanel";
import { makeMotion, MOTION_PRESETS, presetForIndex } from "./lib/effects";
import { defaultTracks, firstTrackFor, freeBounds, newTrack, overwriteRange, trackEnd, trackKindFor } from "./lib/tracks";
import { emptyHistory, mapHistory, record, redo, undo, type History } from "./lib/history";
import Timeline, { type TrackFlag } from "./components/Timeline";
import ProgramMonitor from "./components/ProgramMonitor";
import AssemblyDialog from "./components/AssemblyDialog";
import type { AssemblyPlan } from "./lib/autoassemble";

type FileInfo = { exists: boolean; size: number };
type PreviewMode = "program" | "source";

const timelineEndOf = (state: Pick<TimelineState, "clips" | "captions">) => Math.max(
  state.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0),
  state.captions.reduce((max, caption) => Math.max(max, caption.end), 0),
);
/** Movimento salvo no projeto, validado (null se inválido). */
function validMotion(value: any): ClipMotion | null {
  const frame = (entry: any) => entry && [entry.scale, entry.x, entry.y].every((n) => typeof n === "number" && Number.isFinite(n)) && entry.scale >= 1 && entry.scale <= 4
    ? { scale: entry.scale, x: entry.x, y: entry.y } : null;
  const from = frame(value?.from), to = frame(value?.to);
  const presets = [...MOTION_PRESETS.map((entry) => entry.id), "custom"];
  if (!from || !to || !presets.includes(value.preset) || value.preset === "none") return null;
  const intensity = Number(value.intensity);
  return { preset: value.preset, intensity: Number.isFinite(intensity) ? intensity : 0.15, smooth: value.smooth !== false, from, to };
}
const inTauri = () => "__TAURI_INTERNALS__" in window;

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("program");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>(() => ({ tracks: defaultTracks(), clips: [], captions: [] }));
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [ratio, setRatio] = useState("9:16");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [notice, setNotice] = useState("Seu espaço de edição está pronto.");
  const [assemblyOpen, setAssemblyOpen] = useState(false);
  const { tracks, clips, captions } = timeline;

  // Histórico de edições da timeline (trilhas + clipes). Os refs guardam o valor mais recente
  // para que várias edições no mesmo ciclo (e os atalhos de teclado) não usem estado antigo.
  const [history, setHistory] = useState<History<TimelineState>>(emptyHistory);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const historyRef = useRef(history);
  historyRef.current = history;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const clipboardRef = useRef<TimelineClip | null>(null);
  /** Última edição "contínua" (arrastar um volume): edições seguidas com a mesma chave viram um só passo de desfazer. */
  const lastMergeRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    invoke<string>("app_version").then(setAppVersion).catch(() => undefined);
  }, []);

  const selected = media.find((item) => item.id === selectedId) ?? null;
  const selectedClip = timeline.clips.find((clip) => clip.id === selectedClipId) ?? null;
  const timelineEnd = timelineEndOf(timeline);
  const mediaCount = useMemo(() => ({
    video: media.filter((item) => item.kind === "video").length,
    image: media.filter((item) => item.kind === "image").length,
    audio: media.filter((item) => item.kind === "audio").length,
  }), [media]);

  const mediaOf = (mediaId: string) => media.find((item) => item.id === mediaId);
  const hasSource = (clip: TimelineClip) => sourceDurationOf(mediaOf(clip.mediaId)) !== null;
  const isLocked = (trackId: string) => Boolean(timelineRef.current.tracks.find((track) => track.id === trackId)?.locked);

  // ---- Biblioteca ----------------------------------------------------------------
  /** Importa arquivos vindos de um <input type="file"> (sem caminho no disco). */
  function importFiles(files: FileList | File[]) {
    const additions: MediaItem[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file, path: null, url: URL.createObjectURL(file),
      name: file.name, kind: kindOfFile(file), size: file.size, duration: null,
    })).filter((item) => item.kind !== "other");
    if (!additions.length) {
      setNotice("Não encontrei arquivos de vídeo, imagem ou áudio nesse grupo.");
      return;
    }
    setMedia((current) => [...current, ...additions]);
    setSelectedId((current) => current ?? additions[0].id);
    setNotice(`${additions.length} arquivo(s) adicionado(s) à biblioteca.`);
    void loadMediaDurations(additions);
  }

  /** Mede a duração real dos vídeos/áudios e atualiza a biblioteca. */
  async function loadMediaDurations(items: MediaItem[]) {
    const results = await Promise.all(items.map((item) => item.missing ? Promise.resolve(null) : probeMediaDuration(item.url, item.kind)));
    const durations = new Map<string, number>();
    items.forEach((item, index) => { const value = results[index]; if (value !== null) durations.set(item.id, roundTime(value)); });
    if (!durations.size) return;
    setMedia((current) => current.map((entry) => durations.has(entry.id) ? { ...entry, duration: durations.get(entry.id) } : entry));
  }

  /** Adiciona arquivos do disco à biblioteca, pulando os que já estão nela. Retorna quantos entraram. */
  async function importPaths(paths: string[]) {
    const known = new Set(media.map((item) => item.path?.toLowerCase()).filter(Boolean));
    const fresh = paths.filter((path) => !known.has(path.toLowerCase()));
    const repeated = paths.length - fresh.length;
    if (!fresh.length) {
      setNotice(repeated ? "Esses arquivos já estão na biblioteca." : "Nenhum arquivo de mídia compatível encontrado.");
      return 0;
    }
    const info = await invoke<FileInfo[]>("media_file_info", { paths: fresh });
    const additions: MediaItem[] = fresh.map((mediaPath, index) => {
      const name = fileNameOf(mediaPath);
      return { id: crypto.randomUUID(), file: null, path: mediaPath, url: convertFileSrc(mediaPath), name, kind: kindFromFileName(name),
        size: info[index]?.size ?? 0, missing: !info[index]?.exists, duration: null };
    }).filter((item) => item.kind !== "other");
    if (!additions.length) { setNotice("Nenhum arquivo de mídia compatível selecionado."); return 0; }
    setMedia((current) => [...current, ...additions]);
    setSelectedId((current) => current ?? additions[0].id);
    setNotice(`${additions.length} arquivo(s) importado(s)${repeated ? `; ${repeated} já estava(m) na biblioteca e foi(ram) ignorado(s)` : ""}.`);
    void loadMediaDurations(additions);
    return additions.length;
  }

  async function importMediaFromDisk() {
    try {
      const paths = await open({ multiple: true, title: "Importar mídia", filters: [{ name: "Mídia", extensions: MEDIA_EXTENSIONS }] });
      if (!paths || typeof paths === "string") return;
      await importPaths(paths);
    } catch (error) { setNotice("Erro ao importar mídia: " + String(error)); }
  }

  /** Importa todos os arquivos de mídia de uma pasta e abre a montagem automática. */
  async function importFolder() {
    try {
      const folder = await open({ directory: true, multiple: false, title: "Importar pasta de mídia" });
      if (!folder || Array.isArray(folder)) return;
      const paths = await invoke<string[]>("list_media_files", { folder });
      if (!paths.length) { setNotice("Essa pasta não tem arquivos de vídeo, imagem ou áudio."); return; }
      await importPaths(paths);
      setAssemblyOpen(true);
    } catch (error) { setNotice("Erro ao importar a pasta: " + String(error)); }
  }

  async function relinkMedia(item: MediaItem) {
    try {
      const selectedPath = await open({ multiple: false, title: "Localizar arquivo: " + item.name });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      const info = await invoke<FileInfo[]>("media_file_info", { paths: [selectedPath] });
      if (!info[0]?.exists) { setNotice("O arquivo selecionado não foi encontrado."); return; }
      const relinked: MediaItem = { ...item, file: null, path: selectedPath, url: convertFileSrc(selectedPath), name: fileNameOf(selectedPath), size: info[0].size, missing: false };
      setMedia((current) => current.map((entry) => entry.id === item.id ? relinked : entry));
      setNotice("Arquivo relinkado com sucesso.");
      void loadMediaDurations([relinked]);
    } catch (error) { setNotice("Não foi possível relinkar: " + String(error)); }
  }

  function removeMedia(item: MediaItem) {
    if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
    const selectedClip = clips.find((clip) => clip.id === selectedClipId);
    // Tira os clipes dessa mídia da timeline e também do histórico (não há como desfazer para uma mídia removida).
    const withoutMedia = (state: TimelineState): TimelineState => ({ ...state, clips: state.clips.filter((clip) => clip.mediaId !== item.id) });
    setTimelineNow(withoutMedia(timelineRef.current));
    applyHistory(mapHistory(historyRef.current, withoutMedia));
    setMedia((current) => current.filter((entry) => entry.id !== item.id));
    if (clipboardRef.current?.mediaId === item.id) clipboardRef.current = null;
    if (selectedId === item.id) setSelectedId(null);
    if (selectedClip?.mediaId === item.id) setSelectedClipId(null);
    setNotice("Arquivo removido da biblioteca e da timeline.");
  }

  function selectLibraryItem(item: MediaItem) {
    setSelectedId(item.id);
    setPlaying(false);
    setPreviewMode("source");
  }

  // ---- Preview da mídia (modo "Mídia") --------------------------------------------
  function togglePreviewPlayback() {
    const video = previewVideoRef.current;
    if (!video) { setNotice("Selecione um vídeo para usar os controles de reprodução."); return; }
    if (video.paused) video.play().catch((error) => setNotice("Não foi possível reproduzir: " + String(error)));
    else video.pause();
  }

  function seekPreview(value: number) {
    const video = previewVideoRef.current;
    if (!video) return;
    video.currentTime = value;
    setPreviewTime(value);
  }

  // ---- Reprodução da timeline (modo "Timeline") -----------------------------------
  const timelineEndRef = useRef(timelineEnd);
  timelineEndRef.current = timelineEnd;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = playheadRef.current + (now - last) / 1000;
      last = now;
      if (next >= timelineEndRef.current) {
        playheadRef.current = roundTime(timelineEndRef.current);
        setPlayhead(playheadRef.current);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function togglePlay() {
    setPreviewMode("program");
    previewVideoRef.current?.pause();
    if (playing) { setPlaying(false); setPlayhead(roundTime(playheadRef.current)); return; }
    if (!timelineEnd) { setNotice("Adicione clipes à timeline para reproduzir."); return; }
    if (playheadRef.current >= timelineEnd - 0.05) setPlayhead(0);
    setPlaying(true);
  }

  function movePlayhead(seconds: number) {
    setPreviewMode("program");
    setPlayhead(seconds);
  }

  // ---- Edição da timeline (com histórico) -----------------------------------------
  function setTimelineNow(next: TimelineState) {
    timelineRef.current = next;
    setTimeline(next);
  }

  function applyHistory(next: History<TimelineState>) {
    historyRef.current = next;
    setHistory(next);
  }

  /** Toda edição da timeline passa por aqui para poder ser desfeita. */
  function editTimeline(updater: (current: TimelineState) => TimelineState, mergeKey?: string) {
    const current = timelineRef.current;
    const next = updater(current);
    if (next === current) return;
    const now = Date.now();
    const last = lastMergeRef.current;
    const merge = Boolean(mergeKey && last && last.key === mergeKey && now - last.at < 1500 && historyRef.current.past.length);
    if (!merge) applyHistory(record(historyRef.current, current));
    lastMergeRef.current = mergeKey ? { key: mergeKey, at: now } : null;
    setTimelineNow(next);
  }

  function editClips(updater: (current: TimelineClip[]) => TimelineClip[], mergeKey?: string) {
    editTimeline((state) => {
      const next = updater(state.clips);
      return next === state.clips ? state : { ...state, clips: next };
    }, mergeKey);
  }

  function undoEdit() {
    const result = undo(historyRef.current, timelineRef.current);
    if (!result) { setNotice("Nada para desfazer."); return; }
    applyHistory(result.history);
    setTimelineNow(result.present);
    setNotice("Edição desfeita.");
  }

  function redoEdit() {
    const result = redo(historyRef.current, timelineRef.current);
    if (!result) { setNotice("Nada para refazer."); return; }
    applyHistory(result.history);
    setTimelineNow(result.present);
    setNotice("Edição refeita.");
  }

  function selectTimelineClip(clip: TimelineClip | null) {
    if (!clip) { setSelectedClipId(null); return; }
    setSelectedCaptionId(null);
    const item = mediaOf(clip.mediaId);
    if (!item) return;
    setSelectedId(item.id);
    setSelectedClipId(clip.id);
    setPreviewMode("program");
  }

  function addToTimeline(item: MediaItem) {
    const track = firstTrackFor(timelineRef.current.tracks, trackKindFor(item.kind));
    if (!track) { setNotice(`Todas as trilhas de ${item.kind === "audio" ? "áudio" : "vídeo"} estão travadas.`); return; }
    const knownDuration = sourceDurationOf(item);
    const duration = roundTime(knownDuration ?? DEFAULT_IMAGE_DURATION);
    const start = roundTime(trackEnd(timelineRef.current.clips, track.id));
    const clipId = crypto.randomUUID();
    editClips((current) => [...current, { id: clipId, mediaId: item.id, trackId: track.id, start, duration, inPoint: 0 }]);
    setSelectedClipId(clipId);
    setPreviewMode("program");
    setNotice(knownDuration
      ? `“${item.name}” foi colocado na timeline com a duração real: ${formatSeconds(duration)}s.`
      : `“${item.name}” foi colocado na timeline. Duração inicial: ${formatSeconds(duration)}s.`);
  }

  /** Muda posição/duração sem sobrescrever (aparas e o campo de duração já respeitam os vizinhos). */
  function updateClip(clipId: string, change: Partial<ClipGeometry>) {
    editClips((current) => {
      const target = current.find((clip) => clip.id === clipId);
      if (!target || isLocked(target.trackId)) return current;
      const merged = { ...target, ...change };
      if (merged.start === target.start && merged.duration === target.duration && merged.inPoint === target.inPoint) return current;
      return current.map((clip) => clip.id === clipId ? merged : clip);
    });
  }

  /** Volume e fades do clipe. Arrastar o volume vira um só passo de desfazer. */
  function updateClipAudio(clipId: string, change: ClipAudio) {
    editTimeline((state) => {
      const target = state.clips.find((clip) => clip.id === clipId);
      if (!target || isLocked(target.trackId)) return state;
      const next: TimelineClip = { ...target };
      if (change.volume !== undefined) next.volume = Math.round(Math.min(1, Math.max(0, change.volume)) * 100) / 100;
      if (change.fadeIn !== undefined) next.fadeIn = clampFade(target, "fadeIn", change.fadeIn);
      if (change.fadeOut !== undefined) next.fadeOut = clampFade(target, "fadeOut", change.fadeOut);
      if (next.volume === 1) delete next.volume;
      if (!next.fadeIn) delete next.fadeIn;
      if (!next.fadeOut) delete next.fadeOut;
      if (next.volume === target.volume && next.fadeIn === target.fadeIn && next.fadeOut === target.fadeOut) return state;
      return { ...state, clips: state.clips.map((clip) => clip.id === clipId ? next : clip) };
    }, change.volume !== undefined ? `volume:${clipId}` : undefined);
  }

  function setTrackVolume(trackId: string, volume: number) {
    const level = Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100;
    editTimeline((state) => {
      const track = state.tracks.find((entry) => entry.id === trackId);
      if (!track || (track.volume ?? 1) === level) return state;
      return { ...state, tracks: state.tracks.map((entry) => {
        if (entry.id !== trackId) return entry;
        const { volume: _old, ...rest } = entry;
        return level === 1 ? rest : { ...rest, volume: level };
      }) };
    }, `track-volume:${trackId}`);
    setNotice(`Volume da trilha: ${formatPercent(level)}.`);
  }

  /** Enquadramento e movimento do clipe. Arrastar a intensidade vira um só passo de desfazer. */
  function updateClipEffects(clipId: string, change: EffectsChange) {
    editClips((current) => {
      const target = current.find((clip) => clip.id === clipId);
      if (!target || isLocked(target.trackId)) return current;
      const next: TimelineClip = { ...target };
      if (change.fit !== undefined) { if (change.fit === "contain") delete next.fit; else next.fit = change.fit; }
      if (change.motion !== undefined) { if (change.motion) next.motion = change.motion; else delete next.motion; }
      if (JSON.stringify(next) === JSON.stringify(target)) return current;
      return current.map((clip) => clip.id === clipId ? next : clip);
    }, change.motion ? `motion:${clipId}:${change.motion.preset}` : undefined);
  }

  /** Aplica um movimento (ou alterna vários) em todas as imagens de trilhas destravadas, em ordem de tempo. */
  function applyMotionToAllImages({ choice, intensity, smooth, fit }: ApplyAllOptions) {
    const images = timelineRef.current.clips
      .filter((clip) => mediaOf(clip.mediaId)?.kind === "image" && !isLocked(clip.trackId))
      .sort((a, b) => a.start - b.start);
    if (!images.length) { setNotice("Não há imagens destravadas na timeline."); return; }
    const order = new Map(images.map((clip, index) => [clip.id, index]));
    editClips((current) => current.map((clip) => {
      const index = order.get(clip.id);
      if (index === undefined) return clip;
      const next: TimelineClip = { ...clip };
      const motion = makeMotion(presetForIndex(choice, index), intensity, smooth);
      if (motion) next.motion = motion; else delete next.motion;
      if (fit === "cover") next.fit = "cover";
      return next;
    }));
    const label = choice === "alternate" ? "movimentos alternados" : MOTION_PRESETS.find((entry) => entry.id === choice)?.label.toLowerCase();
    setNotice(`${images.length} imagem(ns) com ${label}. Ctrl+Z desfaz.`);
  }

  /** Coloca um clipe em [start, fim) de uma trilha, sobrescrevendo o que estiver embaixo. */
  function placeClip(current: TimelineClip[], clip: TimelineClip) {
    const others = current.filter((entry) => entry.id !== clip.id);
    const cleared = overwriteRange(others, clip.trackId, clip.start, clipEnd(clip), hasSource);
    const touched = others.filter((entry) => entry.trackId === clip.trackId && entry.start < clipEnd(clip) && clipEnd(entry) > clip.start).length;
    if (touched) setNotice(`${touched} clipe(s) sobrescrito(s) na trilha. Use Ctrl+Z para desfazer.`);
    return [...cleared, clip];
  }

  function moveClip(clipId: string, geometry: ClipGeometry, trackId: string) {
    editClips((current) => {
      const target = current.find((clip) => clip.id === clipId);
      if (!target || isLocked(target.trackId) || isLocked(trackId)) return current;
      const moved: TimelineClip = { ...target, ...geometry, trackId };
      if (moved.start === target.start && moved.duration === target.duration && moved.trackId === target.trackId) return current;
      return placeClip(current, moved);
    });
  }

  function removeClip(clipId: string) {
    const clip = timelineRef.current.clips.find((entry) => entry.id === clipId);
    if (!clip) return;
    if (isLocked(clip.trackId)) { setNotice("Esta trilha está travada. Destrave para remover o clipe."); return; }
    editClips((current) => current.filter((entry) => entry.id !== clipId));
    if (selectedClipId === clipId) setSelectedClipId(null);
  }

  /** Divide o clipe selecionado no playhead; sem seleção, divide todos os clipes sob o playhead (exceto em trilhas travadas). */
  function splitAtPlayhead() {
    const current = timelineRef.current.clips;
    const at = playheadRef.current;
    const selectedClip = current.find((clip) => clip.id === selectedClipId);
    const candidates = (selectedClip ? [selectedClip] : current.filter((clip) => clip.start < at && clipEnd(clip) > at))
      .filter((clip) => !isLocked(clip.trackId));
    const targets = new Set(candidates.map((clip) => clip.id));
    let splits = 0;
    const next = current.flatMap((clip) => {
      if (!targets.has(clip.id)) return [clip];
      const parts = splitClip(clip, at, crypto.randomUUID(), hasSource(clip));
      if (!parts) return [clip];
      splits++;
      return parts;
    });
    if (!splits) {
      setNotice(selectedClip ? "Posicione o playhead dentro do clipe selecionado (e destravado) para dividir." : "Não há clipe sob o playhead para dividir.");
      return;
    }
    editClips(() => next);
    setNotice(splits === 1 ? "Clipe dividido no playhead." : `${splits} clipes divididos no playhead.`);
  }

  /** Cria uma cópia do clipe selecionado no fim da trilha dele. */
  function duplicateSelected() {
    const clip = timelineRef.current.clips.find((entry) => entry.id === selectedClipId);
    if (!clip) { setNotice("Selecione um clipe para duplicar."); return; }
    if (isLocked(clip.trackId)) { setNotice("Esta trilha está travada."); return; }
    const copy: TimelineClip = { ...clip, id: crypto.randomUUID(), start: roundTime(trackEnd(timelineRef.current.clips, clip.trackId)) };
    editClips((current) => [...current, copy]);
    setSelectedClipId(copy.id);
    setNotice("Clipe duplicado no fim da trilha.");
  }

  function copySelected() {
    const clip = timelineRef.current.clips.find((entry) => entry.id === selectedClipId);
    if (!clip) { setNotice("Selecione um clipe para copiar."); return; }
    clipboardRef.current = clip;
    setNotice("Clipe copiado. Use Ctrl+V para colar no playhead.");
  }

  /** Cola no playhead, na trilha original (ou na primeira compatível), sobrescrevendo o que houver ali. */
  function pasteAtPlayhead() {
    const clip = clipboardRef.current;
    const item = clip ? mediaOf(clip.mediaId) : undefined;
    if (!clip || !item) { setNotice("Nada para colar."); return; }
    const { tracks: currentTracks } = timelineRef.current;
    const original = currentTracks.find((track) => track.id === clip.trackId && !track.locked);
    const track = original ?? firstTrackFor(currentTracks, trackKindFor(item.kind));
    if (!track) { setNotice("Não há trilha destravada para colar."); return; }
    const copy: TimelineClip = { ...clip, id: crypto.randomUUID(), trackId: track.id, start: roundTime(playheadRef.current) };
    editClips((current) => placeClip(current, copy));
    setSelectedClipId(copy.id);
  }

  function nudgeSelected(delta: number) {
    const clip = timelineRef.current.clips.find((entry) => entry.id === selectedClipId);
    if (!clip) return;
    const { minStart, maxEnd } = freeBounds(clip, timelineRef.current.clips);
    const start = Math.min(Math.max(clip.start + delta, minStart), maxEnd - clip.duration);
    updateClip(clip.id, { start: roundTime(Math.max(0, start)) });
  }

  // ---- Trilhas -------------------------------------------------------------------
  function addTrack(kind: TrackKind) {
    editTimeline((state) => ({ ...state, tracks: [...state.tracks, newTrack(kind)] }));
    setNotice(`Trilha de ${kind === "video" ? "vídeo" : "áudio"} adicionada.`);
  }

  function removeTrack(trackId: string) {
    editTimeline((state) => {
      const track = state.tracks.find((entry) => entry.id === trackId);
      const sameKind = state.tracks.filter((entry) => entry.kind === track?.kind).length;
      if (!track || sameKind <= 1 || state.clips.some((clip) => clip.trackId === trackId)) return state;
      return { ...state, tracks: state.tracks.filter((entry) => entry.id !== trackId) };
    });
  }

  function toggleTrack(trackId: string, flag: TrackFlag) {
    editTimeline((state) => ({ ...state, tracks: state.tracks.map((track) => track.id === trackId ? { ...track, [flag]: !track[flag] } : track) }));
  }

  // ---- Legendas -----------------------------------------------------------------
  function editCaptions(updater: (current: Caption[]) => Caption[], mergeKey?: string) {
    editTimeline((state) => {
      const next = updater(state.captions);
      return next === state.captions ? state : { ...state, captions: next };
    }, mergeKey);
  }

  function selectCaption(id: string | null) {
    setSelectedCaptionId(id);
    if (id) { setSelectedClipId(null); setPreviewMode("program"); }
  }

  /** Muda texto ou tempos de uma legenda (fim sempre depois do início). */
  function updateCaption(id: string, change: Partial<Caption>) {
    editCaptions((current) => {
      const target = current.find((caption) => caption.id === id);
      if (!target) return current;
      const next = { ...target, ...change, id };
      next.start = roundTime(Math.max(0, next.start));
      if (change.start !== undefined && change.end === undefined && next.end - next.start < 0.1) next.end = roundTime(next.start + (target.end - target.start));
      if (next.end - next.start < 0.1) { setNotice("O fim da legenda precisa ser depois do início."); return current; }
      next.end = roundTime(next.end);
      if (next.start === target.start && next.end === target.end && next.text === target.text) return current;
      return sortCaptions(current.map((caption) => caption.id === id ? next : caption));
    });
  }

  function addCaptionAt(at: number) {
    const caption = newCaptionAt(timelineRef.current.captions, at, crypto.randomUUID());
    if (!caption) { setNotice("Já existe uma legenda nesse ponto. Mova o playhead para um trecho vazio."); return; }
    editCaptions((current) => sortCaptions([...current, caption]));
    selectCaption(caption.id);
    setNotice("Legenda criada. Escreva o texto na barra acima da timeline.");
  }

  function removeCaption(id: string) {
    editCaptions((current) => current.filter((caption) => caption.id !== id));
    if (selectedCaptionId === id) setSelectedCaptionId(null);
    setNotice("Legenda removida. Ctrl+Z desfaz.");
  }

  function loadCaptionText(text: string, fileName: string) {
    const { captions: parsed, skipped, format } = parseCaptions(text);
    if (!parsed.length) { setNotice(`Nenhuma legenda válida em “${fileName}”.`); return; }
    const replaced = timelineRef.current.captions.length;
    editCaptions(() => parsed);
    setSelectedCaptionId(null);
    setPreviewMode("program");
    setNotice(`${parsed.length} legenda(s) importada(s) de “${fileName}” (${format.toUpperCase()})`
      + `${skipped ? `, ${skipped} bloco(s) inválido(s) ignorado(s)` : ""}${replaced ? `, substituindo ${replaced} anterior(es)` : ""}. Ctrl+Z desfaz.`);
  }

  async function importCaptions() {
    if (!inTauri()) { captionInputRef.current?.click(); return; }
    try {
      const path = await open({ multiple: false, title: "Importar legendas", filters: [{ name: "Legendas", extensions: ["srt", "vtt"] }] });
      if (!path || Array.isArray(path)) return;
      loadCaptionText(await invoke<string>("read_text_file", { path }), fileNameOf(path));
    } catch (error) { setNotice("Erro ao importar legendas: " + String(error)); }
  }

  async function exportCaptions(format: CaptionFormat) {
    const contents = formatCaptions(timelineRef.current.captions, format);
    const fileName = `${projectName.replace(/[^\p{L}\p{N}\-_ ]/gu, "_").trim() || "legendas"}.${format}`;
    if (!inTauri()) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    }
    try {
      const path = await save({ title: `Exportar legendas ${format.toUpperCase()}`, defaultPath: fileName,
        filters: [{ name: format === "srt" ? "SubRip" : "WebVTT", extensions: [format] }] });
      if (!path) return;
      const finalPath = path.toLowerCase().endsWith(`.${format}`) ? path : `${path}.${format}`;
      await invoke("write_text_file", { path: finalPath, contents });
      setNotice(`Legendas exportadas em: ${finalPath}`);
    } catch (error) { setNotice("Erro ao exportar legendas: " + String(error)); }
  }

  function shiftAllCaptions(delta: number) {
    editCaptions((current) => shiftCaptions(current, delta), "shift-captions");
    setNotice(`Legendas ${delta < 0 ? "adiantadas" : "atrasadas"} ${formatSeconds(Math.abs(delta))}s. Ctrl+Z desfaz.`);
  }

  function clearCaptions() {
    const count = timelineRef.current.captions.length;
    editCaptions(() => []);
    setSelectedCaptionId(null);
    setNotice(`${count} legenda(s) removida(s). Ctrl+Z desfaz.`);
  }

  // ---- Montagem automática -------------------------------------------------------
  /** Coloca a montagem planejada na timeline como um único passo de desfazer. */
  function applyAssembly(plan: AssemblyPlan, narration: MediaItem | null) {
    editTimeline((state) => {
      // Timeline vazia: usa V1/A1. Senão (ou se travadas): trilhas novas, sem tocar no que já existe.
      const reuse = state.clips.length === 0;
      let tracksNext = state.tracks;
      const pickTrack = (kind: TrackKind) => {
        const existing = reuse ? firstTrackFor(tracksNext, kind) : null;
        if (existing) return existing;
        const created = newTrack(kind);
        tracksNext = [...tracksNext, created];
        return created;
      };
      const videoTrack = pickTrack("video");
      const added: TimelineClip[] = plan.clips.map((clip) => ({
        id: crypto.randomUUID(), mediaId: clip.mediaId, trackId: videoTrack.id, start: clip.start, duration: clip.duration, inPoint: 0,
        ...(clip.speed && clip.speed !== 1 ? { speed: clip.speed } : {}),
      }));
      if (narration?.duration) {
        const audioTrack = pickTrack("audio");
        added.push({ id: crypto.randomUUID(), mediaId: narration.id, trackId: audioTrack.id, start: 0, duration: roundTime(narration.duration), inPoint: 0 });
      }
      return { ...state, tracks: tracksNext, clips: [...state.clips, ...added] };
    });
    setAssemblyOpen(false);
    setSelectedClipId(null);
    setPlaying(false);
    setPlayhead(0);
    setPreviewMode("program");
    const warnings = plan.issues.filter((issue) => issue.level === "warning").length;
    setNotice(`Montagem pronta: ${plan.clips.length} arquivo(s)${narration ? " sincronizados com a narração" : ""}`
      + `${plan.skipped.length ? `, ${plan.skipped.length} ignorado(s)` : ""}${warnings ? `, ${warnings} aviso(s)` : ""}. Ctrl+Z desfaz.`);
  }

  // ---- Atalhos de teclado --------------------------------------------------------
  function handleShortcut(event: KeyboardEvent) {
    if (assemblyOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const step = event.shiftKey ? 1 : 0.1;
    if (ctrl && key === "z" && !event.shiftKey) undoEdit();
    else if (ctrl && (key === "y" || (key === "z" && event.shiftKey))) redoEdit();
    else if (ctrl && key === "s") void saveProject();
    else if (ctrl && key === "d") duplicateSelected();
    else if (ctrl && key === "c") copySelected();
    else if (ctrl && key === "v") pasteAtPlayhead();
    else if (ctrl) return;
    else if (key === " ") togglePlay();
    else if (key === "delete" || key === "backspace") { if (selectedCaptionId) removeCaption(selectedCaptionId); else if (selectedClipId) removeClip(selectedClipId); }
    else if (key === "s") splitAtPlayhead();
    else if (key === "arrowleft" && event.altKey) nudgeSelected(-step);
    else if (key === "arrowright" && event.altKey) nudgeSelected(step);
    else if (key === "arrowleft") movePlayhead(roundTime(Math.max(0, playheadRef.current - step)));
    else if (key === "arrowright") movePlayhead(roundTime(playheadRef.current + step));
    else if (key === "home") movePlayhead(0);
    else if (key === "end") movePlayhead(roundTime(timelineEndOf(timelineRef.current)));
    else if (key === "escape") { setSelectedClipId(null); setSelectedCaptionId(null); }
    else return;
    event.preventDefault();
  }

  // Um único listener; ele sempre chama a versão mais recente do handler.
  const shortcutRef = useRef(handleShortcut);
  shortcutRef.current = handleShortcut;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // ---- Projeto -------------------------------------------------------------------
  function createProjectSnapshot() {
    return {
      format: "sveproj", schemaVersion: 1, projectName, ratio,
      media: media.map(({ id, name, kind, size, path, duration }) => ({ id, name, kind, size, path, duration: duration ?? null })),
      tracks, clips, captions, captionStyle, note: "Projeto com caminhos absolutos para mídia. Se arquivos forem movidos, use Relinkar na biblioteca.",
    };
  }

  async function writeProject(path: string) {
    const projectFilePath = path.toLowerCase().endsWith(".sveproj") ? path : `${path}.sveproj`;
    await invoke("save_project_file", {
      path: projectFilePath,
      contents: JSON.stringify(createProjectSnapshot(), null, 2),
    });
    setProjectPath(projectFilePath);
    setNotice(`Projeto salvo com sucesso em: ${projectFilePath}`);
  }

  async function saveProjectAs() {
    try {
      const suggestedName = `${projectName.replace(/[^a-z0-9-_]/gi, "_") || "projeto"}.sveproj`;
      const path = await save({
        title: "Salvar projeto como",
        defaultPath: projectPath ?? suggestedName,
        filters: [{ name: "Projeto Social Video Editor", extensions: ["sveproj"] }],
      });
      if (!path) {
        setNotice("Salvamento cancelado.");
        return;
      }
      await writeProject(path);
    } catch (error) {
      setNotice(`Não foi possível salvar o projeto: ${String(error)}`);
    }
  }

  async function saveProject() {
    if (!projectPath) {
      await saveProjectAs();
      return;
    }
    try {
      await writeProject(projectPath);
    } catch (error) {
      setNotice(`Não foi possível salvar o projeto: ${String(error)}`);
    }
  }

  async function openProject() {
    try {
      const path = await open({
        multiple: false,
        title: "Abrir projeto",
        filters: [{ name: "Projeto Social Video Editor", extensions: ["sveproj"] }],
      });
      if (!path || Array.isArray(path)) return;

      const contents = await invoke<string>("read_project_file", { path });
      const data = JSON.parse(contents);
      if (data.format !== "sveproj" || data.schemaVersion !== 1) {
        throw new Error("Formato ou versão não reconhecida.");
      }
      setProjectName(typeof data.projectName === "string" ? data.projectName : "Projeto importado");
      setRatio(typeof data.ratio === "string" ? data.ratio : "9:16");
      const savedMedia: any[] = Array.isArray(data.media) ? data.media : [];
      const mediaPaths: string[] = savedMedia.map((item) => typeof item?.path === "string" ? item.path : "");
      const fileInfos = await invoke<FileInfo[]>("media_file_info", { paths: mediaPaths });
      const validKinds: MediaKind[] = ["video", "image", "audio"];
      const restoredMedia: MediaItem[] = savedMedia.map((item, index): MediaItem => {
        const mediaPath = mediaPaths[index];
        const exists = Boolean(mediaPath && fileInfos[index]?.exists);
        const savedDuration = Number(item?.duration);
        return { id: String(item?.id || crypto.randomUUID()), file: null, path: mediaPath || null,
          url: exists ? convertFileSrc(mediaPath) : "", name: String(item?.name || "Mídia"),
          kind: validKinds.includes(item?.kind) ? item.kind : "other", size: fileInfos[index]?.size ?? Number(item?.size ?? 0), missing: !exists,
          duration: Number.isFinite(savedDuration) && savedDuration > 0 ? savedDuration : null };
      }).filter((item) => item.kind !== "other");

      // Trilhas: projetos antigos não têm; garante pelo menos uma de vídeo e uma de áudio.
      const savedTracks: any[] = Array.isArray(data.tracks) ? data.tracks : [];
      const restoredTracks: Track[] = savedTracks
        .filter((track) => typeof track?.id === "string" && (track.kind === "video" || track.kind === "audio"))
        .map((track): Track => {
          const volume = Number(track.volume);
          return { id: track.id, kind: track.kind, hidden: Boolean(track.hidden), muted: Boolean(track.muted), locked: Boolean(track.locked),
            ...(Number.isFinite(volume) && volume >= 0 && volume < 1 ? { volume } : {}) };
        });
      if (!restoredTracks.some((track) => track.kind === "video")) restoredTracks.unshift(newTrack("video"));
      if (!restoredTracks.some((track) => track.kind === "audio")) restoredTracks.push(newTrack("audio"));

      // Só restaura clipes bem formados que apontam para mídia da biblioteca; trilha ausente ou incompatível → primeira compatível.
      const mediaById = new Map(restoredMedia.map((item) => [item.id, item]));
      const savedClips: any[] = Array.isArray(data.clips) ? data.clips : [];
      const restoredClips = savedClips.flatMap((clip): TimelineClip[] => {
        const start = Number(clip?.start), duration = Number(clip?.duration), inPoint = Number(clip?.inPoint ?? 0);
        const speed = Number(clip?.speed ?? 1);
        const volume = Number(clip?.volume ?? 1), fadeIn = Number(clip?.fadeIn ?? 0), fadeOut = Number(clip?.fadeOut ?? 0);
        const item = typeof clip?.mediaId === "string" ? mediaById.get(clip.mediaId) : undefined;
        if (!item || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
        const kind = trackKindFor(item.kind);
        const track = restoredTracks.find((entry) => entry.id === clip.trackId && entry.kind === kind)
          ?? restoredTracks.find((entry) => entry.kind === kind)!;
        return [{ id: typeof clip.id === "string" ? clip.id : crypto.randomUUID(), mediaId: item.id, trackId: track.id,
          start: Math.max(0, start), duration, inPoint: Number.isFinite(inPoint) ? Math.max(0, inPoint) : 0,
          ...(Number.isFinite(speed) && speed > 0 && speed !== 1 ? { speed } : {}),
          ...(Number.isFinite(volume) && volume >= 0 && volume < 1 ? { volume } : {}),
          ...(Number.isFinite(fadeIn) && fadeIn > 0 ? { fadeIn } : {}),
          ...(Number.isFinite(fadeOut) && fadeOut > 0 ? { fadeOut } : {}),
          ...(clip.fit === "cover" ? { fit: "cover" as const } : {}),
          ...(validMotion(clip.motion) ? { motion: validMotion(clip.motion)! } : {}) }];
      });
      setMedia(restoredMedia);
      setSelectedId(restoredMedia.find((item) => !item.missing)?.id ?? restoredMedia[0]?.id ?? null);
      const savedCaptions: any[] = Array.isArray(data.captions) ? data.captions : [];
      const restoredCaptions: Caption[] = sortCaptions(savedCaptions.flatMap((caption): Caption[] => {
        const start = Number(caption?.start), end = Number(caption?.end);
        const text = typeof caption?.text === "string" ? caption.text.trim() : "";
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text) return [];
        return [{ id: typeof caption.id === "string" ? caption.id : crypto.randomUUID(), start, end, text }];
      }));
      const savedStyle = data.captionStyle ?? {};
      const size = Number(savedStyle.size);
      setCaptionStyle({
        visible: savedStyle.visible !== false,
        size: Number.isFinite(size) && size >= 2 && size <= 12 ? size : DEFAULT_CAPTION_STYLE.size,
        position: ["bottom", "middle", "top"].includes(savedStyle.position) ? savedStyle.position : DEFAULT_CAPTION_STYLE.position,
        background: Boolean(savedStyle.background),
      });
      setTimelineNow({ tracks: restoredTracks, clips: restoredClips, captions: restoredCaptions });
      setSelectedCaptionId(null);
      applyHistory(emptyHistory());
      clipboardRef.current = null;
      setSelectedClipId(null);
      setPlaying(false);
      setPlayhead(0);
      setPreviewMode("program");
      setProjectPath(path);
      void loadMediaDurations(restoredMedia.filter((item) => !item.missing && !item.duration));
      const missingCount = restoredMedia.filter((item) => item.missing).length;
      setNotice(missingCount ? `Projeto aberto, ${missingCount} mídia(s) ausente(s). Use Relinkar.` : "Projeto aberto com biblioteca e timeline restauradas.");
    } catch (error) {
      setNotice(`Não foi possível abrir o projeto: ${String(error)}`);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Clapperboard size={21} /></div>
          <div><strong>social<span>video</span></strong><small>EDITOR <i>BY SOCIAL NEXUS</i></small></div>
        </div>
        <div className="project-title">
          <input aria-label="Nome do projeto" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          <span className="saved-dot" title="Projeto local"></span>
        </div>
        <div className="top-actions">
          <button className="button secondary" onClick={openProject}><FolderOpen size={16} /> Abrir</button>
          <button className="button primary" onClick={saveProject}><Save size={16} /> Salvar</button>
          <button className="button secondary" onClick={saveProjectAs}>Salvar como</button>
          <button className="icon-button" title="Configurações" onClick={() => setNotice("As configurações serão implementadas nas próximas etapas.")}><Settings2 size={18} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="media-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">SEU PROJETO</span><h2>Biblioteca</h2></div>
            <button className="icon-button small" title="Importar mídia do computador" onClick={importMediaFromDisk}><Plus size={18} /></button>
          </div>
          <button className="import-drop" onClick={importMediaFromDisk}>
            <div className="upload-icon"><Import size={20} /></div>
            <strong>Importar arquivos</strong>
            <span>Vídeos, imagens e áudios</span>
            <small>Selecione vários arquivos de uma vez</small>
          </button>
          <div className="library-actions">
            <button className="button secondary compact" onClick={importFolder} title="Importa todos os arquivos de mídia de uma pasta"><FolderInput size={14} /> Importar pasta</button>
            <button className="button secondary compact" onClick={() => setAssemblyOpen(true)} disabled={!media.length} title="Monta a sequência pelos tempos nos nomes dos arquivos"><WandSparkles size={14} /> Montagem automática</button>
          </div>
          <input ref={inputRef} hidden type="file" multiple accept="video/*,image/*,audio/*" onChange={(event) => event.target.files && importFiles(event.target.files)} />
          <div className="media-stats">
            <span><Video size={13} /> {mediaCount.video}</span><span><ImageIcon size={13} /> {mediaCount.image}</span><span><Music2 size={13} /> {mediaCount.audio}</span>
          </div>
          <div className="asset-list">
            {media.length === 0 ? <div className="empty-library"><FolderPlus size={25} /><strong>Sua biblioteca está vazia</strong><span>Importe arquivos para começar a montar seu vídeo.</span></div> :
              media.map((item) => <div key={item.id} className={`asset-row ${selectedId === item.id ? "selected" : ""}`}>
                <button className="asset-main" onClick={() => selectLibraryItem(item)}>
                  <div className="asset-thumb">
                    {item.kind === "image" ? <img src={item.url} /> : item.kind === "video" ? <Video size={18} /> : <AudioLines size={18} />}
                  </div>
                  <div className="asset-info"><strong title={item.name}>{item.name}</strong><span>{item.kind.toUpperCase()} · {formatSize(item.size)}</span></div>
                </button>
                <button className="asset-add" title="Adicionar à timeline" onClick={() => addToTimeline(item)}><Plus size={15} /></button>{item.missing && <button className="asset-add" title="Relinkar arquivo" onClick={() => relinkMedia(item)}><FolderOpen size={14} /></button>}
                <button className="asset-remove" title="Remover" onClick={() => removeMedia(item)}><X size={14} /></button>
              </div>)
            }
          </div>
          <div className="panel-foot"><Layers3 size={14} /> {media.length} itens na biblioteca</div>
        </aside>

        <section className="center-column">
          <div className="preview-panel panel">
            <div className="panel-heading preview-heading">
              <div><span className="eyebrow">MONITOR DE VÍDEO</span><h2>Pré-visualização</h2></div>
              <div className="preview-tools">
                <div className="segmented" role="tablist" aria-label="O que o preview mostra">
                  <button role="tab" aria-selected={previewMode === "program"} className={previewMode === "program" ? "active" : ""}
                    onClick={() => setPreviewMode("program")} title="Mostra a montagem da timeline no playhead">Timeline</button>
                  <button role="tab" aria-selected={previewMode === "source"} className={previewMode === "source" ? "active" : ""}
                    onClick={() => { setPlaying(false); setPreviewMode("source"); }} disabled={!selected} title="Mostra a mídia selecionada na biblioteca">Mídia</button>
                </div>
                <button className="icon-button small" title="Ajustes do preview" onClick={() => setNotice("Ajustes de preview serão adicionados.")}><Settings2 size={16} /></button>
              </div>
            </div>
            <div className="preview-stage">
              <div className={`preview-canvas ratio-${ratio.replace(":", "-")}`}>
                {previewMode === "program"
                  ? <><ProgramMonitor media={media} tracks={tracks} clips={clips} playhead={playhead} playing={playing} />
                    <CaptionOverlay captions={captions} playhead={playhead} style={captionStyle} /></>
                  : !selected ? <div className="preview-empty"><div className="preview-logo"><MonitorPlay size={31} /></div><strong>Seu vídeo começa aqui</strong><span>Selecione um arquivo na biblioteca para visualizar.</span></div> :
                  selected.kind === "image" ? <img className="preview-media" src={selected.url} /> :
                  selected.kind === "video" ? <video key={selected.id} ref={previewVideoRef} className="preview-media" src={selected.url} controls onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onPlay={() => setPreviewPlaying(true)} onPause={() => setPreviewPlaying(false)} onLoadedMetadata={(event) => setPreviewDuration(event.currentTarget.duration || 0)} onDurationChange={(event) => setPreviewDuration(event.currentTarget.duration || 0)} /> :
                  <div className="audio-preview"><AudioLines size={44} /><strong>{selected.name}</strong><audio src={selected.url} controls /></div>}
              </div>
            </div>
            {previewMode === "program"
              ? <div className="preview-transport">
                  <button className="button secondary compact" onClick={togglePlay} disabled={!timelineEnd} title="Reproduzir / pausar (Espaço)">
                    {playing ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Reproduzir</>}
                  </button>
                  <span className="preview-time">{formatTimecode(playhead)} / {formatTimecode(timelineEnd)}</span>
                  <input aria-label="Posição na timeline" type="range" min={0} max={Math.max(0, timelineEnd)} step={0.01} value={Math.min(playhead, timelineEnd)}
                    onChange={(event) => movePlayhead(Number(event.target.value))} disabled={!timelineEnd} />
                </div>
              : <div className="preview-transport"><button className="button secondary compact" onClick={togglePreviewPlayback} disabled={selected?.kind !== "video"}>{previewPlaying ? "⏸ Pausar" : "▶ Reproduzir"}</button><span className="preview-time">{previewTime.toFixed(1)}s / {previewDuration.toFixed(1)}s</span><input aria-label="Posição do vídeo" type="range" min={0} max={Math.max(0, previewDuration)} step={0.1} value={Math.min(previewTime, previewDuration)} onChange={(event) => seekPreview(Number(event.target.value))} disabled={selected?.kind !== "video" || !previewDuration} /></div>}
            <div className="preview-bottom"><span>{previewMode === "program" ? "Montagem da timeline" : selected ? selected.name : "Nenhuma mídia selecionada"}</span><span>Proporção <b>{ratio}</b></span></div>
          </div>

          <Timeline
            media={media}
            tracks={tracks}
            clips={clips}
            captions={captions}
            selectedCaptionId={selectedCaptionId}
            captionsVisible={captionStyle.visible}
            onSelectCaption={selectCaption}
            onUpdateCaption={updateCaption}
            onAddCaption={addCaptionAt}
            onRemoveCaption={removeCaption}
            onToggleCaptions={() => setCaptionStyle((style) => ({ ...style, visible: !style.visible }))}
            selectedClipId={selectedClipId}
            playhead={playhead}
            ratio={ratio}
            canAddClip={Boolean(selected)}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undoEdit}
            onRedo={redoEdit}
            onSplit={splitAtPlayhead}
            onDuplicate={duplicateSelected}
            onRatioChange={setRatio}
            onAddClip={() => selected && addToTimeline(selected)}
            onSelectClip={selectTimelineClip}
            onUpdateClip={updateClip}
            onUpdateClipAudio={updateClipAudio}
            onSetTrackVolume={setTrackVolume}
            onMoveClip={moveClip}
            onRemoveClip={removeClip}
            onPlayheadChange={movePlayhead}
            onNotice={setNotice}
            onAddTrack={addTrack}
            onRemoveTrack={removeTrack}
            onToggleTrack={toggleTrack}
          />
        </section>

        <aside className="properties-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">AJUSTES</span><h2>Propriedades</h2></div><Settings2 size={17} className="muted-icon" /></div>
          {selected ? <div className="properties-content">
            <div className="property-preview">{selected.kind === "image" ? <img src={selected.url} /> : selected.kind === "video" ? <Video size={27} /> : <Music2 size={27} />}</div>
            <span className="eyebrow">ARQUIVO SELECIONADO</span><h3>{selected.name}</h3>
            <div className="property-line"><span>Tipo</span><b>{selected.kind}</b></div>
            <div className="property-line"><span>Tamanho</span><b>{formatSize(selected.size)}</b></div>
            {selected.duration ? <div className="property-line"><span>Duração</span><b>{formatSeconds(selected.duration)}s</b></div> : null}
            <div className="property-line"><span>Formato do projeto</span><b>{ratio}</b></div>
            <button className="button primary full" onClick={() => addToTimeline(selected)}><Plus size={15} /> Adicionar à timeline</button>
          </div> : <div className="properties-empty"><WandSparkles size={25} /><strong>Nada selecionado</strong><span>Escolha um arquivo para ver suas propriedades e opções.</span></div>}
          {selectedClip && mediaOf(selectedClip.mediaId)?.kind !== "audio" && <EffectsPanel clip={selectedClip} locked={isLocked(selectedClip.trackId)}
            imageClipCount={clips.filter((clip) => mediaOf(clip.mediaId)?.kind === "image").length}
            onChange={updateClipEffects} onApplyAll={applyMotionToAllImages} />}
          <CaptionsPanel captions={captions} style={captionStyle} onImport={importCaptions} onExport={exportCaptions} onShift={shiftAllCaptions}
            onClear={clearCaptions} onStyleChange={(change) => setCaptionStyle((style) => ({ ...style, ...change }))} />
          <input ref={captionInputRef} hidden type="file" accept=".srt,.vtt" onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) loadCaptionText(await file.text(), file.name);
          }} />
          <div className="tools-card"><div className="tools-title"><Sparkles size={15} /> Ferramentas planejadas</div><div className="tool-row"><span>Transições</span><small>Em breve</small></div><div className="tool-row"><span>Correção de cor</span><small>Em breve</small></div><div className="tool-row"><span>Mixagem de áudio</span><small>Em breve</small></div></div>
        </aside>
      </main>
      <footer className="statusbar"><span><i className="status-dot" /> {notice}</span><span>Social Video Editor · v{appVersion} · Projeto local</span></footer>
      {assemblyOpen && <AssemblyDialog media={media} timelineHasClips={clips.length > 0} onClose={() => setAssemblyOpen(false)} onApply={applyAssembly} />}
    </div>
  );
}
