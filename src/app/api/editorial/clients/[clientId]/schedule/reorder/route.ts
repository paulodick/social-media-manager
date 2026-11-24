import { isDay, isTime } from "@/lib/dates";
import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { reorderEditorialSlots } from "@/lib/editorial-queries";
import { isUuid } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    moves?: { slot_id?: string; planned_day?: string; planned_time?: string | null; position?: number }[];
  }>(req);
  if (!body || !Array.isArray(body.moves) || !body.moves.length) {
    return jsonError("Informe os horários para reordenar.", 400);
  }
  if (body.moves.length > 50) return jsonError("Reordene no máximo 50 itens por vez.", 400);

  const moves: { slot_id: string; planned_day: string; planned_time?: string | null; position: number }[] = [];
  for (const m of body.moves) {
    if (!isUuid(m.slot_id)) return jsonError("ID de horário inválido.", 400);
    if (!isDay(m.planned_day)) return jsonError("Data planejada inválida.", 400);
    if (m.planned_time !== undefined && m.planned_time !== null && !isTime(m.planned_time)) {
      return jsonError("Horário planejado inválido.", 400);
    }
    const position = typeof m.position === "number" && Number.isInteger(m.position) && m.position >= 0 ? m.position : 0;
    moves.push({ slot_id: m.slot_id, planned_day: m.planned_day, planned_time: m.planned_time, position });
  }

  try {
    const res = await reorderEditorialSlots(clientId, moves);
    if (!res.ok) return jsonError(res.error, res.status);
    return Response.json({ slots: res.slots });
  } catch (e) {
    if (isPgUniqueViolation(e)) {
      return jsonError("Já existe este mesmo conteúdo planejado para essa rede, formato e dia.", 409);
    }
    throw e;
  }
}
