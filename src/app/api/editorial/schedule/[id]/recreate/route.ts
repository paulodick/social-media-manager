import { buildMemoryBlock, listRecentAiMemory, recordAiMemory } from "@/lib/ai-memory";
import { db } from "@/lib/db";
import { editorialAiConfigured, generateEditorialJson } from "@/lib/editorial-ai";
import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { buildRecreateTopicPrompt } from "@/lib/editorial-prompts";
import {
  getContentItem,
  getEditorialSlot,
  getPillar,
  listRecentThemeKeys,
} from "@/lib/editorial-queries";
import { extractJsonPayload, isUuid, parseAiRecreatedTopic } from "@/lib/editorial-rules";
import type { ContentItem } from "@/lib/editorial-types";
import { getClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id: slotId } = await ctx.params;
  if (!isUuid(slotId)) return jsonError("Horário inválido.", 400);

  const slot = await getEditorialSlot(slotId);
  if (!slot) return jsonError("Item do cronograma não encontrado.", 404);
  if (slot.target) return jsonError("Este item já está na fila de publicação e não pode ser recriado.", 409);

  const [clientData, oldItem] = await Promise.all([
    getClient(slot.client_id),
    getContentItem(slot.content_item_id, slot.client_id),
  ]);
  if (!clientData || !oldItem) return jsonError("Cliente ou conteúdo não encontrado.", 404);

  const body = await readJsonBody<{
    reason?: string;
    mode?: "ai" | "prompt_only";
    manual_json?: unknown;
  }>(req);

  const pool = await db();
  const [pillar, recentThemes, memories, styleRow] = await Promise.all([
    oldItem.pillar_id ? getPillar(oldItem.pillar_id, slot.client_id) : Promise.resolve(null),
    listRecentThemeKeys(slot.client_id, 200),
    listRecentAiMemory(slot.client_id, 15),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [slot.client_id]),
  ]);

  const avoidSet = new Set(recentThemes);
  if (oldItem.theme_key) avoidSet.add(oldItem.theme_key);

  const memoryBlock = buildMemoryBlock(memories, styleRow.rows[0]?.ai_style_notes ?? "");
  const prompt = buildRecreateTopicPrompt({
    client: clientData.client,
    pillar,
    network: slot.network,
    format: slot.format,
    contentFormat: oldItem.content_format ?? "video",
    rejectedTitle: oldItem.title,
    rejectedThemeKey: oldItem.theme_key,
    reason: body?.reason,
    avoidThemeKeys: Array.from(avoidSet),
    memoryBlock,
  });

  let rawJson: unknown = body?.manual_json;
  if (rawJson === undefined) {
    if (body?.mode === "prompt_only" || !editorialAiConfigured()) {
      return Response.json({ prompt, slot: null, item: null });
    }
    const aiRes = await generateEditorialJson(prompt);
    if ("error" in aiRes) return jsonError(aiRes.error, 502);
    try {
      rawJson = extractJsonPayload(aiRes.text);
    } catch {
      return jsonError("O Gemini não retornou um JSON válido ao recriar o tópico.", 502);
    }
  } else if (typeof rawJson === "string") {
    try {
      rawJson = extractJsonPayload(rawJson);
    } catch {
      return jsonError("O JSON colado não é válido.", 400);
    }
  }

  const parsed = parseAiRecreatedTopic(rawJson, {
    avoidThemeKeys: avoidSet,
    fallbackFormat: oldItem.content_format ?? "video",
  });
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const t = parsed.topic;
  const c = await pool.connect();
  let newItem: ContentItem;
  try {
    await c.query("begin");
    const ins = await c.query<ContentItem>(
      `insert into content_items (
         client_id, pillar_id, source_kind, content_format, title, theme_key, hook, angle, brief,
         script, script_hook, script_dev, script_cta, caption_draft, tones, status
       )
       values ($1,$2,'needs_creation',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'idea')
       returning id, client_id, pillar_id, source_kind, content_format, title, theme_key, hook, angle, brief,
                 script, script_hook, script_dev, script_cta, transcript,
                 caption_draft, tones, status, drive_url, drive_file_id, drive_meta,
                 created_at::text as created_at, updated_at::text as updated_at`,
      [
        slot.client_id,
        oldItem.pillar_id,
        t.content_format,
        t.title,
        t.theme_key,
        t.hook,
        t.angle,
        t.brief,
        t.script,
        t.script_hook,
        t.script_dev,
        t.script_cta,
        t.caption_draft,
        t.tones,
      ],
    );
    newItem = ins.rows[0];
    await c.query(
      `update editorial_schedule
          set content_item_id = $1, asset_id = null, updated_at = now()
        where id = $2 and post_target_id is null`,
      [newItem.id, slotId],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  await Promise.all([
    recordAiMemory({
      workspaceId: slot.client_id,
      eventType: "topic_rejected",
      pillarId: oldItem.pillar_id,
      format: oldItem.content_format,
      contentSummary: `${oldItem.title} (${oldItem.theme_key || "sem-chave"})`,
      userFeedbackOrDiff: body?.reason ? `Substituído pelo usuário: ${body.reason}` : "Substituído via botão Recriar.",
    }),
    recordAiMemory({
      workspaceId: slot.client_id,
      eventType: "topic_recreated",
      pillarId: oldItem.pillar_id,
      format: t.content_format,
      contentSummary: `${t.title} — ${t.angle}`,
      userFeedbackOrDiff: t.reason_why || "Novo tópico gerado para evitar repetição.",
    }),
  ]).catch(() => {});

  const updatedSlot = await getEditorialSlot(slotId, slot.client_id);
  return Response.json({ prompt, slot: updatedSlot, item: newItem, reason_why: t.reason_why });
}
