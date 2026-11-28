import type { ClipColor } from "../types";

/**
 * Correção de cor de um clipe, com a mesma conta no preview (filtro SVG) e na exportação (ffmpeg):
 * 1) contraste por canal: v' = v·c + 0,5·(1 − c)   (feComponentTransfer / lutrgb)
 * 2) uma matriz 3×3 sem deslocamento: brilho → saturação → temperatura → sépia
 *    (feColorMatrix / colorchannelmixer).
 * Cada passo limita a 0–1 nos dois lados, então os resultados batem.
 */
export const NEUTRAL_COLOR: ClipColor = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sepia: 0 };

export const COLOR_FIELDS: { key: keyof ClipColor; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brilho", min: -0.5, max: 0.5 },
  { key: "contrast", label: "Contraste", min: -0.5, max: 0.5 },
  { key: "saturation", label: "Saturação", min: -1, max: 1 },
  { key: "temperature", label: "Temperatura", min: -1, max: 1 },
  { key: "sepia", label: "Sépia", min: 0, max: 1 },
];

export const COLOR_PRESETS: { id: string; label: string; color: ClipColor }[] = [
  { id: "bw", label: "P&B", color: { ...NEUTRAL_COLOR, saturation: -1, contrast: 0.1 } },
  { id: "sepia", label: "Sépia", color: { ...NEUTRAL_COLOR, sepia: 0.85, contrast: 0.05 } },
  { id: "vivid", label: "Vívido", color: { ...NEUTRAL_COLOR, saturation: 0.35, contrast: 0.12 } },
  { id: "warm", label: "Quente", color: { ...NEUTRAL_COLOR, temperature: 0.5, saturation: 0.05 } },
  { id: "cool", label: "Frio", color: { ...NEUTRAL_COLOR, temperature: -0.5 } },
  { id: "vintage", label: "Vintage", color: { ...NEUTRAL_COLOR, sepia: 0.35, contrast: -0.1, saturation: -0.2, brightness: 0.03 } },
  { id: "drama", label: "Dramático", color: { ...NEUTRAL_COLOR, contrast: 0.35, saturation: -0.15, brightness: -0.05 } },
];

const round4 = (value: number) => Math.round(value * 10000) / 10000;

export function cleanColor(color: Partial<ClipColor>): ClipColor {
  const out = { ...NEUTRAL_COLOR };
  for (const field of COLOR_FIELDS) {
    const value = Number(color[field.key]);
    out[field.key] = Number.isFinite(value) ? round4(Math.min(field.max, Math.max(field.min, value))) : 0;
  }
  return out;
}

export const isNeutralColor = (color: ClipColor | undefined) =>
  !color || COLOR_FIELDS.every((field) => color[field.key] === 0);

/** Valida o que veio do arquivo do projeto (neutro = nada). */
export function validColor(value: any): ClipColor | null {
  if (!value || typeof value !== "object") return null;
  const color = cleanColor(value);
  return isNeutralColor(color) ? null : color;
}

/** Filtro pronto igual aos ajustes atuais (ou ""). */
export const matchingColorPreset = (color: ClipColor | undefined) =>
  COLOR_PRESETS.find((preset) => COLOR_FIELDS.every((field) => preset.color[field.key] === (color ?? NEUTRAL_COLOR)[field.key]))?.id ?? "";

type Matrix = number[]; // 3×3, linha a linha

const multiply = (a: Matrix, b: Matrix): Matrix => {
  const out: Matrix = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
    out.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
  return out;
};

/** Fator do contraste (1 = sem mudança). */
export const contrastFactor = (color: ClipColor) => 1 + color.contrast;

/** Matriz de cor (sem o contraste), aplicada depois dele: brilho → saturação → temperatura → sépia. */
export function colorMatrix(color: ClipColor): Matrix {
  const b = 1 + color.brightness;
  const bright: Matrix = [b, 0, 0, 0, b, 0, 0, 0, b];
  // Saturação com os pesos de luminância do CSS (saturate()).
  const s = 1 + color.saturation;
  const saturate: Matrix = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  // Temperatura: puxa para o laranja (positivo) ou para o azul (negativo).
  const t = color.temperature;
  const warmth: Matrix = [1 + 0.16 * t, 0, 0, 0, 1 + 0.03 * t, 0, 0, 0, 1 - 0.16 * t];
  // Sépia (mesma matriz do CSS sepia()), misturada pela intensidade.
  const a = color.sepia;
  const sepia: Matrix = [
    0.393 + 0.607 * (1 - a), 0.769 - 0.769 * (1 - a), 0.189 - 0.189 * (1 - a),
    0.349 - 0.349 * (1 - a), 0.686 + 0.314 * (1 - a), 0.168 - 0.168 * (1 - a),
    0.272 - 0.272 * (1 - a), 0.534 - 0.534 * (1 - a), 0.131 + 0.869 * (1 - a),
  ];
  return multiply(sepia, multiply(warmth, multiply(saturate, bright))).map(round4);
}

/** Aplica a correção num pixel RGB (0–1), do mesmo jeito que o preview e o ffmpeg. */
export function applyColor(color: ClipColor, rgb: [number, number, number]): [number, number, number] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const c = contrastFactor(color);
  const [r, g, b] = rgb.map((v) => clamp(v * c + 0.5 * (1 - c)));
  const m = colorMatrix(color);
  return [clamp(m[0] * r + m[1] * g + m[2] * b), clamp(m[3] * r + m[4] * g + m[5] * b), clamp(m[6] * r + m[7] * g + m[8] * b)];
}

/** Valores do feColorMatrix do SVG (4×5, alfa intocado). */
export function svgMatrixValues(color: ClipColor): string {
  const m = colorMatrix(color);
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(" ");
}

/** Filtros do ffmpeg (em RGBA, preservando a transparência). */
export function colorFilters(color: ClipColor): string[] {
  const c = round4(contrastFactor(color));
  const filters = ["format=rgba"];
  if (c !== 1) {
    const expr = `val*${c}+${round4(127.5 * (1 - c))}`;
    filters.push(`lutrgb=r='${expr}':g='${expr}':b='${expr}'`);
  }
  const m = colorMatrix(color);
  filters.push(`colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`);
  return filters;
}
