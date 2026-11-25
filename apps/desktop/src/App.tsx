import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AudioLines, Clapperboard, Film, FolderOpen, FolderPlus, Image as ImageIcon,
  Import, Layers3, Music2, Plus, Save, Scissors, Settings2, Sparkles,
  Video, WandSparkles, X, ChevronDown, MonitorPlay
} from "lucide-react";

type MediaKind = "video" | "image" | "audio" | "other";
type MediaItem = { id: string; file: File | null; path: string | null; url: string; name: string; kind: MediaKind; size: number };
type TimelineClip = { id: string; mediaId: string; start: number; duration: number };

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
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [ratio, setRatio] = useState("9:16");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [notice, setNotice] = useState("Seu espaço de edição está pronto.");


  useEffect(() => {
    invoke<string>("app_version").then(setAppVersion).catch(() => undefined);
  }, []);

  const selected = media.find((item) => item.id === selectedId) ?? null;
  const totalDuration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  const timelineWidth = Math.max(760, totalDuration * 42 + 120);
  const mediaCount = useMemo(() => ({
    video: media.filter((item) => item.kind === "video").length,
    image: media.filter((item) => item.kind === "image").length,
    audio: media.filter((item) => item.kind === "audio").length,
  }), [media]);

  function importFiles(files: FileList | File[]) {
    const additions = Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file),
      name: file.name, kind: kindOf(file), size: file.size,
    })).filter((item) => item.kind !== "other");
    if (!additions.length) {
      setNotice("Não encontrei arquivos de vídeo, imagem ou áudio nesse grupo.");
      return;
    }
    setMedia((current) => [...current, ...additions]);
    setSelectedId((current) => current ?? additions[0].id);
    setNotice(`${additions.length} arquivo(s) adicionado(s) à biblioteca.`);
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
        return { id: crypto.randomUUID(), file: null, path: mediaPath, url: convertFileSrc(mediaPath), name, kind, size: info[index]?.size ?? 0, missing: !info[index]?.exists };
      }).filter(item => item.kind !== "other");
      if (!additions.length) { setNotice("Nenhum arquivo de mídia compatível selecionado."); return; }
      setMedia(current => [...current, ...additions]);
      setSelectedId(current => current ?? additions[0].id);
      setNotice(additions.length + " arquivo(s) importado(s) com caminho vinculado.");
    } catch (error) { setNotice("Erro ao importar mídia: " + String(error)); }
  }

  async function relinkMedia(item: MediaItem) {
    try {
      const selectedPath = await open({ multiple: false, title: "Localizar arquivo: " + item.name });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      const info = await invoke<{ exists: boolean; size: number }[]>("media_file_info", { paths: [selectedPath] });
      if (!info[0]?.exists) { setNotice("O arquivo selecionado não foi encontrado."); return; }
      setMedia(current => current.map(entry => entry.id === item.id ? { ...entry, file: null, path: selectedPath, url: convertFileSrc(selectedPath), name: selectedPath.split(/[\\/]/).pop() || entry.name, size: info[0].size, missing: false } : entry));
      setNotice("Arquivo relinkado com sucesso.");
    } catch (error) { setNotice("Não foi possível relinkar: " + String(error)); }
  }

  function selectTimelineClip(clip: TimelineClip) {
    const item = media.find((entry) => entry.id === clip.mediaId);
    if (!item) return;
    setSelectedId(item.id);
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

  function addToTimeline(item: MediaItem) {
    const duration = item.kind === "image" ? 5 : 5;
    const start = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    setClips((current) => [...current, { id: crypto.randomUUID(), mediaId: item.id, start, duration }]);
    setNotice(`“${item.name}” foi colocado na timeline. Duração inicial: 5 segundos (ajustável nesta etapa futura).`);
  }

  function removeMedia(item: MediaItem) {
    URL.revokeObjectURL(item.url);
    setMedia((current) => current.filter((entry) => entry.id !== item.id));
    setClips((current) => current.filter((clip) => clip.mediaId !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    setNotice("Arquivo removido da biblioteca e da timeline.");
  }

  function createProjectSnapshot() {
    return {
      format: "sveproj", schemaVersion: 1, projectName, ratio,
      media: media.map(({ id, name, kind, size, path }) => ({ id, name, kind, size, path })),
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
      const restoredMedia = savedMedia.map((item: any, index: number) => {
        const mediaPath = mediaPaths[index];
        const exists = Boolean(mediaPath && fileInfos[index]?.exists);
        return { id: String(item.id || crypto.randomUUID()), file: null, path: mediaPath || null,
          url: exists ? convertFileSrc(mediaPath) : "", name: String(item.name || "Mídia"),
          kind: item.kind as MediaKind, size: fileInfos[index]?.size ?? Number(item.size ?? 0), missing: !exists };
      }).filter((item: MediaItem) => item.kind !== "other");
      setMedia(restoredMedia);
      setSelectedId(restoredMedia.find((item: any) => !item.missing)?.id ?? restoredMedia[0]?.id ?? null);
      setClips(Array.isArray(data.clips) ? data.clips : []);
      setProjectPath(path);
      const missingCount = restoredMedia.filter((item: any) => item.missing).length;
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
                <button className="asset-add" title="Adicionar à timeline" onClick={() => addToTimeline(item)}><Plus size={15} /></button>{(item as any).missing && <button className="asset-add" title="Relinkar arquivo" onClick={() => relinkMedia(item)}><FolderOpen size={14} /></button>}
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
                  selected.kind === "video" ? <video key={selected.id} ref={previewVideoRef} className="preview-media" src={selected.url} controls onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setPreviewDuration(event.currentTarget.duration || 0)} onDurationChange={(event) => setPreviewDuration(event.currentTarget.duration || 0)} /> :
                  <div className="audio-preview"><AudioLines size={44} /><strong>{selected.name}</strong><audio src={selected.url} controls /></div>}
              </div>
            </div>
            <div className="preview-transport"><button className="button secondary compact" onClick={togglePreviewPlayback} disabled={selected?.kind !== "video"}>{previewVideoRef.current?.paused ? "▶ Reproduzir" : "⏸ Pausar"}</button><span className="preview-time">{previewTime.toFixed(1)}s / {previewDuration.toFixed(1)}s</span><input aria-label="Posição do vídeo" type="range" min={0} max={Math.max(0, previewDuration)} step={0.1} value={Math.min(previewTime, previewDuration)} onChange={(event) => seekPreview(Number(event.target.value))} disabled={selected?.kind !== "video" || !previewDuration} /></div>\n            <div className="preview-bottom"><span>{selected ? selected.name : "Nenhuma mídia selecionada"}</span><span>Proporção <b>{ratio}</b></span></div>
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
              <div className="timeline-ruler" style={{ width: timelineWidth }}>
                {Array.from({ length: Math.max(8, Math.ceil(totalDuration) + 2) }, (_, i) => <span key={i} style={{ left: i * 42 }}>{i}s</span>)}
              </div>
              <div className="track-row"><div className="track-label"><Video size={14} /> V1</div><div className="track-lane" style={{ width: timelineWidth }}>
                {clips.filter((clip) => media.find((item) => item.id === clip.mediaId)?.kind !== "audio").map((clip) => {
                  const item = media.find((entry) => entry.id === clip.mediaId);
                  return <div key={clip.id} className="timeline-clip video-clip" onClick={() => selectTimelineClip(clip)} style={{ left: clip.start * 42, width: Math.max(70, clip.duration * 42), cursor: "pointer" }} title={item?.name}><Film size={13} /><span>{item?.name ?? "Mídia não vinculada"}</span><button onClick={() => setClips((current) => current.filter((entry) => entry.id !== clip.id))}><X size={12} /></button></div>;
                })}
              </div></div>
              <div className="track-row"><div className="track-label"><Music2 size={14} /> A1</div><div className="track-lane audio-lane" style={{ width: timelineWidth }}>
                {clips.filter((clip) => media.find((item) => item.id === clip.mediaId)?.kind === "audio").map((clip) => {
                  const item = media.find((entry) => entry.id === clip.mediaId);
                  return <div key={clip.id} className="timeline-clip audio-clip" onClick={() => selectTimelineClip(clip)} style={{ left: clip.start * 42, width: Math.max(70, clip.duration * 42), cursor: "pointer" }} title={item?.name}><AudioLines size={13} /><span>{item?.name ?? "Áudio"}</span><button onClick={() => setClips((current) => current.filter((entry) => entry.id !== clip.id))}><X size={12} /></button></div>;
                })}
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