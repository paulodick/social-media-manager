import { folderPathFromRoot, getFolderName, listFolderFiles } from "@/lib/drive";
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

  const [folderInfo, listing] = await Promise.all([
    getFolderName(folder),
    listFolderFiles(folder, { kinds, pageToken }),
  ]);

  if ("error" in listing) return jsonError(listing.error, 502);
  const folderName = "name" in folderInfo ? folderInfo.name : data.client.name;

  return Response.json({
    folder: { id: folder, name: folderName },
    files: listing.files.map((f) => ({
      ...f,
      preview_url: `/api/media/${f.id}`,
    })),
    next_page_token: listing.nextPageToken,
  });
}
