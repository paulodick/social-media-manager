// Monta e grava a sequência de postagem (pedido para a IA, conferência e gravação). Usado pelo botão
// "Montar sequência com IA" e pela reorganização automática que a sincronização faz quando entra ou sai vídeo.
import { isFormat, isNetwork, NETWORKS } from "../config/networks.ts";
import { buildMemoryBlock, listRecentAiMemory } from "./ai-memory.ts";
import { addDays, isDay, isTime, todaySP } from "./dates.ts";
import { db } from "./db.ts";
import { editorialAiConfigured, generateEditorialJson } from "./editorial-ai.ts";
import { listPillars } from "./editorial-queries.ts";
import { extractJsonPayload } from "./editorial-rules.ts";
import { SEQUENCE_MAX_POSTS, buildSequencePrompt, parseSequencePlan, sequenceDates } from "./editorial-sequence.ts";
import { listAvailableReady, listRecentForSequence, saveSequence } from "./editorial-sequence-store.ts";
import { getClient } from "./queries.ts";

export type SequenceTarget = { network: string; format: string; time: string };
export type SequenceParams = { start: string; every_days: number; count: number; lead_days: number; targets: SequenceTarget[] };

const intIn = (v: unknown, min: number, max: number, def: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** Confere o que veio da tela (ou do banco) e devolve os parâmetros normalizados. */
export function parseSequenceParams(
  body: { start?: unknown; every_days?: unknown; count?: unknown; lead_days?: unknown; targets?: unknown },
  today: string,
): { ok: true; params: SequenceParams } | { ok: false; error: string } {
  const start = typeof body.start === "string" && isDay(body.start) ? body.start : addDays(today, 1);
  if (start < today) return { ok: false, error: "A sequência não pode começar no passado." };
  const targets: SequenceTarget[] = [];
  for (const t of Array.isArray(body.targets) ? (body.targets as { network?: string; format?: string; time?: string }[]) : []) {
    const network = String(t.network ?? "");
    const format = String(t.format ?? "");
    if (!isNetwork(network) || !isFormat(network, format)) return { ok: false, error: `Rede ou formato inválido: ${network}/${format}.` };
    const time = t.time && isTime(t.time) ? t.time : "10:00";
    if (!targets.some((x) => x.network === network && x.format === format)) targets.push({ network, format, time });
  }
  if (!targets.length) return { ok: false, error: "Escolha pelo menos uma rede." };
  return {
    ok: true,
    params: {
      start,
      every_days: intIn(body.every_days, 1, 14, 2),
      count: intIn(body.count, 1, SEQUENCE_MAX_POSTS, 8),
      lead_days: intIn(body.lead_days, 0, 30, 2),
      targets,
    },
  };
}

type Plan = ReturnType<typeof parseSequencePlan>;
type Opts = Parameters<typeof parseSequencePlan>[1];

/** Pedido para a IA com os vídeos disponíveis agora, para as datas dadas. */
export async function buildRun(clientId: string, params: SequenceParams, dates: string[]): Promise<{ prompt: string; opts: Opts } | null> {
  const data = await getClient(clientId);
  if (!data) return null;
  const today = todaySP();
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
    leadDays: params.lead_days,
    networks: params.targets.map((t) => `${isNetwork(t.network) ? NETWORKS[t.network].label : t.network} ${t.format}`),
  });
  return { prompt, opts: { dates, readyIds: new Set(ready.map((r) => r.id)), today, leadDays: params.lead_days } };
}

