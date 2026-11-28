import { describe, expect, it } from "vitest";
import {
  effectiveTransition, extensionAfter, makeTransition, mixTransitions, previousAdjacent, TRANSITION_TYPES, transitionBlendExprs, transitionLook,
  transitionMotion, transitionMotionExpr, transitionProgress, validTransition, pixelBlocks, pixelBlockExprs, pixelateFilters, MAX_PIXEL_BLOCK,
} from "./transitions";
import type { TimelineClip } from "../types";

const clip = (id: string, start: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, mediaId: "m", trackId: "v1", start, duration, inPoint: 0, ...extra });

/** Avalia uma expressão do ffmpeg (clip, if, lt, gte, max, cos, hypot, PI) com as variáveis dadas. */
function evaluate(expr: string, vars: Record<string, number>) {
  const F = { clip: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), if: (c: number, a: number, b: number) => c ? a : b,
    lt: (a: number, b: number) => a < b ? 1 : 0, gte: (a: number, b: number) => a >= b ? 1 : 0, max: Math.max, min: Math.min, cos: Math.cos, hypot: Math.hypot };
  const js = expr.replace(/\b(clip|if|lt|gte|max|min|cos|hypot)\(/g, "F.$1(").replace(/\bPI\b/g, "Math.PI");
  return new Function("F", ...Object.keys(vars), `return ${js};`)(F, ...Object.values(vars));
}

