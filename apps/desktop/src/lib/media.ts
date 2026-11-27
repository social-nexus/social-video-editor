import type { MediaKind } from "../types";

export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg"];
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS];

export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;

export function kindFromFileName(name: string): MediaKind {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return "other";
}

export function kindOfFile(file: File): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "other";
}

export const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Lê a duração de um vídeo/áudio pelos metadados do próprio elemento de mídia. */
export function probeMediaDuration(url: string, kind: MediaKind): Promise<number | null> {
  if ((kind !== "video" && kind !== "audio") || !url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      element.removeAttribute("src");
      element.load();
      resolve(value);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 10000);
    element.src = url;
  });
}
