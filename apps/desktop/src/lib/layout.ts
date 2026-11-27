/** Tamanhos dos painéis do editor (px), guardados neste computador. null = tamanho padrão do CSS. */
export type PanelLayout = { left: number | null; right: number | null; timeline: number | null };

export const LAYOUT_KEY = "sve.layout";
export const DEFAULT_LAYOUT: PanelLayout = { left: null, right: null, timeline: null };

export const LIMITS = {
  left: { min: 180, max: 520 },
  right: { min: 200, max: 520 },
  timeline: { min: 170 },
  /** Espaço mínimo que sobra para o centro (preview) e para o preview acima da timeline. */
  centerMin: 360,
  previewMin: 160,
};

const valid = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): PanelLayout {
  try {
    const saved = JSON.parse(storage.getItem(LAYOUT_KEY) ?? "{}");
    return { left: valid(saved?.left), right: valid(saved?.right), timeline: valid(saved?.timeline) };
  } catch { return DEFAULT_LAYOUT; }
}

export function saveLayout(layout: PanelLayout, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

/** Largura de uma coluna lateral, sem espremer o centro abaixo do mínimo. */
export function clampSide(which: "left" | "right", value: number, workspaceWidth: number, otherSide: number) {
  const limits = LIMITS[which];
  return clamp(value, limits.min, Math.min(limits.max, workspaceWidth - otherSide - LIMITS.centerMin - 40));
}

/** Altura da timeline, deixando espaço para o preview em cima. */
export function clampTimeline(value: number, columnHeight: number) {
  return clamp(value, LIMITS.timeline.min, columnHeight - LIMITS.previewMin - 12);
}
