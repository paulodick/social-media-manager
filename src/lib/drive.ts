import { JWT } from "google-auth-library";
import type { MediaMeta } from "./checks.ts";
import {
  extractTextFromDocBuffer,
  groupFolderIntoCutBundle,
  isIgnoredCutFolderName,
  type DocExtractionResult,
  type DriveCutBundle,
} from "./drive-cuts.ts";

// DRIVE_API_BASE e DRIVE_TEST_TOKEN só existem para testes com um Drive de mentira (os dois precisam estar definidos).
function isTestDrive(): boolean {
  return !!process.env.DRIVE_API_BASE && !!process.env.DRIVE_TEST_TOKEN;
}
function driveApiBase(): string {
  return isTestDrive() ? (process.env.DRIVE_API_BASE as string) : "https://www.googleapis.com/drive/v3";
}
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
  if (isTestDrive()) return process.env.DRIVE_TEST_TOKEN as string;
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
  return fetch(`${driveApiBase()}${path}${sep}supportsAllDrives=true`, { ...init, headers, cache: "no-store" });
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

function mapListedFile(f: DriveFile & { modifiedTime?: string }): ListedFile {
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
}

/** Lista subpastas diretas de uma pasta (só leitura), ordenadas por nome. */
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

export async function listSubfolders(
  folderId: string,
  opts: { pageSize?: number; max?: number; followShortcuts?: boolean } = {},
): Promise<{ folders: { id: string; name: string }[]; truncated: boolean } | { error: string }> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  if (!SAFE_ID.test(folderId)) return { error: "o link da pasta não é válido." };
  // Com followShortcuts, atalhos para pastas (comuns quando a pasta é de outra conta e foi "adicionada" aqui)
  // contam como subpastas, apontando para a pasta de verdade.
  const q = opts.followShortcuts
    ? `'${folderId}' in parents and (mimeType = '${FOLDER_MIME}' or mimeType = '${SHORTCUT_MIME}') and trashed = false`
    : `'${folderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const max = Math.max(opts.max ?? 100, 1);
  const folders: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  try {
    // Percorre as páginas do Drive: antes só a primeira (60 pastas) era lida e o resto sumia sem aviso.
    do {
      const qs = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))",
        orderBy: "name asc",
        pageSize: String(Math.min(Math.max(opts.pageSize ?? 100, 1), 100)),
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) qs.set("pageToken", pageToken);
      const r = await api(`/files?${qs.toString()}`);
      if (r.status === 403 || r.status === 404) {
        return { error: "o app não enxerga essa pasta. Compartilhe-a com o e-mail de acesso do app." };
      }
      if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
      const j = (await r.json()) as {
        files?: { id: string; name: string; mimeType?: string; shortcutDetails?: { targetId?: string; targetMimeType?: string } }[];
        nextPageToken?: string;
      };
      for (const f of j.files ?? []) {
        if (f.mimeType === SHORTCUT_MIME) {
          const t = f.shortcutDetails;
          if (t?.targetId && t.targetMimeType === FOLDER_MIME) folders.push({ id: t.targetId, name: f.name });
        } else {
          folders.push({ id: f.id, name: f.name });
        }
      }
      pageToken = j.nextPageToken || undefined;
    } while (pageToken && folders.length < max);
    return { folders: folders.slice(0, max), truncated: folders.length > max || !!pageToken };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

/** Lista todos os arquivos (não-pastas) dentro de uma subpasta (vídeo, capa, .doc/.docx/Google Doc). */
export async function listFolderAllFiles(
  folderId: string,
  opts: { pageSize?: number } = {},
): Promise<FolderListing> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  if (!SAFE_ID.test(folderId)) return { error: "o link da pasta não é válido." };
  const q = `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`;
  const qs = new URLSearchParams({
    q,
    fields: `nextPageToken,files(${FIELDS},modifiedTime)`,
    orderBy: "name asc",
    pageSize: String(Math.min(Math.max(opts.pageSize ?? 50, 1), 100)),
    includeItemsFromAllDrives: "true",
  });
  try {
    const r = await api(`/files?${qs.toString()}`);
    if (r.status === 403 || r.status === 404) {
      return { error: "o app não enxerga essa pasta. Compartilhe-a com o e-mail de acesso do app." };
    }
    if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
    const j = (await r.json()) as { files?: (DriveFile & { modifiedTime?: string })[]; nextPageToken?: string };
    return {
      files: (j.files ?? []).map(mapListedFile),
      nextPageToken: j.nextPageToken ?? null,
    };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

/**
 * Escaneia a pasta do cliente agrupando cada subpasta de corte (vídeo + capa + .doc) em um único item editorial,
 * mantendo também eventuais arquivos avulsos na raiz.
 */
/** Quantas subpastas de corte o scanner lê por vez (cada uma custa uma consulta ao Drive). */
export const MAX_CUT_FOLDERS = 300;

/** Até quantos níveis abaixo da pasta do cliente a varredura procura cortes (ex.: Episódio / Cortes_Reels / 01 - ...). */
export const MAX_SCAN_DEPTH = 5;
/** Teto de pastas abertas numa varredura, para não ficar lendo o Drive inteiro. */
export const MAX_SCAN_FOLDERS = 800;

/**
 * Varre TODA a pasta do cliente, em qualquer profundidade (episódios, "Cortes_Reels", subpastas de corte), e devolve
 * cada pasta que é um corte: tem vídeo, ou não tem subpastas e tem capa ou texto. Ignora `Logotipo`, `Artes`,
 * as pastas de ano criadas pelo app para os posts e `Reels Editados` (lida à parte pela sequência).
 */
export async function scanClientCutFolders(
  rootFolderId: string,
  opts: { kinds?: ("image" | "video")[]; pageToken?: string; maxFolders?: number; basePath?: string[] } = {},
): Promise<
  | {
      cut_folders: DriveCutBundle[];
      loose_files: ListedFile[];
      next_page_token: string | null;
      folders_truncated: boolean;
      /** O que a varredura viu no primeiro nível e erros do Drive, para explicar quando nada é encontrado. */
      scan_notes: string[];
    }
  | { error: string }
> {
  const looseRes = await listFolderFiles(rootFolderId, { kinds: opts.kinds, pageToken: opts.pageToken });
  if ("error" in looseRes) return looseRes;
  // Com pageToken é o "carregar mais" dos arquivos avulsos: as pastas de corte já vieram na primeira página.
  if (opts.pageToken) {
    return { cut_folders: [], loose_files: looseRes.files, next_page_token: looseRes.nextPageToken, folders_truncated: false, scan_notes: [] };
  }

  const notes: string[] = [];
  const maxCuts = opts.maxFolders ?? MAX_CUT_FOLDERS;
  type Node = { id: string; name: string; path: string[]; depth: number };
  const queue: Node[] = [{ id: rootFolderId, name: "", path: [], depth: 0 }];
  const queued = new Set([rootFolderId]); // atalhos podem apontar para a mesma pasta duas vezes
  const cutFolders: DriveCutBundle[] = [];
  let visited = 0;
  let truncated = false;
  const batchSize = 6;
  while (queue.length) {
    if (visited >= MAX_SCAN_FOLDERS || cutFolders.length >= maxCuts) {
      truncated = true;
      break;
    }
    const batch = queue.splice(0, Math.min(batchSize, MAX_SCAN_FOLDERS - visited));
    visited += batch.length;
    const results = await Promise.all(
      batch.map(async (node) => ({
        node,
        subs: await listSubfolders(node.id, { max: 300, followShortcuts: true }),
        listing: node.depth > 0 ? await listFolderAllFiles(node.id, { pageSize: 30 }) : null,
      })),
    );
    if (batch.some((n) => n.depth === 0)) {
      // Pastas de OUTRA conta dentro da pasta do cliente às vezes não aparecem na busca por "in parents" da conta do
      // app, embora ela consiga abri-las. Procura também entre as pastas visíveis que não são do app.
      const extra = await listForeignChildFolders(rootFolderId);
      const root = results.find((x) => x.node.depth === 0);
      if (root && !("error" in root.subs) && extra.length) {
        const have = new Set(root.subs.folders.map((f) => f.id));
        for (const f of extra) if (!have.has(f.id)) root.subs.folders.push(f);
      }
    }
    for (const { node, subs, listing } of results) {
      const where = node.depth === 0 ? "pasta do cliente" : [...node.path, node.name].join(" / ");
      if ("error" in subs) notes.push(`${where}: não deu para listar as subpastas (${subs.error})`);
      if (listing && "error" in listing) notes.push(`${where}: não deu para listar os arquivos (${listing.error})`);
      if (node.depth === 0 && !("error" in subs)) {
        notes.push(
          subs.folders.length
            ? `Subpastas na pasta do cliente: ${subs.folders.map((f) => (isIgnoredCutFolderName(f.name) ? `${f.name} (ignorada)` : f.name)).join(", ")}.`
            : "A pasta do cliente não tem subpastas visíveis para o app.",
        );
      }
      const children = "error" in subs ? [] : subs.folders.filter((f) => !isIgnoredCutFolderName(f.name));
      if ("folders" in subs && subs.truncated) truncated = true;
      if (listing && !("error" in listing)) {
        const bundle = groupFolderIntoCutBundle({ id: node.id, name: node.name }, listing.files, node.path);
        // Pasta intermediária (episódio com subpastas) só vira corte se tiver vídeo próprio.
        if (bundle && (bundle.video || children.length === 0)) cutFolders.push(bundle);
      }
      if (node.depth < MAX_SCAN_DEPTH) {
        const childPath = node.depth > 0 ? [...node.path, node.name] : (opts.basePath ?? []);
        for (const c of children) {
          if (queued.has(c.id)) continue;
          queued.add(c.id);
          queue.push({ id: c.id, name: c.name, path: childPath, depth: node.depth + 1 });
        }
      } else if (children.length) {
        truncated = true;
      }
    }
  }

  if (!cutFolders.length) {
    // Nada encontrado: mostra tudo o que o app enxerga na pasta do cliente (com o tipo), para achar o motivo.
    try {
      const qs = new URLSearchParams({
        q: `'${rootFolderId}' in parents and trashed = false`,
        fields: "files(name,mimeType,owners(emailAddress))",
        pageSize: "50",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      const r = await api(`/files?${qs.toString()}`);
      if (r.ok) {
        const j = (await r.json()) as { files?: { name: string; mimeType: string; owners?: { emailAddress?: string }[] }[] };
        const items = (j.files ?? []).map((f) => `${f.name} [${f.mimeType.replace("application/vnd.google-apps.", "")}${f.owners?.[0]?.emailAddress ? `, ${f.owners[0].emailAddress}` : ""}]`);
        notes.push(items.length ? `O app enxerga na pasta do cliente: ${items.join("; ")}.` : "O app não enxerga nenhum item na pasta do cliente.");
      }
      const q2 = new URLSearchParams({
        q: `mimeType = '${FOLDER_MIME}' and trashed = false and not 'me' in owners`,
        fields: "files(id,name,parents,owners(emailAddress))",
        pageSize: "100",
        orderBy: "modifiedTime desc",
      });
      const r2 = await api(`/files?${q2.toString()}`);
      if (r2.ok) {
        const j2 = (await r2.json()) as { files?: { id: string; name: string; parents?: string[]; owners?: { emailAddress?: string }[] }[] };
        const list = (j2.files ?? []).slice(0, 25).map((f) => `${f.name} (pai ${f.parents?.[0] ?? "?"}, ${f.owners?.[0]?.emailAddress ?? "?"})`);
        notes.push(`Pastas de outras contas que o app enxerga (${j2.files?.length ?? 0}): ${list.join("; ")}.`);
      } else {
        notes.push(`Busca de pastas de outras contas falhou (erro ${r2.status}).`);
      }
    } catch {
      // só diagnóstico
    }
  }

  const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  cutFolders.sort((a, b) => collator.compare([...a.path, a.folder_name].join(" / "), [...b.path, b.folder_name].join(" / ")));

  return {
    cut_folders: cutFolders.slice(0, maxCuts),
    loose_files: looseRes.files,
    next_page_token: looseRes.nextPageToken,
    folders_truncated: truncated,
    scan_notes: [...notes, ...(cutFolders.length ? [] : foreignDebug)].slice(0, 40),
  };
}

/**
 * Subpastas diretas de `rootId` que a busca "in parents" não devolve. Acontece com pastas de OUTRA conta colocadas
 * na pasta do cliente: o Drive deixa a conta do app abri-las, mas não as lista. Caminho: pega as pastas visíveis de
 * outras contas (busca ampla) e sobe pelos pais (lendo cada pasta, o que funciona) até chegar em `rootId`; a pasta
 * logo abaixo dele é a subpasta que faltava (ex.: "Ep - 2 Convidado", achada a partir dos cortes dentro dela).
 */
const foreignDebug: string[] = [];
async function listForeignChildFolders(rootId: string): Promise<{ id: string; name: string }[]> {
  foreignDebug.length = 0;
  const info = new Map<string, { name: string; parents: string[] }>();
  const foreign: string[] = [];
  let pageToken: string | undefined;
  let seen = 0;
  try {
    do {
      const qs = new URLSearchParams({
        q: `mimeType = '${FOLDER_MIME}' and trashed = false and not 'me' in owners`,
        fields: "nextPageToken,files(id,name,parents)",
        pageSize: "200",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      if (pageToken) qs.set("pageToken", pageToken);
      const r = await api(`/files?${qs.toString()}`);
      if (!r.ok) break;
      const j = (await r.json()) as { files?: { id: string; name: string; parents?: string[] }[]; nextPageToken?: string };
      for (const f of j.files ?? []) {
        info.set(f.id, { name: f.name, parents: f.parents ?? [] });
        foreign.push(f.id);
      }
      seen += j.files?.length ?? 0;
      pageToken = j.nextPageToken || undefined;
    } while (pageToken && seen < 1000);
  } catch {
    return [];
  }

  // Sobe por níveis. Uma pasta pode ter mais de um pai (pastas antigas de outra conta "adicionadas" aqui): basta um
  // deles ser a pasta do cliente. Só os pais que a busca não trouxe (ou trouxe sem pai) são lidos, cada um uma vez.
  const found = new Map<string, string>();
  for (const id of foreign) {
    const v = info.get(id);
    if (v?.parents.includes(rootId)) found.set(id, v.name);
  }
  const fetched = new Set<string>();
  const needsRead = (id: string) => id !== rootId && !fetched.has(id) && (!info.has(id) || info.get(id)?.parents.length === 0);
  let frontier = [
    ...new Set([
      ...foreign.filter((id) => info.get(id)?.parents.length === 0),
      ...foreign.flatMap((id) => info.get(id)?.parents ?? []).filter(needsRead),
    ]),
  ];
  foreignDebug.push(`busca ampla: ${foreign.length} pastas; a ler: ${frontier.length}`);
  for (const id of foreign) {
    const v = info.get(id);
    if (v && /^(ep|cortes)/i.test(v.name) && foreignDebug.length < 15) foreignDebug.push(`busca: ${v.name} pais ${v.parents.join(",") || "-"}`);
  }
  let gets = 0;
  for (let level = 0; level < 6 && frontier.length && gets < 300; level++) {
    const next: string[] = [];
    for (let i = 0; i < frontier.length && gets < 300; i += 8) {
      const batch = frontier.slice(i, i + 8).filter((id) => SAFE_ID.test(id) && !fetched.has(id));
      for (const id of batch) fetched.add(id);
      gets += batch.length;
      const metas = await Promise.all(
        batch.map(async (id) => {
          try {
            const r = await api(`/files/${id}?fields=${encodeURIComponent("id,name,parents,mimeType")}&supportsAllDrives=true`);
            if (!r.ok) return null;
            return { id, ...((await r.json()) as { name: string; parents?: string[]; mimeType?: string }) };
          } catch {
            return null;
          }
        }),
      );
      for (const [k, m] of metas.entries()) {
        if (foreignDebug.length < 25) foreignDebug.push(`${batch[k]} -> ${m ? `${m.name} pai ${m.parents?.join(",") ?? "-"}` : "erro"}`);
        if (!m || m.mimeType !== FOLDER_MIME) continue;
        const parents = m.parents ?? [];
        info.set(m.id, { name: m.name, parents });
        if (parents.includes(rootId)) found.set(m.id, m.name);
        else next.push(...parents.filter(needsRead));
      }
    }
    frontier = [...new Set(next)];
  }
  // Pastas da busca cujo pai (visto pela busca) só é ligado ao cliente por um segundo pai: sobe pelo que já se sabe.
  const memo = new Map<string, string | null>();
  const topUnderRoot = (id: string, depth = 0): string | null => {
    if (memo.has(id)) return memo.get(id) ?? null;
    if (depth > 8) return null;
    memo.set(id, null);
    const v = info.get(id);
    let res: string | null = null;
    if (v?.parents.includes(rootId)) res = id;
    else for (const p of v?.parents ?? []) {
      res = topUnderRoot(p, depth + 1);
      if (res) break;
    }
    memo.set(id, res);
    return res;
  };
  for (const id of foreign) {
    const top = topUnderRoot(id);
    if (top) found.set(top, info.get(top)?.name ?? "");
  }
  return [...found].map(([id, name]) => ({ id, name }));
}

const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Lê texto de um arquivo de documento do Drive (Google Docs via export text/plain, ou .doc/.docx/.txt/.rtf via alt=media).
 * Sempre tem fallback seguro e nunca envia vídeo para transcrição.
 */
export async function readDriveDocumentText(file: {
  id: string;
  name: string;
  mimeType: string;
}): Promise<DocExtractionResult> {
  if (!driveConfigured()) {
    return { text: "", format: "fallback", warning: "Google Drive não configurado." };
  }
  if (!SAFE_ID.test(file.id)) {
    return { text: "", format: "fallback", warning: "ID de documento inválido." };
  }
  try {
    if (file.mimeType === "application/vnd.google-apps.document") {
      const r = await api(`/files/${file.id}/export?mimeType=${encodeURIComponent("text/plain")}`);
      if (!r.ok) {
        return {
          text: "",
          format: "fallback",
          warning: `Não foi possível exportar "${file.name}" (erro ${r.status}); usando nome da pasta como referência.`,
        };
      }
      const text = (await r.text()).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
      return text
        ? { text, format: "google_doc" }
        : { text: "", format: "fallback", warning: `Documento "${file.name}" vazio.` };
    }

    const r = await api(`/files/${file.id}?alt=media`);
    if (!r.ok) {
      return {
        text: "",
        format: "fallback",
        warning: `Não foi possível ler "${file.name}" (erro ${r.status}); usando nome da pasta como referência.`,
      };
    }
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab.byteLength > MAX_DOC_BYTES ? ab.slice(0, MAX_DOC_BYTES) : ab);
    return extractTextFromDocBuffer(buf, file.name);
  } catch {
    return {
      text: "",
      format: "fallback",
      warning: `Falha ao ler "${file.name}" no Drive; usando nome da pasta e metadados como referência.`,
    };
  }
}


// ---------- Mover pastas (só o teste de permissão e, depois, o editorial) ----------

/** Nome de pasta normalizado para comparar ("Reels Editados", "reels-editados" e "Reels_Editados" viram "reelseditados"). */
export function normalizeFolderName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Nomes aceitos para a pasta dos vídeos prontos de cada cliente. */
export const READY_VIDEOS_FOLDER = "Reels Editados";

/** Acha a pasta "Reels Editados" (ou variação do nome) dentro da pasta do cliente. */
export async function findReadyVideosFolder(clientFolderId: string): Promise<{ id: string; name: string } | null | { error: string }> {
  const subs = await listSubfolders(clientFolderId, { max: 200 });
  if ("error" in subs) return subs;
  return subs.folders.find((f) => normalizeFolderName(f.name) === normalizeFolderName(READY_VIDEOS_FOLDER)) ?? null;
}

/** O que o Drive diz que a conta do app pode fazer com um item. */
export async function getMoveInfo(
  id: string,
): Promise<{ canMove: boolean; owner: string; parents: string[] } | { error: string }> {
  if (!SAFE_ID.test(id)) return { error: "ID inválido." };
  try {
    const r = await api(`/files/${id}?fields=${encodeURIComponent("parents,owners(emailAddress),capabilities(canMoveItemWithinDrive)")}`);
    if (!r.ok) return { error: `o Google Drive respondeu com erro ${r.status}.` };
    const j = (await r.json()) as {
      parents?: string[];
      owners?: { emailAddress?: string }[];
      capabilities?: { canMoveItemWithinDrive?: boolean };
    };
    return { canMove: !!j.capabilities?.canMoveItemWithinDrive, owner: j.owners?.[0]?.emailAddress ?? "", parents: j.parents ?? [] };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

/** Move um item de uma pasta para outra. Devolve a frase do Drive em caso de recusa. */
export async function moveItem(id: string, fromParent: string, toParent: string): Promise<{ ok: true } | { error: string }> {
  if (![id, fromParent, toParent].every((x) => SAFE_ID.test(x))) return { error: "ID inválido." };
  try {
    const qs = new URLSearchParams({ addParents: toParent, removeParents: fromParent, fields: "id,parents" });
    const r = await api(`/files/${id}?${qs.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: `o Google Drive recusou (erro ${r.status}${j?.error?.message ? `: ${j.error.message}` : ""}).` };
  } catch {
    return { error: "não foi possível falar com o Google Drive agora." };
  }
}

