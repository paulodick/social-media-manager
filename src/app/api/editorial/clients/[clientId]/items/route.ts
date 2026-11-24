import { validateTones } from "@/config/tones";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { createContentItem, getPillar, listContentItems } from "@/lib/editorial-queries";
import { isUuid, normalizeThemeKey } from "@/lib/editorial-rules";
import type { ContentSourceKind, ContentStatus } from "@/lib/editorial-types";
import { resolveDrive } from "@/lib/post-folders";

export const dynamic = "force-dynamic";

const VALID_STATUS = new Set<ContentStatus>(["idea", "drafting", "ready", "archived"]);
const VALID_SOURCE = new Set<ContentSourceKind>(["existing_ready", "needs_creation"]);

export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const sp = new URL(req.url).searchParams;
  const statusParam = sp.get("status") as ContentStatus | null;
  const sourceParam = sp.get("source_kind") as ContentSourceKind | null;
  const pillarId = sp.get("pillar_id") || undefined;
  const q = sp.get("q") || undefined;
  const cursor = sp.get("cursor") || undefined;
  const limitRaw = Number(sp.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  if (statusParam && !VALID_STATUS.has(statusParam)) return jsonError("Status inválido.", 400);
  if (sourceParam && !VALID_SOURCE.has(sourceParam)) return jsonError("Origem inválida.", 400);
  if (pillarId && !isUuid(pillarId)) return jsonError("Pilar inválido.", 400);

  const res = await listContentItems({
    clientId,
    status: statusParam ?? undefined,
    sourceKind: sourceParam ?? undefined,
    pillarId,
    q,
    limit,
    cursor,
  });
  return Response.json(res);
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    title?: string;
    source_kind?: ContentSourceKind;
    pillar_id?: string | null;
    theme_key?: string;
    hook?: string;
    angle?: string;
    brief?: string;
    script?: string;
    transcript?: string;
    caption_draft?: string;
    tones?: string[];
    status?: ContentStatus;
    drive_url?: string;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  const title = String(body.title ?? "").trim();
  if (title.length < 1 || title.length > 160) return jsonError("Informe um título entre 1 e 160 caracteres.", 400);

  const sourceKind = body.source_kind ?? "needs_creation";
  if (!VALID_SOURCE.has(sourceKind)) return jsonError("Origem inválida.", 400);

  const status = body.status ?? (sourceKind === "existing_ready" ? "ready" : "idea");
  if (!VALID_STATUS.has(status)) return jsonError("Status inválido.", 400);

  let pillarId: string | null = null;
  if (body.pillar_id) {
    if (!isUuid(body.pillar_id)) return jsonError("Pilar inválido.", 400);
    const pillar = await getPillar(body.pillar_id, clientId);
    if (!pillar) return jsonError("Pilar não encontrado neste cliente.", 404);
    pillarId = pillar.id;
  }

  let tones: string[] = [];
  if (Array.isArray(body.tones) && body.tones.length) {
    const check = validateTones(body.tones.map(String));
    if ("error" in check) return jsonError(check.error, 400);
    tones = check.tones;
  }

  const driveUrl = String(body.drive_url ?? "").trim();
  let driveFileId: string | null = null;
  let driveMeta = null;
  if (driveUrl) {
    const resolved = await resolveDrive(driveUrl);
    if (resolved.meta?.error) return jsonError(resolved.meta.error, 400);
    driveFileId = resolved.fileId;
    driveMeta = resolved.meta;
  }

  const themeKey = body.theme_key ? normalizeThemeKey(String(body.theme_key)) : normalizeThemeKey(title);

  const item = await createContentItem(clientId, {
    title,
    source_kind: sourceKind,
    pillar_id: pillarId,
    theme_key: themeKey,
    hook: String(body.hook ?? ""),
    angle: String(body.angle ?? ""),
    brief: String(body.brief ?? ""),
    script: String(body.script ?? ""),
    transcript: String(body.transcript ?? ""),
    caption_draft: String(body.caption_draft ?? ""),
    tones,
    status,
    drive_url: driveUrl,
    drive_file_id: driveFileId,
    drive_meta: driveMeta,
  });

  return Response.json({ item }, { status: 201 });
}
