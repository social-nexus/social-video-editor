import { Captions, Download, FileUp, Trash2 } from "lucide-react";
import type { Caption, CaptionStyle } from "../types";
import { captionsAt } from "../lib/captions";
import type { CaptionFormat } from "../lib/captions";

/** Texto da legenda sobre o preview, no instante do playhead. */
export function CaptionOverlay({ captions, playhead, style }: { captions: Caption[]; playhead: number; style: CaptionStyle }) {
  if (!style.visible) return null;
  const active = captionsAt(captions, playhead);
  if (!active.length) return null;
  return <div className={`caption-overlay pos-${style.position} ${style.background ? "boxed" : ""}`}
    style={{ fontSize: `${style.size}cqh` }} aria-live="polite">
    {active.map((caption) => <span key={caption.id}>{caption.text}</span>)}
  </div>;
}

type Props = {
  captions: Caption[];
  style: CaptionStyle;
  onImport: () => void;
  onExport: (format: CaptionFormat) => void;
  onShift: (delta: number) => void;
  onClear: () => void;
  onStyleChange: (change: Partial<CaptionStyle>) => void;
};

/** Cartão de legendas no painel de propriedades. */
export default function CaptionsPanel({ captions, style, onImport, onExport, onShift, onClear, onStyleChange }: Props) {
  const has = captions.length > 0;
  return <div className="tools-card captions-card">
    <div className="tools-title"><Captions size={15} /> Legendas <small>{has ? `${captions.length} no projeto` : "nenhuma"}</small></div>
    <div className="captions-actions">
      <button className="button secondary compact" onClick={onImport} title="Importar arquivo .srt ou .vtt"><FileUp size={13} /> Importar SRT/VTT</button>
      <button className="button secondary compact" onClick={() => onExport("srt")} disabled={!has}><Download size={13} /> SRT</button>
      <button className="button secondary compact" onClick={() => onExport("vtt")} disabled={!has}><Download size={13} /> VTT</button>
    </div>
    {has && <>
      <div className="caption-setting">
        <span>Sincronia</span>
        <div className="caption-shift">
          {[-0.5, -0.1, 0.1, 0.5].map((delta) => <button key={delta} className="button secondary compact"
            title={`${delta < 0 ? "Adiantar" : "Atrasar"} todas as legendas`} onClick={() => onShift(delta)}>
            {delta > 0 ? "+" : "−"}{String(Math.abs(delta)).replace(".", ",")}s</button>)}
        </div>
      </div>
      <label className="caption-setting"><span>Tamanho</span>
        <input type="range" min={2} max={12} step={0.5} value={style.size} onChange={(event) => onStyleChange({ size: Number(event.target.value) })} />
        <b>{String(style.size).replace(".", ",")}</b></label>
      <label className="caption-setting"><span>Posição</span>
        <select value={style.position} onChange={(event) => onStyleChange({ position: event.target.value as CaptionStyle["position"] })}>
          <option value="bottom">Embaixo</option><option value="middle">No meio</option><option value="top">Em cima</option>
        </select></label>
      <label className="caption-setting check"><input type="checkbox" checked={style.background} onChange={(event) => onStyleChange({ background: event.target.checked })} /> Fundo escuro atrás do texto</label>
      <label className="caption-setting check"><input type="checkbox" checked={style.visible} onChange={(event) => onStyleChange({ visible: event.target.checked })} /> Mostrar no preview</label>
      <button className="button secondary compact danger" onClick={onClear}><Trash2 size={13} /> Remover todas</button>
    </>}
    {!has && <p className="captions-hint">Importe um .srt ou .vtt, ou dê duplo clique na faixa de legendas da timeline para criar uma.</p>}
  </div>;
}
