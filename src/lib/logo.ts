import { driveConfigured, getFileMeta, openMedia } from "./drive";
import { processLogo } from "./logo-image";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Baixa o arquivo do Drive e devolve a cópia reduzida, ou um erro em português. */
export async function fetchLogo(fileId: string): Promise<{ png: Buffer } | { error: string }> {
  if (!driveConfigured()) return { error: "o Google Drive ainda não está configurado no app." };
  const meta = await getFileMeta(fileId);
  if (meta.error) return { error: meta.error };
  if (!meta.mimeType?.startsWith("image/")) return { error: "o arquivo do logotipo precisa ser uma imagem (PNG, JPG ou SVG)." };
  if (meta.size && meta.size > MAX_INPUT_BYTES) return { error: "o arquivo do logotipo é maior que 25 MB." };
  try {
    const res = await openMedia(fileId, null);
    if (!res.ok) return { error: `o Google Drive respondeu com erro ${res.status}.` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { png: await processLogo(buf) };
  } catch {
    return { error: "não consegui ler a imagem do logotipo. Confira se o arquivo não está corrompido." };
  }
}
