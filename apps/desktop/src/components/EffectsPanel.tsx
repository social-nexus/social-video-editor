import { useState } from "react";
import { Move, Sparkles } from "lucide-react";
import type { AnimationType, ClipAnimation, ClipFit, ClipMotion, MotionPreset, TimelineClip } from "../types";
import { ANIMATION_TYPES, DEFAULT_ANIMATION_DURATION, effectiveAnimations, makeAnimation, MAX_ANIMATION_DURATION, MIN_ANIMATION_DURATION } from "../lib/animations";
import { DEFAULT_FIT, DEFAULT_INTENSITY, makeMotion, MOTION_PRESETS } from "../lib/effects";

export type EffectsChange = { motion?: ClipMotion | null; fit?: ClipFit; animIn?: ClipAnimation | null; animOut?: ClipAnimation | null };
export type ApplyAllOptions = { choice: MotionPreset | "alternate"; intensity: number; smooth: boolean; fit: ClipFit | null };

type Props = {
  clip: TimelineClip;
  locked: boolean;
  imageClipCount: number;
  onChange: (clipId: string, change: EffectsChange) => void;
  onApplyAll: (options: ApplyAllOptions) => void;
  onCopyAnimations: (clipId: string) => void;
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

/** Enquadramento e movimento (Ken Burns) do clipe selecionado, no painel de propriedades. */
export default function EffectsPanel({ clip, locked, imageClipCount, onChange, onApplyAll, onCopyAnimations }: Props) {
  const motion = clip.motion;
  const preset: MotionPreset = motion?.preset ?? "none";
  const intensity = motion?.intensity ?? DEFAULT_INTENSITY;
  const smooth = motion?.smooth ?? true;
  const fit = clip.fit ?? DEFAULT_FIT;
  const [batchChoice, setBatchChoice] = useState<MotionPreset | "alternate">("alternate");

  const setMotion = (nextPreset: MotionPreset, nextIntensity = intensity, nextSmooth = smooth) =>
    onChange(clip.id, { motion: makeMotion(nextPreset, nextIntensity, nextSmooth) });

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
      <div className="effects-anim">
        <div className="tools-title small">Animação de entrada e saída</div>
        <AnimationField which="animIn" clip={clip} onChange={onChange} />
        <AnimationField which="animOut" clip={clip} onChange={onChange} />
      </div>
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
      <button className="button secondary compact full-width" onClick={() => onCopyAnimations(clip.id)}
        title="Copia a entrada e a saída deste clipe para todas as imagens de trilhas destravadas. Ctrl+Z desfaz.">
        Copiar entrada e saída para todas</button>
    </div>}
  </div>;
}
