import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { deleteVisualAsset, getVisualAsset, updateVisualAsset } from "@/lib/editorial-queries";
import { isUuid, validateSlides } from "@/lib/editorial-rules";
import type { AssetAspect, AssetStatus, SlideInput } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

const VALID_ASPECTS = new Set<AssetAspect>(["4:5", "1:1", "9:16", "16:9"]);
const VALID_STATUS = new Set<AssetStatus>(["draft", "ready", "approved"]);

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Ativo inválido.", 400);

  const existing = await getVisualAsset(id);
  if (!existing) return jsonError("Ativo não encontrado.", 404);

  const body = await readJsonBody<{
    title?: string;
    aspect?: AssetAspect;
    status?: AssetStatus;
    drive_folder_id?: string | null;
    slides?: SlideInput[];
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (body.aspect !== undefined && !VALID_ASPECTS.has(body.aspect)) return jsonError("Proporção inválida.", 400);
  if (body.status !== undefined && !VALID_STATUS.has(body.status)) return jsonError("Status inválido.", 400);
  if (body.slides !== undefined) {
    const slideErr = validateSlides(existing.kind, body.slides);
    if (slideErr) return jsonError(slideErr, 400);
  }

  const asset = await updateVisualAsset(id, {
    title: body.title,
    aspect: body.aspect,
    status: body.status,
    drive_folder_id: body.drive_folder_id,
    slides: body.slides,
  });
  return Response.json({ asset });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Ativo inválido.", 400);

  const ok = await deleteVisualAsset(id);
  if (!ok) return jsonError("Ativo não encontrado.", 404);
  return new Response(null, { status: 204 });
}
