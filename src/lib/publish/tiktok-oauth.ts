// Conexão do TikTok por login OAuth (Login Kit v2 + Content Posting API; documentação oficial conferida em 2026-11-21):
//  1. /api/tiktok/conectar leva à janela de login do TikTok (com um "state" assinado).
//  2. O TikTok volta em /api/tiktok/callback com um "code" (vale 5 minutos, uso único).
//  3. O code vira um token de acesso (poucas horas) e um token de renovação (meses). O token de renovação GIRA: cada
//     renovação devolve um novo e invalida o anterior, então quem renova precisa guardar o novo na hora (tiktok-token.ts).
//  4. GET /v2/user/info/ (escopo user.info.basic) devolve o nome da conta e o open_id.
// Escopos pedidos hoje: user.info.basic e video.upload (envio como rascunho para a caixa de entrada do TikTok, que não
// exige auditoria). "video.publish" (publicar direto) só depois que o app passar na auditoria do TikTok.
// TIKTOK_AUTH_BASE e TIKTOK_API_BASE existem só para testes com um servidor falso.
import crypto from "node:crypto";
import { PublishError } from "./meta.ts";
import { appUrl } from "../signed-url.ts";

export const TIKTOK_SCOPES = ["user.info.basic", "video.upload"];

export const authBase = () => (process.env.TIKTOK_AUTH_BASE || "https://www.tiktok.com").replace(/\/+$/, "");
export const apiBase = () => (process.env.TIKTOK_API_BASE || "https://open.tiktokapis.com").replace(/\/+$/, "");

export type TiktokConfig = { clientKey: string; secret: string; redirectUri: string };

/** Configuração do app do TikTok, ou a frase que diz o que falta. */
export function tiktokConfig(): TiktokConfig | { error: string } {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  const base = appUrl();
  const faltam = [!clientKey && "TIKTOK_CLIENT_KEY", !secret && "TIKTOK_CLIENT_SECRET", !base && "APP_URL"].filter(Boolean);
  if (faltam.length) return { error: `O app do TikTok ainda não está configurado: faltam ${faltam.join(", ")} nas variáveis do Render.` };
  return { clientKey: clientKey as string, secret: secret as string, redirectUri: `${base}/api/tiktok/callback` };
}

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET precisa ter pelo menos 16 caracteres.");
  return s;
}

function stateSig(payload: string): string {
  return crypto.createHmac("sha256", stateSecret()).update("tiktok-state:" + payload).digest("hex");
}

/** "state" do OAuth: amarra a volta do TikTok ao cliente e ao navegador que começou (nonce no cookie). Vale 10 minutos. */
export function signState(clientId: string, nonce: string, now = Date.now(), ttlSeconds = 600): string {
  const payload = `${clientId}.${Math.floor(now / 1000) + ttlSeconds}.${nonce}`;
  return `${payload}.${stateSig(payload)}`;
}

export function verifyState(state: string, now = Date.now()): { clientId: string; nonce: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [clientId, exp, nonce, given] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !/^\d+$/.test(exp) || !/^[A-Za-z0-9_-]{16,}$/.test(nonce)) return null;
  const want = stateSig(`${clientId}.${exp}.${nonce}`);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < now) return null;
  return { clientId, nonce };
}

