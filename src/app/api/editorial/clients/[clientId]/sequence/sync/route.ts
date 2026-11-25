import { jsonError, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { syncReadyVideos } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";

/** Lê a pasta "Reels Editados" do cliente: cada subpasta (vídeo + transcrição) vira ou atualiza um item "Já gravado". */
export async function POST(_req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  if (!(await requireClient(clientId))) return jsonError("Cliente não encontrado.", 404);
  return Response.json(await syncReadyVideos(clientId));
}
