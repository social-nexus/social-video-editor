import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, Clapperboard, Download, Info, Keyboard, Loader2, Settings2, SlidersHorizontal, X } from "lucide-react";
import {
  appSettings, DEFAULT_EXPORT, DEFAULT_SETTINGS, FFMPEG_KEY, loadExportSettings, RATIO_OPTIONS, saveExportSettings, saveSettings,
  type AppSettings, type ExportSettings,
} from "../lib/settings";
import { FRAME_RATES, QUALITY_PRESETS, RESOLUTIONS, SPEED_PRESETS } from "../lib/render";

type Section = "general" | "export" | "ffmpeg" | "shortcuts" | "about";
type FfmpegInfo = { path: string; version: string; major: number };

type Props = {
  version: string;
  recentCount: number;
  onClose: () => void;
  onResetPanels: () => void;
  onClearRecent: () => void;
  onNotice: (message: string) => void;
};

const inTauri = () => "__TAURI_INTERNALS__" in window;

const SHORTCUTS: [string, string][] = [
  ["Espaço", "Reproduzir / pausar"],
  ["← / →", "Andar 0,1 s (com Shift: 1 s)"],
  ["Home / End", "Ir para o começo / fim"],
  ["S", "Dividir no playhead"],
  ["R", "Ligar/desligar a edição em cascata (ímã)"],
  ["Delete", "Remover o clipe ou a legenda selecionada"],
  ["Alt + ← / →", "Mover o clipe selecionado"],
  ["Ctrl + Z / Ctrl + Y", "Desfazer / refazer"],
  ["Ctrl + C / Ctrl + V", "Copiar / colar clipe no playhead"],
  ["Ctrl + D", "Duplicar o clipe selecionado"],
  ["Ctrl + S / Ctrl + Shift + S", "Salvar / salvar como"],
  ["Ctrl + O", "Abrir projeto"],
  ["Ctrl + N", "Projeto novo"],
  ["Ctrl + E", "Exportar"],
  ["Ctrl + roda do mouse", "Zoom da timeline"],
  ["Alt (arrastando)", "Desliga o ímã das bordas"],
  ["Shift (girando no preview)", "Gira de 15 em 15°"],
  ["Esc", "Fechar janelas / cancelar arraste"],
];

