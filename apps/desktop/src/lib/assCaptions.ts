import type { Caption, CaptionStyle } from "../types";
import { CAPTION_ANIMATION_TIME, captionAppearance, captionBoxWidth, captionPlacement, captionWords, wordGroups, type CaptionWord } from "./captionWords";

/**
 * Legendas para gravar no vídeo (formato ASS, desenhado pelo libass do ffmpeg),
 * com o mesmo visual do preview: tamanho, posição, contorno, fundo, destaque e animação.
 */

/** Fonte usada no preview e na exportação (padrão do Windows). */
export const CAPTION_FONT = "Segoe UI";
export const CAPTION_FONT_BLACK = "Segoe UI Black";
/** No libass o tamanho da fonte é a altura da linha; na Segoe UI isso dá ≈ 1,33 × o font-size do CSS. */
export const ASS_FONT_SCALE = 1.33;

const FRAME = 1 / 30;

const pad2 = (value: number) => String(value).padStart(2, "0");
/** Tempo no formato do ASS (H:MM:SS.cc). */
export function assTime(seconds: number) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs % 100)}`;
}

/** "#rrggbb" → "&HBBGGRR&" (cor do ASS). */
export function assColor(hex: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "ffffff";
  return `&H${(clean.slice(4, 6) + clean.slice(2, 4) + clean.slice(0, 2)).toUpperCase()}&`;
}
const alphaTag = (value: number) => `&H${Math.max(0, Math.min(255, Math.round(value))).toString(16).toUpperCase().padStart(2, "0")}&`;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Texto seguro para o ASS (chaves e barra invertida são comandos lá). */
const assText = (text: string) => text.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")");

type Layer = "box" | "hibox" | "text";
type Base = { a1: number; a3: number; a4: number };
type Geometry = { width: number; height: number };

/** Transparência de cada parte (texto, contorno/caixa, sombra) em cada camada. */
function baseAlpha(layer: Layer, active: boolean): Base {
  if (layer === "box") return { a1: 255, a3: 0x44, a4: 255 };
  if (layer === "hibox") return { a1: 255, a3: active ? 0 : 255, a4: 255 };
  return { a1: 0, a3: 0, a4: 0x60 };
}
const faded = (base: number, opacity: number) => 255 - (255 - base) * opacity;

export function buildAssCaptions(captions: Caption[], style: CaptionStyle, { width, height }: Geometry): string | null {
  if (!captions.length) return null;
  const fontPx = (style.size / 100) * height;
  const fontSize = Math.round(fontPx * ASS_FONT_SCALE);
  const black = style.weight === "black";
  const font = black ? CAPTION_FONT_BLACK : CAPTION_FONT;
  const bold = black ? 0 : -1;
  const align = style.position === "top" ? 8 : style.position === "middle" || style.position === "custom" ? 5 : 2;
  const marginV = style.position === "top" ? Math.round(height * 0.08) : style.position === "middle" || style.position === "custom" ? 0 : Math.round(height * 0.1);
  const marginH = Math.round(width * 0.06);
  /** Onde fica cada legenda (a posição própria dela ou a do estilo). */
  const placeOf = (caption: Caption) => {
    const place = captionPlacement(caption, style);
    const custom = place.position === "custom";
    return {
      custom,
      // Posição livre: a largura da linha acompanha a distância até a borda (margens do próprio evento).
      margin: custom ? Math.round(width * (1 - captionBoxWidth(place.x)) / 2) : 0,
      x: custom ? round1(place.x * width) : Math.round(width / 2),
      y: custom ? round1(place.y * height) : style.position === "top" ? marginV : style.position === "middle" ? height / 2 : height - marginV,
    };
  };
  const outline = style.background || !style.outline ? 0 : round1(fontPx * 0.07);
  const shadowY = style.background ? 0 : round1(fontPx * 0.05);
  const text = assColor(style.textColor);
  const highlight = assColor(style.highlightColor);
  const styleLine = (name: string, primary: string, outlineColor: string, borderStyle: number, border: number) =>
    `Style: ${name},${font},${fontSize},${primary},${primary},${outlineColor},&H60000000,${bold},0,0,0,100,100,0,0,${borderStyle},${border},0,${align},${marginH},${marginH},${marginV},1`;

  const events: string[] = [];
  const emit = (layer: Layer, start: number, end: number, body: string, margin: number) => {
    const index = layer === "box" ? 0 : layer === "hibox" ? 1 : 2;
    const name = layer === "box" ? "Box" : layer === "hibox" ? "HiBox" : "Main";
    events.push(`Dialogue: ${index},${assTime(start)},${assTime(end)},${name},,${margin},${margin},0,,${body}`);
  };

  const blocks = captions.flatMap((caption) => {
    const words = captionWords({ ...caption, text: style.uppercase ? caption.text.toLocaleUpperCase("pt-BR") : caption.text });
    if (!words.length) return [];
    const place = placeOf(caption);
    return (style.mode === "words" ? wordGroups(words, style.wordsPerGroup).map((group) => group.map((word) => ({ ...word, lineBreakBefore: false })))
      : [words]).map((blockWords) => ({ words: blockWords, place }));
  });

  for (const { words, place } of blocks) {
    const anchorX = place.x, anchorY = place.y;
    // \an5 + \pos: centro do bloco no ponto (vale mesmo se o estilo for "embaixo"/"em cima").
    const anchorTag = place.custom ? "\\an5" : "";
    const start = words[0].start, end = words[words.length - 1].end;
    const animEnd = start + CAPTION_ANIMATION_TIME;
    const cuts = new Set([start, end]);
    if (style.highlight !== "none") words.forEach((word) => { if (word.start > start && word.start < end) cuts.add(word.start); });
    if (style.animation !== "none" && animEnd < end) cuts.add(animEnd);
    const times = [...cuts].sort((a, b) => a - b);

    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1];
      if (b - a < 0.005) continue;
      const activeIndex = style.highlight === "none" ? -1 : words.findIndex((word) => a >= word.start - 1e-9 && a < word.end - 1e-9);
      const animated = style.animation !== "none" && a < animEnd - 1e-6;

      // Animação de entrada do bloco: estados quadro a quadro dentro deste pedaço.
      const steps: { ms: number; opacity: number; scale: number; rise: number }[] = [];
      if (animated) {
        const count = Math.max(1, Math.ceil((b - a) / FRAME - 1e-6));
        for (let s = 0; s <= count; s++) {
          const time = a + ((b - a) * s) / count;
          const look = captionAppearance(style.animation, (time - start) / CAPTION_ANIMATION_TIME);
          steps.push({ ms: Math.round((time - a) * 1000), ...look });
        }
      }
      const runTags = (base: Base, extra: string) => {
        if (!steps.length) return `{\\1a${alphaTag(base.a1)}\\3a${alphaTag(base.a3)}\\4a${alphaTag(base.a4)}${extra}}`;
        const state = (step: typeof steps[number]) =>
          `\\fscx${round1(step.scale * 100)}\\fscy${round1(step.scale * 100)}\\1a${alphaTag(faded(base.a1, step.opacity))}\\3a${alphaTag(faded(base.a3, step.opacity))}\\4a${alphaTag(faded(base.a4, step.opacity))}`;
        let tags = `{${state(steps[0])}${extra}`;
        for (let s = 1; s < steps.length; s++) tags += `\\t(${steps[s - 1].ms},${steps[s].ms},${state(steps[s])})`;
        return `${tags}}`;
      };
      const rise = steps.length && (steps[0].rise || steps[steps.length - 1].rise)
        ? `{${anchorTag}\\move(${anchorX},${round1(anchorY + steps[0].rise * fontPx)},${anchorX},${round1(anchorY + steps[steps.length - 1].rise * fontPx)},0,${steps[steps.length - 1].ms})}`
        : place.custom ? `{\\an5\\pos(${anchorX},${anchorY})}` : "";

      const body = (layer: Layer) => {
        let out = rise;
        words.forEach((word: CaptionWord, index) => {
          const active = index === activeIndex;
          const color = layer === "text" && active && style.highlight === "color" ? highlight : text;
          const extra = layer === "text" ? `\\1c${color}\\yshad${shadowY}\\xshad0` : "";
          const separator = word.lineBreakBefore ? "\\N" : index > 0 ? " " : "";
          // O espaço fica fora da caixa da palavra destacada.
          if (separator === " ") out += `${runTags(baseAlpha(layer, false), layer === "text" ? `\\1c${text}` : "")} `;
          else out += separator;
          out += `${runTags(baseAlpha(layer, active), extra)}${assText(word.text)}`;
        });
        return out;
      };

      if (style.background) emit("box", a, b, body("box"), place.margin);
      if (style.highlight === "box" && activeIndex >= 0) emit("hibox", a, b, body("hibox"), place.margin);
      emit("text", a, b, body("text"), place.margin);
    }
  }

  return [
    "[Script Info]",
    "; Gerado pelo Social Video Editor",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 1",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine("Main", text, "&H00000000", 1, outline),
    styleLine("Box", "&HFF000000", "&H44000000", 3, round1(fontPx * 0.22)),
    styleLine("HiBox", "&HFF000000", highlight, 3, round1(fontPx * 0.12)),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
