import { JWT } from "google-auth-library";
import type { MediaMeta } from "./checks.ts";

// DRIVE_API_BASE e DRIVE_TEST_TOKEN só existem para testes com um Drive de mentira (os dois precisam estar definidos).
const TEST_DRIVE = !!process.env.DRIVE_API_BASE && !!process.env.DRIVE_TEST_TOKEN;
const API = TEST_DRIVE ? (process.env.DRIVE_API_BASE as string) : "https://www.googleapis.com/drive/v3";
// Escopo completo porque o app precisa enxergar pastas que ele não criou e criar subpastas.
// O alcance real é limitado pelo que foi compartilhado com a conta de serviço (a pasta do cliente).
// O app só lê arquivos e cria pastas: não envia, move nem apaga nada.
const SCOPE = "https://www.googleapis.com/auth/drive";

export type DriveRef = { id: string; kind: "file" | "folder" | "unknown" };

/** Extrai o ID de um link do Google Drive (arquivo, pasta ou o próprio ID). */
export function parseDriveUrl(input: string): DriveRef | null {
  const s = input.trim();
  if (!s) return null;
  const folder = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folder) return { id: folder[1], kind: "folder" };
  const file = s.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/);
  if (file) return { id: file[1], kind: "file" };
  const q = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (q) return { id: q[1], kind: "unknown" };
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return { id: s, kind: "unknown" };
  return null;
}

type Creds = { client_email: string; private_key: string };

function creds(): Creds | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  const tryParse = (t: string): Creds | null => {
    try {
      const j = JSON.parse(t);
      if (j.client_email && j.private_key) return { client_email: j.client_email, private_key: j.private_key };
    } catch {}
    return null;
  };
  return tryParse(raw) ?? tryParse(Buffer.from(raw, "base64").toString("utf8"));
}

export function driveConfigured(): boolean {
  return creds() !== null;
}

/** "missing": variável vazia ou ausente. "invalid": tem texto, mas não é um JSON de conta de serviço (sem client_email e private_key). */
export function driveStatus(): "ok" | "missing" | "invalid" {
  if (creds() !== null) return "ok";
  return process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ? "invalid" : "missing";
}

export function serviceAccountEmail(): string | null {
  return creds()?.client_email ?? null;
}

type G = typeof globalThis & { _smmJwt?: JWT };

