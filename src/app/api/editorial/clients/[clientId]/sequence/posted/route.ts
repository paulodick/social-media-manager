import { jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { editorialAiConfigured } from "@/lib/editorial-ai";
import { isUuid } from "@/lib/editorial-rules";
import { markReadyPosted, startProfiling } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

/**
 * "Já foi postado" na lista de vídeos prontos (vídeo postado fora do app): a pasta vai para "Reels Postados",
 * o vídeo sai da lista e, se ele estava num rascunho da sequência, os rascunhos são reorganizados.
 */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  if (!(await requireClient(clientId))) return jsonError("Cliente não encontrado.", 404);
  const body = await readJsonBody<{ item_id?: string }>(req);
  const itemId = String(body?.item_id ?? "");
  if (!isUuid(itemId)) return jsonError("Vídeo inválido.", 400);
  const r = await markReadyPosted(clientId, itemId);
  if (!r.ok) return jsonError(r.error, 404);
  if (editorialAiConfigured()) startProfiling(clientId, { reorganize: true });
  return Response.json({ ok: true, warning: r.warning, reorganizing: editorialAiConfigured() });
}
