/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  captionBounds, captionsAt, formatCaptions, formatCueTime, newCaptionAt, parseCaptions, parseCueTime, plainCaptionText, shiftCaptions,
} from "./captions";
import { dragCaption } from "../components/CaptionLane";

let counter = 0;
const ids = () => `c${++counter}`;

describe("tempos", () => {
  it("lê SRT, VTT e VTT sem horas", () => {
    expect(parseCueTime("00:00:01,527")).toBe(1.527);
    expect(parseCueTime("00:01:02.5")).toBe(62.5);
    expect(parseCueTime("01:02.345")).toBe(62.345);
    expect(parseCueTime("1:00:00.000")).toBe(3600);
    expect(parseCueTime("00:61:00,000")).toBeNull();
    expect(parseCueTime("abc")).toBeNull();
  });
  it("formata SRT e VTT", () => {
    expect(formatCueTime(3723.04, "srt")).toBe("01:02:03,040");
    expect(formatCueTime(1.5, "vtt")).toBe("00:00:01.500");
  });
});

describe("parseCaptions", () => {
  it("arquivo SRT da pasta de testes", () => {
    // A pasta de testes fica fora do git: sem ela, o teste não tem o que conferir.
    const files = import.meta.glob("../../../../IMG_VID_TESTE/P-Ep-001.srt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const text = Object.values(files)[0];
    if (!text) return;
    const { format, captions, skipped } = parseCaptions(text, ids);
    expect(format).toBe("srt");
    expect(skipped).toBe(0);
    expect(captions).toHaveLength(15);
    expect(captions[0]).toMatchObject({ start: 0, end: 1.527, text: "O despertador tocou alto." });
    expect(captions[14].end).toBeCloseTo(30.68, 2);
  });
  it("VTT com cabeçalho, NOTE, ajustes de posição e marcações", () => {
    const vtt = "\uFEFFWEBVTT\nKind: captions\n\nNOTE comentário\n\nintro\n00:01.000 --> 00:02.500 align:center line:90%\n<v Ana>Olá <i>mundo</i></v>\n\n00:03.000 --> 00:04.000\nSegunda\nlinha\n";
    const { format, captions } = parseCaptions(vtt, ids);
    expect(format).toBe("vtt");
    expect(captions.map((caption) => [caption.start, caption.end, caption.text])).toEqual([[1, 2.5, "Olá mundo"], [3, 4, "Segunda\nlinha"]]);
  });
  it("CRLF, numeração fora de ordem e blocos inválidos", () => {
    const srt = "2\r\n00:00:05,000 --> 00:00:06,000\r\nB\r\n\r\n1\r\n00:00:01,000 --> 00:00:02,000\r\n{\\an8}A\r\n\r\n3\r\n00:00:09,000 --> 00:00:08,000\r\nRuim\r\n";
    const { captions, skipped } = parseCaptions(srt, ids);
    expect(captions.map((caption) => caption.text)).toEqual(["A", "B"]);
    expect(skipped).toBe(1);
  });
  it("ida e volta SRT → texto → SRT", () => {
    const { captions } = parseCaptions("1\n00:00:01,000 --> 00:00:02,000\nA\nB\n", ids);
    expect(formatCaptions(captions, "srt")).toBe("1\n00:00:01,000 --> 00:00:02,000\nA\nB\n");
    expect(formatCaptions(captions, "vtt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\nB\n");
  });
  it("plainCaptionText tira tags e entidades", () => {
    expect(plainCaptionText("<b>a &amp; b</b>\n  <font color=red>c</font> ")).toBe("a & b\nc");
  });
});

const list = [
  { id: "a", start: 0, end: 2, text: "A" },
  { id: "b", start: 3, end: 5, text: "B" },
  { id: "c", start: 8, end: 9, text: "C" },
];

describe("edição", () => {
  it("captionsAt: início incluso, fim excluso", () => {
    expect(captionsAt(list, 2).map((caption) => caption.id)).toEqual([]);
    expect(captionsAt(list, 3).map((caption) => caption.id)).toEqual(["b"]);
  });
  it("captionBounds acha os vizinhos", () => {
    expect(captionBounds(list[1], list)).toEqual({ minStart: 2, maxEnd: 8 });
  });
  it("shiftCaptions não deixa passar do 0", () => {
    expect(shiftCaptions(list, -1).map((caption) => [caption.start, caption.end])).toEqual([[0, 1], [2, 4], [7, 8]]);
    expect(shiftCaptions(list, -2)).toHaveLength(2);
  });
  it("newCaptionAt respeita a próxima legenda", () => {
    expect(newCaptionAt(list, 6.5, "n")).toMatchObject({ start: 6.5, end: 8 });
    expect(newCaptionAt(list, 4, "n")).toBeNull();
  });
  it("arrastar fica entre os vizinhos e gruda nos alvos", () => {
    const bounds = { minStart: 2, maxEnd: 8 };
    expect(dragCaption("move", { start: 3, end: 5 }, 10, bounds, [], 0)).toEqual({ start: 6, end: 8 });
    expect(dragCaption("move", { start: 3, end: 5 }, 0.95, bounds, [4], 0.1)).toEqual({ start: 4, end: 6 });
    expect(dragCaption("trim-end", { start: 3, end: 5 }, -5, bounds, [], 0)).toEqual({ start: 3, end: 3.1 });
    expect(dragCaption("trim-start", { start: 3, end: 5 }, -5, bounds, [], 0)).toEqual({ start: 2, end: 5 });
  });
});
