import {
  folderPathFromRoot,
  getFileMeta,
  getFolderName,
  listFolderAllFiles,
  readDriveDocumentText,
} from "@/lib/drive";
import { groupFolderIntoCutBundle, parseCutDocument } from "@/lib/drive-cuts";
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
    cut_folders?: { folder_id?: string; folder_name?: string }[];
  }>(req);
  const filesInput = Array.isArray(body?.files) ? body.files : [];
  const cutFoldersInput = Array.isArray(body?.cut_folders) ? body.cut_folders : [];

  if (filesInput.length === 0 && cutFoldersInput.length === 0) {
    return jsonError("Informe ao menos um corte (pasta) ou arquivo do Google Drive para importar.", 400);
  }
  if (filesInput.length + cutFoldersInput.length > 50) {
    return jsonError("Importe no máximo 50 itens por vez.", 400);
  }

  const created: ContentItem[] = [];
  const skippedDuplicates: string[] = [];
  const warnings: string[] = [];

  // 1) Importação agrupada por subpasta de corte (vídeo + capa + .doc -> 1 único item editorial)
  for (const cf of cutFoldersInput) {
    const folderId = String(cf.folder_id ?? "").trim();
    if (!SAFE_DRIVE_ID.test(folderId)) return jsonError("ID de pasta de corte do Drive inválido.", 400);

    const path = await folderPathFromRoot(folderId, root);
    if (!path) return jsonError(`A pasta ${folderId} não pertence à pasta deste cliente.`, 403);

    const [folderInfo, listing] = await Promise.all([
      getFolderName(folderId),
      listFolderAllFiles(folderId, { pageSize: 30 }),
    ]);
    if ("error" in listing) return jsonError(listing.error, 502);

    const folderName =
      ("name" in folderInfo ? folderInfo.name : String(cf.folder_name ?? "").trim()) || "Corte do Drive";
    const bundle = groupFolderIntoCutBundle({ id: folderId, name: folderName }, listing.files);
    if (!bundle) {
      warnings.push(`A pasta "${folderName}" não tinha vídeo, capa nem documento e foi ignorada.`);
      continue;
    }

    // Referência principal: lê o texto do .doc/.docx/Google Doc (sem transcrição pesada do vídeo).
    let docText = "";
    if (bundle.doc) {
      const docRes = await readDriveDocumentText(bundle.doc);
      docText = docRes.text;
      if (docRes.warning) warnings.push(`${folderName}: ${docRes.warning}`);
    }

    const parsed = parseCutDocument({
      folderName,
      videoName: bundle.video?.name,
      coverName: bundle.cover?.name,
      docText,
    });

    const primaryMedia = bundle.video ?? bundle.cover;
    let mediaMeta = null;
    if (primaryMedia) {
      const m = await getFileMeta(primaryMedia.id);
      if (!m.error) mediaMeta = m;
    }

    try {
      const item = await createContentItem(clientId, {
        source_kind: "existing_ready",
        content_format: bundle.video ? "video" : "static_image",
        status: "ready",
        title: parsed.title,
        theme_key: normalizeThemeKey(parsed.topic_tag || parsed.title),
        guest_name: parsed.guest_name,
        topic_tag: parsed.topic_tag,
        cover_idea: parsed.cover_idea,
        cover_drive_file_id: bundle.cover?.id ?? null,
        cover_drive_url: bundle.cover ? `https://drive.google.com/file/d/${bundle.cover.id}/view` : "",
        doc_drive_file_id: bundle.doc?.id ?? null,
        source_folder_id: folderId,
        source_folder_name: folderName,
        hook: parsed.hook,
        brief: parsed.brief,
        caption_draft: parsed.caption_draft,
        caption_instagram: parsed.caption_instagram,
        caption_linkedin: parsed.caption_linkedin,
        drive_url: primaryMedia ? `https://drive.google.com/file/d/${primaryMedia.id}/view` : "",
        drive_file_id: primaryMedia?.id ?? null,
        drive_meta: mediaMeta,
      });
      created.push(item);
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        skippedDuplicates.push(folderId);
      } else {
        throw e;
      }
    }
  }

  // 2) Importação de arquivos avulsos na raiz (compatibilidade)
  for (const f of filesInput) {
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

  return Response.json({ created, skipped_duplicates: skippedDuplicates, warnings }, { status: 201 });
}
