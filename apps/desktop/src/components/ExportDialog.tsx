import { FFMPEG_KEY, loadExportSettings, saveExportSettings, type ExportSettings } from "../lib/settings";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, Clapperboard, Info, Loader2, X } from "lucide-react";
import type { CaptionStyle, MediaItem, TimelineState } from "../types";
import {
  buildRenderPlan, FRAME_RATES, outputSize, QUALITY_PRESETS, renderDuration, RESOLUTIONS, SPEED_PRESETS,
  type ProbeInfo, type RenderSettings,
} from "../lib/render";
import { formatTimecode } from "../lib/time";

type Props = {
  state: TimelineState;
  media: MediaItem[];
  captionStyle: CaptionStyle;
  ratio: string;
  projectName: string;
  onClose: () => void;
  onNotice: (message: string) => void;
};

type FfmpegInfo = { path: string; version: string; major: number };
type Phase = { kind: "idle" } | { kind: "rendering"; done: number; startedAt: number }
  | { kind: "done"; output: string; seconds: number } | { kind: "error"; message: string };

type Saved = ExportSettings;
const loadSaved = () => loadExportSettings();

const inTauri = () => "__TAURI_INTERNALS__" in window;
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "video";

/** Janela de exportação: escolhe qualidade, roda o ffmpeg e mostra o progresso. */
export default function ExportDialog({ state, media, captionStyle, ratio, projectName, onClose, onNotice }: Props) {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [ffmpegPath, setFfmpegPath] = useState(() => localStorage.getItem(FFMPEG_KEY) ?? "");
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  const outputRef = useRef("");
  phaseRef.current = phase;
  const rendering = phase.kind === "rendering";

  const duration = renderDuration(state);
  const size = outputSize(ratio, saved.resolution);
  const settings: RenderSettings = {
    ...size, fps: saved.fps,
    crf: QUALITY_PRESETS.find((entry) => entry.id === saved.quality)?.crf ?? 21,
    preset: saved.speed,
    normalize: saved.normalize,
  };

  useEffect(() => { saveExportSettings(saved); }, [saved]);

  // Procura o ffmpeg (o escolhido ou o do PATH).
  useEffect(() => {
    if (!inTauri()) { setFfmpegError("A exportação só funciona no aplicativo (npm run tauri dev)."); return; }
    let alive = true;
    setFfmpeg(null); setFfmpegError(null);
    invoke<FfmpegInfo>("ffmpeg_info", { path: ffmpegPath || null })
      .then((info) => { if (alive) setFfmpeg(info); })
      .catch((error) => { if (alive) setFfmpegError(String(error)); });
    return () => { alive = false; };
  }, [ffmpegPath]);

  // Progresso e fim da exportação, vindos do Rust.
  useEffect(() => {
    if (!inTauri()) return;
    const offProgress = listen<number>("render-progress", (event) => {
      setPhase((current) => current.kind === "rendering" ? { ...current, done: event.payload } : current);
    });
    const offDone = listen<{ ok: boolean; cancelled: boolean; error: string | null }>("render-done", (event) => {
      const current = phaseRef.current;
      if (current.kind !== "rendering") return;
      const { ok, cancelled, error } = event.payload;
      const seconds = (Date.now() - current.startedAt) / 1000;
      if (ok) setPhase({ kind: "done", output: outputRef.current, seconds });
      else if (cancelled) { setPhase({ kind: "idle" }); onNotice("Exportação cancelada."); }
      else setPhase({ kind: "error", message: error || "O ffmpeg terminou com erro." });
    });
    return () => { void offProgress.then((off) => off()); void offDone.then((off) => off()); };
  }, [onNotice]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && phaseRef.current.kind !== "rendering") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  // Avisos antes de exportar (sem consultar os arquivos).
  const preview = useMemo(() => buildRenderPlan(state, media, new Map(), settings, duration),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, media, duration]);
  const hasCaptions = state.captions.length > 0;
  const captionsForExport = hasCaptions && saved.burnCaptions ? captionStyle : null;

  async function chooseFfmpeg() {
    const picked = await open({ multiple: false, directory: false, title: "Escolher o ffmpeg",
      filters: navigator.userAgent.includes("Windows") ? [{ name: "ffmpeg", extensions: ["exe"] }] : undefined });
    if (typeof picked !== "string") return;
    localStorage.setItem(FFMPEG_KEY, picked);
    setFfmpegPath(picked);
  }

  function useSystemFfmpeg() {
    localStorage.removeItem(FFMPEG_KEY);
    setFfmpegPath("");
  }

  async function startExport() {
    if (!ffmpeg || rendering) return;
    const output = await save({ title: "Exportar vídeo", defaultPath: `${safeName(projectName)}.mp4`, filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }] });
    if (!output) return;
    const target = /\.mp4$/i.test(output) ? output : `${output}.mp4`;
    try {
      const paths = [...new Set(state.clips.map((clip) => media.find((item) => item.id === clip.mediaId)?.path).filter((path): path is string => Boolean(path)))];
      const infos = await invoke<ProbeInfo[]>("probe_media", { ffmpeg: ffmpeg.path, paths });
      const probes = new Map(paths.map((path, index) => [path, infos[index]]));
      const plan = buildRenderPlan(state, media, probes, settings, duration, captionsForExport);
      outputRef.current = target;
      setPhase({ kind: "rendering", done: 0, startedAt: Date.now() });
      await invoke("start_render", { job: { ffmpeg: ffmpeg.path, inputs: plan.inputs, filter: plan.filter, outputArgs: plan.outputArgs, output: target, sources: plan.sources, ass: plan.ass } });
    } catch (error) {
      setPhase({ kind: "error", message: String(error) });
    }
  }

  const progress = phase.kind === "rendering" ? Math.min(1, phase.done / duration) : 0;
  const elapsed = phase.kind === "rendering" ? (Date.now() - phase.startedAt) / 1000 : 0;
  const remaining = progress > 0.02 ? elapsed * (1 - progress) / progress : null;
  const set = (change: Partial<Saved>) => setSaved((current) => ({ ...current, ...change }));

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !rendering) onClose(); }}>
      <div className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-head">
          <div><span className="eyebrow">FFMPEG</span><h2 id="export-title">Exportar vídeo</h2></div>
          <button className="icon-button small" title="Fechar (Esc)" disabled={rendering} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="export-body">
          <div className={`export-ffmpeg ${ffmpegError ? "bad" : ""}`}>
            {ffmpeg ? <><CheckCircle2 size={14} /> <span title={ffmpeg.path}>{ffmpeg.version.replace(/ Copyright.*/, "")}</span></>
              : ffmpegError ? <><AlertTriangle size={14} /> <span>{ffmpegError}</span></>
              : <><Loader2 size={14} className="spin" /> <span>Procurando o ffmpeg…</span></>}
            {inTauri() && <span className="export-ffmpeg-actions">
              <button className="button secondary compact" disabled={rendering} onClick={chooseFfmpeg}>Escolher ffmpeg.exe…</button>
              {ffmpegPath && <button className="button secondary compact" disabled={rendering} onClick={useSystemFfmpeg}>Usar o do sistema</button>}
            </span>}
          </div>

          <fieldset className="export-grid" disabled={rendering}>
            <label>Resolução
              <select value={saved.resolution} onChange={(event) => set({ resolution: Number(event.target.value) })}>
                {RESOLUTIONS.map((entry) => { const s = outputSize(ratio, entry.id); return <option key={entry.id} value={entry.id}>{entry.label} ({s.width}×{s.height})</option>; })}
              </select></label>
            <label>Quadros por segundo
              <select value={saved.fps} onChange={(event) => set({ fps: Number(event.target.value) })}>
                {FRAME_RATES.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select></label>
            <label>Qualidade
              <select value={saved.quality} onChange={(event) => set({ quality: event.target.value })}>
                {QUALITY_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
            <label>Velocidade
              <select value={saved.speed} onChange={(event) => set({ speed: event.target.value })}>
                {SPEED_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
          </fieldset>

          <p className="export-summary">
            <Clapperboard size={13} /> {size.width}×{size.height} · {saved.fps} fps · duração <b>{formatTimecode(duration)}</b> · H.264 + AAC (MP4), codificado no processador
          </p>
          {preview.warnings.map((warning) => <p key={warning} className="export-note warn"><AlertTriangle size={13} /> {warning}</p>)}
          {hasCaptions && <label className="export-check">
            <input type="checkbox" checked={saved.burnCaptions} disabled={rendering} onChange={(event) => set({ burnCaptions: event.target.checked })} />
            Gravar as legendas no vídeo ({state.captions.length}), com o estilo atual
            {!captionStyle.visible && <span className="export-hint"><Info size={12} /> estão ocultas no preview</span>}
          </label>}

          <label className="export-check">
            <input type="checkbox" checked={saved.normalize} disabled={rendering} onChange={(event) => set({ normalize: event.target.checked })} />
            Normalizar o volume (padrão das redes: −14 LUFS, sem estourar)
          </label>

          {phase.kind === "rendering" && <div className="export-progress">
            <div className="export-bar"><div style={{ width: `${progress * 100}%` }} /></div>
            <span>{Math.round(progress * 100)}% · {formatTimecode(phase.done)} de {formatTimecode(duration)}
              {remaining !== null ? ` · falta ~${Math.ceil(remaining)} s` : ""}</span>
          </div>}
          {phase.kind === "done" && <p className="export-note ok"><CheckCircle2 size={13} /> Pronto em {Math.round(phase.seconds)} s: <code>{phase.output}</code></p>}
          {phase.kind === "error" && <div className="export-note warn"><AlertTriangle size={13} /> Falhou: <pre>{phase.message}</pre></div>}
        </div>

        <div className="modal-foot">
          <span>O original das mídias nunca é alterado.</span>
          <div>
          {rendering
            ? <button className="button secondary" onClick={() => void invoke("cancel_render")}>Cancelar exportação</button>
            : <button className="button secondary" onClick={onClose}>Fechar</button>}
          <button className="button primary" disabled={!ffmpeg || rendering || duration <= 0} onClick={() => void startExport()}>
            {rendering ? <><Loader2 size={15} className="spin" /> Exportando…</> : "Exportar…"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
