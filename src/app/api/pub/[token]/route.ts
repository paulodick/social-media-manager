import { driveConfigured, openMedia } from "@/lib/drive";
import { fileIsLinked } from "@/lib/queries";
import { verifyMediaToken } from "@/lib/signed-url";

export const dynamic = "force-dynamic";

// Endereço temporário e assinado para a Meta baixar a mídia na hora de publicar. Não usa login:
// quem tem o endereço (e dentro do prazo) lê só aquele arquivo, e só se ele estiver ligado a um post.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  const id = verifyMediaToken(token);
  if (!id) return new Response("Link inválido ou vencido", { status: 403 });
  if (!(await fileIsLinked(id))) return new Response("Arquivo não encontrado", { status: 404 });
  if (!driveConfigured()) return new Response("Google Drive não configurado", { status: 503 });
  const upstream = await openMedia(id, req.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) return new Response("Não foi possível abrir o arquivo", { status: 502 });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}
