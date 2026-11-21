import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { setNonce } from "@/lib/meta-pending";
import { authUrl, metaConfig, newNonce, signState } from "@/lib/publish/meta-oauth";

export const dynamic = "force-dynamic";

// Começa a conexão: leva à janela de login da Meta. Exige login no app e um cliente válido.
export async function GET(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/login", origin));
  const clientId = new URL(req.url).searchParams.get("cliente") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.redirect(new URL("/", origin));
  const back = (msg: string) => NextResponse.redirect(new URL(`/clientes/${clientId}/editar?erro=${encodeURIComponent(msg)}`, origin));
  const cfg = metaConfig();
  if ("error" in cfg) return back(cfg.error);
  const nonce = newNonce();
  await setNonce(nonce);
  return NextResponse.redirect(authUrl(cfg, signState(clientId, nonce)));
}
