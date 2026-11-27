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
  /** Volume da trilha (0–1). Ausente = 100%. */
  volume?: number;
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
  /** Volume do clipe (0–1). Ausente = 100%. */
  volume?: number;
  /** Fade de entrada / saída do som, em segundos. Ausente = sem fade. */
  fadeIn?: number;
  fadeOut?: number;
};

/** Ajustes de som de um clipe. */
export type ClipAudio = Pick<TimelineClip, "volume" | "fadeIn" | "fadeOut">;

/** Parte do clipe que muda ao mover ou aparar. */
export type ClipGeometry = Pick<TimelineClip, "start" | "duration" | "inPoint">;

/** Tudo o que o desfazer/refazer guarda. */
export type TimelineState = { tracks: Track[]; clips: TimelineClip[] };
