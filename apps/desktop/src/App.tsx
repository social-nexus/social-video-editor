import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AudioLines, Clapperboard, Film, FolderOpen, FolderPlus, Image as ImageIcon,
  Import, Layers3, Music2, Plus, Save, Scissors, Settings2, Sparkles,
  Video, WandSparkles, X, ChevronDown, MonitorPlay
} from "lucide-react";

type MediaKind = "video" | "image" | "audio" | "other";
type MediaItem = {
  id: string; file: File | null; path: string | null; url: string; name: string; kind: MediaKind; size: number;
  missing?: boolean;
  /** Duração real em segundos (vídeo/áudio). null/undefined = desconhecida ou imagem. */
  duration?: number | null;
};
type TimelineClip = { id: string; mediaId: string; start: number; duration: number };

const PX_PER_SECOND = 42;
const MIN_CLIP_DURATION = 0.1;
const DEFAULT_IMAGE_DURATION = 5;
const NARROW_CLIP_PX = 48;

const roundTime = (value: number) => Math.round(value * 1000) / 1000;
const formatSeconds = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const parseSeconds = (text: string) => Number(text.trim().replace(",", "."));

/** Lê a duração de um vídeo/áudio pelos metadados do próprio elemento de mídia. */
function probeMediaDuration(url: string, kind: MediaKind): Promise<number | null> {
  if ((kind !== "video" && kind !== "audio") || !url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      element.removeAttribute("src");
      element.load();
      resolve(value);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 10000);
    element.src = url;
  });
}

