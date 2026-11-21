import test from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "../src/lib/crypto.ts";
import { signMediaToken, verifyMediaToken } from "../src/lib/signed-url.ts";
import { explainMetaError, publishToMeta, PublishError, type MediaSource } from "../src/lib/publish/meta.ts";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockMeta } from "./support/mock-meta.mjs";

process.env.TOKEN_ENC_KEY = "chave-de-teste-com-mais-de-16";
process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

test("token criptografado vai e volta, e não aparece em texto", () => {
  const enc = encryptToken("EAAB-token-secreto");
  assert.ok(!enc.includes("EAAB"));
  assert.equal(decryptToken(enc), "EAAB-token-secreto");
  assert.notEqual(encryptToken("x"), encryptToken("x")); // iv novo a cada vez
  process.env.TOKEN_ENC_KEY = "outra-chave-completamente-diferente";
  assert.throws(() => decryptToken(enc), /TOKEN_ENC_KEY mudou/);
  process.env.TOKEN_ENC_KEY = "chave-de-teste-com-mais-de-16";
});

test("link assinado de mídia vence, não aceita adulteração e é só do arquivo", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const t = signMediaToken("ARQUIVO0123456789", 60, now);
  assert.equal(verifyMediaToken(t, now + 30_000), "ARQUIVO0123456789");
  assert.equal(verifyMediaToken(t, now + 61_000), null);
  assert.equal(verifyMediaToken(t.replace("ARQUIVO0123456789", "OUTROARQ0123456789"), now), null);
  assert.equal(verifyMediaToken(t.slice(0, -2) + "00", now), null);
  assert.equal(verifyMediaToken("lixo", now), null);
});

test("erros da Meta viram frases que dizem o que fazer", () => {
  assert.match(explainMetaError({ code: 190, message: "x" }), /Conecte a conta de novo/);
  assert.match(explainMetaError({ code: 200, message: "x" }), /permissão/);
  assert.match(explainMetaError({ code: 200, error_subcode: 2108006, message: "Requires instagram_content_publish" }), /Resposta da Meta: código 200, subcódigo 2108006, "Requires instagram_content_publish"/);
  assert.match(explainMetaError({ code: 613, message: "x" }), /alguns minutos/);
  assert.match(explainMetaError({ code: 100, message: "Invalid parameter" }), /A Meta recusou: Invalid parameter/);
  assert.match(explainMetaError(undefined, 502), /problema/);
});

function media(kind: "video" | "image", url: string | null = "http://app.test/api/pub/x"): MediaSource {
  const bytes = Buffer.alloc(2048, 1);
  return { kind, size: bytes.length, publicUrl: url, open: async () => new Response(bytes) };
}

