import { useState } from "react";
import { cleanPlacement, isIdentity, placementOf } from "../lib/placement";
import { DEFAULT_TRANSITION_DURATION, makeTransition, MAX_TRANSITION_DURATION, MIN_TRANSITION_DURATION, TRANSITION_TYPES } from "../lib/transitions";
import { Clapperboard, Move, Palette, Shuffle, Sparkles } from "lucide-react";
import { cleanColor, COLOR_FIELDS, COLOR_PRESETS, isNeutralColor, matchingColorPreset, NEUTRAL_COLOR } from "../lib/color";
import type { AnimationType, ClipAnimation, ClipColor, ClipFit, ClipMotion, MotionPreset, TimelineClip, ClipPlacement, ClipTransition, TransitionType } from "../types";
import { ANIMATION_TYPES, DEFAULT_ANIMATION_DURATION, effectiveAnimations, makeAnimation, MAX_ANIMATION_DURATION, MIN_ANIMATION_DURATION } from "../lib/animations";
import { DEFAULT_FIT, DEFAULT_INTENSITY, makeMotion, MOTION_PRESETS } from "../lib/effects";

export type EffectsChange = { motion?: ClipMotion | null; fit?: ClipFit; animIn?: ClipAnimation | null; animOut?: ClipAnimation | null; placement?: ClipPlacement | null; transition?: ClipTransition | null; color?: ClipColor | null };
export type ApplyAllOptions = { choice: MotionPreset | "alternate"; intensity: number; smooth: boolean; fit: ClipFit | null };
/** Qual parte do clipe o painel mostra (cada uma é uma mini-aba em Propriedades). */
export type EffectsSection = "frame" | "color" | "animation" | "transition";

type Props = {
  section: EffectsSection;
  clip: TimelineClip;
  locked: boolean;
  imageClipCount: number;
  onChange: (clipId: string, change: EffectsChange) => void;
  onApplyAll: (options: ApplyAllOptions) => void;
  onCopyAnimations: (clipId: string) => void;
  /** Há um clipe colado antes deste na mesma trilha (dá para ter transição). */
  hasPrevious: boolean;
  /** Quantos cortes (clipes colados) existem nas trilhas destravadas. */
  cutCount: number;
  onApplyTransitionAll: (transition: ClipTransition | null) => void;
  /** Sorteia entre os tipos escolhidos em todos os cortes. */
  onMixTransitions: (types: TransitionType[], duration: number) => void;
  /** Quantos clipes de imagem/vídeo há nas trilhas destravadas. */
  visualClipCount: number;
  onApplyColorAll: (color: ClipColor | null) => void;
};

const percent = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (value: number) => `${value.toFixed(1).replace(".", ",")} s`;

/** Seletor de uma animação (entrada ou saída) e sua duração. */
function AnimationField({ which, clip, onChange }: { which: "animIn" | "animOut"; clip: TimelineClip; onChange: (clipId: string, change: EffectsChange) => void }) {
  const current = clip[which];
  const label = which === "animIn" ? "Entrada" : "Saída";
  const effective = effectiveAnimations(clip)[which === "animIn" ? "inDur" : "outDur"];
  const set = (type: AnimationType | "none", duration = current?.duration ?? DEFAULT_ANIMATION_DURATION) =>
    onChange(clip.id, { [which]: type === "none" ? null : makeAnimation(type, duration) });
  return <>
    <label className="caption-setting"><span>{label}</span>
      <select value={current?.type ?? "none"} onChange={(event) => set(event.target.value as AnimationType | "none")}>
        <option value="none">Nenhuma</option>
        {ANIMATION_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{which === "animIn" ? entry.in : entry.out}</option>)}
      </select></label>
    {current && <label className="caption-setting"><span>Duração</span>
      <input type="range" min={MIN_ANIMATION_DURATION} max={MAX_ANIMATION_DURATION} step={0.1} value={current.duration}
        aria-label={`Duração da ${label.toLowerCase()}`} onChange={(event) => set(current.type, Number(event.target.value))} />
      <b title={effective < current.duration - 1e-6 ? "Encurtada para caber no clipe" : undefined}>{seconds(effective)}</b></label>}
  </>;
}

