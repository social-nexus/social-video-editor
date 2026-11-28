/**
 * Preferências do app, guardadas neste computador (não vão para o arquivo do projeto).
 * - Gerais: padrões do editor (duração das imagens e das transições, proporção de projetos novos).
 * - Exportação: os padrões que a janela de exportar usa e lembra.
 * - FFmpeg: caminho do ffmpeg escolhido (vazio = o do sistema).
 */
export type AppSettings = {
  /** Duração de uma imagem ao entrar na timeline (s). */
  imageDuration: number;
  /** Duração de uma transição nova (s). */
  transitionDuration: number;
  /** Proporção de um projeto novo. */
  defaultRatio: string;
};

export type ExportSettings = { resolution: number; fps: number; quality: string; speed: string; burnCaptions: boolean; normalize: boolean };

export const SETTINGS_KEY = "sve.settings";
export const EXPORT_KEY = "sve.export";
export const FFMPEG_KEY = "sve.ffmpegPath";

export const RATIO_OPTIONS = ["9:16", "16:9", "1:1", "4:5", "3:4"];
export const DEFAULT_SETTINGS: AppSettings = { imageDuration: 5, transitionDuration: 0.5, defaultRatio: "9:16" };
export const DEFAULT_EXPORT: ExportSettings = { resolution: 1080, fps: 30, quality: "good", speed: "medium", burnCaptions: true, normalize: true };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const browserStorage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number)) * 100) / 100 : fallback;
};

export function validSettings(value: any): AppSettings {
  return {
    imageDuration: clampNumber(value?.imageDuration, 0.5, 60, DEFAULT_SETTINGS.imageDuration),
    transitionDuration: clampNumber(value?.transitionDuration, 0.1, 3, DEFAULT_SETTINGS.transitionDuration),
    defaultRatio: RATIO_OPTIONS.includes(value?.defaultRatio) ? value.defaultRatio : DEFAULT_SETTINGS.defaultRatio,
  };
}

export function loadSettings(storage: Storage | null = browserStorage()): AppSettings {
  try { return validSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) ?? "{}")); } catch { return DEFAULT_SETTINGS; }
}

export function loadExportSettings(storage: Storage | null = browserStorage()): ExportSettings {
  try { return { ...DEFAULT_EXPORT, ...JSON.parse(storage?.getItem(EXPORT_KEY) ?? "{}") }; } catch { return DEFAULT_EXPORT; }
}

export function saveExportSettings(settings: ExportSettings, storage: Storage | null = browserStorage()) {
  storage?.setItem(EXPORT_KEY, JSON.stringify(settings));
}

// Preferências em uso (lidas uma vez; a tela de Configurações atualiza).
let current: AppSettings = loadSettings();

export const appSettings = () => current;

export function saveSettings(next: AppSettings, storage: Storage | null = browserStorage()): AppSettings {
  current = validSettings(next);
  storage?.setItem(SETTINGS_KEY, JSON.stringify(current));
  return current;
}