test("publica no Instagram e no Facebook contra o servidor de mentira", async () => {
  const m = await startMockMeta(4021);
  process.env.META_GRAPH_BASE = "http://localhost:4021";
  process.env.META_POLL_MS = "5";
  try {
    // Reels: container resumable, envio do arquivo, espera, publica, link
    let r = await publishToMeta({ network: "instagram", format: "reels", accountId: "IG1", token: "TK", caption: "Legenda #um", media: media("video") });
    assert.match(r.url, /instagram\.com\/reel\//);
    const up = m.seen.find((s: { path: string }) => s.path.startsWith("/upload/ig/"));
    assert.equal(up.auth, "OAuth TK");
    assert.equal(up.offset, "0");
    assert.equal(up.file_size, "2048");
    assert.equal(up.bytes, 2048);
    const create = m.seen.find((s: { path: string; body: { upload_type?: string } }) => s.path.endsWith("/IG1/media") && s.body.upload_type);
    assert.deepEqual(create.body, { media_type: "REELS", upload_type: "resumable", caption: "Legenda #um" });
    assert.equal(create.auth, "Bearer TK");

    // Stories de imagem: sem legenda, com endereço público
    m.seen.length = 0;
    await publishToMeta({ network: "instagram", format: "stories", accountId: "IG1", token: "TK", caption: "não vai", media: media("image") });
    assert.deepEqual(m.seen.find((s: { path: string }) => s.path.endsWith("/IG1/media")).body, { image_url: "http://app.test/api/pub/x", media_type: "STORIES" });

    // Feed com vídeo sai como Reels; feed com imagem leva legenda
    m.seen.length = 0;
    await publishToMeta({ network: "instagram", format: "feed", accountId: "IG1", token: "TK", caption: "c", media: media("video") });
    assert.equal(m.seen.find((s: { path: string }) => s.path.endsWith("/IG1/media")).body.media_type, "REELS");
    m.seen.length = 0;
    await publishToMeta({ network: "instagram", format: "feed", accountId: "IG1", token: "TK", caption: "Foto #um", media: media("image") });
    assert.equal(m.seen.find((s: { path: string }) => s.path.endsWith("/IG1/media")).body.caption, "Foto #um");

    // Facebook Reels: start, envio, finish com descrição
    m.seen.length = 0;
    r = await publishToMeta({ network: "facebook", format: "reels", accountId: "PG1", token: "TK", caption: "Descrição", media: media("video") });
    assert.match(r.url, /facebook\.com\/reel\/V/);
    const phases = m.seen.filter((s: { path: string }) => s.path.endsWith("/PG1/video_reels")).map((s: { body: { upload_phase: string } }) => s.body.upload_phase);
    assert.deepEqual(phases, ["start", "finish"]);
    assert.equal(m.seen.find((s: { path: string; body: { upload_phase?: string } }) => s.body.upload_phase === "finish").body.description, "Descrição");

    // Facebook Stories de foto: sobe sem publicar e vira story
    m.seen.length = 0;
    await publishToMeta({ network: "facebook", format: "stories", accountId: "PG1", token: "TK", caption: "", media: media("image") });
    assert.equal(m.seen.find((s: { path: string }) => s.path.endsWith("/PG1/photos")).body.published, false);
    assert.ok(m.seen.some((s: { path: string }) => s.path.endsWith("/PG1/photo_stories")));

    // Facebook feed: foto e vídeo por endereço
    m.seen.length = 0;
    await publishToMeta({ network: "facebook", format: "feed", accountId: "PG1", token: "TK", caption: "Foto", media: media("image") });
    await publishToMeta({ network: "facebook", format: "feed", accountId: "PG1", token: "TK", caption: "Vídeo", title: "T", media: media("video") });
    assert.equal(m.seen.find((s: { path: string }) => s.path.endsWith("/PG1/photos")).body.caption, "Foto");
    assert.equal(m.seen.find((s: { path: string }) => s.path.endsWith("/PG1/videos")).body.file_url, "http://app.test/api/pub/x");

    // Erros: token vencido, sem permissão, recusa com mensagem, imagem sem APP_URL, Reels sem vídeo
    await assert.rejects(publishToMeta({ network: "instagram", format: "reels", accountId: "IG1", token: "TOKEN_EXPIRADO", caption: "", media: media("video") }), /Conecte a conta de novo/);
    await assert.rejects(publishToMeta({ network: "facebook", format: "feed", accountId: "PG1", token: "TOKEN_SEM_PERMISSAO", caption: "", media: media("image") }), /permissão/);
    await assert.rejects(publishToMeta({ network: "instagram", format: "feed", accountId: "IG1", token: "TK", caption: "FALHAR", media: media("image") }), /A legenda tem um problema de teste/);
    await assert.rejects(publishToMeta({ network: "instagram", format: "feed", accountId: "IG1", token: "TK", caption: "", media: media("image", null) }), (e: Error) => e instanceof PublishError && /APP_URL/.test(e.message));
    await assert.rejects(publishToMeta({ network: "facebook", format: "reels", accountId: "PG1", token: "TK", caption: "", media: media("image") }), /precisam de um vídeo/);
  } finally {
    await m.close();
    delete process.env.META_GRAPH_BASE;
    delete process.env.META_POLL_MS;
  }
});

// ---------- conexão das contas (OAuth) ----------
import { authUrl, exchangeCode, listPages, metaConfig, signState, verifyState, META_SCOPES } from "../src/lib/publish/meta-oauth.ts";

const CLIENTE = "0b9a1d5e-1c2b-4f3a-8d6e-123456789abc";
const NONCE = "nonce-de-teste-1234567890";

test("state do login: vale 10 minutos, amarra ao cliente e ao navegador, não aceita adulteração", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const s = signState(CLIENTE, NONCE, now);
  assert.deepEqual(verifyState(s, now + 5 * 60_000), { clientId: CLIENTE, nonce: NONCE });
  assert.equal(verifyState(s, now + 11 * 60_000), null);
  assert.equal(verifyState(s.replace(CLIENTE, "ffffffff-1c2b-4f3a-8d6e-123456789abc"), now), null);
  assert.equal(verifyState(s.replace(NONCE, "outro-nonce-1234567890"), now), null);
  assert.equal(verifyState(s.slice(0, -2) + "00", now), null);
  assert.equal(verifyState("lixo", now), null);
});

