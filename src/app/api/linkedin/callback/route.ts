import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { saveLinkedinConnection } from "@/lib/connections";
import { publicOrigin } from "@/lib/signed-url";
import { exchangeCode, fetchMember, linkedinConfig, verifyState } from "@/lib/publish/linkedin-oauth";

export const dynamic = "force-dynamic";

// Volta do LinkedIn. Confere o state (assinado, 10 min, mesmo navegador), troca o code e guarda o perfil conectado.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  if (!(await isAuthed())) return go("/login");

  const jar = await cookies();
  const nonce = jar.get("smm_linkedin_nonce")?.value ?? null;
  if (nonce) jar.delete("smm_linkedin_nonce");
  const st = verifyState(url.searchParams.get("state") ?? "");
  if (!st || !nonce || st.nonce !== nonce) {
    return go("/?erro=" + encodeURIComponent("A conexão com o LinkedIn expirou ou não foi iniciada por aqui. Comece de novo."));
  }
  const edit = (k: "erro" | "ok" | "aviso", msg: string) => go(`/clientes/${st.clientId}/editar?${k}=${encodeURIComponent(msg)}`);

  if (url.searchParams.get("error")) return edit("erro", "A conexão foi cancelada no LinkedIn. Nada foi conectado.");
  const code = url.searchParams.get("code");
  if (!code) return edit("erro", "O LinkedIn não devolveu o código de acesso. Tente de novo.");
  const cfg = linkedinConfig();
  if ("error" in cfg) return edit("erro", cfg.error);

  try {
    const { token, expiresAt } = await exchangeCode(cfg, code);
    const member = await fetchMember(token);
    await saveLinkedinConnection(st.clientId, { id: member.id, name: member.name, token, expiresAt });
    const until = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(expiresAt);
    return edit("ok", `Conectado: LinkedIn de ${member.name}. O acesso vale até ${until}; o app avisa antes de vencer.`);
  } catch (e) {
    return edit("erro", e instanceof Error ? e.message : "Não foi possível conectar. Tente de novo.");
  }
}
