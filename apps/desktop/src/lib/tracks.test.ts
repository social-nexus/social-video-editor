import { describe, expect, it } from "vitest";
import { clipsAt, freeBounds, overwriteRange, trackEnd, trackLabel } from "./tracks";
import type { TimelineClip, Track } from "../types";

const clip = (id: string, start: number, duration: number, trackId = "v1", inPoint = 0): TimelineClip =>
  ({ id, mediaId: "m", trackId, start, duration, inPoint });
const always = () => true;
let n = 0;
const ids = () => `novo${++n}`;

describe("overwriteRange", () => {
  it("remove o que está totalmente coberto", () => {
    expect(overwriteRange([clip("a", 2, 2)], "v1", 1, 5, always)).toEqual([]);
  });
  it("apara o fim do clipe que começa antes", () => {
    expect(overwriteRange([clip("a", 0, 4)], "v1", 3, 6, always)).toEqual([clip("a", 0, 3)]);
  });
  it("apara o início do clipe que termina depois e avança o ponto de entrada", () => {
    expect(overwriteRange([clip("a", 2, 4, "v1", 1)], "v1", 0, 3, always)).toEqual([clip("a", 3, 3, "v1", 2)]);
  });
  it("corta em dois o clipe que cobre o intervalo inteiro", () => {
    n = 0;
    expect(overwriteRange([clip("a", 0, 10)], "v1", 4, 6, always, ids)).toEqual([clip("a", 0, 4), clip("novo1", 6, 4, "v1", 6)]);
  });
  it("não mexe em outras trilhas nem em clipes só encostados", () => {
    const clips = [clip("a", 0, 4, "v2"), clip("b", 0, 2), clip("c", 6, 2)];
    expect(overwriteRange(clips, "v1", 2, 6, always)).toEqual(clips);
  });
  it("imagem não ganha ponto de entrada", () => {
    expect(overwriteRange([clip("a", 0, 5)], "v1", 0, 2, () => false)[0].inPoint).toBe(0);
  });
});

describe("trilhas", () => {
  const tracks: Track[] = [
    { id: "v1", kind: "video", hidden: false, muted: false, locked: false },
    { id: "a1", kind: "audio", hidden: false, muted: false, locked: false },
    { id: "v2", kind: "video", hidden: false, muted: false, locked: false },
  ];
  it("numera por tipo", () => {
    expect(tracks.map((track) => trackLabel(track, tracks))).toEqual(["V1", "A1", "V2"]);
  });
  it("freeBounds acha os vizinhos na mesma trilha", () => {
    const clips = [clip("a", 0, 2), clip("b", 3, 2), clip("c", 7, 1), clip("x", 5.5, 1, "v2")];
    expect(freeBounds(clips[1], clips)).toEqual({ minStart: 2, maxEnd: 7 });
  });
  it("trackEnd e clipsAt", () => {
    const clips = [clip("a", 0, 2), clip("b", 2, 3), clip("c", 1, 9, "a1")];
    expect(trackEnd(clips, "v1")).toBe(5);
    expect(clipsAt(clips, 2).map((c) => c.id)).toEqual(["b", "c"]);
  });
});
