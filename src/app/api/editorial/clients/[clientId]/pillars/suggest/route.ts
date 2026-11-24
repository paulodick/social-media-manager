import { editorialAiConfigured, generateEditorialJson } from "@/lib/editorial-ai";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { buildPillarsPrompt } from "@/lib/editorial-prompts";
import { extractJsonPayload, parsePillarsInput } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const clientData = await requireClient(clientId);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{ mode?: "ai" | "prompt_only" }>(req);
  const prompt = buildPillarsPrompt(clientData.client);

  if (body?.mode === "prompt_only" || !editorialAiConfigured()) {
    return Response.json({ prompt, pillars: [] });
  }

  const aiRes = await generateEditorialJson(prompt);
  if ("error" in aiRes) return jsonError(aiRes.error, 502);

  let rawJson: unknown;
  try {
    rawJson = extractJsonPayload(aiRes.text);
  } catch {
    return jsonError("O Gemini não retornou um JSON válido. Use 'Importar JSON' manualmente.", 502);
  }

  const parsed = parsePillarsInput(rawJson);
  if (!parsed.ok) return jsonError(parsed.error, 502);

  return Response.json({ prompt, pillars: parsed.pillars });
}
