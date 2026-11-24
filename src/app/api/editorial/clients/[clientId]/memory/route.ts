import { listRecentAiMemory, recordAiMemory, type AiMemoryEventType } from "@/lib/ai-memory";
import { db } from "@/lib/db";
import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const pool = await db();
  const [memories, styleRow] = await Promise.all([
    listRecentAiMemory(clientId, 20),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [clientId]),
  ]);

  return Response.json({
    ai_style_notes: styleRow.rows[0]?.ai_style_notes ?? "",
    memories,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const data = await requireClient(clientId);
  if (!data) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    ai_style_notes?: string;
    event_type?: AiMemoryEventType;
    pillar_id?: string | null;
    format?: string;
    content_summary?: string;
    user_feedback_or_diff?: string;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  const pool = await db();
  if (body.ai_style_notes !== undefined) {
    const notes = String(body.ai_style_notes).trim().slice(0, 4000);
    await pool.query("update clients set ai_style_notes = $1 where id = $2", [notes, clientId]);
    await recordAiMemory({
      workspaceId: clientId,
      eventType: "style_note",
      contentSummary: "Diretrizes de estilo do workspace atualizadas.",
      userFeedbackOrDiff: notes,
    });
    return Response.json({ ok: true, ai_style_notes: notes });
  }

  if (body.event_type) {
    await recordAiMemory({
      workspaceId: clientId,
      eventType: body.event_type,
      pillarId: body.pillar_id ?? null,
      format: body.format,
      contentSummary: body.content_summary,
      userFeedbackOrDiff: body.user_feedback_or_diff,
    });
    return Response.json({ ok: true }, { status: 201 });
  }

  return jsonError("Informe ai_style_notes ou event_type.", 400);
}
