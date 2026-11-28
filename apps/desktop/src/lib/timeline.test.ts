import { describe, expect, it } from "vitest";
import { applyClipDrag, clampClipDuration, nearestSnap, rippleFollowers, rippleTrim, rulerStep, shiftClips, snapTargetsFor, splitClip } from "./timeline";
import { MIN_CLIP_DURATION } from "./time";
import { formatTimecode, parseSeconds } from "./time";
import type { TimelineClip } from "../types";

const noSnap = { snapTargets: [], snapThreshold: 0 };
// Vídeo real de IMG_VID_TESTE: 4,458 s.
const video = { start: 2, duration: 4.458, inPoint: 0 };

describe("applyClipDrag: move", () => {
  it("desloca o clipe mantendo duração e ponto de entrada", () => {
    expect(applyClipDrag("move", video, 1.5, { sourceDuration: 4.458, ...noSnap })).toEqual({ start: 3.5, duration: 4.458, inPoint: 0 });
  });
  it("não deixa o clipe passar antes do 0", () => {
    expect(applyClipDrag("move", video, -10, { sourceDuration: 4.458, ...noSnap }).start).toBe(0);
  });
  it("encaixa a borda inicial num alvo próximo", () => {
    expect(applyClipDrag("move", video, 2.9, { sourceDuration: 4.458, snapTargets: [5], snapThreshold: 0.2 }).start).toBe(5);
  });
  it("encaixa a borda final quando ela está mais perto", () => {
    // fim original 6,458 + 0,5 = 6,958 → encaixa em 7 → início 2,542
    expect(applyClipDrag("move", video, 0.5, { sourceDuration: 4.458, snapTargets: [7], snapThreshold: 0.2 }).start).toBe(2.542);
  });
});

describe("applyClipDrag: trim-end", () => {
  it("encurta o clipe", () => {
    expect(applyClipDrag("trim-end", video, -2, { sourceDuration: 4.458, ...noSnap }).duration).toBe(2.458);
  });
  it("não passa do fim da mídia", () => {
    expect(applyClipDrag("trim-end", video, 10, { sourceDuration: 4.458, ...noSnap }).duration).toBe(4.458);
  });
  it("imagem pode crescer à vontade", () => {
    expect(applyClipDrag("trim-end", { start: 0, duration: 5, inPoint: 0 }, 10, { sourceDuration: null, ...noSnap }).duration).toBe(15);
  });
  it("respeita a duração mínima", () => {
    expect(applyClipDrag("trim-end", video, -100, { sourceDuration: 4.458, ...noSnap }).duration).toBe(0.1);
  });
});

describe("applyClipDrag: trim-start", () => {
  it("apara o início mantendo o fim e avança o ponto de entrada", () => {
    expect(applyClipDrag("trim-start", video, 1, { sourceDuration: 4.458, ...noSnap })).toEqual({ start: 3, duration: 3.458, inPoint: 1 });
  });
  it("não volta antes do começo da mídia", () => {
    expect(applyClipDrag("trim-start", video, -1, { sourceDuration: 4.458, ...noSnap })).toEqual(video);
  });
  it("pode recuperar o que foi aparado", () => {
    const trimmed = { start: 3, duration: 3.458, inPoint: 1 };
    expect(applyClipDrag("trim-start", trimmed, -5, { sourceDuration: 4.458, ...noSnap })).toEqual(video);
  });
  it("imagem pode crescer para trás até o 0, sem ponto de entrada", () => {
    expect(applyClipDrag("trim-start", { start: 2, duration: 5, inPoint: 0 }, -5, { sourceDuration: null, ...noSnap })).toEqual({ start: 0, duration: 7, inPoint: 0 });
  });
});

describe("snap e limites", () => {
  it("nearestSnap escolhe o alvo mais próximo dentro do limite", () => {
    expect(nearestSnap(4.9, [0, 5, 4.7], 0.25)).toBe(5);
    expect(nearestSnap(4.9, [0, 6], 0.25)).toBeNull();
  });
  it("snapTargetsFor ignora o próprio clipe", () => {
    const clips: TimelineClip[] = [
      { id: "a", mediaId: "m", trackId: "v", start: 0, duration: 4, inPoint: 0 },
      { id: "b", mediaId: "m", trackId: "v", start: 4, duration: 2, inPoint: 0 },
    ];
    expect(snapTargetsFor("a", clips, 3)).toEqual([0, 3, 4, 6]);
  });
  it("clampClipDuration desconta o ponto de entrada", () => {
    expect(clampClipDuration({ inPoint: 1 }, 4.458, 10)).toBe(3.458);
  });
  it("rulerStep mantém as marcas espaçadas", () => {
    expect(rulerStep(42)).toBe(2);
    expect(rulerStep(200)).toBe(0.5);
    expect(rulerStep(8)).toBe(10);
  });
});

