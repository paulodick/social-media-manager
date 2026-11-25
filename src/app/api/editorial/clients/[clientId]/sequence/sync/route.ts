import { jsonError, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { syncContents } from "@/lib/editorial-sequence-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Sincronizar conteúdos": lê a pasta "Reels Editados" do cliente (cada subpasta com vídeo + transcrição vira ou
 * atualiza um item "Já gravado") e a IA faz a ficha dos vídeos novos ou com transcrição alterada.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  if (!(await requireClient(clientId))) return jsonError("Cliente não encontrado.", 404);
  return Response.json(await syncContents(clientId));
}
