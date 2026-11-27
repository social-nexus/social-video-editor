import type { TrackKind } from "../types";

/**
 * Arraste de mídia até a timeline: da biblioteca (com o mouse) ou de arquivos do computador
 * (evento de arrastar do Tauri). Os dois avisam a posição por aqui; a timeline mostra a prévia
 * e diz onde a mídia entraria (trilha + instante).
 *
 * Não usa o arrastar nativo do HTML: no Windows ele não funciona junto com o arrastar
 * de arquivos do sistema para dentro da janela.
 */
export type DragPayload = { name: string; kind: TrackKind; duration: number };
export type DragState = { payload: DragPayload; x: number; y: number } | null;
export type DropSpot = { target: string | TrackKind; start: number };

export const MEDIA_DRAG_EVENT = "sve-media-drag";

let state: DragState = null;
let resolver: ((x: number, y: number, payload: DragPayload) => DropSpot | null) | null = null;

function notify() {
  window.dispatchEvent(new CustomEvent<DragState>(MEDIA_DRAG_EVENT, { detail: state }));
}

/** Atualiza a posição (coordenadas da janela, em px CSS). */
export function moveDrag(payload: DragPayload, x: number, y: number) {
  state = { payload, x, y };
  notify();
}

export function endDrag() {
  if (!state) return;
  state = null;
  notify();
}

export const currentDrag = () => state;

/** A timeline registra como transformar um ponto da tela em trilha + instante. */
export function setDropResolver(fn: typeof resolver) {
  resolver = fn;
}

export function resolveDrop(x: number, y: number, payload: DragPayload): DropSpot | null {
  return resolver ? resolver(x, y, payload) : null;
}
