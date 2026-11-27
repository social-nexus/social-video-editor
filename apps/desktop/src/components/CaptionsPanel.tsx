import { Captions, Download, FileUp, Trash2 } from "lucide-react";
import type { Caption, CaptionAnimation, CaptionHighlight, CaptionStyle } from "../types";
import { Fragment } from "react";
import type { CSSProperties } from "react";
import { CAPTION_PRESETS, captionAppearance, captionBlocksAt, HIGHLIGHT_SWATCHES, matchingPreset } from "../lib/captionWords";
import type { CaptionFormat } from "../lib/captions";

/** Texto da legenda sobre o preview, no instante do playhead (legenda inteira ou palavra por palavra). */
export function CaptionOverlay({ captions, playhead, style, selectedId, onSelect }: {
  captions: Caption[]; playhead: number; style: CaptionStyle; selectedId?: string | null; onSelect?: (captionId: string) => void;
}) {
  if (!style.visible) return null;
  const blocks = captionBlocksAt(captions, playhead, style);
  if (!blocks.length) return null;
  const classes = ["caption-overlay", `pos-${style.position}`, style.background ? "boxed" : "", style.outline ? "outlined" : "",
    style.uppercase ? "upper" : "", style.weight === "black" ? "black" : "", `hl-${style.highlight}`].filter(Boolean).join(" ");
  const vars = { fontSize: `${style.size}cqh`, "--caption-color": style.textColor, "--caption-highlight": style.highlightColor } as CSSProperties;
  return <div className={classes} style={vars} aria-live="polite">
    {blocks.map((block) => {
      const look = captionAppearance(style.animation, block.appear);
      return <div key={block.key} className={`caption-line ${onSelect ? "editable" : ""} ${block.captionId === selectedId ? "selected" : ""}`}
        title={onSelect ? "Clique para editar o texto desta legenda" : undefined}
        onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(block.captionId); } : undefined}
        style={look.opacity < 1 || look.scale !== 1 || look.rise ? { opacity: look.opacity, transform: `translateY(${look.rise}em) scale(${look.scale})` } : undefined}>
        <span className="caption-text">{block.words.map((word, index) => <Fragment key={index}>
          {word.lineBreakBefore ? <br /> : index > 0 ? " " : null}
          <span className={`caption-word ${word.state}`}>{word.text}</span>
        </Fragment>)}</span>
      </div>;
    })}
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
      <div className="caption-style-group">
        <div className="tools-title small">Estilo e efeitos</div>
        <label className="caption-setting"><span>Estilo pronto</span>
          <select value={matchingPreset(style)} onChange={(event) => { const preset = CAPTION_PRESETS.find((entry) => entry.id === event.target.value); if (preset) onStyleChange(preset.style); }}>
            <option value="" disabled>Personalizado</option>
            {CAPTION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select></label>
        <div className="caption-setting"><span>Mostrar</span>
          <div className="segmented small" role="radiogroup" aria-label="Modo da legenda">
            <button role="radio" aria-checked={style.mode === "full"} className={style.mode === "full" ? "active" : ""} onClick={() => onStyleChange({ mode: "full" })}>Frase inteira</button>
            <button role="radio" aria-checked={style.mode === "words"} className={style.mode === "words" ? "active" : ""} onClick={() => onStyleChange({ mode: "words" })}>Palavras</button>
          </div></div>
        {style.mode === "words" && <label className="caption-setting"><span>Por vez</span>
          <input type="range" min={1} max={5} step={1} value={style.wordsPerGroup} aria-label="Palavras por vez" onChange={(event) => onStyleChange({ wordsPerGroup: Number(event.target.value) })} />
          <b>{style.wordsPerGroup}</b></label>}
        <label className="caption-setting"><span>Destaque</span>
          <select value={style.highlight} onChange={(event) => onStyleChange({ highlight: event.target.value as CaptionHighlight })}>
            <option value="none">Nenhum</option><option value="color">Cor na palavra falada</option><option value="box">Caixa na palavra falada</option>
          </select></label>
        {style.highlight !== "none" && <div className="caption-setting caption-colors"><span>Cor do destaque</span>
          <div className="swatches" role="radiogroup" aria-label="Cor do destaque">
            {HIGHLIGHT_SWATCHES.map((color) => <button key={color} role="radio" aria-checked={style.highlightColor === color} title={color}
              className={`swatch ${style.highlightColor === color ? "active" : ""}`} style={{ background: color }}
              onClick={() => onStyleChange({ highlightColor: color })} />)}
            <label className="swatch custom" title="Outra cor…"><input type="color" value={style.highlightColor} aria-label="Outra cor de destaque"
              onChange={(event) => onStyleChange({ highlightColor: event.target.value })} /></label>
          </div></div>}
        <label className="caption-setting"><span>Cor do texto</span>
          <input type="color" value={style.textColor} aria-label="Cor do texto" onChange={(event) => onStyleChange({ textColor: event.target.value })} /></label>
        <label className="caption-setting"><span>Animação</span>
          <select value={style.animation} onChange={(event) => onStyleChange({ animation: event.target.value as CaptionAnimation })}>
            <option value="none">Nenhuma</option><option value="pop">Pop</option><option value="fade">Surgir (fade)</option><option value="rise">Subir</option>
          </select></label>
        <label className="caption-setting check"><input type="checkbox" checked={style.outline} onChange={(event) => onStyleChange({ outline: event.target.checked })} /> Contorno preto</label>
        <label className="caption-setting check"><input type="checkbox" checked={style.uppercase} onChange={(event) => onStyleChange({ uppercase: event.target.checked })} /> Tudo em maiúsculas</label>
        <label className="caption-setting check"><input type="checkbox" checked={style.weight === "black"} onChange={(event) => onStyleChange({ weight: event.target.checked ? "black" : "bold" })} /> Letra extra forte</label>
        {style.mode === "words" && <p className="captions-hint">O tempo de cada palavra é estimado pelo tamanho dela dentro da legenda.</p>}
      </div>
      <label className="caption-setting check"><input type="checkbox" checked={style.background} onChange={(event) => onStyleChange({ background: event.target.checked })} /> Fundo escuro atrás do texto</label>
      <label className="caption-setting check"><input type="checkbox" checked={style.visible} onChange={(event) => onStyleChange({ visible: event.target.checked })} /> Mostrar no preview</label>
      <button className="button secondary compact danger" onClick={onClear}><Trash2 size={13} /> Remover todas</button>
    </>}
    {!has && <p className="captions-hint">Importe um .srt ou .vtt, ou dê duplo clique na faixa de legendas da timeline para criar uma.</p>}
  </div>;
}
