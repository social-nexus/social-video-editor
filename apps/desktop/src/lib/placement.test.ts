import { describe, expect, it } from "vitest";
import { cleanPlacement, placementFilters, contentSize, hitsPlaced, normalizeAngle, placedCorners, placementTransform, snapRotation, snapValue, validPlacement } from "./placement";

const frame = { width: 1080, height: 1920 };

describe("posição no quadro", () => {
  it("sem posição não gera CSS", () => {
    expect(placementTransform(undefined)).toBeUndefined();
    expect(placementTransform({ x: 0, y: 0, scale: 1, rotation: 0 })).toBeUndefined();
    expect(placementTransform({ x: 0.25, y: -0.1, scale: 0.5, rotation: 30 })).toBe("translate(25%, -10%) rotate(30deg) scale(0.5)");
  });
  it("ângulos e limites", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(720)).toBe(0);
    expect(cleanPlacement({ x: 9, y: 0, scale: 0, rotation: 361 })).toEqual({ x: 2, y: 0, scale: 0.05, rotation: 1 });
  });
  it("arquivo: valida e ignora o neutro", () => {
    expect(validPlacement({ x: 0.1, y: 0, scale: 2, rotation: 0 })).toEqual({ x: 0.1, y: 0, scale: 2, rotation: 0 });
    expect(validPlacement({ x: 0, y: 0, scale: 1, rotation: 0 })).toBeNull();
    expect(validPlacement({ x: "a", y: 0, scale: 1, rotation: 0 })).toBeNull();
    expect(validPlacement(null)).toBeNull();
  });
  it("tamanho da mídia encaixada", () => {
    expect(contentSize("contain", 16 / 9, 9 / 16)).toEqual({ w: 1, h: (9 / 16) / (16 / 9) });
    expect(contentSize("contain", 9 / 16, 9 / 16)).toEqual({ w: 1, h: 1 });
    expect(contentSize("contain", 1, 16 / 9)).toEqual({ w: 9 / 16, h: 1 });
    expect(contentSize("cover", 16 / 9, 9 / 16)).toEqual({ w: 1, h: 1 });
    expect(contentSize(undefined, null, 9 / 16)).toEqual({ w: 1, h: 1 });
  });
  it("cantos: metade do tamanho, deslocada e girada 90°", () => {
    const corners = placedCorners({ w: 1, h: 1 }, { x: 0.25, y: 0, scale: 0.5, rotation: 90 }, frame);
    // centro em (810, 960); largura 540 e altura 960 giradas: o canto sup. esq. vai para cima à direita
    expect(corners[0].x).toBeCloseTo(810 + 480);
    expect(corners[0].y).toBeCloseTo(960 - 270);
    expect(corners[2].x).toBeCloseTo(810 - 480);
    expect(corners[2].y).toBeCloseTo(960 + 270);
  });
  it("clique sobre a mídia posicionada", () => {
    const p = { x: 0.25, y: 0, scale: 0.5, rotation: 0 };
    expect(hitsPlaced({ x: 810, y: 960 }, { w: 1, h: 1 }, p, frame)).toBe(true);
    expect(hitsPlaced({ x: 500, y: 960 }, { w: 1, h: 1 }, p, frame)).toBe(false);
    expect(hitsPlaced({ x: 810, y: 500 }, { w: 1, h: 1 }, p, frame)).toBe(true);
    expect(hitsPlaced({ x: 810, y: 400 }, { w: 1, h: 1 }, p, frame)).toBe(false);
    // girada 90°: agora é larga e baixa
    expect(hitsPlaced({ x: 810, y: 500 }, { w: 1, h: 1 }, { ...p, rotation: 90 }, frame)).toBe(false);
    expect(hitsPlaced({ x: 400, y: 960 }, { w: 1, h: 1 }, { ...p, rotation: 90 }, frame)).toBe(true);
  });
  it("ímãs", () => {
    expect(snapValue(0.008, [0], 0.01)).toBe(0);
    expect(snapValue(0.02, [0], 0.01)).toBe(0.02);
    expect(snapRotation(88, false)).toBe(90);
    expect(snapRotation(80, false)).toBe(80);
    expect(snapRotation(37, true)).toBe(30);
  });
  it("exportação: metade do tamanho no canto, sem cortar", () => {
    const placed = placementFilters({ x: 0.25, y: -0.25, scale: 0.5, rotation: 0 }, 1080, 1920);
    expect(placed).toEqual({ filters: ["scale=540:960:flags=bicubic"], x: "540", y: "0" });
  });
  it("exportação: zoom grande corta só o que aparece", () => {
    const placed = placementFilters({ x: 0, y: 0, scale: 4, rotation: 0 }, 1080, 1920)!;
    expect(placed.filters[0]).toBe("crop=272:480:404:720");
    expect(placed.filters[1]).toBe("scale=1088:1920:flags=bicubic");
    expect(Number(placed.x)).toBeLessThanOrEqual(0);
  });
  it("exportação: fora do quadro some; girada usa rotate", () => {
    expect(placementFilters({ x: 1.2, y: 0, scale: 0.5, rotation: 0 }, 1080, 1920)).toBeNull();
    const rotated = placementFilters({ x: 0, y: 0.1, scale: 0.5, rotation: 90 }, 1080, 1920)!;
    expect(rotated.filters[1]).toMatch(/^rotate=a=1.570796:ow=rotw\(1.570796\)/);
    expect(rotated).toMatchObject({ x: "540-w/2", y: "1152-h/2" });
  });
});
