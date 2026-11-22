import test from "node:test";
import assert from "node:assert/strict";
import { chunkPlan, publishTiktokDraft } from "../src/lib/publish/tiktok.ts";
import { authUrl, exchangeCode, explainTiktokError, fetchCreator, refreshAccess, revokeAccess, signState, verifyState } from "../src/lib/publish/tiktok-oauth.ts";
import { tiktokHealthFrom } from "../src/lib/publish/tiktok-health.ts";
import { PublishError, type MediaSource } from "../src/lib/publish/meta.ts";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockTiktok } from "./support/mock-tiktok.mjs";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

function media(kind: "video" | "image", size = 2048, publicUrl: string | null = null): MediaSource {
  const bytes = Buffer.alloc(size, 1);
  return { kind, size, publicUrl, open: async () => new Response(bytes) };
}
type Seen = { path: string; method: string; bytes: number; auth?: string; ctype?: string; clen?: string; crange?: string; body: Record<string, any>; form: Record<string, string>; query: Record<string, string> };

test("partes do vídeo do TikTok: uma parte até 20 MB; acima, partes de 10 MB e o resto na última", () => {
  assert.deepEqual(chunkPlan(1000), [1000]);
  assert.deepEqual(chunkPlan(20_000_000), [20_000_000]);
  assert.deepEqual(chunkPlan(25_000_000), [10_000_000, 15_000_000]);
  assert.deepEqual(chunkPlan(50_000_123), [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_123]);
  for (const size of [20_000_001, 33_333_333, 64_000_000, 200_000_000]) {
    const p = chunkPlan(size);
    assert.equal(p.reduce((a, b) => a + b, 0), size);
    assert.ok(p.slice(0, -1).every((n) => n >= 5_000_000 && n <= 64_000_000));
    assert.ok(p[p.length - 1] >= 5_000_000 && p[p.length - 1] <= 128_000_000);
  }
});

test("estado do login do TikTok: assinado, 10 minutos, amarrado ao cliente e ao navegador", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const id = "0f6b1e2c-1111-4222-8333-444455556666";
  const nonce = "n".repeat(24);
  const s = signState(id, nonce, now);
  assert.deepEqual(verifyState(s, now + 1000), { clientId: id, nonce });
  assert.equal(verifyState(s, now + 601_000), null);
  assert.equal(verifyState(s.slice(0, -2) + "00", now), null);
  assert.equal(verifyState("lixo", now), null);
  const url = authUrl({ clientKey: "CK", secret: "SEC", redirectUri: "https://app.test/api/tiktok/callback" }, s);
  assert.match(url, /^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize\/\?client_key=CK&scope=user\.info\.basic%2Cvideo\.upload&response_type=code/);
  assert.ok(!url.includes("SEC"));
  assert.ok(!url.includes("video.publish"), "publicação direta só depois da auditoria");
});

test("erros do TikTok viram frases que dizem o que fazer", () => {
  assert.match(explainTiktokError(401, { error: { code: "access_token_invalid", message: "x" } }), /Conecte de novo/);
  assert.match(explainTiktokError(400, { error: "invalid_grant", error_description: "expired" }), /Conecte de novo/);
  assert.match(explainTiktokError(401, { error: { code: "scope_not_authorized" } }), /Content Posting API/);
  assert.match(explainTiktokError(429, { error: { code: "rate_limit_exceeded" } }), /alguns minutos/);
  assert.match(explainTiktokError(403, { error: { code: "spam_risk_too_many_posts" } }), /excesso de envios/);
  process.env.APP_URL = "https://app.ebuks.com.br";
  assert.match(explainTiktokError(403, { error: { code: "url_ownership_unverified" } }), /verifique app\.ebuks\.com\.br/);
  assert.match(explainTiktokError(502, {}), /problema/);
  assert.match(explainTiktokError(400, { error: { code: "invalid_param", message: "Bad thing" } }), /O TikTok recusou: Bad thing/);
});

test("vencimento da autorização do TikTok: avisa 14 dias antes e depois de vencer", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const d = (days: number) => new Date(now + days * 86_400_000);
  assert.equal(tiktokHealthFrom(d(100), now).state, "ok");
  assert.equal(tiktokHealthFrom(d(10), now).state, "attention");
  assert.equal(tiktokHealthFrom(d(-1), now).state, "reconnect");
  assert.equal(tiktokHealthFrom(null, now).state, "unknown");
});

