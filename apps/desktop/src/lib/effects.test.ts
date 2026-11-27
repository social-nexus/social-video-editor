import { describe, expect, it } from "vitest";
import { clipFrameAt, frameAt, frameTransform, makeMotion, maxOffset, presetForIndex, presetFrames, sliceMotion } from "./effects";
import { splitClip } from "./timeline";
import { overwriteRange } from "./tracks";

describe("presets", () => {
  it("zoom in e zoom out", () => {
    expect(presetFrames("zoom-in", 0.2)).toEqual({ from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.2, x: 0, y: 0 } });
    expect(presetFrames("zoom-out", 0.2).from.scale).toBe(1.2);
  });
  it("panorâmica nunca mostra a borda", () => {
    const { from, to } = presetFrames("pan-right", 0.15);
    expect(from.x).toBeGreaterThan(0);
    expect(to.x).toBe(-from.x);
    expect(Math.abs(from.x)).toBeLessThanOrEqual(maxOffset(from.scale));
  });
  it("sem movimento = null", () => {
    expect(makeMotion("none")).toBeNull();
  });
  it("alternar percorre os movimentos", () => {
    expect([0, 1, 2, 3].map((index) => presetForIndex("alternate", index))).toEqual(["zoom-in", "pan-right", "zoom-out", "pan-left"]);
    expect(presetForIndex("pan-up", 5)).toBe("pan-up");
  });
});

describe("quadro no tempo", () => {
  const motion = makeMotion("zoom-in", 0.2, false)!;
  const clip = { start: 10, duration: 4, motion };
  it("linear do início ao fim, parado fora do clipe", () => {
    expect(clipFrameAt(clip, 10).scale).toBe(1);
    expect(clipFrameAt(clip, 12).scale).toBe(1.1);
    expect(clipFrameAt(clip, 14).scale).toBe(1.2);
    expect(clipFrameAt(clip, 20).scale).toBe(1.2);
  });
  it("suave começa devagar", () => {
    const smooth = makeMotion("zoom-in", 0.2, true)!;
    expect(frameAt(smooth, 0.1).scale).toBeLessThan(frameAt(motion, 0.1).scale);
    expect(frameAt(smooth, 0.5).scale).toBe(1.1);
  });
  it("CSS do quadro", () => {
    expect(frameTransform({ scale: 1, x: 0, y: 0 })).toBeUndefined();
    expect(frameTransform({ scale: 1.2, x: 0.05, y: 0 })).toBe("scale(1.2) translate(5.000%, 0.000%)");
  });
});

describe("dividir e sobrescrever continuam o movimento", () => {
  const motion = makeMotion("zoom-in", 0.2, false)!;
  const clip = { id: "a", mediaId: "m", trackId: "t", start: 0, duration: 10, inPoint: 0, motion };
  it("sliceMotion pega o pedaço certo", () => {
    expect(sliceMotion(motion, 0.25, 0.75)).toMatchObject({ preset: "custom", from: { scale: 1.05 }, to: { scale: 1.15 } });
    expect(sliceMotion(motion, 0, 1)).toBe(motion);
  });
  it("dividir no meio", () => {
    const [first, second] = splitClip(clip, 5, "b", false)!;
    expect(first.motion).toMatchObject({ from: { scale: 1 }, to: { scale: 1.1 } });
    expect(second.motion).toMatchObject({ from: { scale: 1.1 }, to: { scale: 1.2 } });
  });
  it("sobrescrever o meio", () => {
    const result = overwriteRange([clip], "t", 2, 6, () => false, () => "c");
    expect(result[0].motion).toMatchObject({ from: { scale: 1 }, to: { scale: 1.04 } });
    expect(result[1].motion).toMatchObject({ from: { scale: 1.12 }, to: { scale: 1.2 } });
  });
});
