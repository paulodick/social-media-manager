import { MAX_CUT_FOLDERS, folderPathFromRoot, getFolderName, scanClientCutFolders } from "@/lib/drive";
import { jsonError, requireApiAuth, requireClient } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const root = data.client.drive_folder_id;
  if (!root) return jsonError("Este cliente ainda não tem uma pasta do Google Drive configurada.", 400);

  const sp = new URL(req.url).searchParams;
  const folder = sp.get("folder")?.trim() || root;
  if (folder !== root) {
    const path = await folderPathFromRoot(folder, root);
    if (!path) return jsonError("A pasta informada está fora da pasta deste cliente.", 403);
  }

  const kindParam = sp.get("kind");
  const kinds: ("image" | "video")[] =
    kindParam === "image" ? ["image"] : kindParam === "video" ? ["video"] : ["image", "video"];
  const pageToken = sp.get("page_token") || undefined;

  const [folderInfo, scan] = await Promise.all([
    getFolderName(folder),
    scanClientCutFolders(folder, { kinds, pageToken }),
  ]);

  if ("error" in scan) return jsonError(scan.error, 502);
  const folderName = "name" in folderInfo ? folderInfo.name : data.client.name;

  return Response.json({
    folder: { id: folder, name: folderName },
    // Sem preview_url: /api/media só serve arquivos já ligados a um post, então o endereço daria 404 aqui.
    cut_folders: scan.cut_folders,
    files: scan.loose_files,
    next_page_token: scan.next_page_token,
    folders_truncated: scan.folders_truncated,
    folders_limit: MAX_CUT_FOLDERS,
  });
}
