import { recordAiMemory } from "@/lib/ai-memory";
import { db } from "@/lib/db";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { enqueueSlots, processScheduleApproval } from "@/lib/editorial-enqueue";
import { listEditorialSlots } from "@/lib/editorial-queries";
import { isUuid } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{ slot_ids?: string[]; default_time?: string }>(req);
  const slotIds = Array.isArray(body?.slot_ids) ? body.slot_ids.filter(isUuid) : [];
  if (!slotIds.length) {
    return jsonError("Informe os itens do cronograma que deseja aprovar.", 400);
  }

  const defaultTime = body?.default_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.default_time)
    ? body.default_time
    : "09:00";

  // Promove para a fila oficial (posts + post_targets em draft, sem auto_confirmed_at) agrupando por item + dia.
  const allSlots = await listEditorialSlots({ clientId });
  const toEnqueue = allSlots.filter((s) => slotIds.includes(s.id) && s.status === "planned" && !s.target);

  if (!toEnqueue.length) {
    return Response.json(
      {
        error: "Nenhum item pendente para enviar à fila.",
        approved_count: 0,
        enqueued_targets: 0,
        warnings: [],
        failed: [],
      },
      { status: 409 },
    );
  }

  const groups = new Map<string, string[]>();
  for (const s of toEnqueue) {
    const key = `${s.content_item_id}|${s.day}`;
    groups.set(key, [...(groups.get(key) ?? []), s.id]);
  }

  const batch = await processScheduleApproval([...groups.values()], (groupSlotIds) =>
    enqueueSlots(clientId, groupSlotIds, { fallbackTime: defaultTime }),
  );

  if (!batch.approved_slot_ids.length) {
    return Response.json(
      {
        error: batch.failed[0]?.error ?? "Nenhum item pôde ser enviado para a fila.",
        approved_count: 0,
        enqueued_targets: 0,
        warnings: batch.warnings,
        failed: batch.failed,
      },
      { status: 409 },
    );
  }

  const pool = await db();
  await pool.query(
    `update editorial_schedule
        set plan_status = 'approved',
            approved_at = coalesce(approved_at, now()),
            updated_at = now()
      where client_id = $1 and id = any($2::uuid[])`,
    [clientId, batch.approved_slot_ids],
  );

  await recordAiMemory({
    workspaceId: clientId,
    eventType: "schedule_approved",
    contentSummary: `Cronograma aprovado com ${batch.approved_slot_ids.length} item(ns) e ${batch.enqueued_targets} destino(s) na fila oficial.`,
  }).catch(() => {});

  const refreshed = await listEditorialSlots({ clientId });
  return Response.json({
    approved_count: batch.approved_slot_ids.length,
    enqueued_targets: batch.enqueued_targets,
    warnings: batch.warnings,
    failed: batch.failed,
    slots: refreshed.filter((s) => slotIds.includes(s.id)),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{ slot_ids?: string[] }>(req);
  const slotIds = Array.isArray(body?.slot_ids) ? body.slot_ids.filter(isUuid) : [];
  if (!slotIds.length) {
    return jsonError("Informe os itens para desfazer a aprovação.", 400);
  }

  const pool = await db();
  const { rows } = await pool.query<{ id: string }>(
    `update editorial_schedule
        set plan_status = 'draft',
            approved_at = null,
            updated_at = now()
      where client_id = $1
        and id = any($2::uuid[])
        and plan_status = 'approved'
        and post_target_id is null
      returning id`,
    [clientId, slotIds],
  );

  if (!rows.length) {
    return jsonError("Nenhum item aprovado sem destino na fila foi encontrado para desfazer.", 409);
  }

  const refreshed = await listEditorialSlots({ clientId });
  return Response.json({
    unapproved_count: rows.length,
    slots: refreshed.filter((s) => slotIds.includes(s.id)),
  });
}
