import { describe, expect, it } from "vitest";
import { captionAppearance, captionBlocksAt, captionWords, validCaptionStyle, wordGroups } from "./captionWords";
import { DEFAULT_CAPTION_STYLE } from "../types";
import type { Caption } from "../types";

const cap = (text: string, start = 0, end = 3, id = "c1"): Caption => ({ id, start, end, text });

describe("tempo das palavras", () => {
  it("cobre a legenda inteira, em ordem e sem buracos", () => {
    const words = captionWords(cap("Olá mundo, tudo bem?", 2, 5));
    expect(words.map((word) => word.text)).toEqual(["Olá", "mundo,", "tudo", "bem?"]);
    expect(words[0].start).toBe(2);
    expect(words[words.length - 1].end).toBe(5);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeCloseTo(words[i - 1].end);
  });
  it("palavras longas e pontuação ganham mais tempo", () => {
    const [short, long] = captionWords(cap("é extraordinariamente"));
    expect(long.end - long.start).toBeGreaterThan(short.end - short.start);
    const [plain, comma] = captionWords(cap("casa casa,"));
    expect(comma.end - comma.start).toBeGreaterThan(plain.end - plain.start);
  });
  it("guarda as quebras de linha", () => {
    const words = captionWords(cap("primeira linha\nsegunda"));
    expect(words.map((word) => word.lineBreakBefore)).toEqual([false, false, true]);
  });
});

describe("grupos", () => {
  it("agrupa de N em N e quebra no fim de frase", () => {
    const groups = wordGroups(captionWords(cap("um dois três quatro. cinco seis")), 3);
    expect(groups.map((group) => group.map((word) => word.text).join(" "))).toEqual(["um dois três", "quatro.", "cinco seis"]);
  });
});

describe("o que aparece no instante", () => {
  const captions = [cap("um dois três quatro cinco seis", 0, 6)];
  it("frase inteira marca a palavra falada", () => {
    const [block] = captionBlocksAt(captions, 0.1, { mode: "full", wordsPerGroup: 3 });
    expect(block.words).toHaveLength(6);
    expect(block.words[0].state).toBe("active");
    expect(block.words[1].state).toBe("future");
  });
  it("palavras: mostra só o grupo atual", () => {
    const [first] = captionBlocksAt(captions, 0.1, { mode: "words", wordsPerGroup: 3 });
    expect(first.words.map((word) => word.text)).toEqual(["um", "dois", "três"]);
    const [second] = captionBlocksAt(captions, 5.9, { mode: "words", wordsPerGroup: 3 });
    expect(second.words.map((word) => word.text)).toEqual(["quatro", "cinco", "seis"]);
    expect(second.words[2].state).toBe("active");
    expect(second.words[0].state).toBe("past");
    expect(second.key).not.toBe(first.key);
  });
  it("fora da legenda não mostra nada", () => {
    expect(captionBlocksAt(captions, 7, { mode: "words", wordsPerGroup: 2 })).toEqual([]);
  });
  it("animação de entrada termina no estado normal", () => {
    expect(captionAppearance("pop", 1)).toEqual({ opacity: 1, scale: 1, rise: 0 });
    expect(captionAppearance("pop", 0).scale).toBeCloseTo(0.6);
    expect(captionAppearance("rise", 0).rise).toBeCloseTo(0.6);
  });
});

describe("estilo salvo", () => {
  it("projeto antigo ganha os padrões novos", () => {
    const style = validCaptionStyle({ visible: true, size: 7, position: "top", background: true }, DEFAULT_CAPTION_STYLE);
    expect(style).toEqual({ ...DEFAULT_CAPTION_STYLE, size: 7, position: "top", background: true });
  });
  it("descarta valores inválidos", () => {
    const style = validCaptionStyle({ mode: "letters", wordsPerGroup: 40, textColor: "red", highlight: "box" }, DEFAULT_CAPTION_STYLE);
    expect(style.mode).toBe("full");
    expect(style.wordsPerGroup).toBe(3);
    expect(style.textColor).toBe("#ffffff");
    expect(style.highlight).toBe("box");
  });
});

describe("posição livre das legendas", () => {
  it("projeto guarda e valida o ponto", () => {
    expect(validCaptionStyle({ position: "custom", x: 0.2, y: 1.7 }, DEFAULT_CAPTION_STYLE)).toMatchObject({ position: "custom", x: 0.2, y: 1 });
    expect(validCaptionStyle({ position: "custom" }, DEFAULT_CAPTION_STYLE)).toMatchObject({ x: 0.5, y: 0.75 });
    expect(validCaptionStyle({ position: "bottom", x: 0.2 }, DEFAULT_CAPTION_STYLE).x).toBeUndefined();
  });
});
