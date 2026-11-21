import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { publicOrigin } from "@/lib/signed-url";
import { authUrl, linkedinConfig, newNonce, signState } from "@/lib/publish/linkedin-oauth";

export const dynamic = "force-dynamic";

// Começa a conexão: leva à janela de login do LinkedIn. Exige login no app e um cliente válido.
export async function GET(req: Request): Promise<Response> {
  const origin = publicOrigin(req);
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/login", origin));
  const clientId = new URL(req.url).searchParams.get("cliente") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.redirect(new URL("/", origin));
  const back = (msg: string) => NextResponse.redirect(new URL(`/clientes/${clientId}/editar?erro=${encodeURIComponent(msg)}`, origin));
  const cfg = linkedinConfig();
  if ("error" in cfg) return back(cfg.error);
  const nonce = newNonce();
  (await cookies()).set("smm_linkedin_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return NextResponse.redirect(authUrl(cfg, signState(clientId, nonce)));
}
