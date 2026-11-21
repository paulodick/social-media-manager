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

/** Nomes das pastas entre a pasta do cliente e o arquivo, ou null se o arquivo não está dentro dela. */
export async function folderPathFromRoot(fileId: string, rootId: string): Promise<string[] | null> {
  if (!driveConfigured()) return null;
  const names: string[] = [];
  let current = fileId;
  try {
    for (let i = 0; i < 8; i++) {
      const r = await api(`/files/${current}?fields=${encodeURIComponent("id,name,parents")}`);
      if (!r.ok) return null;
      const f = (await r.json()) as { id: string; name: string; parents?: string[] };
      const parent = f.parents?.[0];
      if (!parent) return null;
      if (parent === rootId) return names.reverse();
      const pr = await api(`/files/${parent}?fields=${encodeURIComponent("id,name,parents")}`);
      if (!pr.ok) return null;
      const p = (await pr.json()) as { id: string; name: string; parents?: string[] };
      names.push(p.name);
      current = p.id;
    }
  } catch {}
  return null;
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