/** Pergunta à IA e, se a resposta vier fora das regras, tenta mais uma vez dizendo o que errou. */
export async function askAi(prompt: string, opts: Opts): Promise<Plan> {
  let ask = prompt;
  let last: Plan = { ok: false, error: "A IA não respondeu." };
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

export async function saveSequenceParams(clientId: string, params: SequenceParams): Promise<void> {
  const pool = await db();
  await pool.query("update clients set sequence_params = $2 where id = $1", [clientId, JSON.stringify(params)]);
}

/**
 * Datas da reorganização: segue a grade da última sequência (início + a cada N dias), a partir de amanhã, pulando
 * os dias que já têm post aprovado. Quantidade: o que já era rascunho, ou mais, se houver mais vídeos prontos.
 */
export function reorganizeDates(opts: {
  params: SequenceParams;
  from: string;
  locked: Set<string>;
  draftCount: number;
  readyCount: number;
}): string[] {
  const n = Math.min(SEQUENCE_MAX_POSTS, Math.max(opts.draftCount, opts.readyCount));
  const out: string[] = [];
  let day = opts.params.start;
  // Grade antiga começa no passado: avança até `from` sem sair do passo de N dias.
  for (let guard = 0; day < opts.from && guard < 2000; guard++) day = addDays(day, opts.params.every_days);
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    if (!opts.locked.has(day)) out.push(day);
    day = addDays(day, opts.params.every_days);
  }
  return out;
}

export type ReorganizeResult =
  | { done: true; note: string }
  | { done: false; note: string };

/**
 * Refaz só a parte em rascunho da sequência, com os vídeos disponíveis agora (entraram novos ou saíram alguns).
 * Aprovados, agendados e postados ficam onde estão. Sem sequência montada antes, não faz nada.
 */
export async function reorganizeDraftSequence(clientId: string): Promise<ReorganizeResult> {
  const pool = await db();
  const pr = await pool.query<{ sequence_params: SequenceParams | null }>("select sequence_params from clients where id = $1", [clientId]);
  const saved = pr.rows[0]?.sequence_params;
  if (!saved) return { done: false, note: "" };
  if (!editorialAiConfigured()) {
    return { done: false, note: "Entraram ou saíram vídeos: monte a sequência de novo para eles entrarem na ordem (sem chave de IA ela não se reorganiza sozinha)." };
  }
  const today = todaySP();
  const from = addDays(today, 1);
  const parsed = parseSequenceParams({ ...saved, start: saved.start < today ? today : saved.start }, today);
  if (!parsed.ok) return { done: false, note: "" };
  // A grade continua a da sequência original (mesmo início, mesmo passo).
  const params: SequenceParams = { ...parsed.params, start: saved.start };
  const [drafts, locked, ready] = await Promise.all([
    pool.query<{ day: string }>(
      `select distinct to_char(planned_day, 'YYYY-MM-DD') as day from editorial_schedule
        where client_id = $1 and planned_day >= $2::date and sequence_kind <> '' and plan_status = 'draft' and post_target_id is null
       union
       select to_char(day, 'YYYY-MM-DD') from editorial_sequence_skips where client_id = $1 and day >= $2::date`,
      [clientId, from],
    ),
    pool.query<{ day: string }>(
      `select distinct to_char(planned_day, 'YYYY-MM-DD') as day from editorial_schedule
        where client_id = $1 and planned_day >= $2::date and (plan_status = 'approved' or post_target_id is not null)`,
      [clientId, from],
    ),
    listAvailableReady(clientId),
  ]);
  if (!drafts.rows.length && !ready.length) return { done: false, note: "" };
  const dates = reorganizeDates({
    params,
    from,
    locked: new Set(locked.rows.map((r) => r.day)),
    draftCount: drafts.rows.length,
    readyCount: ready.length,
  });
  if (!dates.length) return { done: false, note: "" };
  const run = await buildRun(clientId, params, dates);
  if (!run) return { done: false, note: "" };
  const plan = await askAi(run.prompt, run.opts);
  if (!plan.ok) return { done: false, note: `A ordem dos rascunhos não foi refeita (${plan.error}). A sequência anterior continua valendo.` };
  await saveSequence(clientId, from, plan.entries, params.targets);
  const posts = plan.entries.filter((e) => e.kind !== "skip").length;
  return { done: true, note: `Sequência reorganizada com os vídeos de agora: ${posts} post(s) em rascunho a partir de amanhã. Os aprovados não mudaram.` };
}

export { editorialAiConfigured, SEQUENCE_MAX_POSTS, sequenceDates };
