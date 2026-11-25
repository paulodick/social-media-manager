import { todaySP } from "@/lib/dates";
import { db } from "@/lib/db";
import { jsonError, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { listAvailableReady, profilingStatus, readSequence } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

/** Sequência de hoje em diante, os vídeos prontos disponíveis (com a ficha da IA) e a última sincronização. */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  if (!(await requireClient(clientId))) return jsonError("Cliente não encontrado.", 404);
  const pool = await db();
  const [rows, ready, synced] = await Promise.all([
    readSequence(clientId, todaySP()),
    listAvailableReady(clientId),
    pool.query<{ at: string | null }>("select ready_synced_at::text as at from clients where id = $1", [clientId]),
  ]);
  return Response.json({
    rows,
    synced_at: synced.rows[0]?.at ?? null,
    profiling: profilingStatus(clientId),
    ready: ready.map((r) => ({
      id: r.id,
      title: r.title,
      folder: r.folder ?? "",
      theme: r.topic,
      summary: r.summary ?? "",
      pillar: r.pillar ?? "",
      audience: r.audience ?? "",
      hook: r.hook ?? "",
      caption_instagram: r.caption_instagram ?? "",
      caption_linkedin: r.caption_linkedin ?? "",
      drive_url: r.drive_url ?? "",
      flags: r.flags ?? [],
      profiled: !!r.profiled,
      has_transcript: r.transcript.trim().length > 0 || (r.suggested_caption ?? "").trim().length > 0,
    })),
  });
}
