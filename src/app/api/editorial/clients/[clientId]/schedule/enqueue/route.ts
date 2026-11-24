import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { enqueueSlots } from "@/lib/editorial-enqueue";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{ slot_ids?: string[]; time?: string }>(req);
  if (!body || !Array.isArray(body.slot_ids) || !body.slot_ids.length) {
    return jsonError("Informe os horários que deseja enviar para a fila.", 400);
  }

  const res = await enqueueSlots(clientId, body.slot_ids, { time: body.time });
  if (!res.ok) return jsonError(res.error, res.status);

  return Response.json({
    ...res,
    redirect: `/clientes/${clientId}/dia/${res.day}`,
  });
}
