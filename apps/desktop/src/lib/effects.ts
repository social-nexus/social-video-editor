import type { ClipMotion, MotionFrame, MotionPreset, TimelineClip } from "../types";

/** Enquadramento padrão: a mídia aparece inteira (com barras se a proporção for outra). */
export const DEFAULT_FIT = "contain" as const;

export const MOTION_PRESETS: { id: MotionPreset; label: string }[] = [
  { id: "none", label: "Sem movimento" },
  { id: "zoom-in", label: "Aproximar (zoom in)" },
  { id: "zoom-out", label: "Afastar (zoom out)" },
  { id: "pan-right", label: "Panorâmica → direita" },
  { id: "pan-left", label: "Panorâmica ← esquerda" },
  { id: "pan-down", label: "Panorâmica ↓ para baixo" },
  { id: "pan-up", label: "Panorâmica ↑ para cima" },
];

/** Ordem usada ao alternar movimentos numa sequência de imagens. */
export const ALTERNATE_CYCLE: MotionPreset[] = ["zoom-in", "pan-right", "zoom-out", "pan-left", "zoom-in", "pan-down", "zoom-out", "pan-up"];

export const DEFAULT_INTENSITY = 0.15;
const STILL: MotionFrame = { scale: 1, x: 0, y: 0 };

/**
 * Deslocamento máximo (fração do quadro) que um zoom `scale` permite sem mostrar a borda da mídia.
 * Com `transform: scale(s) translate(x, y)`, a borda aparece quando |x| > (s − 1) / (2s).
 */
export const maxOffset = (scale: number) => Math.max(0, (scale - 1) / (2 * scale));

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** Quadros inicial e final de um movimento pronto. `intensity` = quanto de zoom (0,15 = 15%). */
export function presetFrames(preset: MotionPreset, intensity = DEFAULT_INTENSITY): { from: MotionFrame; to: MotionFrame } {
  const zoom = 1 + Math.max(0.02, Math.min(0.6, intensity));
  const edge = round4(maxOffset(zoom) * 0.95);
  switch (preset) {
    case "zoom-in": return { from: STILL, to: { scale: zoom, x: 0, y: 0 } };
    case "zoom-out": return { from: { scale: zoom, x: 0, y: 0 }, to: STILL };
    // Câmera vai para a direita → a imagem desliza para a esquerda.
    case "pan-right": return { from: { scale: zoom, x: edge, y: 0 }, to: { scale: zoom, x: -edge, y: 0 } };
    case "pan-left": return { from: { scale: zoom, x: -edge, y: 0 }, to: { scale: zoom, x: edge, y: 0 } };
    case "pan-down": return { from: { scale: zoom, x: 0, y: edge }, to: { scale: zoom, x: 0, y: -edge } };
    case "pan-up": return { from: { scale: zoom, x: 0, y: -edge }, to: { scale: zoom, x: 0, y: edge } };
    default: return { from: STILL, to: STILL };
  }
}

/** Movimento completo de um preset (null = sem movimento). */
export function makeMotion(preset: MotionPreset, intensity = DEFAULT_INTENSITY, smooth = true): ClipMotion | null {
  if (preset === "none") return null;
  return { preset, intensity, smooth, ...presetFrames(preset, intensity) };
}

/** Curva suave (começa e termina devagar). */
const smoothstep = (p: number) => p * p * (3 - 2 * p);

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Progresso 0–1 da curva do movimento. */
export const motionProgress = (motion: Pick<ClipMotion, "smooth">, p: number) => {
  const clamped = Math.min(1, Math.max(0, p));
  return motion.smooth ? smoothstep(clamped) : clamped;
};

/** Quadro do movimento na fração `p` (0–1) do clipe. */
export function frameAt(motion: ClipMotion, p: number): MotionFrame {
  const eased = motionProgress(motion, p);
  return {
    scale: round4(lerp(motion.from.scale, motion.to.scale, eased)),
    x: round4(lerp(motion.from.x, motion.to.x, eased)),
    y: round4(lerp(motion.from.y, motion.to.y, eased)),
  };
}

/** Quadro do clipe no instante `time` da timeline (sem movimento = parado). */
export function clipFrameAt(clip: Pick<TimelineClip, "start" | "duration" | "motion">, time: number): MotionFrame {
  if (!clip.motion) return STILL;
  return frameAt(clip.motion, clip.duration > 0 ? (time - clip.start) / clip.duration : 0);
}

/** CSS do quadro: zoom a partir do centro e deslocamento em % do quadro. */
export const frameTransform = (frame: MotionFrame) =>
  frame.scale === 1 && frame.x === 0 && frame.y === 0 ? undefined
    : `scale(${frame.scale}) translate(${(frame.x * 100).toFixed(3)}%, ${(frame.y * 100).toFixed(3)}%)`;

/**
 * Pedaço [p0, p1] de um movimento (ao dividir ou sobrescrever um clipe):
 * cada parte continua exatamente de onde a outra parou.
 * As partes ficam com curva linear entre os quadros calculados (a curva suave é aproximada).
 */
export function sliceMotion(motion: ClipMotion | undefined, p0: number, p1: number): ClipMotion | undefined {
  if (!motion) return undefined;
  if (p0 <= 0 && p1 >= 1) return motion;
  return { ...motion, preset: "custom", from: frameAt(motion, p0), to: frameAt(motion, p1), smooth: false };
}

/** Presets para uma sequência de imagens: um só para todas, ou alternando para dar variedade. */
export function presetForIndex(choice: MotionPreset | "alternate", index: number): MotionPreset {
  return choice === "alternate" ? ALTERNATE_CYCLE[index % ALTERNATE_CYCLE.length] : choice;
}
