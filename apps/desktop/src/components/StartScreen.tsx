import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Clapperboard, Clock, FolderOpen, FolderSearch, Import, Plus, Search, WandSparkles, X } from "lucide-react";
import type { RecentProject } from "../lib/recent";
import { formatWhen } from "../lib/recent";
import { formatTimecode } from "../lib/time";

export const RATIOS = [
  { id: "9:16", label: "9:16", hint: "Shorts, Reels, TikTok" },
  { id: "16:9", label: "16:9", hint: "YouTube" },
  { id: "1:1", label: "1:1", hint: "Quadrado" },
  { id: "4:5", label: "4:5", hint: "Feed vertical" },
  { id: "3:4", label: "3:4", hint: "Retrato" },
];

type Props = {
  version: string;
  recent: RecentProject[];
  ratio: string;
  onRatioChange: (ratio: string) => void;
  onNew: () => void;
  onAutoAssembly: () => void;
  onImportMedia: () => void;
  onOpenDialog: () => void;
  onOpenRecent: (project: RecentProject) => void;
  onLocate: (project: RecentProject) => void;
  onForget: (project: RecentProject) => void;
};

const inTauri = () => "__TAURI_INTERNALS__" in window;

/** Tela inicial: novo projeto, atalhos e projetos recentes. */
export default function StartScreen({ version, recent, ratio, onRatioChange, onNew, onAutoAssembly, onImportMedia, onOpenDialog, onOpenRecent, onLocate, onForget }: Props) {
  const [query, setQuery] = useState("");
  const [exists, setExists] = useState<Map<string, boolean>>(new Map());

  // Marca os projetos cujo arquivo sumiu (movido ou apagado).
  useEffect(() => {
    if (!inTauri() || !recent.length) return;
    let alive = true;
    invoke<boolean[]>("paths_exist", { paths: recent.map((project) => project.path) })
      .then((result) => { if (alive) setExists(new Map(recent.map((project, index) => [project.path, result[index]]))); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [recent]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? recent.filter((project) => project.name.toLowerCase().includes(term) || project.path.toLowerCase().includes(term)) : recent;
  }, [recent, query]);

  return <div className="start-screen">
    <aside className="start-side">
      <div className="brand">
        <div className="brand-mark"><Clapperboard size={21} /></div>
        <div><strong>social<span>video</span></strong><small>EDITOR <i>BY SOCIAL NEXUS</i></small></div>
      </div>
      <nav>
        <button className="start-nav active"><Plus size={16} /> Criar um projeto</button>
        <button className="start-nav" onClick={onOpenDialog} title="Ctrl+O"><FolderOpen size={16} /> Abrir projeto…</button>
      </nav>
      <small className="start-version">Social Video Editor v{version} · projeto local</small>
    </aside>

    <main className="start-main">
      <div className="start-ratio">
        <span>Proporção do vídeo</span>
        <div className="segmented" role="radiogroup" aria-label="Proporção do vídeo">
          {RATIOS.map((entry) => <button key={entry.id} role="radio" aria-checked={ratio === entry.id} title={entry.hint}
            className={ratio === entry.id ? "active" : ""} onClick={() => onRatioChange(entry.id)}>{entry.label}</button>)}
        </div>
        <small>{RATIOS.find((entry) => entry.id === ratio)?.hint}</small>
      </div>

      <button className="start-new" onClick={onNew} title="Ctrl+N">
        <span className="start-new-icon"><Plus size={22} /></span>
        <strong>Novo projeto</strong>
        <small>Timeline vazia em {ratio}</small>
      </button>

      <div className="start-tools">
        <button className="start-tool" onClick={onAutoAssembly}>
          <WandSparkles size={20} /><span><strong>Montagem automática</strong><small>Escolha a pasta: imagens e vídeos entram no tempo do nome do arquivo, com a narração.</small></span>
        </button>
        <button className="start-tool" onClick={onImportMedia}>
          <Import size={20} /><span><strong>Importar mídias</strong><small>Projeto novo já com vídeos, imagens e áudios na biblioteca.</small></span>
        </button>
        <button className="start-tool" onClick={onOpenDialog}>
          <FolderOpen size={20} /><span><strong>Abrir projeto</strong><small>Procurar um arquivo .sveproj no computador.</small></span>
        </button>
      </div>

      <div className="start-recent-head">
        <h2><Clock size={15} /> Projetos recentes</h2>
        {recent.length > 0 && <label className="start-search"><Search size={13} />
          <input placeholder="Buscar pelo nome" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
      </div>
      {!recent.length && <p className="start-empty">Os projetos que você salvar ou abrir aparecem aqui.</p>}
      {recent.length > 0 && !shown.length && <p className="start-empty">Nenhum projeto com “{query}”.</p>}
      <div className="start-grid">
        {shown.map((project) => {
          const missing = exists.get(project.path) === false;
          return <div key={project.path} className={`start-card ${missing ? "missing" : ""}`}>
            <button className="start-card-main" title={project.path} onClick={() => missing ? onLocate(project) : onOpenRecent(project)}>
              <div className={`start-thumb ratio-${project.ratio.replace(":", "-")}`}>
                {missing ? <AlertTriangle size={22} /> : project.thumb ? <img src={project.thumb} alt="" draggable={false} /> : <Clapperboard size={22} />}
                <em>{project.ratio}</em>
              </div>
              <strong>{project.name}</strong>
              <small>{missing ? "Arquivo não encontrado — clique para localizar"
                : `${formatWhen(project.openedAt)} · ${formatTimecode(project.duration)} · ${project.clips} clipe(s)`}</small>
            </button>
            <div className="start-card-actions">
              {missing && <button className="icon-button small" title="Localizar o arquivo" onClick={() => onLocate(project)}><FolderSearch size={14} /></button>}
              <button className="icon-button small" title="Remover da lista (o arquivo não é apagado)" onClick={() => onForget(project)}><X size={14} /></button>
            </div>
          </div>;
        })}
      </div>
    </main>
  </div>;
}
