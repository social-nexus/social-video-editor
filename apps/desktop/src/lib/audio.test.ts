import { describe, expect, it } from "vitest";
import { clampFade, clipGainAt, clipVolume, computePeaks, effectiveFades, trackVolume } from "./audio";
import { splitClip } from "./timeline";
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
