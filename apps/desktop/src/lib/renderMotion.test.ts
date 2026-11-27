import { describe, expect, it } from "vitest";
import { clipTransformExpr, fadeBlend, motionFilters } from "./renderMotion";
import { clipAnimationAt, makeAnimation } from "./animations";
import { clipFrameAt, makeMotion, sliceMotion } from "./effects";
import type { AnimationType, TimelineClip } from "../types";

/** Avalia uma expressão do ffmpeg (clip, pow, min, max, trunc) no instante t. */
function evaluate(expr: string, t: number): number {
  const js = expr.replace(/\b(clip|pow|min|max|trunc)\(/g, "F.$1(");
  const F = { clip: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), pow: Math.pow, min: Math.min, max: Math.max, trunc: Math.trunc };
  return new Function("F", "t", `return ${js};`)(F, t);
}

/** O que o preview mostra: zoom total e deslocamento (fração do quadro) e opacidade. */
function previewAt(clip: TimelineClip, time: number) {
  const kb = clipFrameAt(clip, clip.start + time);
  const anim = clipAnimationAt(clip, clip.start + time);
  const scale = anim.scale * kb.scale;
  return { scale, x: anim.x + scale * kb.x, y: anim.y + scale * kb.y, opacity: anim.opacity };
}

const base = (extra: Partial<TimelineClip>): TimelineClip => ({ id: "c", mediaId: "m", trackId: "v", start: 7, duration: 4, inPoint: 0, ...extra });
const TYPES: AnimationType[] = ["fade", "zoom-in", "zoom-out", "pop", "slide-left", "slide-right", "slide-up", "slide-down"];
const TIMES = [0, 0.05, 0.13, 0.31, 0.6, 1, 2, 3.2, 3.55, 3.8, 3.97, 4];

function expectSame(clip: TimelineClip) {
  const expr = clipTransformExpr(clip)!;
  for (const t of TIMES) {
    const want = previewAt(clip, t);
    expect(evaluate(expr.scale, t), `scale t=${t}`).toBeCloseTo(want.scale, 3);
    expect(evaluate(expr.x, t), `x t=${t}`).toBeCloseTo(want.x, 3);
    expect(evaluate(expr.y, t), `y t=${t}`).toBeCloseTo(want.y, 3);
    expect(evaluate(expr.opacity, t), `opacity t=${t}`).toBeCloseTo(want.opacity, 3);
  }
}

describe("movimento na exportação = preview", () => {
  it("sem movimento nem animação: nada a fazer", () => {
    expect(clipTransformExpr(base({}))).toBeNull();
  });
  for (const preset of ["zoom-in", "zoom-out", "pan-right", "pan-left", "pan-down", "pan-up"] as const) {
    it(`Ken Burns ${preset}`, () => {
      expectSame(base({ motion: makeMotion(preset, 0.2, true)! }));
      expectSame(base({ motion: makeMotion(preset, 0.35, false)! }));
    });
  }
  it("pedaço de movimento (clipe dividido)", () => {
    expectSame(base({ motion: sliceMotion(makeMotion("pan-right", 0.2)!, 0.3, 0.8) }));
  });
  for (const type of TYPES) {
    it(`entrada e saída ${type} junto com Ken Burns`, () => {
      expectSame(base({ animIn: makeAnimation(type, 0.6), animOut: makeAnimation(type, 0.5), motion: makeMotion("pan-left", 0.15)! }));
      expectSame(base({ animIn: makeAnimation(type, 3), animOut: makeAnimation(type, 3) })); // encurtadas para caber
    });
  }
  it("filtros: fundo transparente, escala por quadro e redução (o fade fica para a mistura)", () => {
    const expr = clipTransformExpr(base({ animIn: makeAnimation("fade", 0.5), motion: makeMotion("zoom-in")! }))!;
    const chains = motionFilters(expr, "f0", "m0", "0", { width: 1080, height: 1920, fps: 30, length: 4, factor: 2 });
    expect(chains[0]).toBe("color=c=black@0:s=2160x3840:r=30:d=4,format=yuva420p[bg0]");
    expect(chains[1]).toContain("[f0]scale=w='max(2,trunc(2160*");
    expect(chains[1]).toContain(":eval=frame");
    expect(chains[2]).toContain("overlay=x='(W-w)/2+W*");
    expect(chains[2]).toContain("scale=1080:1920:flags=area");
    expect(chains[2]).not.toContain("eq=");
    expect(chains[2]).toMatch(/\[m0\]$/);
  });
  it("sem fade não mexe nas cores", () => {
    const expr = clipTransformExpr(base({ animIn: makeAnimation("slide-left", 0.5) }))!;
    expect(expr.fades).toBe(false);
    expect(motionFilters(expr, "f", "m", "1", { width: 720, height: 1280, fps: 30, length: 4, factor: 1 }).join(";")).not.toContain("eq=");
  });
  it("fade: mistura com as camadas de baixo, no tempo da timeline", () => {
    const clip = base({ animIn: makeAnimation("fade", 0.5), animOut: makeAnimation("fade", 0.4) });
    const expr = clipTransformExpr(clip)!;
    const blend = fadeBlend(expr.opacity, clip.start, [[7, 7.5], [10.6, 11]]);
    expect(blend.enable).toBe("between(t,7,7.5)+between(t,10.6,11)");
    // k(T), com T = tempo da timeline, deve ser a opacidade do preview nesse instante.
    const k = blend.expr.match(/^A\*\((.*)\)\+B\*\(1-\(/)![1];
    expect(k).not.toMatch(/\bt\b/);
    for (const T of [7, 7.1, 7.3, 7.5, 9, 10.7, 10.9]) {
      // evaluate() usa a variável `t`; aqui a expressão já usa `T` (tempo da timeline).
      expect(evaluate(k.replace(/\bT\b/g, "t"), T), `T=${T}`).toBeCloseTo(clipAnimationAt(clip, T).opacity, 3);
    }
  });
});