test("conecta, renova (token de renovação gira) e envia rascunhos contra o servidor de mentira", async () => {
  const m = await startMockTiktok(4051);
  process.env.TIKTOK_AUTH_BASE = "http://localhost:4051";
  process.env.TIKTOK_API_BASE = "http://localhost:4051";
  process.env.TIKTOK_POLL_MS = "5";
  process.env.TIKTOK_POLL_MAX = "5";
  const seen = m.seen as Seen[];
  try {
    const cfg = { clientKey: "CK", secret: "SEGREDO", redirectUri: "https://app.test/api/tiktok/callback" };
    // login: segredos no corpo, nunca na URL
    const t = await exchangeCode(cfg, "CODIGO_BOM");
    assert.equal(t.accessToken, "TT_ACESSO");
    assert.equal(t.refreshToken, "TT_RENOVA_1");
    assert.equal(t.openId, "open-123");
    assert.deepEqual(t.scopes, ["user.info.basic", "video.upload"]);
    assert.ok(t.accessExpiresAt.getTime() > Date.now() + 7000 * 1000 && t.accessExpiresAt.getTime() < Date.now() + 7300 * 1000);
    assert.ok(t.refreshExpiresAt.getTime() > Date.now() + 179 * 86_400_000);
    const tok = seen.find((s) => s.path === "/v2/oauth/token/")!;
    assert.equal(tok.form.client_secret, "SEGREDO");
    assert.equal(tok.form.client_key, "CK");
    assert.equal(tok.form.grant_type, "authorization_code");
    assert.deepEqual(await fetchCreator("TT_ACESSO"), { id: "open-123", name: "Best Medical Teste" });
    await assert.rejects(() => exchangeCode(cfg, "CODIGO_RUIM"), (e: Error) => e instanceof PublishError && /Conecte de novo/.test(e.message));
    await assert.rejects(() => fetchCreator("OUTRO"), /Conecte de novo/);

    // renovação: o token novo substitui o antigo; reusar o antigo falha
    const r1 = await refreshAccess(cfg, "TT_RENOVA_1");
    assert.equal(r1.accessToken, "TT_ACESSO_2");
    assert.equal(r1.refreshToken, "TT_RENOVA_2");
    await assert.rejects(() => refreshAccess(cfg, "TT_RENOVA_1"), /Conecte de novo/);
    await revokeAccess(cfg, "TT_ACESSO_2");
    assert.ok(seen.some((s) => s.path === "/v2/oauth/revoke/" && s.form.token === "TT_ACESSO_2"));

    // vídeo pequeno: uma parte só, com Content-Range e o tipo do arquivo; sem legenda no corpo
    seen.length = 0;
    const r = await publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "legenda", media: media("video", 2048), mime: "video/mp4" });
    assert.deepEqual(r, { id: "v_inbox_file~v2.123", url: "" });
    const init = seen.find((s) => s.path === "/v2/post/publish/inbox/video/init/")!;
    assert.equal(init.auth, "Bearer TT_ACESSO");
    assert.deepEqual(init.body, { source_info: { source: "FILE_UPLOAD", video_size: 2048, chunk_size: 2048, total_chunk_count: 1 } });
    const up = seen.filter((s) => s.path.startsWith("/upload/"));
    assert.equal(up.length, 1);
    assert.equal(up[0].method, "PUT");
    assert.equal(up[0].bytes, 2048);
    assert.equal(up[0].crange, "bytes 0-2047/2048");
    assert.equal(up[0].ctype, "video/mp4");
    assert.ok(!up[0].auth, "o endereço de envio já vem assinado");
    // espera o rascunho chegar antes de dar certo
    assert.ok(seen.filter((s) => s.path === "/v2/post/publish/status/fetch/").length >= 2);

    // vídeo de 25 MB: duas partes (10 MB + 15 MB), em ordem, cada uma com o Content-Range certo
    seen.length = 0;
    const size = 25_000_000;
    await publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "", media: media("video", size), mime: "video/quicktime" });
    const init2 = seen.find((s) => s.path === "/v2/post/publish/inbox/video/init/")!;
    assert.deepEqual(init2.body.source_info, { source: "FILE_UPLOAD", video_size: size, chunk_size: 10_000_000, total_chunk_count: 2 });
    const parts = seen.filter((s) => s.path.startsWith("/upload/"));
    assert.deepEqual(parts.map((p) => p.crange), ["bytes 0-9999999/25000000", "bytes 10000000-24999999/25000000"]);
    assert.deepEqual(parts.map((p) => p.bytes), [10_000_000, 15_000_000]);
    assert.ok(parts.every((p) => p.ctype === "video/quicktime"));

    // foto: endereço público do app, MEDIA_UPLOAD, título (1ª linha) e descrição (legenda inteira)
    seen.length = 0;
    const ph = await publishTiktokDraft({ format: "fotos", token: "TT_ACESSO", caption: "Primeira linha\nresto #tag", media: media("image", 100, "https://app.test/api/pub/abc") });
    assert.equal(ph.id, "p_inbox_url~v2.456");
    const pinit = seen.find((s) => s.path === "/v2/post/publish/content/init/")!;
    assert.deepEqual(pinit.body, {
      media_type: "PHOTO",
      post_mode: "MEDIA_UPLOAD",
      post_info: { title: "Primeira linha", description: "Primeira linha\nresto #tag" },
      source_info: { source: "PULL_FROM_URL", photo_images: ["https://app.test/api/pub/abc"], photo_cover_index: 0 },
    });
    // título de até 90 caracteres, contando emoji como um
    seen.length = 0;
    await publishTiktokDraft({ format: "fotos", token: "TT_ACESSO", caption: "🚀".repeat(120), media: media("image", 100, "https://app.test/api/pub/abc") });
    assert.equal(Array.from(seen.find((s) => s.path === "/v2/post/publish/content/init/")!.body.post_info.title).length, 90);

    // erros: etapa e frase em português
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_EXPIRADO", caption: "x", media: media("video"), mime: "video/mp4" }), (e: Error) => /Conecte de novo.*\(etapa: preparo do vídeo\)/.test(e.message));
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_SEM_ESCOPO", caption: "x", media: media("video"), mime: "video/mp4" }), /Content Posting API/);
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_LIMITE", caption: "x", media: media("video"), mime: "video/mp4" }), /alguns minutos/);
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_SPAM", caption: "x", media: media("video"), mime: "video/mp4" }), /excesso de envios/);
    await assert.rejects(() => publishTiktokDraft({ format: "fotos", token: "TT_ACESSO", caption: "x", media: media("image", 10, "https://app.test/NAO_VERIFICADO/a") }), /verifique/);
    await assert.rejects(() => publishTiktokDraft({ format: "fotos", token: "TT_ACESSO", caption: "x", media: media("image", 10, null) }), /APP_URL/);
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "x", media: media("image") }), /precisa de um arquivo de vídeo/);
    await assert.rejects(() => publishTiktokDraft({ format: "fotos", token: "TT_ACESSO", caption: "x", media: media("video") }), /precisa de uma imagem/);
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "x", media: media("video"), mime: "video/x-matroska" }), /MP4, MOV ou WebM/);
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "x", media: { ...media("video", 1000), size: 5000 }, mime: "video/mp4" }), /tamanho diferente/);
    // o TikTok recusa o arquivo depois do envio
    process.env.MOCK_TT_PUBLISH_ID = "v_FALHA";
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "x", media: media("video"), mime: "video/mp4" }), /não aceitou o envio: o formato do arquivo/);
    // e o que nunca termina de processar vira uma frase útil, sem ficar esperando para sempre
    process.env.MOCK_TT_PUBLISH_ID = "v_TRAVADO";
    await assert.rejects(() => publishTiktokDraft({ format: "video", token: "TT_ACESSO", caption: "x", media: media("video"), mime: "video/mp4" }), /caixa de entrada do TikTok/);
  } finally {
    delete process.env.MOCK_TT_PUBLISH_ID;
    for (const k of ["TIKTOK_AUTH_BASE", "TIKTOK_API_BASE", "TIKTOK_POLL_MS", "TIKTOK_POLL_MAX"]) delete process.env[k];
    await m.close();
  }
});
