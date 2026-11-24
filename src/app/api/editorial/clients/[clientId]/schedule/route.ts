import { isFormat, isNetwork } from "@/config/networks";
import { addDays, isDay, isTime, todaySP } from "@/lib/dates";
import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import {
  createEditorialSlot,
  getContentItem,
  getVisualAsset,
  listEditorialSlots,
} from "@/lib/editorial-queries";
import { isUuid } from "@/lib/editorial-rules";
import { listDayNotes } from "@/lib/queries";

export const dynamic = "force-dynamic";

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const sp = new URL(req.url).searchParams;
  const today = todaySP();
  const from = sp.get("from") || today;
  const to = sp.get("to") || addDays(from, 30);

  if (!isDay(from) || !isDay(to)) return jsonError("Datas inválidas (use AAAA-MM-DD).", 400);
  const diff = daysBetween(from, to);
  if (diff < 0 || diff > 62) return jsonError("O intervalo da agenda deve ter entre 0 e 62 dias.", 400);

  const [slots, notes] = await Promise.all([
    listEditorialSlots({ clientId, from, to }),
    listDayNotes(clientId, from, to),
  ]);
  return Response.json({ slots, notes });
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    content_item_id?: string;
    asset_id?: string | null;
    planned_day?: string;
    planned_time?: string | null;
    position?: number;
    network?: string;
    format?: string;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (!isUuid(body.content_item_id)) return jsonError("Item de conteúdo inválido.", 400);
  const item = await getContentItem(body.content_item_id, clientId);
  if (!item) return jsonError("Item de conteúdo não encontrado neste cliente.", 404);

  let assetId: string | null = null;
  if (body.asset_id) {
    if (!isUuid(body.asset_id)) return jsonError("Ativo visual inválido.", 400);
    const asset = await getVisualAsset(body.asset_id, clientId);
    if (!asset || asset.content_item_id !== item.id) {
      return jsonError("Ativo visual não pertence a este item.", 404);
    }
    assetId = asset.id;
  }

  if (!isDay(body.planned_day)) return jsonError("Data planejada inválida.", 400);
  if (body.planned_time !== undefined && body.planned_time !== null && !isTime(body.planned_time)) {
    return jsonError("Horário planejado inválido.", 400);
  }
  const network = String(body.network ?? "");
  const format = String(body.format ?? "");
  if (!isNetwork(network) || !isFormat(network, format)) {
    return jsonError("Rede ou formato inválido.", 400);
  }

  try {
    const slot = await createEditorialSlot(clientId, {
      content_item_id: item.id,
      asset_id: assetId,
      planned_day: body.planned_day,
      planned_time: body.planned_time ?? null,
      position: Number.isInteger(body.position) ? body.position : 0,
      network,
      format,
    });
    return Response.json({ slot }, { status: 201 });
  } catch (e) {
    if (isPgUniqueViolation(e)) {
      return jsonError("Este conteúdo já está planejado para esta rede, formato e dia.", 409);
    }
    throw e;
  }
}
