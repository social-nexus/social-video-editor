import type { Caption } from "../types";
import { MIN_CLIP_DURATION, roundTime } from "./time";

export type CaptionFormat = "srt" | "vtt";

/** "00:01:02,345", "01:02.345" (VTT sem horas) ou "1:02:03.4" → segundos. null se inválido. */
export function parseCueTime(value: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(value);
  if (!match) return null;
  const [, hours = "0", minutes, seconds, fraction = ""] = match;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) return null;
  return roundTime(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, "0")) / 1000);
}

/** Segundos → "00:01:02,345" (SRT) ou "00:01:02.345" (VTT). */
export function formatCueTime(seconds: number, format: CaptionFormat) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const time = `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
  return `${time}${format === "srt" ? "," : "."}${pad(ms, 3)}`;
}

/** Tira marcações de estilo (<i>, <b>, <c.cor>, <v Nome>, {\an8}) e deixa só o texto. */
export function plainCaptionText(text: string) {
  return text
    .replace(/<v(?:\.[^\s>]*)?\s+([^>]*)>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export type ParsedCaptions = { format: CaptionFormat; captions: Caption[]; skipped: number };

/**
 * Lê SRT ou WebVTT. Blocos sem tempo válido são ignorados (e contados em `skipped`).
 * O resultado vem ordenado por início; legendas sobrepostas são mantidas.
 */
export function parseCaptions(source: string, newId: () => string = () => crypto.randomUUID()): ParsedCaptions {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const format: CaptionFormat = /^WEBVTT/.test(text.trimStart()) ? "vtt" : "srt";
  const captions: Caption[] = [];
  let skipped = 0;
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      // Cabeçalho WEBVTT, NOTE, STYLE, REGION ou lixo.
      const first = lines[0]?.trim() ?? "";
      if (first && !/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first) && !/^\d+$/.test(first)) skipped++;
      continue;
    }
    const [left, right = ""] = lines[timingIndex].split("-->");
    const start = parseCueTime(left);
    const end = parseCueTime(right.trim().split(/\s+/)[0] ?? "");
    const body = plainCaptionText(lines.slice(timingIndex + 1).join("\n"));
    if (start === null || end === null || end <= start || !body) { skipped++; continue; }
    captions.push({ id: newId(), start, end, text: body });
  }
  return { format, captions: sortCaptions(captions), skipped };
}

export const sortCaptions = (captions: Caption[]) => [...captions].sort((a, b) => a.start - b.start || a.end - b.end);

/** Gera o arquivo SRT ou VTT (sempre em ordem de início). */
export function formatCaptions(captions: Caption[], format: CaptionFormat) {
  const cues = sortCaptions(captions).map((caption, index) => {
    const timing = `${formatCueTime(caption.start, format)} --> ${formatCueTime(caption.end, format)}`;
    return format === "srt" ? `${index + 1}\n${timing}\n${caption.text}` : `${timing}\n${caption.text}`;
  });
  return format === "srt" ? `${cues.join("\n\n")}\n` : `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** Legendas visíveis no instante `time` (início incluso, fim excluso). */
export const captionsAt = (captions: Caption[], time: number) =>
  captions.filter((caption) => caption.start <= time + 1e-9 && caption.end > time + 1e-9);

/** Espaço livre em volta de uma legenda (até os vizinhos que não se sobrepõem a ela). */
export function captionBounds(caption: Caption, captions: Caption[]) {
  let minStart = 0;
  let maxEnd = Infinity;
  for (const other of captions) {
    if (other.id === caption.id) continue;
    if (other.end <= caption.start + 1e-6) minStart = Math.max(minStart, other.end);
    else if (other.start >= caption.end - 1e-6) maxEnd = Math.min(maxEnd, other.start);
  }
  return { minStart: roundTime(minStart), maxEnd };
}

/** Desloca todas as legendas; nenhuma começa antes do 0 (as que sairiam do começo são encurtadas ou removidas). */
export function shiftCaptions(captions: Caption[], delta: number): Caption[] {
  return captions.flatMap((caption) => {
    const start = roundTime(Math.max(0, caption.start + delta));
    const end = roundTime(caption.end + delta);
    return end - start >= MIN_CLIP_DURATION ? [{ ...caption, start, end }] : [];
  });
}

/** Nova legenda no playhead: 2 s, sem passar da próxima. null se não houver espaço. */
export function newCaptionAt(captions: Caption[], time: number, id: string, text = "Nova legenda"): Caption | null {
  const at = roundTime(Math.max(0, time));
  if (captionsAt(captions, at).length) return null;
  const next = captions.filter((caption) => caption.start > at).reduce((min, caption) => Math.min(min, caption.start), Infinity);
  const end = roundTime(Math.min(at + 2, next));
  return end - at >= MIN_CLIP_DURATION ? { id, start: at, end, text } : null;
}
