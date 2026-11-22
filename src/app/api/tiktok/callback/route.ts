import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { saveTiktokConnection } from "@/lib/connections";
import { publicOrigin } from "@/lib/signed-url";
import { exchangeCode, fetchCreator, revokeAccess, tiktokConfig, verifyState } from "@/lib/publish/tiktok-oauth";

export const dynamic = "force-dynamic";

// Volta do TikTok. Confere o state (assinado, 10 min, mesmo navegador), troca o code e guarda a conta conectada.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  if (!(await isAuthed())) return go("/login");

  const jar = await cookies();
  const nonce = jar.get("smm_tiktok_nonce")?.value ?? null;
  if (nonce) jar.delete("smm_tiktok_nonce");
  const st = verifyState(url.searchParams.get("state") ?? "");
  if (!st || !nonce || st.nonce !== nonce) {
    return go("/?erro=" + encodeURIComponent("A conexão com o TikTok expirou ou não foi iniciada por aqui. Comece de novo."));
  }
  const edit = (k: "erro" | "ok" | "aviso", msg: string) => go(`/clientes/${st.clientId}/editar?${k}=${encodeURIComponent(msg)}`);

  if (url.searchParams.get("error")) return edit("erro", "A conexão foi cancelada no TikTok. Nada foi conectado.");
  const code = url.searchParams.get("code");
  if (!code) return edit("erro", "O TikTok não devolveu o código de acesso. Tente de novo.");
  const cfg = tiktokConfig();
  if ("error" in cfg) return edit("erro", cfg.error);

  try {
    const tokens = await exchangeCode(cfg, code);
    // O TikTok deixa a pessoa desmarcar permissões na tela de login: sem o envio de rascunho não há o que fazer aqui.
    if (!tokens.scopes.includes("video.upload")) {
      await revokeAccess(cfg, tokens.accessToken);
      return edit("erro", "Faltou a permissão de envio de vídeos (video.upload). Conecte de novo e mantenha todas as permissões marcadas.");
    }
    const creator = await fetchCreator(tokens.accessToken);
    await saveTiktokConnection(st.clientId, { id: creator.id, name: creator.name, tokens });
    const until = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(tokens.refreshExpiresAt);
    return edit("ok", `Conectado: TikTok de ${creator.name}. O app renova o acesso sozinho; a autorização vale até ${until}.`);
  } catch (e) {
    return edit("erro", e instanceof Error ? e.message : "Não foi possível conectar. Tente de novo.");
  }
}
