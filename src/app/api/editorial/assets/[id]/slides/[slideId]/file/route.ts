import { aspectOf } from "@/lib/checks";
import { folderPathFromRoot, getFileMeta, parseDriveUrl } from "@/lib/drive";
import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { getVisualAsset, setSlideFile } from "@/lib/editorial-queries";
import { isUuid } from "@/lib/editorial-rules";
import type { AssetAspect } from "@/lib/editorial-types";
import { getClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

const ASPECT_RATIO: Record<AssetAspect, number> = {
  "4:5": 4 / 5,
  "1:1": 1,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
};

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; slideId: string }> },
): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id: assetId, slideId } = await ctx.params;
  if (!isUuid(assetId) || !isUuid(slideId)) return jsonError("Identificador inválido.", 400);

  const asset = await getVisualAsset(assetId);
  if (!asset) return jsonError("Ativo não encontrado.", 404);
  if (!asset.slides.some((s) => s.id === slideId)) return jsonError("Slide não encontrado neste ativo.", 404);

  const clientData = await getClient(asset.client_id);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);
  const root = clientData.client.drive_folder_id;
  if (!root) return jsonError("Este cliente não tem pasta do Google Drive configurada.", 400);

  const body = await readJsonBody<{ drive_url?: string }>(req);
  const driveUrl = String(body?.drive_url ?? "").trim();
  const ref = parseDriveUrl(driveUrl);
  if (!driveUrl || !ref) return jsonError("O link não parece ser de um arquivo do Google Drive.", 400);
  if (ref.kind === "folder") return jsonError("Este link é de uma pasta. Cole o link de um arquivo.", 400);

  const path = await folderPathFromRoot(ref.id, root);
  if (!path) return jsonError("O arquivo não está dentro da pasta deste cliente no Google Drive.", 403);

  const meta = await getFileMeta(ref.id);
  if (meta.error) return jsonError(meta.error, 502);
  if (!meta.mimeType?.startsWith("image/")) {
    return jsonError("O arquivo do slide precisa ser uma imagem (JPG, PNG ou WebP).", 400);
  }

  const warnings: string[] = [];
  const actualAspect = aspectOf(meta);
  const expectedAspect = ASPECT_RATIO[asset.aspect];
  if (actualAspect && Math.abs(actualAspect - expectedAspect) > 0.08) {
    warnings.push(`A proporção da imagem difere do formato esperado (${asset.aspect}).`);
  }

  const slide = await setSlideFile(assetId, slideId, {
    drive_url: driveUrl,
    drive_file_id: ref.id,
    drive_meta: meta,
  });
  return Response.json({ slide, warnings });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; slideId: string }> },
): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id: assetId, slideId } = await ctx.params;
  if (!isUuid(assetId) || !isUuid(slideId)) return jsonError("Identificador inválido.", 400);

  const asset = await getVisualAsset(assetId);
  if (!asset) return jsonError("Ativo não encontrado.", 404);

  const slide = await setSlideFile(assetId, slideId, {
    drive_url: "",
    drive_file_id: null,
    drive_meta: null,
  });
  if (!slide) return jsonError("Slide não encontrado neste ativo.", 404);
  return Response.json({ slide });
}
