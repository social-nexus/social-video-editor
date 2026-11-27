import { describe, expect, it } from "vitest";
import { animationTransform, clipAnimationAt, effectiveAnimations, entryState, exitState, makeAnimation, validAnimation } from "./animations";
import { splitClip } from "./timeline";
import { overwriteRange } from "./tracks";
import type { TimelineClip } from "../types";

const clip = (extra: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: "a", mediaId: "m", trackId: "v1", start: 10, duration: 4, inPoint: 0, ...extra });

describe("entrada e saída", () => {
  it("entrada começa fora e termina no lugar", () => {
    expect(entryState("fade", 0).opacity).toBe(0);
    expect(entryState("fade", 1)).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 });
    expect(entryState("slide-left", 0).x).toBe(1); // entra pela direita
    expect(entryState("slide-up", 0).y).toBe(1); // entra por baixo
    expect(entryState("pop", 1).scale).toBeCloseTo(1);
  });
  it("pop passa do tamanho e assenta", () => {
    const peak = Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => entryState("pop", t).scale));
    expect(peak).toBeGreaterThan(1);
  });
  it("saída começa no lugar e termina fora", () => {
    expect(exitState("fade", 0).opacity).toBe(1);
    expect(exitState("fade", 1).opacity).toBe(0);
    expect(exitState("slide-left", 1).x).toBe(-1); // sai pela esquerda
    expect(exitState("zoom-out", 1).scale).toBeCloseTo(0.6);
  });
  it("estado no tempo do clipe", () => {
    const c = clip({ animIn: makeAnimation("fade", 1), animOut: makeAnimation("slide-down", 1) });
    expect(clipAnimationAt(c, 10).opacity).toBe(0);
    expect(clipAnimationAt(c, 12)).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 });
    expect(clipAnimationAt(c, 14).y).toBe(1);
    expect(animationTransform(clipAnimationAt(c, 12))).toBeUndefined();
    expect(animationTransform(clipAnimationAt(c, 14))).toBe("translate(0.000%, 100.000%) scale(1)");
  });
  it("entrada + saída maiores que o clipe encolhem juntas", () => {
    expect(effectiveAnimations(clip({ duration: 1, animIn: makeAnimation("fade", 1), animOut: makeAnimation("fade", 1) })))
      .toEqual({ inDur: 0.5, outDur: 0.5 });
  });
  it("valida o que vem do projeto", () => {
    expect(validAnimation({ type: "pop", duration: 0.4 })).toEqual({ type: "pop", duration: 0.4 });
    expect(validAnimation({ type: "explode", duration: 1 })).toBeNull();
    expect(validAnimation({ type: "fade", duration: -1 })).toBeNull();
    expect(validAnimation({ type: "fade", duration: 99 })?.duration).toBe(3);
  });
  it("dividir: entrada fica na 1ª parte, saída na 2ª", () => {
    const c = clip({ animIn: makeAnimation("fade"), animOut: makeAnimation("pop") });
    const [first, second] = splitClip(c, 12, "b", true)!;
    expect(first.animIn).toBeDefined();
    expect(first.animOut).toBeUndefined();
    expect(second.animIn).toBeUndefined();
    expect(second.animOut).toBeDefined();
  });
  it("sobrescrever no meio mantém entrada e saída nas pontas", () => {
    const c = clip({ animIn: makeAnimation("fade"), animOut: makeAnimation("pop") });
    const parts = overwriteRange([c], "v1", 11, 12, () => true, () => "n");
    expect(parts).toHaveLength(2);
    expect(parts[0].animIn).toBeDefined();
    expect(parts[0].animOut).toBeUndefined();
    expect(parts[1].animIn).toBeUndefined();
    expect(parts[1].animOut).toBeDefined();
  });
});
