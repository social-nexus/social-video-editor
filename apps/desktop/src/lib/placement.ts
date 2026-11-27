import type { ClipFit, ClipPlacement } from "../types";

/**
 * Posição, tamanho e rotação de um clipe no quadro (edição direta no preview).
 * - x, y: deslocamento do centro em fração do quadro (0,5 = meio quadro para a direita/baixo).
 * - scale: tamanho (1 = como enquadrado).
 * - rotation: graus, sentido horário.
 * A camada do clipe ocupa o quadro todo; a mídia fica dentro dela, encaixada ou preenchendo.
 */
export const IDENTITY_PLACEMENT: ClipPlacement = { x: 0, y: 0, scale: 1, rotation: 0 };
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 5;

const round = (value: number, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f; };

/** Ângulo entre -180 e 180. */
export const normalizeAngle = (degrees: number) => {
  const a = ((degrees + 180) % 360 + 360) % 360 - 180;
  return a === -180 ? 180 : a;
};

export function cleanPlacement(p: ClipPlacement): ClipPlacement {
  return {
    x: round(Math.max(-2, Math.min(2, p.x))),
    y: round(Math.max(-2, Math.min(2, p.y))),
    scale: round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, p.scale))),
    rotation: round(normalizeAngle(p.rotation), 2),
  };
}

export const isIdentity = (p: ClipPlacement | undefined) =>
  !p || (p.x === 0 && p.y === 0 && p.scale === 1 && p.rotation === 0);

export const placementOf = (clip: { placement?: ClipPlacement }) => clip.placement ?? IDENTITY_PLACEMENT;

/** Valida o que veio do arquivo do projeto (projetos antigos não têm). */
export function validPlacement(value: any): ClipPlacement | null {
  if (!value || typeof value !== "object") return null;
  const p = { x: Number(value.x), y: Number(value.y), scale: Number(value.scale), rotation: Number(value.rotation) };
  if (![p.x, p.y, p.scale, p.rotation].every(Number.isFinite) || p.scale <= 0) return null;
  const clean = cleanPlacement(p);
  return isIdentity(clean) ? null : clean;
}

/** CSS da camada: desloca, gira e escala a partir do centro (mesma ordem da exportação). */
export const placementTransform = (p: ClipPlacement | undefined) => isIdentity(p) ? undefined
  : `translate(${round(p!.x * 100, 3)}%, ${round(p!.y * 100, 3)}%) rotate(${p!.rotation}deg) scale(${p!.scale})`;

/**
 * Parte do quadro que a mídia ocupa antes da posição (largura e altura em fração do quadro).
 * Encaixar: a mídia inteira cabe; Preencher: cobre o quadro (o que sobra é cortado).
 */
export function contentSize(fit: ClipFit | undefined, mediaAspect: number | null, frameAspect: number) {
  if (fit === "cover" || !mediaAspect || !(mediaAspect > 0) || !(frameAspect > 0)) return { w: 1, h: 1 };
  return mediaAspect >= frameAspect ? { w: 1, h: frameAspect / mediaAspect } : { w: mediaAspect / frameAspect, h: 1 };
}

type Point = { x: number; y: number };
type Frame = { width: number; height: number };

/** Leva um ponto da mídia (em px a partir do centro, antes da posição) para o quadro (px a partir do canto). */
function toFrame(local: Point, p: ClipPlacement, frame: Frame): Point {
  const rad = p.rotation * Math.PI / 180;
  const sx = local.x * p.scale, sy = local.y * p.scale;
  return {
    x: frame.width / 2 + p.x * frame.width + sx * Math.cos(rad) - sy * Math.sin(rad),
    y: frame.height / 2 + p.y * frame.height + sx * Math.sin(rad) + sy * Math.cos(rad),
  };
}

/** Os 4 cantos da mídia posicionada, em px do quadro (sup. esq., sup. dir., inf. dir., inf. esq.). */
export function placedCorners(size: { w: number; h: number }, p: ClipPlacement, frame: Frame): Point[] {
  const hw = size.w * frame.width / 2, hh = size.h * frame.height / 2;
  return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }].map((corner) => toFrame(corner, p, frame));
}

/** O ponto (px do quadro) está sobre a mídia posicionada? */
export function hitsPlaced(point: Point, size: { w: number; h: number }, p: ClipPlacement, frame: Frame): boolean {
  const rad = -p.rotation * Math.PI / 180;
  const dx = point.x - frame.width / 2 - p.x * frame.width;
  const dy = point.y - frame.height / 2 - p.y * frame.height;
  const lx = (dx * Math.cos(rad) - dy * Math.sin(rad)) / p.scale;
  const ly = (dx * Math.sin(rad) + dy * Math.cos(rad)) / p.scale;
  return Math.abs(lx) <= size.w * frame.width / 2 && Math.abs(ly) <= size.h * frame.height / 2;
}

/** Ímã: perto do centro (ou das bordas alinhadas) gruda no valor exato. */
export function snapValue(value: number, targets: number[], tolerance: number) {
  let best = value, bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= bestDistance) { best = target; bestDistance = distance; }
  }
  return best;
}

/** Rotação com ímã a cada 90° (e a cada 15° segurando Shift). */
export function snapRotation(degrees: number, fine: boolean) {
  if (fine) return normalizeAngle(Math.round(degrees / 15) * 15);
  return normalizeAngle(snapValue(degrees, [-180, -90, 0, 90, 180], 3));
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Filtros do ffmpeg que posicionam uma camada W×H (com transparência) no quadro W×H.
 * Sem rotação, corta antes só o pedaço que fica visível (zoom grande não pesa).
 * Retorna os filtros (vazio = nada a fazer) e a posição para o overlay; null = fica toda fora do quadro.
 */
export function placementFilters(p: ClipPlacement, width: number, height: number): { filters: string[]; x: string; y: string } | null {
  const centerX = width / 2 + p.x * width, centerY = height / 2 + p.y * height;
  if (p.rotation === 0) {
    // Parte da camada que cai dentro do quadro (em px da camada).
    const left = Math.max(0, width / 2 - centerX / p.scale), right = Math.min(width, width / 2 + (width - centerX) / p.scale);
    const top = Math.max(0, height / 2 - centerY / p.scale), bottom = Math.min(height, height / 2 + (height - centerY) / p.scale);
    if (right - left < 1 || bottom - top < 1) return null;
    const cropX = Math.floor(left / 2) * 2, cropY = Math.floor(top / 2) * 2;
    const cropW = Math.min(width - cropX, even(right - cropX)), cropH = Math.min(height - cropY, even(bottom - cropY));
    const filters: string[] = [];
    if (cropX > 0 || cropY > 0 || cropW < width || cropH < height) filters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);
    if (p.scale !== 1) filters.push(`scale=${even(cropW * p.scale)}:${even(cropH * p.scale)}:flags=bicubic`);
    return {
      filters,
      x: String(Math.round(centerX + (cropX - width / 2) * p.scale)),
      y: String(Math.round(centerY + (cropY - height / 2) * p.scale)),
    };
  }
  const radians = round(p.rotation * Math.PI / 180, 6);
  return {
    filters: [
      ...(p.scale !== 1 ? [`scale=${even(width * p.scale)}:${even(height * p.scale)}:flags=bicubic`] : []),
      `rotate=a=${radians}:ow=rotw(${radians}):oh=roth(${radians}):c=none:bilinear=1`,
    ],
    x: `${round(centerX, 2)}-w/2`,
    y: `${round(centerY, 2)}-h/2`,
  };
}
