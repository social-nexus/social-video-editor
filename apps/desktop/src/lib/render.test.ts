import { describe, expect, it } from "vitest";
import { buildRenderPlan, num, outputSize, renderDuration, tempoChain } from "./render";
import type { MediaItem, TimelineClip, TimelineState, Track } from "../types";

const item = (id: string, kind: MediaItem["kind"], path: string | null = `D:/m/${id}`): MediaItem =>
  ({ id, file: null, path, url: "", name: id, kind, size: 1 });
const track = (id: string, kind: Track["kind"], extra: Partial<Track> = {}): Track =>
  ({ id, kind, hidden: false, muted: false, locked: false, ...extra });
const clip = (id: string, mediaId: string, trackId: string, start: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, mediaId, trackId, start, duration, inPoint: 0, ...extra });
const settings = { width: 1080, height: 1920, fps: 30, crf: 21, preset: "medium" };
const probes = new Map([["D:/m/vid", { hasVideo: true, hasAudio: true }], ["D:/m/mute", { hasVideo: true, hasAudio: false }]]);

describe("tamanho e números", () => {
  it("lado menor = resolução, sempre par", () => {
    expect(outputSize("9:16", 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize("4:5", 1080)).toEqual({ width: 1080, height: 1350 });
    expect(outputSize("1:1", 1080)).toEqual({ width: 1080, height: 1080 });
  });
  it("números curtos", () => {
    expect(num(5)).toBe("5");
    expect(num(1.23456)).toBe("1.235");
    expect(num(0.5)).toBe("0.5");
    expect(num(0)).toBe("0");
  });
  it("atempo encadeado fora de 0,5–100", () => {
    expect(tempoChain(1)).toEqual([]);
    expect(tempoChain(0.484)).toEqual(["atempo=0.5", "atempo=0.968"]);
    expect(tempoChain(2)).toEqual(["atempo=2"]);
  });
});

describe("plano de exportação", () => {
  const tracks = [track("v1", "video"), track("v2", "video"), track("a1", "audio")];
  const media = [item("img", "image"), item("vid", "video"), item("mute", "video"), item("nar", "audio"), item("web", "image", null)];

  it("imagem + vídeo + narração", () => {
    const state: TimelineState = { tracks, captions: [], clips: [
      clip("c1", "img", "v1", 0, 5, { fit: "cover" }),
      clip("c2", "vid", "v1", 5, 4, { inPoint: 2, speed: 0.5, volume: 0.5, fadeOut: 1 }),
      clip("c3", "nar", "a1", 0, 9),
    ] };
    const plan = buildRenderPlan(state, media, probes, settings, renderDuration(state));
    expect(plan.duration).toBe(9);
    expect(plan.inputs).toEqual([
      "-loop", "1", "-framerate", "30", "-t", "5", "-i", "D:/m/img",
      "-ss", "2", "-t", "2.5", "-i", "D:/m/vid",
      "-ss", "0", "-t", "9.5", "-i", "D:/m/nar",
    ]);
    expect(plan.filter).toContain("color=c=black:s=1080x1920:r=30:d=9");
    expect(plan.filter).toContain("[0:v]trim=duration=5,setpts=PTS-STARTPTS,fps=30,scale=1080:1920:force_original_aspect_ratio=increase");
    expect(plan.filter).toContain("[1:v]trim=duration=2,setpts=(PTS-STARTPTS)/0.5");
    expect(plan.filter).toContain("pad=1080:1920");
    expect(plan.filter).toContain("enable='between(t,5,9)'");
    expect(plan.filter).toContain("[1:a]atrim=duration=2,asetpts=PTS-STARTPTS,atempo=0.5");
    expect(plan.filter).toContain("volume=0.5,afade=t=out:st=3:d=1");
    expect(plan.filter).toContain("adelay=delays=5000:all=1");
    expect(plan.filter).toContain("amix=inputs=2:normalize=0");
    expect(plan.outputArgs).toContain("[aout]");
    expect(plan.sources).toEqual(["D:/m/img", "D:/m/vid", "D:/m/nar"]);
  });

  it("trilha oculta não aparece, silenciada não toca, sem caminho fica de fora", () => {
    const state: TimelineState = { captions: [], tracks: [track("v1", "video", { hidden: true }), track("a1", "audio", { muted: true })], clips: [
      clip("c1", "vid", "v1", 0, 3),
      clip("c2", "nar", "a1", 0, 3),
      clip("c3", "web", "v1", 3, 2),
    ] };
    const plan = buildRenderPlan(state, media, probes, settings, 5);
    // Vídeo em trilha oculta: só o som.
    expect(plan.filter).not.toContain("[0:v]");
    expect(plan.filter).toContain("[0:a]");
    expect(plan.inputs.filter((arg) => arg === "-i")).toHaveLength(1);
    expect(plan.warnings.join(" ")).toContain("não vinculada");
    expect(plan.warnings.join(" ")).toContain("preto");
  });

  it("vídeo sem som não usa [n:a]; sem som nenhum, exporta sem áudio", () => {
    const state: TimelineState = { captions: [], tracks, clips: [clip("c1", "mute", "v1", 0, 3)] };
    const plan = buildRenderPlan(state, media, probes, settings, 3);
    expect(plan.filter).not.toContain(":a]");
    expect(plan.outputArgs).toContain("-an");
  });

  it("a trilha de cima é sobreposta por último", () => {
    const state: TimelineState = { captions: [], tracks, clips: [clip("top", "img", "v2", 0, 2), clip("bottom", "vid", "v1", 0, 2)] };
    const plan = buildRenderPlan(state, media, probes, settings, 2);
    expect(plan.inputs.indexOf("D:/m/vid")).toBeLessThan(plan.inputs.indexOf("D:/m/img"));
  });
});

describe("transições na exportação", () => {
  it("o anterior continua por baixo (imagem e som separados) e o novo entra misturado", () => {
    const state: TimelineState = {
      tracks: [track("v1", "video")],
      clips: [clip("a", "vid", "v1", 0, 4), clip("b", "img", "v1", 4, 3, { transition: { type: "dissolve", duration: 1 } })],
      captions: [],
    };
    const plan = buildRenderPlan(state, [item("vid", "video"), item("img", "image")], probes, settings, 7);
    // vídeo anterior: lê 1 s a mais e segura o último quadro se acabar
    expect(plan.inputs.slice(0, 6)).toEqual(["-ss", "0", "-t", "5.5", "-i", "D:/m/vid"]);
    expect(plan.filter).toContain("tpad=stop_mode=clone:stop_duration=1,trim=duration=5");
    expect(plan.filter).toContain("enable='between(t,0,5)'");
    // som do anterior não se estende
    expect(plan.filter).toContain("atrim=duration=4,");
    // novo clipe: mistura só durante a transição
    expect(plan.filter).toMatch(/blend=c0_expr='A\*clip\(\(T-4\)\/1,0,1\)\+B\*\(1-clip\(\(T-4\)\/1,0,1\)\)':.*:enable='between\(t,4,5\)'/);
  });
  it("sem clipe colado antes, a transição é ignorada", () => {
    const state: TimelineState = {
      tracks: [track("v1", "video")],
      clips: [clip("a", "vid", "v1", 0, 4), clip("b", "img", "v1", 4.5, 3, { transition: { type: "dissolve", duration: 1 } })],
      captions: [],
    };
    const plan = buildRenderPlan(state, [item("vid", "video"), item("img", "image")], probes, settings, 7.5);
    expect(plan.filter).not.toContain("blend=");
    expect(plan.filter).not.toContain("tpad=");
  });
});