describe("transições", () => {
  it("precisa de clipe anterior colado na mesma trilha", () => {
    const a = clip("a", 0, 3), b = clip("b", 3, 4, { transition: makeTransition("dissolve", 1) });
    expect(previousAdjacent(b, [a, b])?.id).toBe("a");
    expect(effectiveTransition(b, [a, b])?.transition).toEqual({ type: "dissolve", duration: 1 });
    expect(effectiveTransition({ ...b, start: 3.5 }, [a, { ...b, start: 3.5 }])).toBeNull();
    expect(effectiveTransition(b, [{ ...a, trackId: "v2" }, b])).toBeNull();
  });
  it("não passa da duração do clipe; o anterior se estende pela duração", () => {
    const a = clip("a", 0, 3), b = clip("b", 3, 0.6, { transition: makeTransition("wipe-left", 2) });
    expect(effectiveTransition(b, [a, b])?.transition.duration).toBe(0.6);
    expect(extensionAfter(a, [a, b])).toBe(0.6);
    expect(extensionAfter(b, [a, b])).toBe(0);
  });
  it("limites e arquivo", () => {
    expect(makeTransition("dissolve", 9).duration).toBe(3);
    expect(makeTransition("dissolve", 0).duration).toBe(0.1);
    expect(validTransition({ type: "wipe-up", duration: 0.75 })).toEqual({ type: "wipe-up", duration: 0.75 });
    expect(validTransition({ type: "explosão", duration: 1 })).toBeNull();
  });
  it("progresso e aparência no preview", () => {
    const t = makeTransition("fade-black", 1);
    expect(transitionProgress({ start: 3 }, t, 2.9)).toBeNull();
    expect(transitionProgress({ start: 3 }, t, 3.25)).toBe(0.25);
    expect(transitionLook("fade-black", 0.25)).toMatchObject({ veil: 0.5, hideIncoming: true });
    expect(transitionLook("fade-black", 0.75)).toMatchObject({ veil: 0.5, hideIncoming: false });
    expect(transitionLook("wipe-left", 0.25).clipPath).toBe("inset(0 75% 0 0)");
    expect(transitionLook("dissolve", 0.3).opacity).toBe(0.3);
  });
  it("exportação = preview (mistura do ffmpeg)", () => {
    const [d] = transitionBlendExprs("dissolve", 3, 1);
    expect(evaluate(d, { T: 3.25, A: 200, B: 100 })).toBeCloseTo(125);
    const [wipe] = transitionBlendExprs("wipe-left", 3, 1);
    expect(evaluate(wipe, { T: 3.5, X: 100, W: 1000, A: 1, B: 0 })).toBe(1);
    expect(evaluate(wipe, { T: 3.5, X: 600, W: 1000, A: 1, B: 0 })).toBe(0);
    const [luma, chroma] = transitionBlendExprs("fade-black", 3, 1);
    expect(evaluate(luma, { T: 3.5, A: 200, B: 100 })).toBeCloseTo(16);
    expect(evaluate(luma, { T: 3.25, A: 200, B: 100 })).toBeCloseTo(58);
    expect(evaluate(chroma, { T: 3.75, A: 200, B: 100 })).toBeCloseTo(164);
  });
  it("movimento: exportação = preview em todas as transições", () => {
    for (const { id } of TRANSITION_TYPES) {
      for (const p of [0, 0.2, 0.5, 0.8, 1]) {
        const want = transitionMotion(id, p);
        const got = transitionMotionExpr(id, String(p));
        for (const side of ["out", "in"] as const) for (const key of ["s", "sx", "sy", "x", "y"] as const)
          expect(evaluate(got[side][key], {}), `${id} ${side}.${key} p=${p}`).toBeCloseTo(want[side][key], 6);
      }
      // No fim o clipe novo está no lugar; no começo o que sai ainda está no lugar.
      const end = transitionMotion(id, 1).in, start = transitionMotion(id, 0).out;
      expect([end.s, end.sx, end.sy, end.x, end.y].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 1, 1, 0, 0]);
      expect([start.s, start.sx, start.sy, start.x, start.y].map((v) => v + 0)).toEqual([1, 1, 1, 0, 0]);
    }
  });
  it("círculo: mistura do ffmpeg", () => {
    const [open] = transitionBlendExprs("circle-open", 0, 1);
    expect(evaluate(open, { T: 0.5, X: 500, Y: 500, W: 1000, H: 1000, A: 1, B: 0 })).toBe(1);
    expect(evaluate(open, { T: 0.5, X: 0, Y: 0, W: 1000, H: 1000, A: 1, B: 0 })).toBe(0);
    const [close] = transitionBlendExprs("circle-close", 0, 1);
    expect(evaluate(close, { T: 0.5, X: 500, Y: 500, W: 1000, H: 1000, A: 1, B: 0 })).toBe(0);
    expect(evaluate(close, { T: 0.5, X: 0, Y: 0, W: 1000, H: 1000, A: 1, B: 0 })).toBe(1);
  });
  it("sorteio: só das escolhidas e sem repetir em cortes seguidos", () => {
    let seed = 7;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const mix = mixTransitions(["dissolve", "push-left", "zoom-in"], 30, random);
    expect(mix).toHaveLength(30);
    mix.forEach((type, i) => { expect(["dissolve", "push-left", "zoom-in"]).toContain(type); if (i) expect(type).not.toBe(mix[i - 1]); });
    expect(mixTransitions(["flip-x"], 3)).toEqual(["flip-x", "flip-x", "flip-x"]);
    expect(mixTransitions([], 3)).toEqual([]);
  });
  it("pixelar: blocos crescem até a metade e somem no fim (preview = exportação)", () => {
    expect(pixelBlocks("pixelate", 0)).toEqual({ out: 0, in: MAX_PIXEL_BLOCK });
    expect(pixelBlocks("pixelate", 0.5)).toEqual({ out: MAX_PIXEL_BLOCK, in: MAX_PIXEL_BLOCK });
    expect(pixelBlocks("pixelate", 1)).toEqual({ out: MAX_PIXEL_BLOCK, in: 0 });
    expect(pixelBlocks("dissolve", 0.5)).toEqual({ out: 0, in: 0 });
    for (const p of [0, 0.2, 0.5, 0.7, 1]) {
      const exprs = pixelBlockExprs(String(p));
      expect(evaluate(exprs.out, {}), `out p=${p}`).toBeCloseTo(pixelBlocks("pixelate", p).out, 6);
      expect(evaluate(exprs.in, {}), `in p=${p}`).toBeCloseTo(pixelBlocks("pixelate", p).in, 6);
    }
    expect(pixelateFilters("0.05", 1080, 1920)).toEqual([
      "scale=w='max(1,trunc(iw/max(1,0.05*1080)))':h='max(1,trunc(ih/max(1,0.05*1080)))':eval=frame:flags=neighbor",
      "scale=1080:1920:flags=neighbor",
    ]);
  });
});
