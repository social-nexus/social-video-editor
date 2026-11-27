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
  /** Encaixar (mídia inteira) ou preencher o quadro. Ausente = encaixar. */
  fit?: ClipFit;
  /** Movimento de câmera (Ken Burns). Ausente = parado. */
  motion?: ClipMotion;
  /** Animação de entrada / saída da imagem. Ausente = sem animação. */
  animIn?: ClipAnimation;
  animOut?: ClipAnimation;
};

export type AnimationType = "fade" | "zoom-in" | "zoom-out" | "pop" | "slide-left" | "slide-right" | "slide-up" | "slide-down";

export type ClipAnimation = { type: AnimationType; duration: number };

export type ClipFit = "contain" | "cover";

export type MotionPreset = "none" | "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "pan-down" | "pan-up" | "custom";

/** Um quadro do movimento: zoom (1 = sem zoom) e deslocamento do centro em fração do quadro. */
export type MotionFrame = { scale: number; x: number; y: number };

export type ClipMotion = {
  preset: MotionPreset;
  /** Quanto de zoom o preset usa (0,15 = 15%). */
  intensity: number;
  /** Curva suave no começo e no fim. */
  smooth: boolean;
  from: MotionFrame;
  to: MotionFrame;
};

/** Ajustes de som de um clipe. */
export type ClipAudio = Pick<TimelineClip, "volume" | "fadeIn" | "fadeOut">;

/** Parte do clipe que muda ao mover ou aparar. */
export type ClipGeometry = Pick<TimelineClip, "start" | "duration" | "inPoint">;

/** Uma legenda: texto puro (pode ter quebras de linha) entre `start` e `end`, em segundos da timeline. */
export type Caption = { id: string; start: number; end: number; text: string };

/** Aparência das legendas no preview (e, no futuro, na exportação). */
export type CaptionStyle = {
  visible: boolean;
  /** Altura da letra em % da altura do vídeo. */
  size: number;
  position: "bottom" | "middle" | "top";
  background: boolean;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { visible: true, size: 5, position: "bottom", background: false };

/** Tudo o que o desfazer/refazer guarda. */
export type TimelineState = { tracks: Track[]; clips: TimelineClip[]; captions: Caption[] };
