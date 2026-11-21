// Conexão das contas da Meta (Facebook Página + Instagram profissional) por login OAuth.
// Fluxo (conferido na documentação oficial em 2026-11-21):
//  1. /api/meta/conectar leva a pessoa à janela de login da Meta (com um "state" assinado).
//  2. A Meta volta em /api/meta/callback com um "code".
//  3. Troca o code por um token de usuário e depois por um token de longa duração.
//  4. Com o token de longa duração, /me/accounts devolve cada Página com o token da própria Página
//     (que não vence) e o Instagram profissional ligado a ela. Esses tokens é que ficam guardados.
// META_GRAPH_BASE existe só para testes com um servidor falso.
import crypto from "node:crypto";
import { explainMetaError, graphBase, graphVersion, PublishError } from "./meta.ts";
import { appUrl } from "../signed-url.ts";

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publishing",
  "business_management",
];

export type MetaPage = {
  id: string;
  name: string;
  /** Token da Página (nunca vai para a tela nem para o log). */
  token: string;
  ig: { id: string; username: string } | null;
};

export type MetaConfig = { appId: string; secret: string; redirectUri: string };

/** Configuração do app da Meta, ou a frase que diz o que falta. */
export function metaConfig(): MetaConfig | { error: string } {
  const appId = process.env.META_APP_ID?.trim();
  const secret = process.env.META_APP_SECRET?.trim();
  const base = appUrl();
  const faltam = [!appId && "META_APP_ID", !secret && "META_APP_SECRET", !base && "APP_URL"].filter(Boolean);
  if (faltam.length) return { error: `O app da Meta ainda não está configurado: faltam ${faltam.join(", ")} nas variáveis do Render.` };
  return { appId: appId as string, secret: secret as string, redirectUri: `${base}/api/meta/callback` };
}

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET precisa ter pelo menos 16 caracteres.");
  return s;
}

function stateSig(payload: string): string {
  return crypto.createHmac("sha256", stateSecret()).update("meta-state:" + payload).digest("hex");
}

/** "state" do OAuth: amarra a volta da Meta ao cliente e ao navegador que começou (nonce no cookie). Vale 10 minutos. */
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

/** Endereço da janela de login da Meta. Com META_LOGIN_CONFIG_ID (Login do Facebook para Empresas) usa a configuração em vez de scope. */
export function authUrl(cfg: MetaConfig, state: string): string {
  const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, state, response_type: "code" });
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (configId) q.set("config_id", configId);
  else q.set("scope", META_SCOPES.join(","));
  return `https://www.facebook.com/${graphVersion()}/dialog/oauth?${q.toString()}`;
}

type Json = Record<string, unknown>;

async function graph(path: string, init: RequestInit): Promise<Json> {
  const res = await fetch(`${graphBase()}/${graphVersion()}/${path}`, init);
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || body.error) {
    throw new PublishError(explainMetaError(body.error as Parameters<typeof explainMetaError>[0], res.status));
  }
  return body;
}

// Os segredos vão no corpo do POST (não na URL), para não aparecerem em registros de acesso.
async function tokenRequest(params: Record<string, string>): Promise<string> {
  const body = await graph("oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const t = body.access_token;
  if (typeof t !== "string" || !t) throw new PublishError("A Meta não devolveu o acesso. Tente conectar de novo.");
  return t;
}

/** Troca o "code" da volta do login por um token de usuário de longa duração. */
export async function exchangeCode(cfg: MetaConfig, code: string): Promise<string> {
  const short = await tokenRequest({ client_id: cfg.appId, client_secret: cfg.secret, redirect_uri: cfg.redirectUri, code });
  // Os tokens de Página só não vencem se vierem de um token de usuário de longa duração.
  return tokenRequest({ grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.secret, fb_exchange_token: short });
}

/** Páginas que a pessoa liberou no login, cada uma com o token da Página e o Instagram profissional ligado. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const body = await graph("me/accounts?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&limit=100", {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const data = Array.isArray(body.data) ? (body.data as Json[]) : [];
  const pages: MetaPage[] = [];
  for (const p of data) {
    if (typeof p.id !== "string" || typeof p.access_token !== "string") continue;
    const ig = p.instagram_business_account as { id?: unknown; username?: unknown } | undefined;
    pages.push({
      id: p.id,
      name: typeof p.name === "string" ? p.name : p.id,
      token: p.access_token,
      ig: ig && typeof ig.id === "string" ? { id: ig.id, username: typeof ig.username === "string" ? ig.username : "" } : null,
    });
  }
  return pages;
}
