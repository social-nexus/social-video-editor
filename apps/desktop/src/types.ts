export type MediaKind = "video" | "image" | "audio" | "other";

export type MediaItem = {
  id: string;
  file: File | null;
  path: string | null;
  url: string;
  name: string;
  kind: MediaKind;
  size: number;
  missing?: boolean;
  /** Duração real em segundos (vídeo/áudio). null/undefined = desconhecida ou imagem. */
  duration?: number | null;
};

export type TimelineClip = {
  id: string;
  mediaId: string;
  /** Posição do clipe na timeline, em segundos. */
  start: number;
  /** Duração do clipe na timeline, em segundos. */
  duration: number;
  /** Ponto de entrada na mídia de origem, em segundos (quanto foi aparado do início). */
  inPoint: number;
};

/** Parte do clipe que muda ao mover ou aparar. */
export type ClipGeometry = Pick<TimelineClip, "start" | "duration" | "inPoint">;