/** Configurações do app (ficam neste computador). */
export default function SettingsDialog({ version, recentCount, onClose, onResetPanels, onClearRecent, onNotice }: Props) {
  const [section, setSection] = useState<Section>("general");
  const [settings, setSettings] = useState<AppSettings>(() => appSettings());
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => loadExportSettings());
  const [ffmpegPath, setFfmpegPath] = useState(() => localStorage.getItem(FFMPEG_KEY) ?? "");
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const updateGeneral = (change: Partial<AppSettings>) => setSettings(saveSettings({ ...settings, ...change }));
  const updateExport = (change: Partial<ExportSettings>) => {
    const next = { ...exportSettings, ...change };
    setExportSettings(next);
    saveExportSettings(next);
  };

  function checkFfmpeg(path = ffmpegPath) {
    if (!inTauri()) { setFfmpegError("O teste do ffmpeg só funciona no aplicativo (npm run tauri dev)."); return; }
    setChecking(true); setFfmpeg(null); setFfmpegError(null);
    invoke<FfmpegInfo>("ffmpeg_info", { path: path || null })
      .then(setFfmpeg).catch((error) => setFfmpegError(String(error))).finally(() => setChecking(false));
  }
  useEffect(() => { if (section === "ffmpeg") checkFfmpeg(); }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chooseFfmpeg() {
    const picked = await open({ multiple: false, directory: false, title: "Escolher o ffmpeg",
      filters: navigator.userAgent.includes("Windows") ? [{ name: "ffmpeg", extensions: ["exe"] }] : undefined });
    if (typeof picked !== "string") return;
    localStorage.setItem(FFMPEG_KEY, picked);
    setFfmpegPath(picked);
    checkFfmpeg(picked);
  }
  function useSystemFfmpeg() {
    localStorage.removeItem(FFMPEG_KEY);
    setFfmpegPath("");
    checkFfmpeg("");
  }

  const nav: { id: Section; label: string; icon: typeof Settings2 }[] = [
    { id: "general", label: "Geral", icon: SlidersHorizontal },
    { id: "export", label: "Exportação", icon: Download },
    { id: "ffmpeg", label: "FFmpeg", icon: Clapperboard },
    { id: "shortcuts", label: "Atalhos", icon: Keyboard },
    { id: "about", label: "Sobre", icon: Info },
  ];

  return <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-head">
        <h2 id="settings-title"><Settings2 size={16} /> Configurações</h2>
        <button className="icon-button small" title="Fechar (Esc)" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="settings-body">
        <nav className="settings-nav">
          {nav.map((entry) => <button key={entry.id} className={section === entry.id ? "active" : ""} onClick={() => setSection(entry.id)}>
            <entry.icon size={14} /> {entry.label}</button>)}
        </nav>
        <div className="settings-content">
          {section === "general" && <>
            <h3>Padrões do editor</h3>
            <label className="settings-row"><span>Duração das imagens<small>ao colocar uma imagem na timeline</small></span>
              <input type="number" min={0.5} max={60} step={0.5} value={settings.imageDuration}
                onChange={(event) => event.target.value !== "" && updateGeneral({ imageDuration: Number(event.target.value) })} /> <em>s</em></label>
            <label className="settings-row"><span>Duração das transições<small>ao criar uma transição nova</small></span>
              <input type="number" min={0.1} max={3} step={0.1} value={settings.transitionDuration}
                onChange={(event) => event.target.value !== "" && updateGeneral({ transitionDuration: Number(event.target.value) })} /> <em>s</em></label>
            <label className="settings-row"><span>Proporção de projetos novos<small>a tela inicial já abre nela</small></span>
              <select value={settings.defaultRatio} onChange={(event) => updateGeneral({ defaultRatio: event.target.value })}>
                {RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select></label>
            <button className="link-button" onClick={() => setSettings(saveSettings(DEFAULT_SETTINGS))}>Voltar aos padrões</button>
            <h3>Janela</h3>
            <div className="settings-row"><span>Painéis<small>Biblioteca à esquerda, Propriedades à direita, tamanhos padrão</small></span>
              <button className="button secondary compact" onClick={() => { onResetPanels(); onNotice("Painéis de volta ao arranjo padrão."); }}>Restaurar painéis</button></div>
            <div className="settings-row"><span>Projetos recentes<small>{recentCount} na lista da tela inicial (os arquivos não são apagados)</small></span>
              <button className="button secondary compact" disabled={!recentCount} onClick={onClearRecent}>Limpar lista</button></div>
          </>}

          {section === "export" && <>
            <h3>Padrões da exportação</h3>
            <p className="settings-hint">A janela de Exportar começa com estes valores (e lembra o que você mudar lá).</p>
            <label className="settings-row"><span>Resolução</span>
              <select value={exportSettings.resolution} onChange={(event) => updateExport({ resolution: Number(event.target.value) })}>
                {RESOLUTIONS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
            <label className="settings-row"><span>Quadros por segundo</span>
              <select value={exportSettings.fps} onChange={(event) => updateExport({ fps: Number(event.target.value) })}>
                {FRAME_RATES.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select></label>
            <label className="settings-row"><span>Qualidade</span>
              <select value={exportSettings.quality} onChange={(event) => updateExport({ quality: event.target.value })}>
                {QUALITY_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
            <label className="settings-row"><span>Velocidade</span>
              <select value={exportSettings.speed} onChange={(event) => updateExport({ speed: event.target.value })}>
                {SPEED_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
            <label className="settings-row check"><input type="checkbox" checked={exportSettings.normalize} onChange={(event) => updateExport({ normalize: event.target.checked })} />
              <span>Normalizar o volume (−14 LUFS)</span></label>
            <label className="settings-row check"><input type="checkbox" checked={exportSettings.burnCaptions} onChange={(event) => updateExport({ burnCaptions: event.target.checked })} />
              <span>Gravar as legendas no vídeo</span></label>
            <button className="link-button" onClick={() => { setExportSettings(DEFAULT_EXPORT); saveExportSettings(DEFAULT_EXPORT); }}>Voltar aos padrões</button>
          </>}

          {section === "ffmpeg" && <>
            <h3>FFmpeg</h3>
            <p className="settings-hint">O editor usa o ffmpeg para exportar e fazer miniaturas. Sem escolher, usa o que estiver instalado no sistema (PATH).
              Não precisa de placa de vídeo: codifica no processador (H.264).</p>
            <div className={`export-ffmpeg ${ffmpegError ? "bad" : ""}`}>
              {checking ? <><Loader2 size={14} className="spin" /> <span>Testando…</span></>
                : ffmpeg ? <><CheckCircle2 size={14} /> <span title={ffmpeg.path}>{ffmpeg.version.replace(/ Copyright.*/, "")}</span></>
                : ffmpegError ? <><AlertTriangle size={14} /> <span>{ffmpegError}</span></> : null}
            </div>
            <div className="settings-row"><span>Em uso<small>{ffmpegPath || "o do sistema (PATH)"}</small></span>
              <span className="settings-actions">
                <button className="button secondary compact" disabled={!inTauri()} onClick={chooseFfmpeg}>Escolher ffmpeg.exe…</button>
                {ffmpegPath && <button className="button secondary compact" onClick={useSystemFfmpeg}>Usar o do sistema</button>}
                <button className="button secondary compact" onClick={() => checkFfmpeg()}>Testar</button>
              </span></div>
          </>}

          {section === "shortcuts" && <>
            <h3>Atalhos do teclado</h3>
            <table className="settings-shortcuts"><tbody>
              {SHORTCUTS.map(([keys, what]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{what}</td></tr>)}
            </tbody></table>
          </>}

          {section === "about" && <>
            <h3>Social Video Editor</h3>
            <p className="settings-hint">Versão {version} · editor de vídeo local (seus arquivos não saem do computador) · família Social Nexus.</p>
            <p className="settings-hint">Feito com Tauri, React e FFmpeg. As mídias originais nunca são alteradas: o editor só lê os arquivos e grava o vídeo novo.</p>
          </>}
        </div>
      </div>
    </div>
  </div>;
}
