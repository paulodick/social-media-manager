import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { saveMetaConnections } from "@/lib/connections";
import { setPending, takeNonce } from "@/lib/meta-pending";
import { publicOrigin } from "@/lib/signed-url";
import { exchangeCode, listPages, metaConfig, verifyState } from "@/lib/publish/meta-oauth";

export const dynamic = "force-dynamic";

// Volta da Meta. Confere o state (assinado, 10 min, mesmo navegador), troca o code e conecta a Página.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  if (!(await isAuthed())) return go("/login");

  const nonce = await takeNonce();
  const st = verifyState(url.searchParams.get("state") ?? "");
  if (!st || !nonce || st.nonce !== nonce) {
    return go("/?erro=" + encodeURIComponent("A conexão com a Meta expirou ou não foi iniciada por aqui. Comece de novo."));
  }
  const edit = (k: "erro" | "ok" | "aviso", msg: string) => go(`/clientes/${st.clientId}/editar?${k}=${encodeURIComponent(msg)}`);

  if (url.searchParams.get("error")) return edit("erro", "A conexão foi cancelada na Meta. Nada foi conectado.");
  const code = url.searchParams.get("code");
  if (!code) return edit("erro", "A Meta não devolveu o código de acesso. Tente de novo.");
  const cfg = metaConfig();
  if ("error" in cfg) return edit("erro", cfg.error);

  try {
    const userToken = await exchangeCode(cfg, code);
    const pages = await listPages(userToken);
    if (pages.length === 0) {
      return edit("erro", "A Meta não liberou nenhuma Página. Na janela de login, marque a Página do cliente e o Instagram dela.");
    }
    if (pages.length > 1) {
      await setPending(st.clientId, userToken);
      return go(`/clientes/${st.clientId}/conectar-meta`);
    }
    const r = await saveMetaConnections(st.clientId, pages[0]);
    return r.instagram
      ? edit("ok", `Conectado: Página ${pages[0].name} e Instagram ${r.instagram}.`)
      : edit("aviso", `Página ${pages[0].name} conectada, mas ela não tem Instagram profissional ligado. Ligue o Instagram à Página e conecte de novo.`);
  } catch (e) {
    return edit("erro", e instanceof Error ? e.message : "Não foi possível conectar. Tente de novo.");
  }
}
