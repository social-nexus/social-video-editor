/** Projetos abertos ou salvos recentemente (só a lista; os arquivos nunca são apagados por aqui). */
export type RecentProject = {
  path: string;
  name: string;
  ratio: string;
  /** Quando foi aberto ou salvo pela última vez (ms desde 1970). */
  openedAt: number;
  /** Duração da timeline em segundos. */
  duration: number;
  clips: number;
};

export const RECENT_KEY = "sve.recentProjects";
export const MAX_RECENT = 24;

const samePath = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

function valid(entry: any): entry is RecentProject {
  return entry && typeof entry.path === "string" && entry.path && typeof entry.name === "string"
    && typeof entry.ratio === "string" && Number.isFinite(entry.openedAt);
}

export function loadRecent(storage: Pick<Storage, "getItem"> = localStorage): RecentProject[] {
  try {
    const list = JSON.parse(storage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(valid).map((entry) => ({
      ...entry, duration: Number(entry.duration) || 0, clips: Number(entry.clips) || 0,
    })) : [];
  } catch { return []; }
}

function store(list: RecentProject[], storage: Pick<Storage, "setItem">) {
  storage.setItem(RECENT_KEY, JSON.stringify(list));
}

/** Coloca o projeto no topo (substitui a entrada antiga do mesmo arquivo). */
export function rememberProject(entry: RecentProject, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): RecentProject[] {
  const list = [entry, ...loadRecent(storage).filter((item) => !samePath(item.path, entry.path))].slice(0, MAX_RECENT);
  store(list, storage);
  return list;
}

/** Tira da lista (o arquivo do projeto continua onde está). */
export function forgetProject(path: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): RecentProject[] {
  const list = loadRecent(storage).filter((item) => !samePath(item.path, path));
  store(list, storage);
  return list;
}

/** "agora há pouco", "há 3 h", "ontem", "12/08/2026". */
export function formatWhen(time: number, now = Date.now()) {
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 2) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return "ontem";
  return new Date(time).toLocaleDateString("pt-BR");
}

/** Nome do arquivo sem a pasta e sem a extensão. */
export const projectFileName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.sveproj$/i, "");
