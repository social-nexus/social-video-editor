/** Pilhas de desfazer/refazer. `past` termina no estado mais recente; `future` começa no próximo a refazer. */
export type History<T> = { past: T[]; future: T[] };

export const HISTORY_LIMIT = 100;

export const emptyHistory = <T,>(): History<T> => ({ past: [], future: [] });

/** Registra `present` (o estado ANTES da edição). Uma nova edição apaga o que havia para refazer. */
export function record<T>(history: History<T>, present: T, limit = HISTORY_LIMIT): History<T> {
  return { past: [...history.past, present].slice(-limit), future: [] };
}

export function undo<T>(history: History<T>, present: T): { history: History<T>; present: T } | null {
  if (!history.past.length) return null;
  const previous = history.past[history.past.length - 1];
  return { history: { past: history.past.slice(0, -1), future: [present, ...history.future] }, present: previous };
}

export function redo<T>(history: History<T>, present: T): { history: History<T>; present: T } | null {
  if (!history.future.length) return null;
  const [next, ...rest] = history.future;
  return { history: { past: [...history.past, present], future: rest }, present: next };
}

/** Aplica `transform` a todos os estados guardados (ex.: tirar clipes de uma mídia removida). */
export function mapHistory<T>(history: History<T>, transform: (state: T) => T): History<T> {
  return { past: history.past.map(transform), future: history.future.map(transform) };
}
