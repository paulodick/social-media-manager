import { todaySP } from "@/lib/dates";
import { jsonError, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { listAvailableReady, readSequence } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

/** Sequência de hoje em diante e quantos vídeos prontos ainda estão disponíveis. */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  if (!(await requireClient(clientId))) return jsonError("Cliente não encontrado.", 404);
  const [rows, ready] = await Promise.all([readSequence(clientId, todaySP()), listAvailableReady(clientId)]);
  return Response.json({
    rows,
    ready: ready.map((r) => ({ id: r.id, title: r.title, has_transcript: r.transcript.trim().length > 0 })),
  });
}
