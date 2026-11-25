import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AudioLines, Clapperboard, Film, FolderOpen, FolderPlus, Image as ImageIcon,
  Import, Layers3, Music2, Plus, Save, Scissors, Settings2, Sparkles,
  Video, WandSparkles, X, ChevronDown, MonitorPlay
} from "lucide-react";

type MediaKind = "video" | "image" | "audio" | "other";
type MediaItem = { id: string; file: File; url: string; name: string; kind: MediaKind; size: number };
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
  const projectRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [projectName, setProjectName] = useState("Projeto sem título");
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

  function saveProject() {
    const snapshot = {
      format: "sveproj", schemaVersion: 1, projectName, ratio,
      media: media.map(({ id, name, kind, size }) => ({ id, name, kind, size })),
      clips, note: "Este protótipo salva a estrutura e as referências por nome. Os arquivos de mídia precisam ser importados novamente ao abrir em outra sessão.",
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.replace(/[^a-z0-9-_]/gi, "_")}.sveproj`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Snapshot do projeto exportado. Os arquivos originais não foram copiados nem modificados.");
  }

  function loadProject(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.format !== "sveproj" || data.schemaVersion !== 1) throw new Error("Formato ou versão não reconhecida.");
        setProjectName(typeof data.projectName === "string" ? data.projectName : "Projeto importado");
        setRatio(typeof data.ratio === "string" ? data.ratio : "9:16");
        setClips(Array.isArray(data.clips) ? data.clips : []);
        setNotice("Estrutura do projeto carregada. Reimporte os arquivos de mídia para reconstruir a biblioteca.");
      } catch {
        setNotice("Não foi possível abrir esse arquivo de projeto.");
      }
    };
    reader.readAsText(file);
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
          <button className="button secondary" onClick={() => projectRef.current?.click()}><FolderOpen size={16} /> Abrir</button>
          <button className="button primary" onClick={saveProject}><Save size={16} /> Salvar projeto</button>
          <button className="icon-button" title="Configurações" onClick={() => setNotice("As configurações serão implementadas nas próximas etapas.")}><Settings2 size={18} /></button>
          <input ref={projectRef} hidden type="file" accept=".sveproj,.json,application/json" onChange={(event) => loadProject(event.target.files?.[0])} />
        </div>
      </header>

      <main className="workspace">
        <aside className="media-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">SEU PROJETO</span><h2>Biblioteca</h2></div>
            <button className="icon-button small" title="Importar mídia" onClick={() => inputRef.current?.click()}><Plus size={18} /></button>
          </div>
          <button className="import-drop" onClick={() => inputRef.current?.click()}>
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
                <button className="asset-add" title="Adicionar à timeline" onClick={() => addToTimeline(item)}><Plus size={15} /></button>
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
                  selected.kind === "video" ? <video key={selected.id} className="preview-media" src={selected.url} controls /> :
                  <div className="audio-preview"><AudioLines size={44} /><strong>{selected.name}</strong><audio src={selected.url} controls /></div>}
              </div>
            </div>
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
              <div className="timeline-ruler" style={{ width: timelineWidth }}>
                {Array.from({ length: Math.max(8, Math.ceil(totalDuration) + 2) }, (_, i) => <span key={i} style={{ left: i * 42 }}>{i}s</span>)}
              </div>
              <div className="track-row"><div className="track-label"><Video size={14} /> V1</div><div className="track-lane" style={{ width: timelineWidth }}>
                {clips.filter((clip) => media.find((item) => item.id === clip.mediaId)?.kind !== "audio").map((clip) => {
                  const item = media.find((entry) => entry.id === clip.mediaId);
                  return <div key={clip.id} className="timeline-clip video-clip" style={{ left: clip.start * 42, width: Math.max(70, clip.duration * 42) }} title={item?.name}><Film size={13} /><span>{item?.name ?? "Mídia não vinculada"}</span><button onClick={() => setClips((current) => current.filter((entry) => entry.id !== clip.id))}><X size={12} /></button></div>;
                })}
              </div></div>
              <div className="track-row"><div className="track-label"><Music2 size={14} /> A1</div><div className="track-lane audio-lane" style={{ width: timelineWidth }}>
                {clips.filter((clip) => media.find((item) => item.id === clip.mediaId)?.kind === "audio").map((clip) => {
                  const item = media.find((entry) => entry.id === clip.mediaId);
                  return <div key={clip.id} className="timeline-clip audio-clip" style={{ left: clip.start * 42, width: Math.max(70, clip.duration * 42) }} title={item?.name}><AudioLines size={13} /><span>{item?.name ?? "Áudio"}</span><button onClick={() => setClips((current) => current.filter((entry) => entry.id !== clip.id))}><X size={12} /></button></div>;
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