export function newNonce(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/** Endereço da janela de login do TikTok. Os escopos vão separados por vírgula. */
export function authUrl(cfg: TiktokConfig, state: string): string {
  const q = new URLSearchParams({
    client_key: cfg.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${authBase()}/v2/auth/authorize/?${q.toString()}`;
}

type Json = Record<string, unknown>;

/** O TikTok responde erro de duas formas: { error: { code, message } } (API) e { error: "invalid_grant", error_description } (login). */
function errorParts(body: Json | undefined): { code: string; message: string } {
  const e = body?.error;
  if (e && typeof e === "object") {
    const o = e as Json;
    return { code: String(o.code ?? ""), message: String(o.message ?? "") };
  }
  return { code: typeof e === "string" ? e : "", message: String(body?.error_description ?? body?.message ?? "") };
}

/** A API do TikTok pode devolver 200 com error.code diferente de "ok". */
export function isTiktokOk(status: number, body: Json | undefined): boolean {
  const { code } = errorParts(body);
  return status >= 200 && status < 300 && (code === "" || code === "ok");
}

/** Frase em português para um erro do TikTok. */
export function explainTiktokError(status: number, body: Json | undefined): string {
  const { code, message } = errorParts(body);
  const raw = message.replace(/\s+/g, " ").trim().slice(0, 220);
  const detail = raw ? ` Resposta do TikTok: "${raw}".` : "";
  switch (code) {
    case "access_token_invalid":
    case "invalid_grant":
      return "O acesso ao TikTok expirou ou foi revogado. Conecte de novo." + detail;
    case "scope_not_authorized":
      return "O TikTok não liberou a permissão de envio (video.upload). Confira se o app tem o produto Content Posting API aprovado e conecte de novo." + detail;
    case "rate_limit_exceeded":
      return "O TikTok limitou as chamadas por enquanto. Tente de novo em alguns minutos.";
    case "spam_risk_too_many_posts":
      return "O TikTok bloqueou por excesso de envios nesta conta hoje. Tente de novo amanhã.";
    case "spam_risk_user_banned_from_posting":
      return "O TikTok bloqueou esta conta para novos posts." + detail;
    case "reached_active_user_cap":
      return "O app atingiu o limite diário de contas que podem postar pelo TikTok. Tente de novo amanhã.";
    case "url_ownership_unverified": {
      const host = appUrl()?.replace(/^https?:\/\//, "") ?? "o endereço do app";
      return `O TikTok só baixa fotos de um endereço verificado. No painel do TikTok para desenvolvedores, verifique ${host} em "Manage URL properties".`;
    }
    case "unaudited_client_can_only_post_to_private_accounts":
      return "O app ainda não foi auditado pelo TikTok, então só consegue postar em conta privada." + detail;
  }
  if (status === 401) return "O acesso ao TikTok expirou ou foi revogado. Conecte de novo." + detail;
  if (status === 429) return "O TikTok limitou as chamadas por enquanto. Tente de novo em alguns minutos.";
  if (status >= 500) return `O TikTok está com problema neste momento. Tente de novo em alguns minutos.${detail}`;
  return raw ? `O TikTok recusou: ${raw}` : `O TikTok recusou o pedido (código ${code || status || "desconhecido"}).`;
}

export type TiktokTokens = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scopes: string[];
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

async function tokenRequest(cfg: TiktokConfig, form: Record<string, string>): Promise<TiktokTokens> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v2/oauth/token/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
      // Os segredos vão no corpo do POST, nunca na URL.
      body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.secret, ...form }).toString(),
    });
  } catch {
    throw new PublishError("Não foi possível falar com o TikTok agora. Tente de novo em alguns minutos.");
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof body.access_token !== "string" || !body.access_token || typeof body.refresh_token !== "string") {
    throw new PublishError(explainTiktokError(res.status || 400, body));
  }
  const now = Date.now();
  const acc = Number(body.expires_in);
  const ref = Number(body.refresh_expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    openId: String(body.open_id ?? ""),
    scopes: String(body.scope ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    // Sem os prazos, assume o mais curto que a documentação cita (2 h de acesso, 180 dias de renovação).
    accessExpiresAt: new Date(now + (Number.isFinite(acc) && acc > 0 ? acc : 7200) * 1000),
    refreshExpiresAt: new Date(now + (Number.isFinite(ref) && ref > 0 ? ref : 180 * 86400) * 1000),
  };
}

/** Troca o "code" da volta do login pelos tokens. */
export function exchangeCode(cfg: TiktokConfig, code: string): Promise<TiktokTokens> {
  return tokenRequest(cfg, { code, grant_type: "authorization_code", redirect_uri: cfg.redirectUri });
}

/** Renova o acesso. O token de renovação devolvido SUBSTITUI o enviado (o antigo deixa de valer). */
export function refreshAccess(cfg: TiktokConfig, refreshToken: string): Promise<TiktokTokens> {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Revoga o acesso quando a pessoa desconecta. Melhor esforço: falhar aqui não impede desconectar. */
export async function revokeAccess(cfg: TiktokConfig, token: string): Promise<void> {
  try {
    await fetch(`${apiBase()}/v2/oauth/revoke/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.secret, token }).toString(),
    });
  } catch {
    /* sem rede ou TikTok fora do ar: a conexão local é removida do mesmo jeito */
  }
}

/** Nome exibido e open_id da conta que fez o login. */
export async function fetchCreator(token: string): Promise<{ id: string; name: string }> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v2/user/info/?fields=open_id,display_name`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new PublishError("Não foi possível falar com o TikTok agora. Tente de novo em alguns minutos.");
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!isTiktokOk(res.status, body)) throw new PublishError(explainTiktokError(res.status, body));
  const user = ((body.data as Json | undefined)?.user ?? {}) as Json;
  const id = typeof user.open_id === "string" ? user.open_id : "";
  if (!id) throw new PublishError("O TikTok não informou quem fez o login. Confira se o app tem o produto \"Login Kit\" com o escopo user.info.basic.");
  const name = typeof user.display_name === "string" && user.display_name.trim() ? user.display_name.trim() : id;
  return { id, name };
}
