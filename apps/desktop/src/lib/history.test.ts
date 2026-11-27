import { describe, expect, it } from "vitest";
import { emptyHistory, mapHistory, record, redo, undo } from "./history";
import { splitClip } from "./timeline";

describe("histórico", () => {
  it("desfaz e refaz em ordem", () => {
    let h = emptyHistory<number>();
    h = record(h, 1); // 1 → 2
    h = record(h, 2); // 2 → 3
    const u1 = undo(h, 3)!;
    expect(u1.present).toBe(2);
    const u2 = undo(u1.history, u1.present)!;
    expect(u2.present).toBe(1);
    expect(undo(u2.history, u2.present)).toBeNull();
    const r1 = redo(u2.history, u2.present)!;
    expect(r1.present).toBe(2);
    expect(redo(r1.history, r1.present)!.present).toBe(3);
  });
  it("uma nova edição apaga o refazer", () => {
    const h = record(emptyHistory<number>(), 1);
    const u = undo(h, 2)!;
    expect(record(u.history, u.present).future).toEqual([]);
  });
  it("respeita o limite", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 5; i++) h = record(h, i, 3);
    expect(h.past).toEqual([2, 3, 4]);
  });
  it("mapHistory transforma passado e futuro", () => {
    expect(mapHistory({ past: [1, 2], future: [3] }, (n) => n * 10)).toEqual({ past: [10, 20], future: [30] });
  });
});

describe("splitClip", () => {
  const clip = { id: "a", mediaId: "m", trackId: "v", start: 2, duration: 4.458, inPoint: 0.5 };
  it("divide um vídeo e avança o ponto de entrada da segunda parte", () => {
    expect(splitClip(clip, 3.5, "b", true)).toEqual([
      { ...clip, duration: 1.5 },
      { id: "b", mediaId: "m", trackId: "v", start: 3.5, duration: 2.958, inPoint: 2 },
    ]);
  });
  it("imagem não tem ponto de entrada", () => {
    expect(splitClip({ ...clip, inPoint: 0 }, 4, "b", false)![1].inPoint).toBe(0);
  });
  it("não divide fora do clipe nem colado na borda", () => {
    expect(splitClip(clip, 1, "b", true)).toBeNull();
    expect(splitClip(clip, 2.05, "b", true)).toBeNull();
    expect(splitClip(clip, 6.45, "b", true)).toBeNull();
  });
});
