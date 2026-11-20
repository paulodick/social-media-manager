import { isAuthed } from "@/lib/auth";
import { driveConfigured, openMedia } from "@/lib/drive";
import { fileIsLinked } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await isAuthed())) return new Response("Não autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return new Response("Arquivo inválido", { status: 400 });
  // Só serve arquivos ligados a algum post, nunca qualquer arquivo que a conta de serviço consiga ler.
  const linked = await fileIsLinked(id);
  if (!linked) return new Response("Arquivo não encontrado", { status: 404 });
  if (!driveConfigured()) return new Response("Google Drive não configurado", { status: 503 });

  const upstream = await openMedia(id, req.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Não foi possível abrir o arquivo no Drive", { status: upstream.status === 404 ? 404 : 502 });
  }
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=300");
  const url = new URL(req.url);
  if (url.searchParams.get("download") === "1") {
    const name = (linked.name ?? "arquivo").replace(/[\r\n"]/g, "");
    headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
