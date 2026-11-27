import { describe, expect, it } from "vitest";
import { clampSide, clampTimeline, DEFAULT_DOCKS, DOCKS_KEY, LAYOUT_KEY, loadDocks, loadLayout, moveDock, saveDocks, saveLayout } from "./layout";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("tamanho dos painéis", () => {
  it("guarda e lê; dado estragado volta ao padrão", () => {
    const storage = memory();
    saveLayout({ left: 300, right: null, timeline: 320.4 }, storage);
    expect(loadLayout(storage)).toEqual({ left: 300, right: null, timeline: 320 });
    storage.setItem(LAYOUT_KEY, "{nada");
    expect(loadLayout(storage)).toEqual({ left: null, right: null, timeline: null });
    storage.setItem(LAYOUT_KEY, JSON.stringify({ left: -5, right: "x" }));
    expect(loadLayout(storage)).toEqual({ left: null, right: null, timeline: null });
  });
  it("colunas não passam dos limites nem espremem o centro", () => {
    expect(clampSide("left", 50, 1400, 250)).toBe(180);
    expect(clampSide("left", 900, 1400, 250)).toBe(520);
    expect(clampSide("left", 500, 1000, 250)).toBe(350);
  });
  it("timeline deixa espaço para o preview", () => {
    expect(clampTimeline(100, 700)).toBe(170);
    expect(clampTimeline(650, 700)).toBe(528);
    expect(clampTimeline(400, 700)).toBe(400);
  });
});

describe("painéis encaixáveis", () => {
  it("troca de lado e empilha", () => {
    expect(moveDock(DEFAULT_DOCKS, "library", "right", 9)).toEqual({ left: [], right: ["properties", "library"] });
    expect(moveDock(DEFAULT_DOCKS, "library", "right", 0)).toEqual({ left: [], right: ["library", "properties"] });
    expect(moveDock({ left: [], right: ["library", "properties"] }, "properties", "left", 0)).toEqual({ left: ["properties"], right: ["library"] });
  });
  it("arranjo guardado inválido volta ao padrão", () => {
    const storage = memory();
    saveDocks({ left: ["properties"], right: ["library"] }, storage);
    expect(loadDocks(storage)).toEqual({ left: ["properties"], right: ["library"] });
    storage.setItem(DOCKS_KEY, JSON.stringify({ left: ["library", "library"], right: [] }));
    expect(loadDocks(storage)).toEqual(DEFAULT_DOCKS);
    storage.setItem(DOCKS_KEY, JSON.stringify({ left: ["xyz"], right: ["library"] }));
    expect(loadDocks(storage)).toEqual(DEFAULT_DOCKS);
  });
});
