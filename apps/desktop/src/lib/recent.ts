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
  /** Miniatura (JPEG pequeno em data URL), gerada ao salvar ou abrir. */
  thumb?: string;
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
      thumb: typeof entry.thumb === "string" && entry.thumb.startsWith("data:image/") ? entry.thumb : undefined,
    })) : [];
  } catch { return []; }
}

function store(list: RecentProject[], storage: Pick<Storage, "setItem">) {
  storage.setItem(RECENT_KEY, JSON.stringify(list));
}

/** Coloca o projeto no topo (substitui a entrada antiga do mesmo arquivo). */
export function rememberProject(entry: RecentProject, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): RecentProject[] {
  const old = loadRecent(storage);
  const previous = old.find((item) => samePath(item.path, entry.path));
  const merged = { ...entry, thumb: entry.thumb ?? previous?.thumb }; // mantém a miniatura até a nova ficar pronta
  const list = [merged, ...old.filter((item) => item !== previous)].slice(0, MAX_RECENT);
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

/** Troca a miniatura de um projeto da lista (se ele ainda estiver nela). */
export function setRecentThumb(path: string, thumb: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): RecentProject[] {
  const list = loadRecent(storage).map((item) => samePath(item.path, path) ? { ...item, thumb } : item);
  store(list, storage);
  return list;
}

type ThumbClip = { mediaId: string; start: number; duration: number; inPoint: number; speed?: number };
type ThumbMedia = { id: string; path: string | null; kind: string; missing?: boolean };

/**
 * De onde tirar a miniatura: o primeiro clipe de imagem/vídeo da timeline (se não houver,
 * a primeira imagem/vídeo da biblioteca). Em vídeos, um quadro a ~1 s do ponto de entrada.
 */
export function thumbnailSource(clips: ThumbClip[], media: ThumbMedia[]): { path: string; seconds: number } | null {
  const usable = new Map(media.filter((item) => item.path && !item.missing && (item.kind === "image" || item.kind === "video"))
    .map((item) => [item.id, item]));
  const first = clips.filter((clip) => usable.has(clip.mediaId)).sort((a, b) => a.start - b.start)[0];
  if (first) {
    const item = usable.get(first.mediaId)!;
    const seconds = item.kind === "video" ? first.inPoint + Math.min(1, first.duration / 2) * (first.speed ?? 1) : 0;
    return { path: item.path!, seconds: Math.round(seconds * 1000) / 1000 };
  }
  const item = [...usable.values()][0];
  return item ? { path: item.path!, seconds: item.kind === "video" ? 1 : 0 } : null;
}
