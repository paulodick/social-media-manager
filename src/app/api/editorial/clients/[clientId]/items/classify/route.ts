import { aiConfigured, generateText } from "@/lib/ai";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { buildClassificationPrompt } from "@/lib/editorial-prompts";
import { getContentItem, listPillars, updateContentItem } from "@/lib/editorial-queries";
import { extractJsonPayload, isUuid, parseAiClassification } from "@/lib/editorial-rules";
import type { ContentItem } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    item_ids?: string[];
    mode?: "ai" | "prompt_only";
    manual_json?: unknown;
  }>(req);
  if (!body || !Array.isArray(body.item_ids) || !body.item_ids.length || !body.item_ids.every(isUuid)) {
    return jsonError("Informe os IDs dos itens para classificar.", 400);
  }
  if (body.item_ids.length > 30) return jsonError("Classifique no máximo 30 itens por vez.", 400);

  const items: ContentItem[] = [];
  for (const id of body.item_ids) {
    const item = await getContentItem(id, clientId);
    if (!item) return jsonError("Um dos itens informados não pertence a este cliente.", 404);
    items.push(item);
  }

  const pillars = await listPillars(clientId);
  const prompt = buildClassificationPrompt({ client: data.client, pillars, items });

  let rawJson: unknown = body.manual_json;
  if (rawJson === undefined) {
    if (body.mode === "prompt_only" || !aiConfigured()) {
      return Response.json({ prompt, applied: 0, items: [] });
    }
    const aiRes = await generateText(prompt);
    if ("error" in aiRes) return jsonError(aiRes.error, 502);
    try {
      rawJson = extractJsonPayload(aiRes.text);
    } catch {
      return jsonError("A IA não retornou um JSON válido. Use 'Copiar pedido para a IA' ou tente novamente.", 502);
    }
  } else if (typeof rawJson === "string") {
    try {
      rawJson = extractJsonPayload(rawJson);
    } catch {
      return jsonError("O JSON colado não é válido.", 400);
    }
  }

  const parsed = parseAiClassification(rawJson, {
    validItemIds: new Set(items.map((i) => i.id)),
    validPillarIds: new Set(pillars.map((p) => p.id)),
  });
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const updated: ContentItem[] = [];
  for (const entry of parsed.entries) {
    const upd = await updateContentItem(entry.item_id, {
      pillar_id: entry.pillar_id,
      title: entry.title,
      theme_key: entry.theme_key,
      brief: entry.brief,
      hook: entry.hook,
    });
    if (upd) updated.push(upd);
  }

  return Response.json({ prompt, applied: updated.length, items: updated });
}
