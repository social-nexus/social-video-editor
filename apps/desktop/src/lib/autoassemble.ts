import { formatSeconds, formatTimecode, MIN_CLIP_DURATION, roundTime } from "./time";

/**
 * Lê o instante (em segundos) escrito no começo do nome do arquivo.
 * Formatos aceitos (separadores "-", "_" ou "."):
 *   0-05.png          → minutos-segundos                      =   5
 *   0-04.300.mp4      → minutos-segundos.milissegundos        =   4,3
 *   00-00-05-500.jpg  → horas-minutos-segundos-milissegundos  =   5,5
 *   01-02-03.jpg      → horas-minutos-segundos                = 3723
 * Pode haver texto depois do tempo ("0-05 cena da cozinha.png").
 * Retorna null quando não há tempo válido.
 */
export function parseTimestamp(fileName: string): number | null {
  const base = fileName.replace(/\.[^.]+$/, "");
  const match = /^(\d+(?:[-_.]\d+){1,3})(?!\d)(?![-_.]\d)/.exec(base);
  if (!match) return null;
  const parts = match[1].split(/[-_.]/);
  const numbers = parts.map(Number);
  let hours = 0, minutes = 0, seconds = 0, fraction = "";
  if (parts.length === 2) [minutes, seconds] = numbers;
  else if (parts.length === 3 && parts[2].length === 3) { [minutes, seconds] = numbers; fraction = parts[2]; }
  else if (parts.length === 3) [hours, minutes, seconds] = numbers;
  else { [hours, minutes, seconds] = numbers; fraction = parts[3]; }
  if (seconds >= 60 || (parts.length !== 2 && !(parts.length === 3 && fraction) && minutes >= 60)) return null;
  if (fraction.length > 3) return null;
  const millis = fraction ? Number(fraction.padEnd(3, "0")) / 1000 : 0;
  return roundTime(hours * 3600 + minutes * 60 + seconds + millis);
}

export type AssemblyItem = {
  id: string;
  name: string;
  kind: "video" | "image";
  /** Duração real (vídeo). null = imagem ou ainda desconhecida. */
  duration: number | null;
};

export type AssemblyOptions = {
  /** Duração da narração; sem narração = null. */
  narrationDuration: number | null;
  /** Duração do último item quando não há narração (imagens). */
  lastImageDuration: number;
  /** Último vídeo mais curto que o fim da narração: desacelera para chegar até lá (padrão: sim). */
  stretchLastVideo?: boolean;
};

export type PlannedClip = { mediaId: string; name: string; kind: "video" | "image"; timestamp: number; start: number; duration: number; speed?: number };
export type SkippedItem = { mediaId: string; name: string; reason: string };
export type AssemblyIssue = { level: "warning" | "info"; message: string };
export type AssemblyPlan = { clips: PlannedClip[]; skipped: SkippedItem[]; issues: AssemblyIssue[]; end: number };

/**
 * Monta a sequência: cada arquivo começa no seu timestamp e dura até o próximo.
 * O último vai até o fim da narração (ou dura o próprio vídeo / `lastImageDuration`).
 * Vídeos mais longos que o intervalo são cortados; mais curtos deixam um vazio (com aviso).
 */
export function planAssembly(items: AssemblyItem[], options: AssemblyOptions): AssemblyPlan {
  const skipped: SkippedItem[] = [];
  const issues: AssemblyIssue[] = [];
  const { narrationDuration } = options;

  // 1. Timestamps.
  const timed: (AssemblyItem & { timestamp: number })[] = [];
  for (const item of items) {
    const timestamp = parseTimestamp(item.name);
    if (timestamp === null) skipped.push({ mediaId: item.id, name: item.name, reason: "Sem timestamp válido no nome" });
    else timed.push({ ...item, timestamp });
  }

  // 2. Ordem por tempo; no empate, vídeo antes de imagem e depois por nome.
  timed.sort((a, b) => a.timestamp - b.timestamp || (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1) || a.name.localeCompare(b.name));

  // 3. Duplicados e itens depois do fim da narração.
  const kept: typeof timed = [];
  const seenNames = new Map<string, string>();
  for (const item of timed) {
    const key = item.name.toLowerCase();
    if (seenNames.has(key)) { skipped.push({ mediaId: item.id, name: item.name, reason: "Arquivo duplicado na biblioteca" }); continue; }
    seenNames.set(key, item.name);
    const previous = kept[kept.length - 1];
    if (previous && Math.abs(previous.timestamp - item.timestamp) < MIN_CLIP_DURATION) {
      skipped.push({ mediaId: item.id, name: item.name, reason: `Mesmo tempo que “${previous.name}”` });
      continue;
    }
    if (narrationDuration !== null && item.timestamp >= narrationDuration) {
      skipped.push({ mediaId: item.id, name: item.name, reason: `Começa em ${formatTimecode(item.timestamp)}, depois do fim da narração (${formatTimecode(narrationDuration)})` });
      continue;
    }
    kept.push(item);
  }

  // 4. Durações.
  const clips: PlannedClip[] = [];
  kept.forEach((item, index) => {
    const next = kept[index + 1];
    const slotEnd = next ? next.timestamp : narrationDuration;
    let duration: number;
    let speed: number | undefined;
    if (slotEnd === null) duration = item.kind === "video" && item.duration ? item.duration : options.lastImageDuration;
    else {
      duration = slotEnd - item.timestamp;
      const stretch = !next && options.stretchLastVideo !== false;
      if (item.kind === "video" && item.duration && item.duration < duration - 0.05 && stretch) {
        speed = Math.round((item.duration / duration) * 1000) / 1000;
        issues.push({ level: "info", message: `“${item.name}” (${formatSeconds(roundTime(item.duration))}s) foi esticado até o fim da narração: ${formatSeconds(roundTime(duration))}s, em ${Math.round(speed * 100)}% da velocidade.` });
      } else if (item.kind === "video" && item.duration && item.duration < duration - 0.05) {
        issues.push({ level: "warning", message: `“${item.name}” dura ${formatSeconds(roundTime(item.duration))}s, mas o intervalo até ${next ? "o próximo" : "o fim da narração"} é de ${formatSeconds(roundTime(duration))}s: fica um vazio de ${formatSeconds(roundTime(duration - item.duration))}s.` });
        duration = item.duration;
      }
    }
    clips.push({ mediaId: item.id, name: item.name, kind: item.kind, timestamp: item.timestamp, start: item.timestamp, duration: roundTime(duration), ...(speed ? { speed } : {}) });
  });

  // 5. Avisos gerais.
  if (clips.length && clips[0].start > 0) {
    issues.unshift({ level: "warning", message: `O primeiro arquivo começa em ${formatTimecode(clips[0].start)}: o início fica sem imagem.` });
  }
  const end = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  if (!clips.length && items.length) issues.push({ level: "warning", message: "Nenhum arquivo pôde ser posicionado." });
  if (clips.some((clip) => clip.kind === "video" && !items.find((item) => item.id === clip.mediaId)?.duration)) {
    issues.push({ level: "info", message: "Alguns vídeos ainda estão sendo medidos; as durações podem mudar em instantes." });
  }
  return { clips, skipped, issues, end: roundTime(end) };
}
