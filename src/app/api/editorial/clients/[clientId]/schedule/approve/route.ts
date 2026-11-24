import { recordAiMemory } from "@/lib/ai-memory";
import { db } from "@/lib/db";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { enqueueSlots } from "@/lib/editorial-enqueue";
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

  const pool = await db();
  await pool.query(
    `update editorial_schedule
        set plan_status = 'approved',
            approved_at = coalesce(approved_at, now()),
            updated_at = now()
      where client_id = $1 and id = any($2::uuid[])`,
    [clientId, slotIds],
  );

  // Promove para a fila oficial (posts + post_targets em draft, sem auto_confirmed_at) agrupando por item + dia.
  const allSlots = await listEditorialSlots({ clientId });
  const toEnqueue = allSlots.filter((s) => slotIds.includes(s.id) && s.status === "planned" && !s.target);

  const groups = new Map<string, string[]>();
  for (const s of toEnqueue) {
    const key = `${s.content_item_id}|${s.day}`;
    groups.set(key, [...(groups.get(key) ?? []), s.id]);
  }

  let enqueuedTargets = 0;
  const warnings: string[] = [];
  for (const groupSlotIds of groups.values()) {
    const res = await enqueueSlots(clientId, groupSlotIds, { time: defaultTime });
    if (res.ok) {
      enqueuedTargets += res.post_target_ids.length;
      warnings.push(...res.warnings);
    }
  }

  await recordAiMemory({
    workspaceId: clientId,
    eventType: "schedule_approved",
    contentSummary: `Cronograma aprovado com ${slotIds.length} item(ns) e ${enqueuedTargets} destino(s) na fila oficial.`,
  }).catch(() => {});

  const refreshed = await listEditorialSlots({ clientId });
  return Response.json({
    approved_count: slotIds.length,
    enqueued_targets: enqueuedTargets,
    warnings,
    slots: refreshed.filter((s) => slotIds.includes(s.id)),
  });
}
