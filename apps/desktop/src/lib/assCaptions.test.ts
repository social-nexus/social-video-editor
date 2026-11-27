import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAssCaptions } from "./assCaptions";
import { buildRenderPlan } from "./render";
import { DEFAULT_CAPTION_STYLE } from "../types";
import type { Caption, CaptionStyle } from "../types";

const cap = (text: string, start: number, end: number, id = "c"): Caption => ({ id, start, end, text });
const size = { width: 720, height: 1280 };
const style = (extra: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, ...extra });
const dialogues = (ass: string) => ass.split("\n").filter((line) => line.startsWith("Dialogue:"));

describe("formatos do ASS", () => {
  it("tempo e cor", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.237)).toBe("0:01:01.24");
    expect(assTime(3725.5)).toBe("1:02:05.50");
    expect(assColor("#facc15")).toBe("&H15CCFA&");
    expect(assColor("inválida")).toBe("&HFFFFFF&");
  });
});

describe("legendas gravadas no vídeo", () => {
  it("sem legendas: nada", () => {
    expect(buildAssCaptions([], style(), size)).toBeNull();
  });
  it("frase inteira, estilo clássico: um evento por legenda, tamanho e posição do preview", () => {
    const ass = buildAssCaptions([cap("Olá mundo\nsegunda linha", 1, 3)], style({ size: 5 }), size)!;
    expect(ass).toContain("PlayResY: 1280");
    // 5% de 1280 = 64 px de font-size → 85 no ASS; embaixo a 10% (128 px).
    expect(ass).toMatch(/Style: Main,Segoe UI,85,&HFFFFFF&.*,1,4\.5,0,2,43,43,128,1/);
    const lines = dialogues(ass);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("0:00:01.00,0:00:03.00,Main");
    expect(lines[0]).toContain("\\N");
    expect(lines[0]).toContain("Olá");
  });
  it("karaokê: um pedaço por palavra, só a palavra falada na cor de destaque", () => {
    const ass = buildAssCaptions([cap("um dois três", 0, 3)], style({ mode: "words", wordsPerGroup: 3, highlight: "color", animation: "none" }), size)!;
    const lines = dialogues(ass);
    expect(lines).toHaveLength(3);
    const highlighted = (line: string) => [...line.matchAll(/\\1c(&H[0-9A-F]+&)[^\}]*\}(\p{L}+)/gu)].filter((m) => m[1] === "&H15CCFA&").map((m) => m[2]);
    expect(lines.map(highlighted)).toEqual([["um"], ["dois"], ["três"]]);
  });
  it("palavras de N em N: cada grupo é um evento", () => {
    const lines = dialogues(buildAssCaptions([cap("a b c d e", 0, 5)], style({ mode: "words", wordsPerGroup: 2 }), size)!);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/}e$/);
  });
  it("caixa na palavra falada e fundo escuro: três camadas alinhadas", () => {
    const lines = dialogues(buildAssCaptions([cap("um dois", 0, 2)], style({ highlight: "box", background: true }), size)!);
    expect(lines.filter((line) => line.startsWith("Dialogue: 0,"))).toHaveLength(2); // fundo
    expect(lines.filter((line) => line.startsWith("Dialogue: 1,"))).toHaveLength(2); // caixa da palavra
    expect(lines.filter((line) => line.startsWith("Dialogue: 2,"))).toHaveLength(2); // texto
    const hibox = lines.find((line) => line.startsWith("Dialogue: 1,"))!;
    expect(hibox).toMatch(/\\3a&H00&[^}]*}um/);
    expect(hibox).toMatch(/\\3a&HFF&[^}]*}dois/);
  });
  it("animação pop: começa pequeno e transparente e chega no normal em 0,2 s", () => {
    const lines = dialogues(buildAssCaptions([cap("olá", 0, 2)], style({ animation: "pop" }), size)!);
    expect(lines).toHaveLength(2); // 0–0,2 s animado + resto parado
    expect(lines[0]).toContain("0:00:00.00,0:00:00.20");
    expect(lines[0]).toMatch(/^[^}]*\\fscx60\\fscy60\\1a&HFF&/);
    expect(lines[0]).toMatch(/\\t\(\d+,200,\\fscx100\\fscy100\\1a&H00&/);
    expect(lines[1]).not.toContain("\\t(");
  });
  it("animação subir usa \\move até a posição final", () => {
    const line = dialogues(buildAssCaptions([cap("olá", 0, 2)], style({ animation: "rise" }), size)!)[0];
    expect(line).toMatch(/\\move\(360,1190\.4,360,1152,0,200\)/);
  });
  it("maiúsculas e texto seguro", () => {
    const line = dialogues(buildAssCaptions([cap("ação {x} a\\b", 0, 1)], style({ uppercase: true }), size)!)[0];
    expect(line).toContain("AÇÃO");
    expect(line).toContain("(X)");
    expect(line).not.toContain("A\\B");
  });
  it("no plano de exportação as legendas vão por cima de tudo", () => {
    const plan = buildRenderPlan({ tracks: [], clips: [], captions: [cap("oi", 0, 1)] }, [], new Map(), { width: 720, height: 1280, fps: 30, crf: 21, preset: "medium" }, 1, style());
    expect(plan.ass).toContain("Dialogue:");
    expect(plan.filter).toContain("[base]ass=filename='{{ASS_FILE}}'{{FONTS_DIR}}[subs]");
    expect(plan.filter).toContain("[subs]format=yuv420p[vout]");
    const without = buildRenderPlan({ tracks: [], clips: [], captions: [cap("oi", 0, 1)] }, [], new Map(), { width: 720, height: 1280, fps: 30, crf: 21, preset: "medium" }, 1, null);
    expect(without.ass).toBeNull();
    expect(without.filter).not.toContain("ass=");
  });
});
