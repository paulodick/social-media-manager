import { validateTones } from "@/config/tones";
import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import {
  deleteContentItem,
  getContentItem,
  getPillar,
  listEditorialSlots,
  listVisualAssets,
  updateContentItem,
} from "@/lib/editorial-queries";
import { isUuid, normalizeThemeKey } from "@/lib/editorial-rules";
import type { ContentSourceKind, ContentStatus } from "@/lib/editorial-types";
import { resolveDrive } from "@/lib/post-folders";

export const dynamic = "force-dynamic";

const VALID_STATUS = new Set<ContentStatus>(["idea", "drafting", "ready", "archived"]);
const VALID_SOURCE = new Set<ContentSourceKind>(["existing_ready", "needs_creation"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Item inválido.", 400);

  const item = await getContentItem(id);
  if (!item) return jsonError("Item não encontrado.", 404);

  const [assets, slots] = await Promise.all([
    listVisualAssets(item.id),
    listEditorialSlots({ clientId: item.client_id, contentItemId: item.id }),
  ]);

  return Response.json({ item, assets, slots });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Item inválido.", 400);

  const existing = await getContentItem(id);
  if (!existing) return jsonError("Item não encontrado.", 404);

  const body = await readJsonBody<{
    title?: string;
    source_kind?: ContentSourceKind;
    content_format?: "video" | "carousel" | "static_image";
    pillar_id?: string | null;
    theme_key?: string;
    hook?: string;
    angle?: string;
    brief?: string;
    script?: string;
    script_hook?: string;
    script_dev?: string;
    script_cta?: string;
    transcript?: string;
    caption_draft?: string;
    tones?: string[];
    status?: ContentStatus;
    drive_url?: string;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 1 || t.length > 160) return jsonError("Informe um título entre 1 e 160 caracteres.", 400);
  }
  if (body.source_kind !== undefined && !VALID_SOURCE.has(body.source_kind)) {
    return jsonError("Origem inválida.", 400);
  }
  if (
    body.content_format !== undefined &&
    body.content_format !== "video" &&
    body.content_format !== "carousel" &&
    body.content_format !== "static_image"
  ) {
    return jsonError("Formato de conteúdo inválido.", 400);
  }
  if (body.status !== undefined && !VALID_STATUS.has(body.status)) {
    return jsonError("Status inválido.", 400);
  }
  if (body.pillar_id !== undefined && body.pillar_id !== null) {
    if (!isUuid(body.pillar_id)) return jsonError("Pilar inválido.", 400);
    const pillar = await getPillar(body.pillar_id, existing.client_id);
    if (!pillar) return jsonError("Pilar não encontrado neste cliente.", 404);
  }

  let tones: string[] | undefined;
  if (body.tones !== undefined) {
    const check = validateTones(body.tones.map(String));
    if ("error" in check) return jsonError(check.error, 400);
    tones = check.tones;
  }

  let driveFields: { drive_url?: string; drive_file_id?: string | null; drive_meta?: ReturnType<typeof Object> | null } = {};
  if (body.drive_url !== undefined) {
    const driveUrl = String(body.drive_url).trim();
    if (!driveUrl) {
      driveFields = { drive_url: "", drive_file_id: null, drive_meta: null };
    } else {
      const resolved = await resolveDrive(driveUrl);
      if (resolved.meta?.error) return jsonError(resolved.meta.error, 400);
      driveFields = { drive_url: driveUrl, drive_file_id: resolved.fileId, drive_meta: resolved.meta };
    }
  }

  const item = await updateContentItem(id, {
    title: body.title,
    source_kind: body.source_kind,
    content_format: body.content_format,
    pillar_id: body.pillar_id,
    theme_key: body.theme_key !== undefined ? normalizeThemeKey(String(body.theme_key)) : undefined,
    hook: body.hook,
    angle: body.angle,
    brief: body.brief,
    script: body.script,
    script_hook: body.script_hook,
    script_dev: body.script_dev,
    script_cta: body.script_cta,
    transcript: body.transcript,
    caption_draft: body.caption_draft,
    tones,
    status: body.status,
    ...driveFields,
  });

  return Response.json({ item });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Item inválido.", 400);

  const deleted = await deleteContentItem(id);
  if (!deleted) return jsonError("Item não encontrado.", 404);
  return new Response(null, { status: 204 });
}
