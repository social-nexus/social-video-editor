import { describe, expect, it } from "vitest";
import { appSettings, DEFAULT_EXPORT, DEFAULT_SETTINGS, EXPORT_KEY, loadExportSettings, loadSettings, saveSettings, SETTINGS_KEY, validSettings } from "./settings";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("configurações", () => {
  it("valores fora do limite ou estragados voltam ao padrão", () => {
    expect(validSettings({ imageDuration: 999, transitionDuration: 0, defaultRatio: "7:3" })).toEqual({ imageDuration: 60, transitionDuration: 0.1, defaultRatio: "9:16" });
    expect(validSettings(null)).toEqual(DEFAULT_SETTINGS);
    const storage = memory();
    storage.setItem(SETTINGS_KEY, "{nada");
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
  it("salva, passa a valer na hora e lê de novo", () => {
    const storage = memory();
    saveSettings({ imageDuration: 3, transitionDuration: 0.8, defaultRatio: "16:9" }, storage);
    expect(appSettings()).toEqual({ imageDuration: 3, transitionDuration: 0.8, defaultRatio: "16:9" });
    expect(loadSettings(storage)).toEqual({ imageDuration: 3, transitionDuration: 0.8, defaultRatio: "16:9" });
    saveSettings(DEFAULT_SETTINGS, storage);
  });
  it("padrões de exportação: completa o que falta", () => {
    const storage = memory();
    storage.setItem(EXPORT_KEY, JSON.stringify({ fps: 60 }));
    expect(loadExportSettings(storage)).toEqual({ ...DEFAULT_EXPORT, fps: 60 });
  });
});