describe("tempo", () => {
  it("formatTimecode", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(4.3)).toBe("0:04,3");
    expect(formatTimecode(65.25)).toBe("1:05,25");
  });
  it("parseSeconds aceita vírgula e rejeita vazio", () => {
    expect(parseSeconds("2,5")).toBe(2.5);
    expect(parseSeconds("8")).toBe(8);
    expect(Number.isNaN(parseSeconds(" "))).toBe(true);
  });
});

describe("applyClipDrag com vizinhos", () => {
  it("aparar o fim para no próximo clipe", () => {
    const image = { start: 0, duration: 5, inPoint: 0 };
    expect(applyClipDrag("trim-end", image, 10, { sourceDuration: null, ...noSnap, maxEnd: 7 }).duration).toBe(7);
  });
  it("aparar o início para no clipe anterior", () => {
    const image = { start: 5, duration: 5, inPoint: 0 };
    expect(applyClipDrag("trim-start", image, -10, { sourceDuration: null, ...noSnap, minStart: 3 })).toEqual({ start: 3, duration: 7, inPoint: 0 });
  });
});

describe("velocidade", () => {
  it("clipe a 50% pode durar o dobro da mídia", () => {
    expect(clampClipDuration({ inPoint: 0, speed: 0.5 }, 4, 20)).toBe(8);
  });
  it("aparar o início a 50% avança metade na mídia", () => {
    const result = applyClipDrag("trim-start", { start: 10, duration: 8, inPoint: 0 }, 2,
      { sourceDuration: 4, snapTargets: [], snapThreshold: 0, speed: 0.5 });
    expect(result).toEqual({ start: 12, duration: 6, inPoint: 1 });
  });
  it("dividir a 50% continua a mídia do ponto certo", () => {
    const parts = splitClip({ id: "a", mediaId: "m", trackId: "t", start: 0, duration: 8, inPoint: 0, speed: 0.5 }, 4, "b", true);
    expect(parts![1]).toMatchObject({ start: 4, duration: 4, inPoint: 2, speed: 0.5 });
  });
});

describe("edição em cascata (ripple)", () => {
  const opts = { sourceDuration: 20, snapTargets: [] as number[], snapThreshold: 0 };
  it("aparar o fim: os seguintes andam junto", () => {
    const r = rippleTrim("trim-end", { start: 2, duration: 5, inPoint: 1 }, -1.5, opts);
    expect(r.geometry).toEqual({ start: 2, duration: 3.5, inPoint: 1 });
    expect(r.shift).toBe(-1.5);
  });
  it("aparar o começo: fica grudado no anterior, a mídia avança e os seguintes voltam", () => {
    const r = rippleTrim("trim-start", { start: 2, duration: 5, inPoint: 1 }, 2, opts);
    expect(r.geometry).toEqual({ start: 2, duration: 3, inPoint: 3 });
    expect(r.shift).toBe(-2);
  });
  it("esticar o começo recupera só o que existe na mídia e empurra os seguintes", () => {
    const r = rippleTrim("trim-start", { start: 2, duration: 5, inPoint: 1 }, -3, opts);
    expect(r.geometry).toEqual({ start: 2, duration: 6, inPoint: 0 });
    expect(r.shift).toBe(1);
  });
  it("imagem: estica à vontade e nunca fica menor que o mínimo", () => {
    const image = { ...opts, sourceDuration: null };
    expect(rippleTrim("trim-start", { start: 0, duration: 5, inPoint: 0 }, -4, image).geometry).toEqual({ start: 0, duration: 9, inPoint: 0 });
    expect(rippleTrim("trim-start", { start: 0, duration: 5, inPoint: 0 }, 99, image).geometry.duration).toBeCloseTo(MIN_CLIP_DURATION);
  });
  it("seguintes: só os da mesma trilha que começam depois", () => {
    const clips = [
      { id: "a", mediaId: "m", trackId: "v1", start: 0, duration: 3, inPoint: 0 },
      { id: "b", mediaId: "m", trackId: "v1", start: 3, duration: 2, inPoint: 0 },
      { id: "c", mediaId: "m", trackId: "v1", start: 6, duration: 2, inPoint: 0 },
      { id: "d", mediaId: "m", trackId: "v2", start: 4, duration: 2, inPoint: 0 },
    ];
    expect(rippleFollowers(clips[0], clips).map((clip) => clip.id)).toEqual(["b", "c"]);
    expect(shiftClips(clips, new Set(["b", "c"]), -1).map((clip) => clip.start)).toEqual([0, 2, 5, 4]);
  });
});
