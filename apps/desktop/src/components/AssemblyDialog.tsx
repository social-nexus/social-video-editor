import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Film, Image as ImageIcon, Info, Loader2, WandSparkles, X } from "lucide-react";
import type { MediaItem } from "../types";
import { planAssembly, type AssemblyItem, type AssemblyPlan } from "../lib/autoassemble";
import { formatSeconds, formatTimecode, parseSeconds } from "../lib/time";

type Props = {
  media: MediaItem[];
  /** Se a timeline já tem clipes, a montagem vai para trilhas novas. */
  timelineHasClips: boolean;
  onClose: () => void;
  onApply: (plan: AssemblyPlan, narration: MediaItem | null) => void;
};

export default function AssemblyDialog({ media, timelineHasClips, onClose, onApply }: Props) {
  const audios = media.filter((item) => item.kind === "audio" && !item.missing);
  const [narrationId, setNarrationId] = useState<string>(audios[0]?.id ?? "");
  const [includeImages, setIncludeImages] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(true);
  const [lastImageText, setLastImageText] = useState("5");
  const [stretchLastVideo, setStretchLastVideo] = useState(true);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const narration = audios.find((item) => item.id === narrationId) ?? null;
  const measuringNarration = Boolean(narration && !narration.duration);
  const lastImageDuration = Math.max(0.5, parseSeconds(lastImageText) || 5);
  const imageCount = media.filter((item) => item.kind === "image" && !item.missing).length;
  const videoCount = media.filter((item) => item.kind === "video" && !item.missing).length;

  const plan = useMemo(() => {
    const items: AssemblyItem[] = media
      .filter((item) => !item.missing && ((item.kind === "image" && includeImages) || (item.kind === "video" && includeVideos)))
      .map((item) => ({ id: item.id, name: item.name, kind: item.kind as "video" | "image", duration: item.duration ?? null }));
    return planAssembly(items, { narrationDuration: narration?.duration ?? null, lastImageDuration, stretchLastVideo });
  }, [media, includeImages, includeVideos, narration?.duration, lastImageDuration, stretchLastVideo]);

  const canApply = plan.clips.length > 0 && !measuringNarration;

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal assembly-modal" role="dialog" aria-modal="true" aria-labelledby="assembly-title">
        <div className="modal-head">
          <div><span className="eyebrow">AUTOMAÇÃO</span><h2 id="assembly-title">Montagem automática</h2></div>
          <button className="icon-button small" title="Fechar (Esc)" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-intro">
          Cada imagem ou vídeo entra no tempo escrito no nome do arquivo e dura até o próximo.
          Exemplos: <code>0-05.png</code> = 5 s · <code>0-04.300.mp4</code> = 4,3 s · <code>00-00-05-500.jpg</code> = 5,5 s.
        </p>

        <div className="assembly-options">
          <label>Narração
            <select value={narrationId} onChange={(event) => setNarrationId(event.target.value)}>
              <option value="">Sem narração</option>
              {audios.map((item) => <option key={item.id} value={item.id}>{item.name}{item.duration ? ` (${formatTimecode(item.duration)})` : ""}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} /> <ImageIcon size={13} /> Imagens ({imageCount})</label>
          <label className="check"><input type="checkbox" checked={includeVideos} onChange={(event) => setIncludeVideos(event.target.checked)} /> <Film size={13} /> Vídeos ({videoCount})</label>
          {narration && includeVideos && <label className="check" title="Se o último vídeo acabar antes da narração, ele fica mais lento para chegar até o fim">
            <input type="checkbox" checked={stretchLastVideo} onChange={(event) => setStretchLastVideo(event.target.checked)} /> Esticar o último vídeo até o fim da narração</label>}
          {!narration && <label>Última imagem
            <input className="short" type="text" inputMode="decimal" value={lastImageText} onChange={(event) => setLastImageText(event.target.value)} /> s
          </label>}
        </div>

        <div className="assembly-summary">
          <b>{plan.clips.length}</b> arquivo(s) posicionado(s) · duração <b>{formatTimecode(narration?.duration ?? plan.end)}</b>
          {plan.skipped.length > 0 && <> · <b>{plan.skipped.length}</b> ignorado(s)</>}
          {measuringNarration && <span className="measuring"><Loader2 size={12} className="spin" /> medindo a narração…</span>}
        </div>

        {plan.issues.length > 0 && <ul className="assembly-issues">
          {plan.issues.map((issue, index) => <li key={index} className={issue.level}>
            {issue.level === "warning" ? <AlertTriangle size={13} /> : <Info size={13} />} {issue.message}
          </li>)}
        </ul>}

        <div className="assembly-table">
          <table>
            <thead><tr><th>Início</th><th>Arquivo</th><th>Duração</th><th>Fim</th></tr></thead>
            <tbody>
              {plan.clips.map((clip) => <tr key={clip.mediaId}>
                <td className="mono">{formatTimecode(clip.start)}</td>
                <td>{clip.kind === "video" ? <Film size={12} /> : <ImageIcon size={12} />} {clip.name}</td>
                <td className="mono">{formatSeconds(clip.duration)}s{clip.speed ? <span className="speed-tag"> · {Math.round(clip.speed * 100)}%</span> : null}</td>
                <td className="mono">{formatTimecode(clip.start + clip.duration)}</td>
              </tr>)}
              {plan.skipped.map((item) => <tr key={`skip-${item.mediaId}`} className="skipped">
                <td className="mono">—</td><td>{item.name}</td><td colSpan={2}>{item.reason}</td>
              </tr>)}
              {!plan.clips.length && !plan.skipped.length && <tr><td colSpan={4} className="empty">Importe imagens ou vídeos com o tempo no nome (botão “Importar pasta” na biblioteca).</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="modal-foot">
          <span>{timelineHasClips
            ? "Vai para trilhas novas, sem mexer no que já está na timeline. Ctrl+Z desfaz tudo de uma vez."
            : "Vai para V1 (imagens/vídeos) e A1 (narração). Ctrl+Z desfaz tudo de uma vez."}</span>
          <div>
            <button className="button secondary" onClick={onClose}>Cancelar</button>
            <button className="button primary" disabled={!canApply} onClick={() => onApply(plan, narration)}><WandSparkles size={15} /> Montar na timeline</button>
          </div>
        </div>
      </div>
    </div>
  );
}
