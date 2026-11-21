import { isAuthed } from "@/lib/auth";
import { getClientLogo } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await isAuthed())) return new Response("Não autorizado", { status: 401 });
  const { id } = await ctx.params;
  const logo = await getClientLogo(id);
  if (!logo) return new Response("Sem logotipo", { status: 404 });
  // A tela pede com ?v=<versão>, então o navegador pode guardar por bastante tempo.
  return new Response(new Uint8Array(logo.png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" },
  });
}
