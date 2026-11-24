import { isFormat, isNetwork } from "@/config/networks";
import { isDay, isTime } from "@/lib/dates";
import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import {
  deleteEditorialSlot,
  getEditorialSlot,
  getVisualAsset,
  updateEditorialSlot,
} from "@/lib/editorial-queries";
import { isUuid } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Horário inválido.", 400);

  const existing = await getEditorialSlot(id);
  if (!existing) return jsonError("Horário planejado não encontrado.", 404);
  if (existing.target) return jsonError("Este horário já foi enviado para a fila e só pode ser editado lá.", 409);

  const body = await readJsonBody<{
    planned_day?: string;
    planned_time?: string | null;
    position?: number;
    network?: string;
    format?: string;
    asset_id?: string | null;
    status?: "planned" | "skipped";
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (body.planned_day !== undefined && !isDay(body.planned_day)) return jsonError("Data planejada inválida.", 400);
  if (body.planned_time !== undefined && body.planned_time !== null && !isTime(body.planned_time)) {
    return jsonError("Horário planejado inválido.", 400);
  }
  const nextNet = body.network ?? existing.network;
  const nextFmt = body.format ?? existing.format;
  if (!isNetwork(nextNet) || !isFormat(nextNet, nextFmt)) {
    return jsonError("Rede ou formato inválido.", 400);
  }
  if (body.status !== undefined && body.status !== "planned" && body.status !== "skipped") {
    return jsonError("Status inválido.", 400);
  }
  if (body.asset_id !== undefined && body.asset_id !== null) {
    if (!isUuid(body.asset_id)) return jsonError("Ativo visual inválido.", 400);
    const asset = await getVisualAsset(body.asset_id, existing.client_id);
    if (!asset || asset.content_item_id !== existing.content_item_id) {
      return jsonError("Ativo visual não pertence a este item.", 404);
    }
  }

  try {
    const slot = await updateEditorialSlot(id, {
      planned_day: body.planned_day,
      planned_time: body.planned_time,
      position: body.position,
      network: body.network,
      format: body.format,
      asset_id: body.asset_id,
      status: body.status,
    });
    if (!slot) return jsonError("Este horário já foi enviado para a fila.", 409);
    return Response.json({ slot });
  } catch (e) {
    if (isPgUniqueViolation(e)) {
      return jsonError("Este conteúdo já está planejado para esta rede, formato e dia.", 409);
    }
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Horário inválido.", 400);

  const res = await deleteEditorialSlot(id);
  if (res === "not_found") return jsonError("Horário planejado não encontrado.", 404);
  if (res === "in_queue") return jsonError("Este horário já está na fila e não pode ser removido aqui.", 409);
  return new Response(null, { status: 204 });
}
