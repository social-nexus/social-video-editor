import { describe, expect, it } from "vitest";
import { activeDucking, clampFade, clipGainAt, clipVolume, computePeaks, dbToGain, duckGainAt, duckGainExpr, effectiveFades, gainToDb, trackAudible, trackVolume, voiceRanges } from "./audio";
import { splitClip } from "./timeline";
import type { Track } from "../types";
import { overwriteRange } from "./tracks";

const clip = { id: "a", mediaId: "m", trackId: "t", start: 10, duration: 10, inPoint: 0 };

describe("volume e fades", () => {
  it("volume padrão é 100% e fica entre 0 e 1", () => {
    expect(clipVolume({})).toBe(1);
    expect(clipVolume({ volume: 1.7 })).toBe(1);
    expect(trackVolume({ volume: 0.4 })).toBe(0.4);
    expect(trackVolume(undefined)).toBe(1);
  });
  it("ganho com fade de entrada e de saída", () => {
    const faded = { ...clip, volume: 0.8, fadeIn: 2, fadeOut: 4 };
    expect(clipGainAt(faded, 10)).toBe(0);
    expect(clipGainAt(faded, 11)).toBeCloseTo(0.4);
    expect(clipGainAt(faded, 15)).toBeCloseTo(0.8);
    expect(clipGainAt(faded, 18)).toBeCloseTo(0.4);
    expect(clipGainAt(faded, 20)).toBe(0);
  });
  it("fades maiores que o clipe encolhem na mesma proporção", () => {
    expect(effectiveFades({ duration: 3, fadeIn: 2, fadeOut: 4 })).toEqual({ fadeIn: 1, fadeOut: 2 });
  });
  it("clampFade respeita o outro fade", () => {
    expect(clampFade({ duration: 10, fadeOut: 4 }, "fadeIn", 8)).toBe(6);
    expect(clampFade({ duration: 10 }, "fadeOut", -1)).toBe(0);
  });
});

describe("fades ao dividir e sobrescrever", () => {
  const faded = { ...clip, fadeIn: 1, fadeOut: 2 };
  it("dividir: 1ª parte fica com o fade de entrada, 2ª com o de saída", () => {
    const [first, second] = splitClip(faded, 15, "b", true)!;
    expect(first.fadeIn).toBe(1);
    expect(first.fadeOut).toBeUndefined();
    expect(second.fadeIn).toBeUndefined();
    expect(second.fadeOut).toBe(2);
  });
  it("sobrescrever o meio: as sobras perdem o fade do lado cortado", () => {
    const result = overwriteRange([faded], "t", 13, 16, () => true, () => "c");
    expect(result[0]).toMatchObject({ start: 10, duration: 3, fadeIn: 1 });
    expect(result[0].fadeOut).toBeUndefined();
    expect(result[1]).toMatchObject({ start: 16, duration: 4, fadeOut: 2 });
    expect(result[1].fadeIn).toBeUndefined();
  });
});

describe("computePeaks", () => {
  it("um pico por bloco, juntando canais, normalizado", () => {
    const left = [0, 0.1, 0.2, 0, 0, 0.05, 0, 0];
    const right = [0, 0, 0, 0.4, 0, 0, 0, 0.1];
    const peaks = computePeaks([left, right], 4, 1); // blocos de 4 amostras
    expect(Array.from(peaks)).toEqual([1, 0.25]);
  });
  it("silêncio não divide por zero", () => {
    expect(Array.from(computePeaks([[0, 0, 0, 0]], 2, 1))).toEqual([0, 0]);
  });
});

describe("mixagem", () => {
  const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, kind: "audio", hidden: false, muted: false, locked: false, ...extra });
  it("solo e mudo", () => {
    const tracks = [track("a"), track("b", { solo: true }), track("c", { muted: true, solo: true })];
    expect(tracks.map((entry) => trackAudible(entry, tracks))).toEqual([false, true, false]);
    expect(trackAudible(track("x"), [track("x")])).toBe(true);
  });
  it("trechos de fala juntam pausas curtas", () => {
    const clips = [{ trackId: "v", start: 0, duration: 2 }, { trackId: "v", start: 2.4, duration: 1 }, { trackId: "v", start: 6, duration: 1 }, { trackId: "m", start: 0, duration: 9 }];
    expect(voiceRanges(clips, new Set(["v"]), 0.3)).toEqual([[0, 3.4], [6, 7]]);
  });
  it("a música desce antes da fala e sobe depois (preview = exportação)", () => {
    const ranges: [number, number][] = [[2, 4], [8, 9]];
    const ducking = { amount: 0.25, fade: 0.5 };
    expect(duckGainAt(ranges, ducking, 0)).toBe(1);
    expect(duckGainAt(ranges, ducking, 1.75)).toBeCloseTo(0.625);
    expect(duckGainAt(ranges, ducking, 3)).toBeCloseTo(0.25);
    expect(duckGainAt(ranges, ducking, 4.25)).toBeCloseTo(0.625);
    const expr = duckGainExpr(ranges, ducking);
    const F = { min: Math.min, clip: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)) };
    const run = (t: number) => new Function("F", "t", `return ${expr.replace(/\b(min|clip)\(/g, "F.$1(")};`)(F, t);
    for (const t of [0, 1.6, 1.75, 2, 3, 4.1, 4.25, 4.6, 7.8, 8.5, 9.3, 12]) expect(run(t), `t=${t}`).toBeCloseTo(duckGainAt(ranges, ducking, t), 6);
  });
  it("abaixada vigente e decibéis", () => {
    const tracks = [track("v1", { ducking: { amount: 0.3, fade: 0.2 } }), track("v2", { ducking: { amount: 0.1, fade: 0.4 } }), track("m")];
    const active = activeDucking(tracks)!;
    expect(active.ducking).toEqual({ amount: 0.1, fade: 0.4 });
    expect([...active.voiceTracks]).toEqual(["v1", "v2"]);
    expect(activeDucking([track("m")])).toBeNull();
    expect(gainToDb(0.25)).toBe(-12);
    expect(dbToGain(-12)).toBeCloseTo(0.251, 3);
  });
});
