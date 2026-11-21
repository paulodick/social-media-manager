// Conexão do perfil pessoal do LinkedIn por login OAuth (fluxo "authorization code", conferido na documentação
// oficial da LinkedIn em 2026-11-21):
//  1. /api/linkedin/conectar leva à janela de login do LinkedIn (com um "state" assinado).
//  2. O LinkedIn volta em /api/linkedin/callback com um "code".
//  3. O code vira um token de acesso (vale 60 dias; renovar sozinho só com aprovação especial da LinkedIn,
//     então o app avisa antes de vencer e a pessoa conecta de novo).
//  4. GET /v2/userinfo (scope openid + profile) devolve o identificador do membro (sub) e o nome.
// Produtos do app no portal da LinkedIn: "Share on LinkedIn" (w_member_social) e "Sign In with LinkedIn using OpenID Connect".
// LINKEDIN_OAUTH_BASE e LINKEDIN_API_BASE existem só para testes com um servidor falso.
import crypto from "node:crypto";
import { PublishError } from "./meta.ts";
import { appUrl } from "../signed-url.ts";

export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

export const oauthBase = () => (process.env.LINKEDIN_OAUTH_BASE || "https://www.linkedin.com").replace(/\/+$/, "");
export const apiBase = () => (process.env.LINKEDIN_API_BASE || "https://api.linkedin.com").replace(/\/+$/, "");

export type LinkedinConfig = { clientId: string; secret: string; redirectUri: string };

/** Configuração do app do LinkedIn, ou a frase que diz o que falta. */
export function linkedinConfig(): LinkedinConfig | { error: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  const base = appUrl();
  const faltam = [!clientId && "LINKEDIN_CLIENT_ID", !secret && "LINKEDIN_CLIENT_SECRET", !base && "APP_URL"].filter(Boolean);
  if (faltam.length) return { error: `O app do LinkedIn ainda não está configurado: faltam ${faltam.join(", ")} nas variáveis do Render.` };
  return { clientId: clientId as string, secret: secret as string, redirectUri: `${base}/api/linkedin/callback` };
}

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET precisa ter pelo menos 16 caracteres.");
  return s;
}

function stateSig(payload: string): string {
  return crypto.createHmac("sha256", stateSecret()).update("linkedin-state:" + payload).digest("hex");
}

/** "state" do OAuth: amarra a volta do LinkedIn ao cliente e ao navegador que começou (nonce no cookie). Vale 10 minutos. */
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

/** Endereço da janela de login do LinkedIn. O escopo vai separado por espaço (%20). */
export function authUrl(cfg: LinkedinConfig, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state });
  return `${oauthBase()}/oauth/v2/authorization?${q.toString()}&scope=${encodeURIComponent(LINKEDIN_SCOPES.join(" "))}`;
}

type Json = Record<string, unknown>;

/** Frase em português para um erro do LinkedIn (corpo no formato { status, code, message } ou { error, error_description }). */
export function explainLinkedinError(status: number, body: Json | undefined): string {
  const raw = String(body?.message ?? body?.error_description ?? body?.error ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
  const detail = raw ? ` Resposta do LinkedIn: "${raw}".` : "";
  if (status === 401) return "O acesso ao LinkedIn expirou ou foi revogado. Conecte de novo." + detail;
  if (status === 403) return "O LinkedIn recusou por falta de permissão. Confira se o app tem o produto \"Share on LinkedIn\" e conecte de novo." + detail;
  if (status === 429) return "O LinkedIn limitou as chamadas por enquanto. Tente de novo em alguns minutos.";
  if (status >= 500) return `O LinkedIn está com problema neste momento. Tente de novo em alguns minutos.${detail}`;
  return raw ? `O LinkedIn recusou: ${raw}` : `O LinkedIn recusou o pedido (código ${status || "desconhecido"}).`;
}

/** Troca o "code" da volta do login por um token de acesso. Os segredos vão no corpo do POST, não na URL. */
export async function exchangeCode(cfg: LinkedinConfig, code: string): Promise<{ token: string; expiresAt: Date }> {
  let res: Response;
  try {
    res = await fetch(`${oauthBase()}/oauth/v2/accessToken`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.secret,
        redirect_uri: cfg.redirectUri,
      }).toString(),
    });
  } catch {
    throw new PublishError("Não foi possível falar com o LinkedIn agora. Tente de novo em alguns minutos.");
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof body.access_token !== "string" || !body.access_token) {
    throw new PublishError(explainLinkedinError(res.status || 400, body));
  }
  const secs = Number(body.expires_in);
  // Sem expires_in, vale o padrão de 60 dias da LinkedIn.
  const expiresAt = new Date(Date.now() + (Number.isFinite(secs) && secs > 0 ? secs : 60 * 86400) * 1000);
  return { token: body.access_token, expiresAt };
}

/** Identificador (sub) e nome do membro que fez o login. O `sub` é o id usado em urn:li:person:{id}. */
export async function fetchMember(token: string): Promise<{ id: string; name: string }> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v2/userinfo`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new PublishError("Não foi possível falar com o LinkedIn agora. Tente de novo em alguns minutos.");
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof body.sub !== "string" || !body.sub) {
    throw new PublishError(
      res.ok
        ? "O LinkedIn não informou quem fez o login. Confira se o app tem o produto \"Sign In with LinkedIn using OpenID Connect\"."
        : explainLinkedinError(res.status, body),
    );
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : [body.given_name, body.family_name].filter((x) => typeof x === "string").join(" ").trim();
  return { id: body.sub, name: name || body.sub };
}
