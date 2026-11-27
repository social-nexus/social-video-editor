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

/** Trilhas de vídeo recebem vídeos e imagens; trilhas de áudio recebem áudios. */
export type TrackKind = "video" | "audio";

export type Track = {
  id: string;
  kind: TrackKind;
  /** Trilha de vídeo oculta não aparece no preview. */
  hidden: boolean;
  /** Sem som no preview (em trilha de vídeo, silencia o áudio dos vídeos). */
  muted: boolean;
  /** Trilha travada não aceita edições. */
  locked: boolean;
};

export type TimelineClip = {
  id: string;
  mediaId: string;
  trackId: string;
  /** Posição do clipe na timeline, em segundos. */
  start: number;
  /** Duração do clipe na timeline, em segundos. */
  duration: number;
  /** Ponto de entrada na mídia de origem, em segundos (quanto foi aparado do início). */
  inPoint: number;
  /** Velocidade de reprodução (1 = normal, 0,5 = metade). Ausente = 1. */
  speed?: number;
};

/** Parte do clipe que muda ao mover ou aparar. */
export type ClipGeometry = Pick<TimelineClip, "start" | "duration" | "inPoint">;

/** Tudo o que o desfazer/refazer guarda. */
export type TimelineState = { tracks: Track[]; clips: TimelineClip[] };
