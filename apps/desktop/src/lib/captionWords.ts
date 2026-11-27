import type { Caption, CaptionAnimation, CaptionStyle } from "../types";
import { captionsAt } from "./captions";

/** Uma palavra da legenda com o tempo estimado em que é falada. */
export type CaptionWord = { text: string; start: number; end: number; lineBreakBefore: boolean };

const SENTENCE_END = /[.!?…]["'”»)]*$/;
const CLAUSE_END = /[,;:]["'”»)]*$/;

/** Peso de uma palavra no tempo da fala: letras + uma base + pausa depois da pontuação. */
function wordWeight(text: string) {
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
  let weight = Math.max(1, letters) + 2;
  if (SENTENCE_END.test(text)) weight += 4;
  else if (CLAUSE_END.test(text)) weight += 2;
  return weight;
}

/**
 * Divide a legenda em palavras e distribui o tempo pelo tamanho de cada uma.
 * É uma estimativa: com transcrição (Whisper) o tempo de cada palavra viria exato.
 */
export function captionWords(caption: Pick<Caption, "start" | "end" | "text">): CaptionWord[] {
  const tokens: { text: string; lineBreakBefore: boolean }[] = [];
  caption.text.split("\n").forEach((line, lineIndex) => {
    line.split(/\s+/).filter(Boolean).forEach((text, wordIndex) =>
      tokens.push({ text, lineBreakBefore: lineIndex > 0 && wordIndex === 0 }));
  });
  if (!tokens.length) return [];
  const weights = tokens.map((token) => wordWeight(token.text));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = caption.end - caption.start;
  let cursor = caption.start;
  return tokens.map((token, index) => {
    const start = cursor;
    cursor = index === tokens.length - 1 ? caption.end : cursor + (span * weights[index]) / total;
    return { ...token, start, end: cursor };
  });
}

/** Agrupa as palavras de `size` em `size`, quebrando também no fim de frase. */
export function wordGroups(words: CaptionWord[], size: number): CaptionWord[][] {
  const limit = Math.max(1, Math.round(size));
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  for (const word of words) {
    current.push(word);
    if (current.length >= limit || SENTENCE_END.test(word.text)) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  return groups;
}

export type WordState = "past" | "active" | "future";
export type CaptionLineWord = { text: string; state: WordState; lineBreakBefore: boolean };
/** O que a legenda mostra num instante: blocos de palavras e quanto da animação de entrada já passou. */
export type CaptionBlock = { key: string; captionId: string; words: CaptionLineWord[]; appear: number };

/** Tempo da animação de entrada do bloco, em segundos. */
export const CAPTION_ANIMATION_TIME = 0.2;

const stateAt = (word: CaptionWord, time: number): WordState =>
  time < word.start ? "future" : time < word.end ? "active" : "past";

/** Blocos visíveis no instante `time`, conforme o modo (legenda inteira ou palavras). */
export function captionBlocksAt(captions: Caption[], time: number, style: Pick<CaptionStyle, "mode" | "wordsPerGroup">): CaptionBlock[] {
  const blocks: CaptionBlock[] = [];
  for (const caption of captionsAt(captions, time)) {
    const words = captionWords(caption);
    if (!words.length) continue;
    if (style.mode === "words") {
      const groups = wordGroups(words, style.wordsPerGroup);
      const index = groups.findIndex((group) => time >= group[0].start && time < group[group.length - 1].end);
      if (index < 0) continue;
      const group = groups[index];
      blocks.push({
        key: `${caption.id}:${index}`,
        captionId: caption.id,
        words: group.map((word) => ({ text: word.text, state: stateAt(word, time), lineBreakBefore: false })),
        appear: Math.min(1, (time - group[0].start) / CAPTION_ANIMATION_TIME),
      });
    } else {
      blocks.push({
        key: caption.id,
        captionId: caption.id,
        words: words.map((word) => ({ text: word.text, state: stateAt(word, time), lineBreakBefore: word.lineBreakBefore })),
        appear: Math.min(1, (time - caption.start) / CAPTION_ANIMATION_TIME),
      });
    }
  }
  return blocks;
}

const easeOutBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

/** Opacidade, zoom e subida (em em) do bloco durante a animação de entrada. */
export function captionAppearance(animation: CaptionAnimation, appear: number) {
  const p = Math.min(1, Math.max(0, appear));
  switch (animation) {
    case "pop": return { opacity: Math.min(1, p * 3), scale: 0.6 + 0.4 * easeOutBack(p), rise: 0 };
    case "fade": return { opacity: p, scale: 1, rise: 0 };
    case "rise": return { opacity: p, scale: 1, rise: (1 - p) ** 3 * 0.6 };
    default: return { opacity: 1, scale: 1, rise: 0 };
  }
}

/** Estilos prontos (aplicam só os campos de aparência). */
export const CAPTION_PRESETS: { id: string; label: string; style: Partial<CaptionStyle> }[] = [
  { id: "classic", label: "Clássica", style: { mode: "full", highlight: "none", outline: true, background: false, uppercase: false, weight: "bold", animation: "none", textColor: "#ffffff" } },
  { id: "karaoke", label: "Karaokê (3 palavras)", style: { mode: "words", wordsPerGroup: 3, highlight: "color", highlightColor: "#facc15", outline: true, background: false, uppercase: true, weight: "black", animation: "pop", textColor: "#ffffff" } },
  { id: "one-word", label: "Uma palavra por vez", style: { mode: "words", wordsPerGroup: 1, highlight: "none", outline: true, background: false, uppercase: true, weight: "black", animation: "pop", textColor: "#ffffff" } },
  { id: "box", label: "Palavra em destaque (caixa)", style: { mode: "words", wordsPerGroup: 3, highlight: "box", highlightColor: "#ec4899", outline: true, background: false, uppercase: true, weight: "black", animation: "rise", textColor: "#ffffff" } },
  { id: "subtitle", label: "Legenda com fundo", style: { mode: "full", highlight: "none", outline: false, background: true, uppercase: false, weight: "bold", animation: "fade", textColor: "#ffffff" } },
];

/** Qual estilo pronto corresponde ao estilo atual ("" = personalizado). */
export function matchingPreset(style: CaptionStyle) {
  return CAPTION_PRESETS.find((preset) => Object.entries(preset.style)
    .every(([key, value]) => style[key as keyof CaptionStyle] === value))?.id ?? "";
}

/** Cores rápidas para o destaque da palavra falada. */
export const HIGHLIGHT_SWATCHES = ["#facc15", "#ec4899", "#22c55e", "#38bdf8", "#f97316", "#a855f7", "#ef4444", "#ffffff"];

const HEX = /^#[0-9a-f]{6}$/i;

/** Estilo salvo no projeto, validado campo a campo (projetos antigos ganham os padrões). */
export function validCaptionStyle(saved: any, defaults: CaptionStyle): CaptionStyle {
  const value = saved ?? {};
  const size = Number(value.size);
  const perGroup = Number(value.wordsPerGroup);
  const pick = <T,>(entry: unknown, options: readonly T[], fallback: T) => options.includes(entry as T) ? entry as T : fallback;
  return {
    visible: value.visible !== false,
    size: Number.isFinite(size) && size >= 2 && size <= 12 ? size : defaults.size,
    position: pick(value.position, ["bottom", "middle", "top"] as const, defaults.position),
    background: Boolean(value.background),
    mode: pick(value.mode, ["full", "words"] as const, defaults.mode),
    wordsPerGroup: Number.isFinite(perGroup) && perGroup >= 1 && perGroup <= 5 ? Math.round(perGroup) : defaults.wordsPerGroup,
    highlight: pick(value.highlight, ["none", "color", "box"] as const, defaults.highlight),
    highlightColor: typeof value.highlightColor === "string" && HEX.test(value.highlightColor) ? value.highlightColor : defaults.highlightColor,
    textColor: typeof value.textColor === "string" && HEX.test(value.textColor) ? value.textColor : defaults.textColor,
    outline: value.outline === undefined ? defaults.outline : Boolean(value.outline),
    uppercase: Boolean(value.uppercase),
    weight: pick(value.weight, ["bold", "black"] as const, defaults.weight),
    animation: pick(value.animation, ["none", "pop", "fade", "rise"] as const, defaults.animation),
  };
}