async function token(): Promise<string> {
  if (TEST_DRIVE) return process.env.DRIVE_TEST_TOKEN as string;
  const c = creds();
  if (!c) throw new Error("Google Drive não configurado.");
  const g = globalThis as G;
  if (!g._smmJwt) g._smmJwt = new JWT({ email: c.client_email, key: c.private_key, scopes: [SCOPE] });
  const t = await g._smmJwt.getAccessToken();
  if (!t.token) throw new Error("Não foi possível obter o token do Google.");
  return t.token;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${API}${path}${sep}supportsAllDrives=true`, { ...init, headers, cache: "no-store" });
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  imageMediaMetadata?: { width?: number; height?: number };
};

const FIELDS = "id,name,mimeType,size,parents,videoMediaMetadata(width,height,durationMillis),imageMediaMetadata(width,height)";

/** Metadados do arquivo ou erro explicado em português. */
export async function getFileMeta(id: string): Promise<MediaMeta> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  try {
    const r = await api(`/files/${id}?fields=${encodeURIComponent(FIELDS)}`);
    if (r.status === 404 || r.status === 403) {
      return { error: "o app não encontrou o arquivo. Confira se a pasta foi compartilhada com o e-mail de acesso do app." };
    }
    if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
    const f = (await r.json()) as DriveFile;
    const dim = f.videoMediaMetadata ?? f.imageMediaMetadata;
    return {
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : undefined,
      width: dim?.width,
      height: dim?.height,
      durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : undefined,
    };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

const FOLDER_PATH_TTL_MS = 5 * 60 * 1000;
const FOLDER_PATH_MAX_ENTRIES = 500;
type FolderPathEntry = { value: string[] | null; expiresAt: number };
type FolderPathGlobal = typeof globalThis & { _smmFolderPathCache?: Map<string, FolderPathEntry> };

function folderPathCache(): Map<string, FolderPathEntry> {
  const g = globalThis as FolderPathGlobal;
  if (!g._smmFolderPathCache) g._smmFolderPathCache = new Map();
  return g._smmFolderPathCache;
}

/** Limpa o cache em memória de `folderPathFromRoot` (útil em testes). */
export function clearFolderPathCache(): void {
  folderPathCache().clear();
}

/** Nomes das pastas entre a pasta do cliente e o arquivo, ou null se o arquivo não está dentro dela. */
export async function folderPathFromRoot(
  fileId: string,
  rootId: string,
  opts?: { ttlMs?: number; now?: number },
): Promise<string[] | null> {
  if (!driveConfigured()) return null;
  const ttlMs = opts?.ttlMs ?? FOLDER_PATH_TTL_MS;
  const now = opts?.now ?? Date.now();
  const cache = folderPathCache();
  const key = `${rootId}:${fileId}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value ? [...hit.value] : null;
  }

  const store = (value: string[] | null): string[] | null => {
    if (ttlMs > 0) {
      if (cache.size >= FOLDER_PATH_MAX_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, { value: value ? [...value] : null, expiresAt: now + ttlMs });
    }
    return value;
  };

  const names: string[] = [];
  let current = fileId;
  try {
    for (let i = 0; i < 8; i++) {
      const r = await api(`/files/${current}?fields=${encodeURIComponent("id,name,parents")}`);
      if (!r.ok) return r.status >= 500 ? null : store(null);
      const f = (await r.json()) as { id: string; name: string; parents?: string[] };
      const parent = f.parents?.[0];
      if (!parent) return store(null);
      if (parent === rootId) return store(names.reverse());
      const pr = await api(`/files/${parent}?fields=${encodeURIComponent("id,name,parents")}`);
      if (!pr.ok) return pr.status >= 500 ? null : store(null);
      const p = (await pr.json()) as { id: string; name: string; parents?: string[] };
      names.push(p.name);
      current = p.id;
    }
  } catch {
    return null;
  }
  return store(null);
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SAFE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** Escapa um nome para usar entre aspas simples na busca do Drive. */
export function driveQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

class DriveError extends Error {}

async function findFolder(parentId: string, name: string): Promise<string | null> {
  const q = `'${parentId}' in parents and name = '${driveQuote(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const r = await api(`/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id)")}&pageSize=2&includeItemsFromAllDrives=true`);
  if (r.status === 403 || r.status === 404) {
    throw new DriveError("o app não enxerga a pasta do cliente. Confira se ela foi compartilhada com o e-mail de acesso do app.");
  }
  if (!r.ok) throw new DriveError(`o Google Drive respondeu com erro ${r.status}.`);
  const j = (await r.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const r = await api("/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (r.status === 403 || r.status === 404) {
    throw new DriveError("o app só tem permissão de leitura nessa pasta. Dê permissão de Editor ao e-mail de acesso do app.");
  }
  if (!r.ok) throw new DriveError(`o Google Drive respondeu com erro ${r.status} ao criar a pasta.`);
  return ((await r.json()) as { id: string }).id;
}

export type FolderResult = { id: string } | { error: string };

/**
 * Garante a cadeia de pastas dentro de rootId (ex.: ["2026","11 - Novembro","21","Instagram","Reels"]).
 * Procura cada nível e só cria o que falta. Devolve o ID da última pasta.
 * `cache` evita criar a mesma pasta duas vezes quando vários destinos do mesmo post usam o mesmo dia
 * (a busca do Drive pode demorar alguns segundos para enxergar uma pasta recém-criada).
 */
export async function ensureFolderPath(rootId: string, names: string[], cache: Map<string, string> = new Map()): Promise<FolderResult> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  if (!SAFE_ID.test(rootId)) return { error: "o link da pasta do cliente não é válido." };
  try {
    let parent = rootId;
    let key = rootId;
    for (const name of names) {
      key += "/" + name;
      let id: string | null | undefined = cache.get(key);
      if (!id) {
        id = (await findFolder(parent, name)) ?? (await createFolder(parent, name));
        cache.set(key, id);
      }
      parent = id;
    }
    return { id: parent };
  } catch (e) {
    return { error: e instanceof DriveError ? e.message : "não foi possível falar com o Google Drive agora." };
  }
}

