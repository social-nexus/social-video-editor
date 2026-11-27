import { describe, expect, it } from "vitest";
import { forgetProject, formatWhen, loadRecent, MAX_RECENT, projectFileName, RECENT_KEY, rememberProject, setRecentThumb, thumbnailSource } from "./recent";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const entry = (path: string, openedAt = 1) => ({ path, name: projectFileName(path), ratio: "9:16", openedAt, duration: 10, clips: 3 });

describe("projetos recentes", () => {
  it("o mais recente fica no topo, sem repetir o mesmo arquivo", () => {
    const storage = memory();
    rememberProject(entry("D:\\a\\Um.sveproj", 1), storage);
    rememberProject(entry("D:\\a\\Dois.sveproj", 2), storage);
    const list = rememberProject(entry("d:/a/um.sveproj", 3), storage);
    expect(list.map((item) => item.name)).toEqual(["um", "Dois"]);
    expect(loadRecent(storage)).toHaveLength(2);
  });
  it("limite de itens", () => {
    const storage = memory();
    for (let i = 0; i < MAX_RECENT + 5; i++) rememberProject(entry(`D:/p${i}.sveproj`, i), storage);
    expect(loadRecent(storage)).toHaveLength(MAX_RECENT);
    expect(loadRecent(storage)[0].path).toBe(`D:/p${MAX_RECENT + 4}.sveproj`);
  });
  it("remover da lista", () => {
    const storage = memory();
    rememberProject(entry("D:/a.sveproj"), storage);
    expect(forgetProject("D:/A.sveproj", storage)).toEqual([]);
  });
  it("dados estragados não quebram", () => {
    const storage = memory();
    storage.setItem(RECENT_KEY, "{nada");
    expect(loadRecent(storage)).toEqual([]);
    storage.setItem(RECENT_KEY, JSON.stringify([{ path: 3 }, entry("D:/ok.sveproj")]));
    expect(loadRecent(storage).map((item) => item.name)).toEqual(["ok"]);
  });
  it("datas amigáveis", () => {
    const now = Date.UTC(2026, 10, 27, 12);
    expect(formatWhen(now - 30_000, now)).toBe("agora há pouco");
    expect(formatWhen(now - 15 * 60_000, now)).toBe("há 15 min");
    expect(formatWhen(now - 3 * 3_600_000, now)).toBe("há 3 h");
    expect(formatWhen(now - 30 * 3_600_000, now)).toBe("ontem");
  });
  it("miniatura: guarda, troca e sobrevive a reabrir", () => {
    const storage = memory();
    rememberProject(entry("D:/a.sveproj"), storage);
    setRecentThumb("d:\\A.sveproj", "data:image/jpeg;base64,AAA", storage);
    expect(loadRecent(storage)[0].thumb).toBe("data:image/jpeg;base64,AAA");
    rememberProject(entry("D:/a.sveproj", 5), storage);
    expect(loadRecent(storage)[0].thumb).toBe("data:image/jpeg;base64,AAA");
    setRecentThumb("D:/a.sveproj", "javascript:alert(1)", storage);
    expect(loadRecent(storage)[0].thumb).toBeUndefined();
  });
  it("fonte da miniatura", () => {
    const media = [
      { id: "a", path: "D:/som.mp3", kind: "audio" },
      { id: "v", path: "D:/v.mp4", kind: "video" },
      { id: "i", path: "D:/i.png", kind: "image" },
      { id: "x", path: "D:/sumiu.png", kind: "image", missing: true },
    ];
    expect(thumbnailSource([
      { mediaId: "a", start: 0, duration: 9, inPoint: 0 },
      { mediaId: "x", start: 0, duration: 2, inPoint: 0 },
      { mediaId: "v", start: 3, duration: 4, inPoint: 2, speed: 2 },
      { mediaId: "i", start: 7, duration: 2, inPoint: 0 },
    ], media)).toEqual({ path: "D:/v.mp4", seconds: 4 });
    expect(thumbnailSource([], media)).toEqual({ path: "D:/v.mp4", seconds: 1 });
    expect(thumbnailSource([], [media[0]])).toBeNull();
  });
});
