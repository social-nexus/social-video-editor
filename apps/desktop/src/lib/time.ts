export const MIN_CLIP_DURATION = 0.1;
export const DEFAULT_IMAGE_DURATION = 5;

/** Arredonda para milissegundos, evitando erros de ponto flutuante (0,1 + 0,2). */
export const roundTime = (value: number) => Math.round(value * 1000) / 1000;

/** 2.5 → "2,5" (padrão brasileiro, até 3 casas). */
export const formatSeconds = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Aceita "2,5" ou "2.5". Retorna NaN para texto inválido ou vazio. */
export const parseSeconds = (text: string) => {
  const trimmed = text.trim();
  return trimmed ? Number(trimmed.replace(",", ".")) : NaN;
};

/** 65.25 → "1:05,25"; 3.5 → "0:03,5". */
export function formatTimecode(value: number) {
  const total = Math.max(0, roundTime(value));
  const minutes = Math.floor(total / 60);
  const seconds = roundTime(total - minutes * 60);
  const [whole, fraction] = seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").split(".");
  return `${minutes}:${whole.padStart(2, "0")}${fraction ? "," + fraction : ""}`;
}
