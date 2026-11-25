import { isFormat, isNetwork, NETWORKS } from "@/config/networks";
import { buildMemoryBlock, listRecentAiMemory } from "@/lib/ai-memory";
import { addDays, isDay, isTime, todaySP } from "@/lib/dates";
import { db } from "@/lib/db";
import { editorialAiConfigured, generateEditorialJson } from "@/lib/editorial-ai";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { listPillars } from "@/lib/editorial-queries";
import { extractJsonPayload } from "@/lib/editorial-rules";
import {
  SEQUENCE_MAX_POSTS,
  buildSequencePrompt,
  parseSequencePlan,
  sequenceDates,
} from "@/lib/editorial-sequence";
import { listAvailableReady, listRecentForSequence, readSequence, saveSequence } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

const intIn = (v: unknown, min: number, max: number, def: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/**
 * Monta a sequência de postagem com a IA: datas a cada N dias, vídeos prontos (com transcrição) e pautas novas,
 * ou dias sem post. A resposta é conferida (parseSequencePlan) e, se vier fora das regras, a IA tenta mais uma vez
 * sabendo o que errou. Sem chave do Gemini, devolve o pedido para copiar e aceita o JSON colado (manual_json).
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
  const start = isDay(body.start) ? body.start : addDays(today, 1);
  if (start < today) return jsonError("A sequência não pode começar no passado.", 400);
  const everyDays = intIn(body.every_days, 1, 14, 2);
  const count = intIn(body.count, 1, SEQUENCE_MAX_POSTS, 8);
  const leadDays = intIn(body.lead_days, 0, 30, 2);

  const targets: { network: string; format: string; time: string }[] = [];
  for (const t of Array.isArray(body.targets) ? body.targets : []) {
    const network = String(t.network ?? "");
    const format = String(t.format ?? "");
    if (!isNetwork(network) || !isFormat(network, format)) return jsonError(`Rede ou formato inválido: ${network}/${format}.`, 400);
    const time = t.time && isTime(t.time) ? t.time : "10:00";
    if (!targets.some((x) => x.network === network && x.format === format)) targets.push({ network, format, time });
  }
  if (!targets.length) return jsonError("Escolha pelo menos uma rede.", 400);

  const dates = sequenceDates(start, everyDays, count);
  const pool = await db();
  const [ready, recent, pillars, memories, styleRow] = await Promise.all([
    listAvailableReady(clientId),
    listRecentForSequence(clientId),
    listPillars(clientId),
    listRecentAiMemory(clientId, 15),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [clientId]),
  ]);
  const client = data.client;
  const prompt = buildSequencePrompt({
    clientName: client.name,
    segment: client.segment ?? "",
    tone: client.tone ?? "",
    notes: client.notes ?? "",
    styleNotes: styleRow.rows[0]?.ai_style_notes ?? "",
    memoryBlock: buildMemoryBlock(memories, ""),
    pillars: pillars.map((p) => p.name),
    ready,
    recent,
    dates,
    today,
    leadDays,
    networks: targets.map((t) => `${isNetwork(t.network) ? NETWORKS[t.network].label : t.network} ${t.format}`),
  });
  const opts = { dates, readyIds: new Set(ready.map((r) => r.id)), today, leadDays };

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
    plan = parseSequencePlan(raw, opts);
  } else {
    if (body.mode === "prompt_only" || !editorialAiConfigured()) return Response.json({ prompt, rows: null });
    plan = await askAi(prompt, opts);
  }
  if (!plan.ok) return jsonError(plan.error, plan.error.startsWith("o Gemini") || plan.error.startsWith("a ") ? 502 : 400);

  await saveSequence(clientId, start, plan.entries, targets);
  return Response.json({ prompt, rows: await readSequence(clientId, today) });
}

async function askAi(prompt: string, opts: Parameters<typeof parseSequencePlan>[1]): Promise<ReturnType<typeof parseSequencePlan>> {
  let ask = prompt;
  let last: ReturnType<typeof parseSequencePlan> = { ok: false, error: "A IA não respondeu." };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateEditorialJson(ask);
    if ("error" in res) return { ok: false, error: res.error };
    let raw: unknown;
    try {
      raw = extractJsonPayload(res.text);
    } catch {
      last = { ok: false, error: "A IA não devolveu um JSON válido. Tente de novo." };
      ask = `${prompt}\n\nSua resposta anterior não era um JSON válido. Responda só com o JSON pedido.`;
      continue;
    }
    last = parseSequencePlan(raw, opts);
    if (last.ok) return last;
    ask = `${prompt}\n\nSua resposta anterior foi recusada por este motivo: ${last.error} Corrija e responda de novo com o JSON completo.`;
  }
  return last;
}
