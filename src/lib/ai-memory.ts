import { db } from "./db.ts";

export type AiMemoryEventType =
  | "topic_approved"
  | "topic_rejected"
  | "caption_generated"
  | "caption_edited_on_publish"
  | "post_scheduled"
  | "schedule_reordered"
  | "schedule_approved"
  | "style_note";

export type WorkspaceAiMemory = {
  id: string;
  workspace_id: string;
  event_type: AiMemoryEventType;
  pillar_id: string | null;
  format: string;
  content_summary: string;
  user_feedback_or_diff: string;
  created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registra um evento de aprendizado/memória contínua para o cliente. */
export async function recordAiMemory(input: {
  workspaceId: string;
  eventType: AiMemoryEventType;
  pillarId?: string | null;
  format?: string;
  contentSummary?: string;
  userFeedbackOrDiff?: string;
}): Promise<void> {
  if (!UUID_RE.test(input.workspaceId)) return;
  const pool = await db();
  await pool.query(
    `insert into workspace_ai_memory (workspace_id, event_type, pillar_id, format, content_summary, user_feedback_or_diff)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.workspaceId,
      input.eventType,
      input.pillarId && UUID_RE.test(input.pillarId) ? input.pillarId : null,
      String(input.format ?? "").slice(0, 40),
      String(input.contentSummary ?? "").slice(0, 1000),
      String(input.userFeedbackOrDiff ?? "").slice(0, 2000),
    ],
  );
}

/** Busca os registros mais recentes de aprendizado do cliente para injeção em prompts. */
export async function listRecentAiMemory(workspaceId: string, limit = 15): Promise<WorkspaceAiMemory[]> {
  if (!UUID_RE.test(workspaceId)) return [];
  const pool = await db();
  const r = await pool.query<WorkspaceAiMemory>(
    `select id, workspace_id, event_type, pillar_id, format, content_summary, user_feedback_or_diff,
            created_at::text as created_at
       from workspace_ai_memory
      where workspace_id = $1
      order by created_at desc
      limit $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 50)],
  );
  return r.rows;
}

/**
 * Resume objetivamente as alterações feitas pelo usuário entre a legenda gerada pela IA e a versão final salva.
 * Retorna null se não houve alteração relevante.
 */
export function summarizeCaptionDiff(generated: string, finalCaption: string): string | null {
  const g = generated.trim();
  const f = finalCaption.trim();
  if (!g || !f || g === f) return null;

  const notes: string[] = [];
  const ratio = f.length / Math.max(g.length, 1);
  if (ratio < 0.8) notes.push(`encurtou o texto (${g.length} -> ${f.length} chars)`);
  else if (ratio > 1.2) notes.push(`expandiu o texto (${g.length} -> ${f.length} chars)`);

  const tagsG = (g.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const tagsF = (f.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (tagsF < tagsG) notes.push(`reduziu hashtags (${tagsG} -> ${tagsF})`);
  else if (tagsF > tagsG) notes.push(`aumentou hashtags (${tagsG} -> ${tagsF})`);

  const firstLineF = f.split("\n")[0]?.trim().slice(0, 140) ?? "";
  const summary = notes.length ? `${notes.join("; ")}. ` : "";
  return `${summary}Versão final aprovada: "${firstLineF}${f.length > 140 ? "…" : ""}"`.slice(0, 600);
}

/** Monta bloco de texto com diretrizes e memória recente do cliente para injetar nos prompts do Gemini. */
export function buildMemoryBlock(memories: WorkspaceAiMemory[], aiStyleNotes = ""): string {
  const lines: string[] = [];
  if (aiStyleNotes.trim()) {
    lines.push(`Diretrizes de estilo do cliente:\n${aiStyleNotes.trim()}`);
  }
  const edits = memories.filter((m) => m.event_type === "caption_edited_on_publish" || m.event_type === "style_note");
  if (edits.length) {
    lines.push(
      "Preferências aprendidas com edições anteriores do usuário:",
      ...edits.slice(0, 6).map((m) => `- [${m.format || "geral"}] ${m.user_feedback_or_diff || m.content_summary}`),
    );
  }
  const approved = memories.filter((m) => m.event_type === "topic_approved" || m.event_type === "schedule_approved");
  if (approved.length) {
    lines.push(
      "Abordagens e temas já aprovados recentemente:",
      ...approved.slice(0, 5).map((m) => `- ${m.content_summary}`),
    );
  }
  const rejected = memories.filter((m) => m.event_type === "topic_rejected");
  if (rejected.length) {
    lines.push(
      "Temas/abordagens rejeitados (evitar):",
      ...rejected.slice(0, 4).map((m) => `- ${m.content_summary}`),
    );
  }
  return lines.join("\n");
}