const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function kindOf(file: File): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "other";
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [ratio, setRatio] = useState("9:16");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [notice, setNotice] = useState("Seu espaço de edição está pronto.");
  const [durationDraft, setDurationDraft] = useState("");

  useEffect(() => {
    invoke<string>("app_version").then(setAppVersion).catch(() => undefined);
  }, []);

  const selected = media.find((item) => item.id === selectedId) ?? null;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedClipMedia = selectedClip ? media.find((item) => item.id === selectedClip.mediaId) ?? null : null;
  const totalDuration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  const timelineWidth = Math.max(760, totalDuration * PX_PER_SECOND + 120);

  // Mantém o campo de duração em sincronia com o clipe selecionado.
  useEffect(() => {
    setDurationDraft(selectedClip ? formatSeconds(selectedClip.duration) : "");
  }, [selectedClip?.id, selectedClip?.duration]);
  const mediaCount = useMemo(() => ({
    video: media.filter((item) => item.kind === "video").length,
    image: media.filter((item) => item.kind === "image").length,
    audio: media.filter((item) => item.kind === "audio").length,
  }), [media]);

  function importFiles(files: FileList | File[]) {
    const additions = Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file, path: null, url: URL.createObjectURL(file),
      name: file.name, kind: kindOf(file), size: file.size,
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


  async function importMediaFromDisk() {
    try {
      const paths = await open({ multiple: true, title: "Importar mídia", filters: [{ name: "Mídia", extensions: ["mp4","mov","mkv","webm","avi","m4v","jpg","jpeg","png","webp","gif","bmp","mp3","wav","m4a","aac","flac","ogg"] }] });
      if (!paths || typeof paths === "string") return;
      const info = await invoke<{ exists: boolean; size: number }[]>("media_file_info", { paths });
      const additions = paths.map((mediaPath, index) => {
        const name = mediaPath.split(/[\\/]/).pop() || mediaPath;
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const kind: MediaKind = ["mp4","mov","mkv","webm","avi","m4v"].includes(ext) ? "video" : ["jpg","jpeg","png","webp","gif","bmp"].includes(ext) ? "image" : ["mp3","wav","m4a","aac","flac","ogg"].includes(ext) ? "audio" : "other";
        return { id: crypto.randomUUID(), file: null, path: mediaPath, url: convertFileSrc(mediaPath), name, kind, size: info[index]?.size ?? 0, missing: !info[index]?.exists, duration: null };
      }).filter(item => item.kind !== "other");
      if (!additions.length) { setNotice("Nenhum arquivo de mídia compatível selecionado."); return; }
      setMedia(current => [...current, ...additions]);
      setSelectedId(current => current ?? additions[0].id);
      setNotice(additions.length + " arquivo(s) importado(s) com caminho vinculado.");
      void loadMediaDurations(additions);
    } catch (error) { setNotice("Erro ao importar mídia: " + String(error)); }
  }

  async function relinkMedia(item: MediaItem) {
    try {
      const selectedPath = await open({ multiple: false, title: "Localizar arquivo: " + item.name });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      const info = await invoke<{ exists: boolean; size: number }[]>("media_file_info", { paths: [selectedPath] });
      if (!info[0]?.exists) { setNotice("O arquivo selecionado não foi encontrado."); return; }
      const relinked: MediaItem = { ...item, file: null, path: selectedPath, url: convertFileSrc(selectedPath), name: selectedPath.split(/[\\/]/).pop() || item.name, size: info[0].size, missing: false };
      setMedia(current => current.map(entry => entry.id === item.id ? relinked : entry));
      setNotice("Arquivo relinkado com sucesso.");
      void loadMediaDurations([relinked]);
    } catch (error) { setNotice("Não foi possível relinkar: " + String(error)); }
  }

  function selectTimelineClip(clip: TimelineClip) {
    const item = media.find((entry) => entry.id === clip.mediaId);
    if (!item) return;
    setSelectedId(item.id);
    setSelectedClipId(clip.id);
    setPreviewTime(0);
    setNotice(`Preview sincronizado com o clipe: ${item.name}`);
  }

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

  const isAudioClip = (clip: TimelineClip) => media.find((item) => item.id === clip.mediaId)?.kind === "audio";

  /** Limite máximo de duração de um clipe: a duração real da mídia (vídeo/áudio) ou sem limite (imagem). */
  function maxClipDuration(mediaId: string) {
    const item = media.find((entry) => entry.id === mediaId);
    return item && item.kind !== "image" && item.duration ? item.duration : Infinity;
  }

  function clampClipDuration(mediaId: string, value: number) {
    return roundTime(Math.min(maxClipDuration(mediaId), Math.max(MIN_CLIP_DURATION, value)));
  }

  function addToTimeline(item: MediaItem) {
    const knownDuration = item.kind !== "image" && item.duration ? item.duration : null;
    const duration = roundTime(knownDuration ?? DEFAULT_IMAGE_DURATION);
    // Cada trilha (V1 / A1) cresce de forma independente.
    const toAudioLane = item.kind === "audio";
    const start = clips.filter((clip) => isAudioClip(clip) === toAudioLane).reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    const clipId = crypto.randomUUID();
    setClips((current) => [...current, { id: clipId, mediaId: item.id, start: roundTime(start), duration }]);
    setSelectedClipId(clipId);
    setNotice(knownDuration
      ? `“${item.name}” foi colocado na timeline com a duração real: ${formatSeconds(duration)}s.`
      : `“${item.name}” foi colocado na timeline. Duração inicial: ${formatSeconds(duration)}s.`);
  }

  function adjustSelectedClip(change: Partial<Pick<TimelineClip, "start" | "duration">>) {
    if (!selectedClip) return;
    const start = roundTime(Math.max(0, change.start ?? selectedClip.start));
    const duration = clampClipDuration(selectedClip.mediaId, change.duration ?? selectedClip.duration);
    setClips((current) => current.map((clip) => clip.id === selectedClip.id ? { ...clip, start, duration } : clip));
  }

  function commitDurationDraft() {
    if (!selectedClip) return;
    const value = parseSeconds(durationDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setDurationDraft(formatSeconds(selectedClip.duration));
      setNotice("Duração inválida. Digite um número em segundos, por exemplo 8 ou 2,5.");
      return;
    }
    const duration = clampClipDuration(selectedClip.mediaId, value);
    adjustSelectedClip({ duration });
    setDurationDraft(formatSeconds(duration));
    if (duration < value) setNotice(`A mídia tem só ${formatSeconds(duration)}s. A duração foi limitada a esse valor.`);
  }

  function removeClip(clipId: string) {
    setClips((current) => current.filter((entry) => entry.id !== clipId));
    if (selectedClipId === clipId) setSelectedClipId(null);
  }

  function removeMedia(item: MediaItem) {
    if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
    setMedia((current) => current.filter((entry) => entry.id !== item.id));
    setClips((current) => current.filter((clip) => clip.mediaId !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    if (selectedClip?.mediaId === item.id) setSelectedClipId(null);
    setNotice("Arquivo removido da biblioteca e da timeline.");
  }

  function renderClip(clip: TimelineClip) {
    const item = media.find((entry) => entry.id === clip.mediaId);
    const audio = item?.kind === "audio";
    const width = Math.max(4, clip.duration * PX_PER_SECOND);
    const narrow = width < NARROW_CLIP_PX;
    const classes = ["timeline-clip", audio ? "audio-clip" : "video-clip", selectedClipId === clip.id ? "selected" : "", narrow ? "narrow" : ""].join(" ");
    return <div key={clip.id} className={classes} onClick={() => selectTimelineClip(clip)} style={{ left: clip.start * PX_PER_SECOND, width }} title={`${item?.name ?? "Mídia não vinculada"} · ${formatSeconds(clip.duration)}s`}>
      {!narrow && (audio ? <AudioLines size={13} /> : <Film size={13} />)}
      {!narrow && <span>{item?.name ?? (audio ? "Áudio" : "Mídia não vinculada")}</span>}
      {!narrow && <button title="Remover clipe" onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }}><X size={12} /></button>}
    </div>;
  }

  function createProjectSnapshot() {
    return {
      format: "sveproj", schemaVersion: 1, projectName, ratio,
      media: media.map(({ id, name, kind, size, path, duration }) => ({ id, name, kind, size, path, duration: duration ?? null })),
      clips, note: "Projeto com caminhos absolutos para mídia. Se arquivos forem movidos, use Relinkar na biblioteca.",
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
      const savedMedia = Array.isArray(data.media) ? data.media : [];
      const mediaPaths = savedMedia.map((item: any) => typeof item.path === "string" ? item.path : "");
      const fileInfos = await invoke<{ exists: boolean; size: number }[]>("media_file_info", { paths: mediaPaths });
      const validKinds: MediaKind[] = ["video", "image", "audio"];
      const restoredMedia: MediaItem[] = savedMedia.map((item: any, index: number): MediaItem => {
        const mediaPath = mediaPaths[index];
        const exists = Boolean(mediaPath && fileInfos[index]?.exists);
        const savedDuration = Number(item.duration);
        return { id: String(item.id || crypto.randomUUID()), file: null, path: mediaPath || null,
          url: exists ? convertFileSrc(mediaPath) : "", name: String(item.name || "Mídia"),
          kind: validKinds.includes(item.kind) ? item.kind : "other", size: fileInfos[index]?.size ?? Number(item.size ?? 0), missing: !exists,
          duration: Number.isFinite(savedDuration) && savedDuration > 0 ? savedDuration : null };
      }).filter((item: MediaItem) => item.kind !== "other");
      // Só restaura clipes bem formados que apontam para mídia da biblioteca.
      const mediaIds = new Set(restoredMedia.map((item) => item.id));
      const savedClips: unknown[] = Array.isArray(data.clips) ? data.clips : [];
      const restoredClips = savedClips.flatMap((clip: any): TimelineClip[] => {
        const start = Number(clip?.start), duration = Number(clip?.duration);
        if (typeof clip?.mediaId !== "string" || !mediaIds.has(clip.mediaId) || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
        return [{ id: typeof clip.id === "string" ? clip.id : crypto.randomUUID(), mediaId: clip.mediaId, start: Math.max(0, start), duration }];
      });
      setMedia(restoredMedia);
      setSelectedId(restoredMedia.find((item) => !item.missing)?.id ?? restoredMedia[0]?.id ?? null);
      setClips(restoredClips);
      setSelectedClipId(null);
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
          <input ref={inputRef} hidden type="file" multiple accept="video/*,image/*,audio/*" onChange={(event) => event.target.files && importFiles(event.target.files)} />
          <div className="media-stats">
            <span><Video size={13} /> {mediaCount.video}</span><span><ImageIcon size={13} /> {mediaCount.image}</span><span><Music2 size={13} /> {mediaCount.audio}</span>
          </div>
          <div className="asset-list">
            {media.length === 0 ? <div className="empty-library"><FolderPlus size={25} /><strong>Sua biblioteca está vazia</strong><span>Importe arquivos para começar a montar seu vídeo.</span></div> :
              media.map((item) => <div key={item.id} className={`asset-row ${selectedId === item.id ? "selected" : ""}`}>
                <button className="asset-main" onClick={() => { setSelectedId(item.id); }}>
                  <div className="asset-thumb">
                    {item.kind === "image" ? <img src={item.url} /> : item.kind === "video" ? <Video size={18} /> : <AudioLines size={18} />}
                  </div>
                  <div className="asset-info"><strong title={item.name}>{item.name}</strong><span>{item.kind.toUpperCase()} · {formatSize(item.size)}</span></div>
                </button>
                <button className="asset-add" title="Adicionar à timeline" onClick={() => addToTimeline(item)}><Plus size={15} /></button>{item.missing &&<button className="asset-add" title="Relinkar arquivo" onClick={() => relinkMedia(item)}><FolderOpen size={14} /></button>}
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
              <div className="preview-tools"><span className="live-indicator">LOCAL</span><button className="icon-button small" title="Ajustes do preview" onClick={() => setNotice("Ajustes de preview serão adicionados.")}><Settings2 size={16} /></button></div>
            </div>
            <div className="preview-stage">
              <div className={`preview-canvas ratio-${ratio.replace(":", "-")}`}>
                {!selected ? <div className="preview-empty"><div className="preview-logo"><MonitorPlay size={31} /></div><strong>Seu vídeo começa aqui</strong><span>Selecione um arquivo na biblioteca para visualizar.</span></div> :
                  selected.kind === "image" ? <img className="preview-media" src={selected.url} /> :
                  selected.kind === "video" ? <video key={selected.id} ref={previewVideoRef} className="preview-media" src={selected.url} controls onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onPlay={() => setPreviewPlaying(true)} onPause={() => setPreviewPlaying(false)} onLoadedMetadata={(event) => setPreviewDuration(event.currentTarget.duration || 0)} onDurationChange={(event) => setPreviewDuration(event.currentTarget.duration || 0)} /> :
                  <div className="audio-preview"><AudioLines size={44} /><strong>{selected.name}</strong><audio src={selected.url} controls /></div>}
              </div>
            </div>
            <div className="preview-transport"><button className="button secondary compact" onClick={togglePreviewPlayback} disabled={selected?.kind !== "video"}>{previewPlaying ? "⏸ Pausar" : "▶ Reproduzir"}</button><span className="preview-time">{previewTime.toFixed(1)}s / {previewDuration.toFixed(1)}s</span><input aria-label="Posição do vídeo" type="range" min={0} max={Math.max(0, previewDuration)} step={0.1} value={Math.min(previewTime, previewDuration)} onChange={(event) => seekPreview(Number(event.target.value))} disabled={selected?.kind !== "video" || !previewDuration} /></div>
            <div className="preview-bottom"><span>{selected ? selected.name : "Nenhuma mídia selecionada"}</span><span>Proporção <b>{ratio}</b></span></div>
          </div>

          <div className="timeline-panel panel">
            <div className="timeline-toolbar">
              <div><span className="eyebrow">EDIÇÃO</span><h2>Timeline</h2></div>
              <div className="timeline-actions">
                <label className="ratio-select"> <span>Formato</span><select value={ratio} onChange={(event) => setRatio(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>3:4</option><option>4:5</option></select><ChevronDown size={13} /></label>
                <button className="button secondary compact" onClick={() => selected && addToTimeline(selected)} disabled={!selected}><Plus size={14} /> Adicionar clipe</button>
              </div>
            </div>
            <div className="timeline-scroll">
              {selectedClip && <div className="clip-edit-controls">
                <span>Clipe selecionado</span>
                <span className="clip-edit-name" title={selectedClipMedia?.name}>{selectedClipMedia?.name}</span>
                <button className="button secondary compact" onClick={() => adjustSelectedClip({ start: selectedClip.start - 0.5 })} disabled={selectedClip.start <= 0}>← 0,5s</button>
                <button className="button secondary compact" onClick={() => adjustSelectedClip({ start: selectedClip.start + 0.5 })}>0,5s →</button>
                <span>Início {formatSeconds(selectedClip.start)}s</span>
                <label>Duração <input type="text" inputMode="decimal" aria-label="Duração do clipe em segundos" value={durationDraft}
                  onChange={(event) => setDurationDraft(event.target.value)}
                  onBlur={commitDurationDraft}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDurationDraft(formatSeconds(selectedClip.duration)); event.currentTarget.blur(); } }} />s</label>
                {Number.isFinite(maxClipDuration(selectedClip.mediaId)) && <span className="clip-edit-hint">máx. {formatSeconds(maxClipDuration(selectedClip.mediaId))}s</span>}
                <button className="button secondary compact" title="Remover clipe da timeline" onClick={() => removeClip(selectedClip.id)}><X size={12} /> Remover</button>
              </div>}
              <div className="timeline-ruler" style={{ width: timelineWidth }}>
                {Array.from({ length: Math.max(8, Math.ceil(totalDuration) + 2) }, (_, i) => <span key={i} style={{ left: i * PX_PER_SECOND }}>{i}s</span>)}
              </div>
              <div className="track-row"><div className="track-label"><Video size={14} /> V1</div><div className="track-lane" style={{ width: timelineWidth }}>
                {clips.filter((clip) => !isAudioClip(clip)).map(renderClip)}
              </div></div>
              <div className="track-row"><div className="track-label"><Music2 size={14} /> A1</div><div className="track-lane audio-lane" style={{ width: timelineWidth }}>
                {clips.filter(isAudioClip).map(renderClip)}
              </div></div>
              {clips.length === 0 && <div className="timeline-empty"><Scissors size={16} /> Importe uma mídia e clique em + para adicioná-la à timeline.</div>}
            </div>
            <div className="timeline-footer"><span>{clips.length} clipe(s)</span><span>Duração estimada: {totalDuration.toFixed(1)}s</span><span>Arraste e edição avançada chegam nas próximas etapas</span></div>
          </div>
        </section>

        <aside className="properties-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">AJUSTES</span><h2>Propriedades</h2></div><Settings2 size={17} className="muted-icon" /></div>
          {selected ? <div className="properties-content">
            <div className="property-preview">{selected.kind === "image" ? <img src={selected.url} /> : selected.kind === "video" ? <Video size={27} /> : <Music2 size={27} />}</div>
            <span className="eyebrow">ARQUIVO SELECIONADO</span><h3>{selected.name}</h3>
            <div className="property-line"><span>Tipo</span><b>{selected.kind}</b></div>
            <div className="property-line"><span>Tamanho</span><b>{formatSize(selected.size)}</b></div>
            <div className="property-line"><span>Formato do projeto</span><b>{ratio}</b></div>
            <button className="button primary full" onClick={() => addToTimeline(selected)}><Plus size={15} /> Adicionar à timeline</button>
          </div> : <div className="properties-empty"><WandSparkles size={25} /><strong>Nada selecionado</strong><span>Escolha um arquivo para ver suas propriedades e opções.</span></div>}
          <div className="tools-card"><div className="tools-title"><Sparkles size={15} /> Ferramentas planejadas</div><div className="tool-row"><span>Legendas</span><small>Em breve</small></div><div className="tool-row"><span>Transições</span><small>Em breve</small></div><div className="tool-row"><span>Correção de cor</span><small>Em breve</small></div><div className="tool-row"><span>Mixagem de áudio</span><small>Em breve</small></div></div>
        </aside>
      </main>
      <footer className="statusbar"><span><i className="status-dot" /> {notice}</span><span>Social Video Editor · v{appVersion} · Projeto local</span></footer>
    </div>
  );
}
