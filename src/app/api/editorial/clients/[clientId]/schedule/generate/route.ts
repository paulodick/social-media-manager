import { isFormat, isNetwork } from "@/config/networks";
import { buildMemoryBlock, listRecentAiMemory } from "@/lib/ai-memory";
import { editorialAiConfigured, generateEditorialJson } from "@/lib/editorial-ai";
import { enforceCalendarAlternation, type AlternationMeta } from "@/lib/editorial-alternation";
import { addDays, isDay, isTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { buildCalendarPrompt } from "@/lib/editorial-prompts";
import {
  getEditorialSlot,
  listContentItems,
  listPillars,
  listRecentThemeKeys,
} from "@/lib/editorial-queries";
import { extractJsonPayload, isUuid, parseAiCalendar, parseGenerateWeekdays } from "@/lib/editorial-rules";
import type { ContentItem, SlotView } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    from?: string;
    to?: string;
    weekdays?: number[];
    targets?: { network?: string; format?: string; default_time?: string | null }[];
    include_existing_ids?: string[];
    mode?: "ai" | "prompt_only";
    manual_json?: unknown;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (!isDay(body.from) || !isDay(body.to)) return jsonError("Período inválido (use AAAA-MM-DD).", 400);
  const diff = Math.round((new Date(body.to + "T00:00:00Z").getTime() - new Date(body.from + "T00:00:00Z").getTime()) / 86_400_000);
  if (diff < 0 || diff > 62) return jsonError("O período de geração deve ter entre 1 e 62 dias.", 400);

  const validWeekdays = parseGenerateWeekdays(body.weekdays);
  if (!validWeekdays) return jsonError("Selecione ao menos um dia da semana.", 400);
  const weekdays = new Set(validWeekdays);

  if (!Array.isArray(body.targets) || !body.targets.length) {
    return jsonError("Selecione ao menos uma rede e formato.", 400);
  }
  const targets: { network: string; format: string; default_time: string | null }[] = [];
  for (const t of body.targets) {
    const network = String(t.network ?? "");
    const format = String(t.format ?? "");
    if (!isNetwork(network) || !isFormat(network, format)) {
      return jsonError(`Rede ou formato inválido: ${network}/${format}.`, 400);
    }
    if (t.default_time !== undefined && t.default_time !== null && t.default_time !== "" && !isTime(t.default_time)) {
      return jsonError("Horário padrão inválido.", 400);
    }
    targets.push({ network, format, default_time: t.default_time || null });
  }

  const slotsToFill: { planned_day: string; planned_time: string | null; network: string; format: string }[] = [];
  for (let i = 0; i <= diff; i++) {
    const day = addDays(body.from, i);
    const dow = new Date(day + "T00:00:00Z").getUTCDay();
    if (!weekdays.has(dow)) continue;
    for (const t of targets) {
      slotsToFill.push({ planned_day: day, planned_time: t.default_time, network: t.network, format: t.format });
    }
  }
  if (!slotsToFill.length) return jsonError("Nenhum dia do período corresponde aos dias da semana selecionados.", 400);
  if (slotsToFill.length > 60) return jsonError("Gere no máximo 60 entradas de calendário por vez.", 400);

  const pool = await db();
  const [pillars, existingList, recentThemes, memories, styleRow] = await Promise.all([
    listPillars(clientId),
    listContentItems({ clientId, sourceKind: "existing_ready", status: "ready", limit: 50 }),
    listRecentThemeKeys(clientId, 200),
    listRecentAiMemory(clientId, 15),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [clientId]),
  ]);
  if (!pillars.length) return jsonError("Cadastre ao menos um pilar de conteúdo antes de gerar o calendário.", 400);

  const filterIds = Array.isArray(body.include_existing_ids) && body.include_existing_ids.every(isUuid)
    ? new Set(body.include_existing_ids)
    : null;
  const existingReady = filterIds
    ? existingList.items.filter((i) => filterIds.has(i.id))
    : existingList.items;

  const memoryBlock = buildMemoryBlock(memories, styleRow.rows[0]?.ai_style_notes ?? "");
  const prompt = buildCalendarPrompt({
    client: data.client,
    pillars,
    existingReady,
    recentThemeKeys: recentThemes,
    slots: slotsToFill,
    memoryBlock,
  });

  let rawJson: unknown = body.manual_json;
  if (rawJson === undefined) {
    if (body.mode === "prompt_only" || !editorialAiConfigured()) {
      return Response.json({ prompt, created_items: [], created_slots: [] });
    }
    const aiRes = await generateEditorialJson(prompt);
    if ("error" in aiRes) return jsonError(aiRes.error, 502);
    try {
      rawJson = extractJsonPayload(aiRes.text);
    } catch {
      return jsonError("O Gemini não retornou um JSON válido. Use 'Copiar pedido para a IA' ou tente novamente.", 502);
    }
  } else if (typeof rawJson === "string") {
    try {
      rawJson = extractJsonPayload(rawJson);
    } catch {
      return jsonError("O JSON colado não é válido.", 400);
    }
  }

  const parsed = parseAiCalendar(rawJson, {
    validPillarIds: new Set(pillars.map((p) => p.id)),
    validExistingIds: new Set(existingReady.map((e) => e.id)),
    existingThemeKeys: new Set(recentThemes),
  });
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const itemMetaById = new Map<string, AlternationMeta>(
    existingReady.map((e) => [
      e.id,
      {
        guest: e.guest_name,
        topic: e.topic_tag || e.theme_key,
        pillar: e.pillar_id,
      },
    ]),
  );
  const orderedEntries = enforceCalendarAlternation(parsed.entries, itemMetaById);

  const c = await pool.connect();
  const createdItems: ContentItem[] = [];
  const createdSlotIds: string[] = [];

  try {
    await c.query("begin");
    for (const [idx, entry] of orderedEntries.entries()) {
      let itemId = entry.existing_item_id;
      if (entry.source_kind === "needs_creation" && entry.new_item) {
        const ni = entry.new_item;
        const insItem = await c.query<ContentItem>(
          `insert into content_items (
             client_id, pillar_id, source_kind, content_format, title, theme_key, hook, angle, brief,
             script, script_hook, script_dev, script_cta, caption_draft, tones, status
           )
           values ($1,$2,'needs_creation',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'idea')
           returning id, client_id, pillar_id, source_kind, content_format, title, theme_key,
                     guest_name, topic_tag, cover_idea, cover_drive_file_id, cover_drive_url,
                     doc_drive_file_id, source_folder_id, source_folder_name,
                     hook, angle, brief, script, script_hook, script_dev, script_cta, transcript,
                     caption_draft, caption_instagram, caption_linkedin, tones, status, drive_url, drive_file_id, drive_meta,
                     created_at::text as created_at, updated_at::text as updated_at`,
          [
            clientId,
            entry.pillar_id,
            ni.content_format,
            ni.title,
            ni.theme_key,
            ni.hook,
            ni.angle,
            ni.brief,
            ni.script,
            ni.script_hook,
            ni.script_dev,
            ni.script_cta,
            ni.caption_draft,
            ni.tones,
          ],
        );
        createdItems.push(insItem.rows[0]);
        itemId = insItem.rows[0].id;
      }
      if (!itemId) continue;
      const insSlot = await c.query<{ id: string }>(
        `insert into editorial_schedule (client_id, content_item_id, planned_day, planned_time, position, network, format, plan_status)
         values ($1, $2, $3::date, $4::time, $5, $6, $7, 'draft')
         returning id`,
        [clientId, itemId, entry.planned_day, entry.planned_time, idx, entry.network, entry.format],
      );
      createdSlotIds.push(insSlot.rows[0].id);
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    if (isPgUniqueViolation(e)) {
      return jsonError("Conflito de agenda: um dos itens já estava planejado no mesmo dia, rede e formato.", 409);
    }
    throw e;
  } finally {
    c.release();
  }

  const createdSlots: SlotView[] = [];
  for (const sid of createdSlotIds) {
    const s = await getEditorialSlot(sid, clientId);
    if (s) createdSlots.push(s);
  }

  return Response.json({ prompt, created_items: createdItems, created_slots: createdSlots }, { status: 201 });
}