/** Quantos itens (até 1) há dentro de uma pasta: serve para achar uma pasta vazia, segura para o teste de mover. */
async function folderIsEmpty(id: string): Promise<boolean | null> {
  const q = `'${id}' in parents and trashed = false`;
  const r = await api(`/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id)")}&pageSize=1&includeItemsFromAllDrives=true`);
  if (!r.ok) return null;
  const j = (await r.json()) as { files?: unknown[] };
  return (j.files ?? []).length === 0;
}

export type MoveTestResult = {
  verdict: "move" | "shortcut" | "setup";
  lines: string[];
};

/**
 * Teste de permissão para mover pastas na pasta do cliente:
 * 1) acha "Reels Editados"; 2) pergunta ao Drive se o app pode mover cada subpasta (só leitura);
 * 3) se houver uma subpasta VAZIA, move de verdade para a pasta do cliente e devolve para "Reels Editados".
 * Nunca mexe em pasta com conteúdo e nunca apaga nada.
 */
export async function runDriveMoveTest(clientFolderId: string): Promise<MoveTestResult> {
  const lines: string[] = [];
  if (!driveConfigured()) return { verdict: "setup", lines: ["O Google Drive ainda não está configurado no app."] };
  const subs = await listSubfolders(clientFolderId, { max: 200 });
  if ("error" in subs) return { verdict: "setup", lines: [`Pasta do cliente: ${subs.error}`] };
  const ready = subs.folders.find((f) => normalizeFolderName(f.name) === normalizeFolderName(READY_VIDEOS_FOLDER));
  if (!ready) {
    return { verdict: "setup", lines: [`Não achei a pasta "${READY_VIDEOS_FOLDER}" dentro da pasta do cliente. Crie-a e rode o teste de novo.`] };
  }
  lines.push(`Pasta "${ready.name}" encontrada.`);
  const videos = await listSubfolders(ready.id, { max: 50 });
  if ("error" in videos) return { verdict: "setup", lines: [...lines, `"${ready.name}": ${videos.error}`] };
  if (!videos.folders.length) {
    return { verdict: "setup", lines: [...lines, `Crie uma subpasta vazia (ex.: "Video 1") dentro de "${ready.name}" para o teste.`] };
  }

  let anyCan = false;
  let empty: { id: string; name: string } | null = null;
  for (const v of videos.folders.slice(0, 10)) {
    const info = await getMoveInfo(v.id);
    if ("error" in info) {
      lines.push(`"${v.name}": ${info.error}`);
      continue;
    }
    anyCan ||= info.canMove;
    lines.push(`"${v.name}" (dona: ${info.owner || "desconhecida"}): o Drive diz que o app ${info.canMove ? "PODE" : "NÃO pode"} mover.`);
    if (!empty && (await folderIsEmpty(v.id)) === true) empty = v;
  }

  if (!empty) {
    lines.push("Nenhuma subpasta vazia: por segurança o teste não move pasta com vídeo. O resultado acima é só o que o Drive informa.");
    return { verdict: anyCan ? "move" : "shortcut", lines };
  }

  const there = await moveItem(empty.id, ready.id, clientFolderId);
  if ("error" in there) {
    lines.push(`Teste real com "${empty.name}" (vazia): não moveu — ${there.error}`);
    return { verdict: "shortcut", lines };
  }
  const back = await moveItem(empty.id, clientFolderId, ready.id);
  if ("error" in back) {
    lines.push(`Teste real com "${empty.name}": moveu, mas NÃO conseguiu devolver — ${back.error} Ela está agora na pasta do cliente; arraste de volta para "${ready.name}".`);
    return { verdict: "move", lines };
  }
  lines.push(`Teste real com "${empty.name}" (vazia): moveu para a pasta do cliente e voltou para "${ready.name}".`);
  return { verdict: "move", lines };
}
