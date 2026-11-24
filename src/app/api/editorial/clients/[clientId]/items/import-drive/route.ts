import { folderPathFromRoot, getFileMeta } from "@/lib/drive";
import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { createContentItem } from "@/lib/editorial-queries";
import { normalizeThemeKey } from "@/lib/editorial-rules";
import type { ContentItem } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

const SAFE_DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const root = data.client.drive_folder_id;
  if (!root) return jsonError("Este cliente não tem pasta do Google Drive configurada.", 400);

  const body = await readJsonBody<{
    files?: { drive_file_id?: string; title?: string; transcript?: string; brief?: string }[];
  }>(req);
  if (!body || !Array.isArray(body.files) || body.files.length === 0) {
    return jsonError("Informe ao menos um arquivo do Google Drive para importar.", 400);
  }
  if (body.files.length > 50) return jsonError("Importe no máximo 50 arquivos por vez.", 400);

  const created: ContentItem[] = [];
  const skippedDuplicates: string[] = [];

  for (const f of body.files) {
    const fileId = String(f.drive_file_id ?? "").trim();
    if (!SAFE_DRIVE_ID.test(fileId)) return jsonError("ID de arquivo do Drive inválido.", 400);

    const path = await folderPathFromRoot(fileId, root);
    if (!path) return jsonError(`O arquivo ${fileId} não pertence à pasta deste cliente.`, 403);

    const meta = await getFileMeta(fileId);
    if (meta.error) return jsonError(meta.error, 502);

    const rawTitle = String(f.title ?? "").trim() || meta.name?.replace(/\.[^.]+$/, "") || "Conteúdo do Drive";
    const title = rawTitle.slice(0, 160);
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;

    try {
      const item = await createContentItem(clientId, {
        source_kind: "existing_ready",
        status: "ready",
        title,
        theme_key: normalizeThemeKey(title),
        transcript: String(f.transcript ?? ""),
        brief: String(f.brief ?? ""),
        drive_url: driveUrl,
        drive_file_id: fileId,
        drive_meta: meta,
      });
      created.push(item);
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        skippedDuplicates.push(fileId);
      } else {
        throw e;
      }
    }
  }

  return Response.json({ created, skipped_duplicates: skippedDuplicates }, { status: 201 });
}