/** Ajustes do clipe selecionado: uma parte por mini-aba (enquadrar, animação ou transição). */
export default function EffectsPanel(props: Props) {
  const { section, clip, locked, imageClipCount, onChange, onApplyAll, onCopyAnimations } = props;
  const motion = clip.motion;
  const preset: MotionPreset = motion?.preset ?? "none";
  const intensity = motion?.intensity ?? DEFAULT_INTENSITY;
  const smooth = motion?.smooth ?? true;
  const fit = clip.fit ?? DEFAULT_FIT;
  const [batchChoice, setBatchChoice] = useState<MotionPreset | "alternate">("alternate");

  const setMotion = (nextPreset: MotionPreset, nextIntensity = intensity, nextSmooth = smooth) =>
    onChange(clip.id, { motion: makeMotion(nextPreset, nextIntensity, nextSmooth) });

  if (section === "transition") return <div className="tools-card effects-card">
    <div className="tools-title"><Clapperboard size={15} /> Transição</div>
    <fieldset disabled={locked} className="effects-fields">
      <TransitionField {...props} />
    </fieldset>
  </div>;

  if (section === "color") return <div className="tools-card effects-card">
    <div className="tools-title"><Palette size={15} /> Cor</div>
    <fieldset disabled={locked} className="effects-fields">
      <ColorFields {...props} />
    </fieldset>
  </div>;

  if (section === "animation") return <div className="tools-card effects-card">
    <div className="tools-title"><Sparkles size={15} /> Animação de entrada e saída</div>
    <fieldset disabled={locked} className="effects-fields">
      <AnimationField which="animIn" clip={clip} onChange={onChange} />
      <AnimationField which="animOut" clip={clip} onChange={onChange} />
    </fieldset>
    {imageClipCount > 1 && <div className="effects-batch">
      <button className="button secondary compact full-width" onClick={() => onCopyAnimations(clip.id)}
        title="Copia a entrada e a saída deste clipe para todas as imagens de trilhas destravadas. Ctrl+Z desfaz.">
        Copiar entrada e saída para todas as imagens</button>
    </div>}
  </div>;

  return <div className="tools-card effects-card">
    <div className="tools-title"><Move size={15} /> Enquadramento e movimento</div>
    <fieldset disabled={locked} className="effects-fields">
      <div className="caption-setting"><span>Enquadrar</span>
        <div className="segmented small" role="radiogroup" aria-label="Enquadramento">
          <button role="radio" aria-checked={fit === "contain"} className={fit === "contain" ? "active" : ""}
            title="Mostra a mídia inteira (pode sobrar barra)" onClick={() => onChange(clip.id, { fit: "contain" })}>Encaixar</button>
          <button role="radio" aria-checked={fit === "cover"} className={fit === "cover" ? "active" : ""}
            title="Preenche o quadro todo (corta as sobras)" onClick={() => onChange(clip.id, { fit: "cover" })}>Preencher</button>
        </div>
      </div>
      <PlacementFields clip={clip} onChange={onChange} />
      <label className="caption-setting"><span>Movimento</span>
        <select value={preset} onChange={(event) => setMotion(event.target.value as MotionPreset)}>
          {MOTION_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          {preset === "custom" && <option value="custom" disabled>Parte de um movimento (clipe dividido)</option>}
        </select></label>
      {motion && motion.preset !== "custom" && <>
        <label className="caption-setting"><span>Intensidade</span>
          <input type="range" min={0.05} max={0.5} step={0.01} value={intensity}
            onChange={(event) => setMotion(preset, Number(event.target.value))} />
          <b>{percent(intensity)}</b></label>
        <label className="caption-setting check"><input type="checkbox" checked={smooth} onChange={(event) => setMotion(preset, intensity, event.target.checked)} /> Suavizar início e fim</label>
      </>}
      {motion && fit === "contain" && <p className="captions-hint">Dica: com “Preencher” o movimento não mostra as bordas da imagem.</p>}
    </fieldset>

    {imageClipCount > 1 && <div className="effects-batch">
      <div className="tools-title small"><Sparkles size={13} /> Todas as imagens da timeline ({imageClipCount})</div>
      <label className="caption-setting"><span>Movimento</span>
        <select value={batchChoice} onChange={(event) => setBatchChoice(event.target.value as MotionPreset | "alternate")}>
          <option value="alternate">Alternar movimentos</option>
          {MOTION_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select></label>
      <button className="button secondary compact full-width" onClick={() => onApplyAll({ choice: batchChoice, intensity, smooth, fit: batchChoice === "none" ? null : "cover" })}
        title="Aplica em todas as imagens de trilhas destravadas (e usa “Preencher”). Ctrl+Z desfaz.">
        Aplicar em todas as imagens</button>
    </div>}
  </div>;
}

/** Posição, tamanho e rotação em números (o mesmo que arrastar as alças no preview). */
function PlacementFields({ clip, onChange }: { clip: TimelineClip; onChange: (clipId: string, change: EffectsChange) => void }) {
  const p = placementOf(clip);
  const set = (change: Partial<typeof p>) => {
    const next = cleanPlacement({ ...p, ...change });
    onChange(clip.id, { placement: isIdentity(next) ? null : next });
  };
  const field = (label: string, value: number, apply: (value: number) => void, unit: string, step: number) =>
    <label className="placement-field"><span>{label}</span>
      <input type="number" step={step} value={Math.round(value * 10) / 10}
        onChange={(event) => { const number = Number(event.target.value); if (event.target.value !== "" && Number.isFinite(number)) apply(number); }} />
      <em>{unit}</em></label>;
  return <div className="placement-grid">
    <div className="placement-head"><span>Posição no quadro</span>
      {!isIdentity(clip.placement) && <button className="link-button" onClick={() => onChange(clip.id, { placement: null })}
        title="Volta ao centro, tamanho normal e sem rotação">Restaurar</button>}
    </div>
    {field("X", p.x * 100, (value) => set({ x: value / 100 }), "%", 1)}
    {field("Y", p.y * 100, (value) => set({ y: value / 100 }), "%", 1)}
    {field("Tamanho", p.scale * 100, (value) => set({ scale: value / 100 }), "%", 5)}
    {field("Rotação", p.rotation, (value) => set({ rotation: value }), "°", 5)}
    <small>Ou arraste no preview: o meio move, os cantos mudam o tamanho e a bolinha gira (Shift: de 15 em 15°).</small>
  </div>;
}

/** Transição do clipe anterior (colado na mesma trilha) para este, e o sorteio em todos os cortes. */
function TransitionField({ clip, hasPrevious, cutCount, onChange, onApplyTransitionAll, onMixTransitions }: Props) {
  const current = clip.transition;
  const duration = current?.duration ?? DEFAULT_TRANSITION_DURATION;
  const [picks, setPicks] = useState<TransitionType[]>(["dissolve", "push-left", "zoom-in", "circle-open"]);
  const set = (type: TransitionType | "none", nextDuration = duration) =>
    onChange(clip.id, { transition: type === "none" ? null : makeTransition(type, nextDuration) });
  const toggle = (type: TransitionType) => setPicks((list) => list.includes(type) ? list.filter((entry) => entry !== type) : [...list, type]);
  return <>
    {!hasPrevious ? <p className="captions-hint">Para ter transição, este clipe precisa começar colado no fim de outro, na mesma trilha.
      Use o “+” que aparece no corte da timeline.</p> : <>
      <label className="caption-setting"><span>Tipo</span>
        <select value={current?.type ?? "none"} onChange={(event) => set(event.target.value as TransitionType | "none")}>
          <option value="none">Corte seco</option>
          {TRANSITION_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select></label>
      {current && <label className="caption-setting"><span>Duração</span>
        <input type="range" min={MIN_TRANSITION_DURATION} max={MAX_TRANSITION_DURATION} step={0.1} value={duration}
          aria-label="Duração da transição" onChange={(event) => set(current.type, Number(event.target.value))} />
        <b>{String(duration).replace(".", ",")}s</b></label>}
    </>}
    {cutCount > 1 && <>
      <button className="button secondary compact full-width" onClick={() => onApplyTransitionAll(current ?? null)}
        title="Usa a mesma transição (ou o corte seco) em todos os cortes das trilhas destravadas. Ctrl+Z desfaz.">
        {current ? "Usar esta transição em todos os cortes" : "Tirar a transição de todos os cortes"} ({cutCount})</button>
      <div className="transition-mix">
        <div className="tools-title small"><Shuffle size={13} /> Sortear nos cortes</div>
        <div className="mix-chips">
          {TRANSITION_TYPES.map((entry) => <button key={entry.id} type="button" className={`mix-chip ${picks.includes(entry.id) ? "on" : ""}`}
            aria-pressed={picks.includes(entry.id)} onClick={() => toggle(entry.id)}>{entry.label.replace(/ \(.*\)$/, "")}</button>)}
        </div>
        <button className="button secondary compact full-width" disabled={!picks.length} onClick={() => onMixTransitions(picks, duration)}
          title="Cada corte ganha uma das escolhidas, sem repetir a mesma em cortes seguidos. Ctrl+Z desfaz.">
          Sortear em todos os cortes ({cutCount})</button>
      </div>
    </>}
  </>;
}

/** Correção de cor: filtros prontos e ajustes finos (o mesmo resultado no preview e na exportação). */
function ColorFields({ clip, onChange, visualClipCount, onApplyColorAll }: Props) {
  const color = clip.color ?? NEUTRAL_COLOR;
  const preset = matchingColorPreset(clip.color);
  const set = (next: ClipColor) => { const clean = cleanColor(next); onChange(clip.id, { color: isNeutralColor(clean) ? null : clean }); };
  return <>
    <div className="color-presets">
      <button type="button" className={`mix-chip ${isNeutralColor(clip.color) ? "on" : ""}`} onClick={() => onChange(clip.id, { color: null })}>Original</button>
      {COLOR_PRESETS.map((entry) => <button key={entry.id} type="button" className={`mix-chip ${preset === entry.id ? "on" : ""}`}
        onClick={() => set(entry.color)}>{entry.label}</button>)}
    </div>
    {COLOR_FIELDS.map((field) => <label key={field.key} className="caption-setting color-field"><span>{field.label}</span>
      <input type="range" min={field.min} max={field.max} step={0.01} value={color[field.key]} aria-label={field.label}
        onChange={(event) => set({ ...color, [field.key]: Number(event.target.value) })}
        onDoubleClick={() => set({ ...color, [field.key]: 0 })} title="Duplo clique volta ao normal" />
      <b>{color[field.key] > 0 && field.key !== "sepia" ? "+" : ""}{Math.round(color[field.key] * 100)}</b></label>)}
    {!isNeutralColor(clip.color) && <button className="link-button" onClick={() => onChange(clip.id, { color: null })}>Restaurar cores originais</button>}
    {visualClipCount > 1 && <button className="button secondary compact full-width" onClick={() => onApplyColorAll(clip.color ?? null)}
      title="Usa estes ajustes de cor em todas as imagens e vídeos das trilhas destravadas. Ctrl+Z desfaz.">
      {isNeutralColor(clip.color) ? "Tirar a cor de todos os clipes" : "Usar esta cor em todos os clipes"} ({visualClipCount})</button>}
  </>;
}