test("configuração do app da Meta diz o que falta e monta o endereço de login", () => {
  const old = { id: process.env.META_APP_ID, sec: process.env.META_APP_SECRET, url: process.env.APP_URL, cfg: process.env.META_LOGIN_CONFIG_ID };
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET; delete process.env.APP_URL; delete process.env.META_LOGIN_CONFIG_ID;
  const falta = metaConfig();
  assert.ok("error" in falta && /META_APP_ID, META_APP_SECRET, APP_URL/.test(falta.error));
  process.env.META_APP_ID = "123"; process.env.META_APP_SECRET = "segredo-do-app"; process.env.APP_URL = "https://app.exemplo.com.br/";
  const cfg = metaConfig();
  assert.ok(!("error" in cfg));
  if ("error" in cfg) return;
  assert.equal(cfg.redirectUri, "https://app.exemplo.com.br/api/meta/callback");
  const u = new URL(authUrl(cfg, "STATE"));
  assert.equal(u.hostname, "www.facebook.com");
  assert.equal(u.searchParams.get("client_id"), "123");
  assert.equal(u.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(u.searchParams.get("state"), "STATE");
  assert.equal(u.searchParams.get("scope"), META_SCOPES.join(","));
  assert.ok(META_SCOPES.includes("instagram_content_publish") && !META_SCOPES.some((x) => x.endsWith("publishing"))); // nome certo da permissão
  assert.ok(!u.toString().includes("segredo-do-app")); // o segredo nunca vai na URL
  process.env.META_LOGIN_CONFIG_ID = "999";
  const u2 = new URL(authUrl(cfg, "STATE"));
  assert.equal(u2.searchParams.get("config_id"), "999");
  assert.equal(u2.searchParams.get("scope"), null);
  assert.equal(u2.searchParams.get("response_type"), "code");
  assert.equal(u2.searchParams.get("override_default_response_type"), "true");
  for (const [k, v] of Object.entries({ META_APP_ID: old.id, META_APP_SECRET: old.sec, APP_URL: old.url, META_LOGIN_CONFIG_ID: old.cfg })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("troca o code por token de longa duração e lista as Páginas com o Instagram ligado", async () => {
  const m = await startMockMeta(4022);
  process.env.META_GRAPH_BASE = "http://localhost:4022";
  try {
    const cfg = { appId: "123", secret: "segredo-do-app", redirectUri: "https://app.exemplo.com.br/api/meta/callback" };
    const userToken = await exchangeCode(cfg, "CODIGO_BOM");
    assert.equal(userToken, "USER_LONGO");
    const calls = m.seen.filter((c: { path: string }) => c.path.endsWith("/oauth/access_token"));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].form.code, "CODIGO_BOM");
    assert.equal(calls[0].form.client_secret, "segredo-do-app"); // vai no corpo do POST
    assert.deepEqual(calls[0].query, {}); // e não na URL
    assert.equal(calls[1].form.grant_type, "fb_exchange_token");
    assert.equal(calls[1].form.fb_exchange_token, "USER_CURTO");

    const pages = await listPages(userToken);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].id, "1111");
    assert.equal(pages[0].token, "PAGE_TOKEN_BM");
    assert.deepEqual(pages[0].ig, { id: "17841400", username: "best_teste" });

    // Página sem Instagram ligado
    await fetch("http://localhost:4022/_pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ id: "2222", name: "Canal", access_token: "PT2" }]) });
    const semIg = await listPages(userToken);
    assert.equal(semIg[0].ig, null);

    // code já usado vira frase em português
    await assert.rejects(() => exchangeCode(cfg, "CODIGO_RUIM"), (e: Error) => e instanceof PublishError && /A Meta recusou: This authorization code has been used/.test(e.message));
    // token de usuário inválido
    await assert.rejects(() => listPages("TOKEN_QUALQUER"), /Conecte a conta de novo/);
  } finally {
    delete process.env.META_GRAPH_BASE;
    await m.close();
  }
});

import { publicOrigin } from "../src/lib/signed-url.ts";

test("endereço público para redirecionar: usa APP_URL ou o que o proxy repassa, nunca o localhost interno", () => {
  const old = process.env.APP_URL;
  delete process.env.APP_URL;
  const req = (headers: Record<string, string>) => new Request("https://localhost:10000/api/meta/conectar", { headers });
  assert.equal(publicOrigin(req({ "x-forwarded-host": "app.ebuks.com.br", "x-forwarded-proto": "https" })), "https://app.ebuks.com.br");
  assert.equal(publicOrigin(req({ "x-forwarded-host": "app.ebuks.com.br, interno", "x-forwarded-proto": "https, http" })), "https://app.ebuks.com.br");
  assert.equal(publicOrigin(req({})), "https://localhost:10000");
  process.env.APP_URL = "https://app.ebuks.com.br/";
  assert.equal(publicOrigin(req({ "x-forwarded-host": "outro.com" })), "https://app.ebuks.com.br");
  if (old === undefined) delete process.env.APP_URL; else process.env.APP_URL = old;
});
