import { buildMemoryBlock, listRecentAiMemory, recordAiMemory } from "@/lib/ai-memory";
import { db } from "@/lib/db";
import { editorialAiConfigured, generateEditorialJson } from "@/lib/editorial-ai";
import { jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { buildRefineDraftPrompt } from "@/lib/editorial-prompts";
import { getContentItem, getPillar } from "@/lib/editorial-queries";
import { extractJsonPayload, isUuid, parseAiRefinedDraft } from "@/lib/editorial-rules";
import { getClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Item inválido.", 400);

  const item = await getContentItem(id);
  if (!item) return jsonError("Item não encontrado.", 404);

  const clientData = await getClient(item.client_id);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    suggestion?: string;
    current_brief?: string;
    current_caption?: string;
    current_script?: string;
    mode?: "ai" | "prompt_only";
    manual_json?: unknown;
  }>(req);

  const pool = await db();
  const [pillar, memories, styleRow] = await Promise.all([
    item.pillar_id ? getPillar(item.pillar_id, item.client_id) : Promise.resolve(null),
    listRecentAiMemory(item.client_id, 15),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [item.client_id]),
  ]);

  const suggestion = String(body?.suggestion ?? "").trim().slice(0, 1000);
  const memoryBlock = buildMemoryBlock(memories, styleRow.rows[0]?.ai_style_notes ?? "");
  const prompt = buildRefineDraftPrompt({
    client: clientData.client,
    pillarName: pillar?.name ?? null,
    contentFormat: item.content_format ?? "video",
    title: item.title,
    currentBrief: body?.current_brief ?? item.brief,
    currentCaption: body?.current_caption ?? item.caption_draft,
    currentScript: body?.current_script ?? item.script,
    suggestion,
    memoryBlock,
  });

  let rawJson: unknown = body?.manual_json;
  if (rawJson === undefined) {
    if (body?.mode === "prompt_only" || !editorialAiConfigured()) {
      return Response.json({ prompt, draft: null });
    }
    const aiRes = await generateEditorialJson(prompt);
    if ("error" in aiRes) return jsonError(aiRes.error, 502);
    try {
      rawJson = extractJsonPayload(aiRes.text);
    } catch {
      return jsonError("O Gemini não retornou um JSON válido ao evoluir o rascunho.", 502);
    }
  } else if (typeof rawJson === "string") {
    try {
      rawJson = extractJsonPayload(rawJson);
    } catch {
      return jsonError("O JSON colado não é válido.", 400);
    }
  }

  const parsed = parseAiRefinedDraft(rawJson);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  await recordAiMemory({
    workspaceId: item.client_id,
    eventType: "draft_refined",
    pillarId: item.pillar_id,
    format: item.content_format,
    contentSummary: item.title,
    userFeedbackOrDiff: suggestion || "Evolução de rascunho via IA.",
  }).catch(() => {});

  return Response.json({ prompt, draft: parsed.draft });
}