/** Abre o conteúdo do arquivo, repassando o cabeçalho Range (necessário para vídeo). */
export async function openMedia(id: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (range) headers.Range = range;
  return api(`/files/${id}?alt=media`, { headers });
}

/** Nome de pasta seguro para o Drive: sem barras nem caracteres de controle, espaços simples, até 120 caracteres. */
export function cleanFolderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\/\\\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Nome da pasta, ou erro em português se o app não a enxerga (confere o compartilhamento). */
export async function getFolderName(id: string): Promise<{ name: string } | { error: string }> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  if (!SAFE_ID.test(id)) return { error: "o link da pasta não é válido." };
  try {
    const r = await api(`/files/${id}?fields=${encodeURIComponent("id,name,mimeType")}`);
    if (r.status === 403 || r.status === 404) {
      return { error: "o app não enxerga essa pasta. Compartilhe-a, como Editor, com o e-mail de acesso do app." };
    }
    if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
    const f = (await r.json()) as { name: string; mimeType: string };
    if (f.mimeType !== FOLDER_MIME) return { error: "esse link é de um arquivo, não de uma pasta." };
    return { name: f.name };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

export type ClientFolders = { folderId: string; logoFolderId: string } | { error: string };

/**
 * Cria (ou encontra, se já existe) a pasta do cliente dentro da pasta raiz e a subpasta "Logotipo".
 * Roda de novo sem duplicar: serve também para reabrir a pasta de um cliente que já tem.
 */
export async function ensureClientFolders(rootId: string, clientName: string): Promise<ClientFolders> {
  const name = cleanFolderName(clientName);
  if (!name) return { error: "informe o nome do cliente antes de criar a pasta." };
  const client = await ensureFolderPath(rootId, [name]);
  if ("error" in client) return client;
  const logo = await ensureFolderPath(client.id, ["Logotipo"]);
  if ("error" in logo) return logo;
  return { folderId: client.id, logoFolderId: logo.id };
}

export type ListedFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  modifiedTime?: string;
};

export type FolderListing = { files: ListedFile[]; nextPageToken: string | null } | { error: string };

/** Lista imagens e/ou vídeos de uma pasta (só leitura), mais recentes primeiro. */
export async function listFolderFiles(
  folderId: string,
  opts: { pageToken?: string; kinds?: ("image" | "video")[]; pageSize?: number } = {},
): Promise<FolderListing> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  if (!SAFE_ID.test(folderId)) return { error: "o link da pasta não é válido." };
  const kinds = opts.kinds?.length ? opts.kinds : (["image", "video"] as const);
  const mime = kinds.map((k) => `mimeType contains '${k}/'`).join(" or ");
  const q = `'${folderId}' in parents and trashed = false and (${mime})`;
  const qs = new URLSearchParams({
    q,
    fields: `nextPageToken,files(${FIELDS},modifiedTime)`,
    orderBy: "modifiedTime desc",
    pageSize: String(Math.min(Math.max(opts.pageSize ?? 50, 1), 100)),
    includeItemsFromAllDrives: "true",
  });
  if (opts.pageToken) qs.set("pageToken", opts.pageToken);
  try {
    const r = await api(`/files?${qs.toString()}`);
    if (r.status === 403 || r.status === 404) {
      return { error: "o app não enxerga essa pasta. Compartilhe-a com o e-mail de acesso do app." };
    }
    if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
    const j = (await r.json()) as { files?: (DriveFile & { modifiedTime?: string })[]; nextPageToken?: string };
    return {
      files: (j.files ?? []).map((f) => {
        const dim = f.videoMediaMetadata ?? f.imageMediaMetadata;
        return {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? Number(f.size) : undefined,
          width: dim?.width,
          height: dim?.height,
          durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : undefined,
          modifiedTime: f.modifiedTime,
        };
      }),
      nextPageToken: j.nextPageToken ?? null,
    };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}
