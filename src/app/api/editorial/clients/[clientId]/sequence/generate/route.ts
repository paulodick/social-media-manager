import { todaySP } from "@/lib/dates";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { extractJsonPayload } from "@/lib/editorial-rules";
import { parseSequencePlan } from "@/lib/editorial-sequence";
import { askAi, buildRun, editorialAiConfigured, parseSequenceParams, saveSequenceParams, sequenceDates } from "@/lib/editorial-sequence-run";
import { readSequence, saveSequence } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

/**
 * Monta a sequência de postagem com a IA: datas a cada N dias, vídeos prontos (com transcrição) e pautas novas,
 * ou dias sem post. A resposta é conferida (parseSequencePlan) e, se vier fora das regras, a IA tenta mais uma vez
 * sabendo o que errou. Sem chave de IA, devolve o pedido para copiar e aceita o JSON colado (manual_json).
 * Os parâmetros ficam guardados para a sincronização reorganizar os rascunhos quando entrar ou sair vídeo.
 */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    start?: string;
    every_days?: number;
    count?: number;
    lead_days?: number;
    targets?: { network?: string; format?: string; time?: string }[];
    mode?: "ai" | "prompt_only";
    manual_json?: unknown;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  const today = todaySP();
  const parsed = parseSequenceParams(body, today);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const params = parsed.params;
  const dates = sequenceDates(params.start, params.every_days, params.count);
  const run = await buildRun(clientId, params, dates);
  if (!run) return jsonError("Cliente não encontrado.", 404);

  let plan: ReturnType<typeof parseSequencePlan>;
  if (body.manual_json !== undefined) {
    let raw: unknown = body.manual_json;
    if (typeof raw === "string") {
      try {
        raw = extractJsonPayload(raw);
      } catch {
        return jsonError("O JSON colado não é válido.", 400);
      }
    }
    plan = parseSequencePlan(raw, run.opts);
  } else {
    if (body.mode === "prompt_only" || !editorialAiConfigured()) return Response.json({ prompt: run.prompt, rows: null });
    plan = await askAi(run.prompt, run.opts);
  }
  if (!plan.ok) return jsonError(plan.error, /^(o Gemini|o Claude|a )/.test(plan.error) ? 502 : 400);

  await saveSequence(clientId, params.start, plan.entries, params.targets);
  await saveSequenceParams(clientId, params);
  return Response.json({ prompt: run.prompt, rows: await readSequence(clientId, today) });
}
