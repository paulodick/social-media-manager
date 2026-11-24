import { folderGroup, targetFolders } from "../config/networks.ts";
import type { MediaMeta } from "./checks.ts";
import { dayFolders } from "./dates.ts";
import { cleanFolderName, ensureFolderPath, getFileMeta, parseDriveUrl } from "./drive.ts";

/**
 * Nomes das pastas, a partir da pasta do cliente: AAAA / MM - Mês / DD / (pasta do grupo | Rede / Formato).
 * Reels, Shorts, TikTok e Kwai dividem uma pasta; Stories do Instagram e do Facebook dividem outra (ver FOLDER_GROUPS).
 */
export function folderNames(day: string, network: string, format: string): string[] | null {
  const rest = targetFolders(network, format);
  return rest ? [...dayFolders(day), ...rest] : null;
}

/** Pasta dos arquivos de um ativo visual: AAAA / MM - Mês / DD / Artes / <título>. O app cria a pasta; não envia arquivos. */
export function assetFolderNames(day: string, title: string): string[] {
  return [...dayFolders(day), "Artes", cleanFolderName(title) || "Sem título"];
}

export async function resolveDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  const ref = parseDriveUrl(url);
  if (!url || !ref) return { fileId: null, meta: url ? { error: "o link não parece ser de um arquivo do Google Drive." } : null };
  if (ref.kind === "folder") return { fileId: null, meta: { error: "este link é de uma pasta. Cole o link de um arquivo." } };
  const meta = await getFileMeta(ref.id);
  return { fileId: ref.id, meta };
}

/**
 * Pasta do Drive de cada destino (mesma ordem de `items`). `reuse` traz pastas já existentes por grupo e dia
 * (ex.: o post já tem a pasta do grupo "curto" no Reels): o destino do mesmo grupo e dia usa essa mesma pasta.
 */
export async function ensureTargetFolders(
  root: string | null,
  items: { network: string; format: string; day: string }[],
  reuse: Map<string, string> = new Map(),
): Promise<{ ids: (string | null)[]; error: string | null }> {
  const cache = new Map<string, string>();
  const ids: (string | null)[] = [];
  let error: string | null = null;
  for (const { network, format, day } of items) {
    const group = folderGroup(network, format);
    const key = group ? `${group.id}|${day}` : "";
    const known = key ? reuse.get(key) : undefined;
    if (known) {
      ids.push(known);
      continue;
    }
    const names = folderNames(day, network, format);
    if (!root || !names || error) {
      ids.push(null);
      continue;
    }
    const res = await ensureFolderPath(root, names, cache);
    if ("error" in res) {
      error = res.error;
      ids.push(null);
    } else {
      ids.push(res.id);
      if (key) reuse.set(key, res.id);
    }
  }
  return { ids, error };
}
