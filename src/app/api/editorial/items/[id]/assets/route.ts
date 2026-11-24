import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { createVisualAsset, getContentItem } from "@/lib/editorial-queries";
import { isUuid, validateSlides } from "@/lib/editorial-rules";
import type { AssetAspect, AssetKind, SlideInput } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

const VALID_ASPECTS = new Set<AssetAspect>(["4:5", "1:1", "9:16", "16:9"]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id: itemId } = await ctx.params;
  if (!isUuid(itemId)) return jsonError("Item inválido.", 400);

  const item = await getContentItem(itemId);
  if (!item) return jsonError("Item não encontrado.", 404);

  const body = await readJsonBody<{
    kind?: AssetKind;
    title?: string;
    aspect?: AssetAspect;
    generation_prompt?: string;
    drive_folder_id?: string | null;
    slides?: SlideInput[];
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  const kind = body.kind;
  if (kind !== "carousel" && kind !== "static") {
    return jsonError("Tipo de ativo inválido (use 'carousel' ou 'static').", 400);
  }
  const aspect = body.aspect ?? "4:5";
  if (!VALID_ASPECTS.has(aspect)) return jsonError("Proporção inválida.", 400);

  const emptySlide = (): SlideInput => ({ headline: "", body: "", cta: "", visual_notes: "", source: "manual" });
  const slides: SlideInput[] =
    Array.isArray(body.slides) && body.slides.length > 0
      ? body.slides
      : kind === "static"
        ? [emptySlide()]
        : [emptySlide(), emptySlide()];

  const slideErr = validateSlides(kind, slides);
  if (slideErr) return jsonError(slideErr, 400);

  const asset = await createVisualAsset(item.client_id, item.id, {
    kind,
    title: String(body.title ?? ""),
    aspect,
    generation_prompt: String(body.generation_prompt ?? ""),
    drive_folder_id: body.drive_folder_id ?? null,
    slides,
  });

  return Response.json({ asset }, { status: 201 });
}
