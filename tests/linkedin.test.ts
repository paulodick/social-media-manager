import test from "node:test";
import assert from "node:assert/strict";
import { escapeCommentary, publishLinkedin } from "../src/lib/publish/linkedin.ts";
import { authUrl, exchangeCode, explainLinkedinError, fetchMember, signState, verifyState } from "../src/lib/publish/linkedin-oauth.ts";
import { linkedinHealthFrom } from "../src/lib/publish/linkedin-health.ts";
import { PublishError, type MediaSource } from "../src/lib/publish/meta.ts";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockLinkedin } from "./support/mock-linkedin.mjs";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

function media(kind: "video" | "image", size = 2048): MediaSource {
  const bytes = Buffer.alloc(size, 1);
  return { kind, size, publicUrl: null, open: async () => new Response(bytes) };
}

test("texto do LinkedIn: caracteres reservados levam barra; hashtag fica como hashtag", () => {
  assert.equal(escapeCommentary("Plantão 24h (WhatsApp) #BestMedical #Diagnostico_Imagem"), "Plantão 24h \\(WhatsApp\\) #BestMedical #Diagnostico\\_Imagem");
  assert.equal(escapeCommentary("C# e @maria [1] {x} <b> a|b *a* ~ \\"), "C\\# e \\@maria \\[1\\] \\{x\\} \\<b\\> a\\|b \\*a\\* \\~ \\\\");
  assert.equal(escapeCommentary("#primeira\nlinha #segunda"), "#primeira\nlinha #segunda");
  assert.equal(escapeCommentary("sem nada especial, só acentuação: ação e emoji 🚀"), "sem nada especial, só acentuação: ação e emoji 🚀");
});

test("estado do login do LinkedIn: assinado, 10 minutos, amarrado ao cliente e ao navegador", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const id = "0f6b1e2c-1111-4222-8333-444455556666";
  const nonce = "n".repeat(24);
  const s = signState(id, nonce, now);
  assert.deepEqual(verifyState(s, now + 1000), { clientId: id, nonce });
  assert.equal(verifyState(s, now + 601_000), null);
  assert.equal(verifyState(s.slice(0, -2) + "00", now), null);
  assert.equal(verifyState("lixo", now), null);
  process.env.LINKEDIN_CLIENT_ID = "CID";
  const url = authUrl({ clientId: "CID", secret: "SEC", redirectUri: "https://app.test/api/linkedin/callback" }, s);
  assert.match(url, /^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?response_type=code&client_id=CID/);
  assert.match(url, /scope=openid%20profile%20w_member_social$/);
  assert.ok(!url.includes("SEC"));
});

test("erros do LinkedIn viram frases que dizem o que fazer", () => {
  assert.match(explainLinkedinError(401, { message: "expired" }), /Conecte de novo/);
  assert.match(explainLinkedinError(403, { message: "Not enough permissions" }), /Share on LinkedIn/);
  assert.match(explainLinkedinError(429, {}), /alguns minutos/);
  assert.match(explainLinkedinError(502, {}), /problema/);
  assert.match(explainLinkedinError(422, { message: "Invalid commentary" }), /O LinkedIn recusou: Invalid commentary/);
});

test("vencimento do acesso do LinkedIn: avisa 7 dias antes e depois de vencer", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const d = (days: number) => new Date(now + days * 86_400_000);
  assert.equal(linkedinHealthFrom(d(40), now).state, "ok");
  assert.equal(linkedinHealthFrom(d(3), now).state, "attention");
  assert.equal(linkedinHealthFrom(d(-1), now).state, "reconnect");
  assert.equal(linkedinHealthFrom(null, now).state, "unknown");
});

test("conecta e publica no LinkedIn contra o servidor de mentira", async () => {
  const m = await startMockLinkedin(4041);
  process.env.LINKEDIN_OAUTH_BASE = "http://localhost:4041";
  process.env.LINKEDIN_API_BASE = "http://localhost:4041";
  process.env.LINKEDIN_POLL_MS = "5";
  try {
    // login: segredos no corpo, nunca na URL
    const cfg = { clientId: "CID", secret: "SEGREDO", redirectUri: "https://app.test/api/linkedin/callback" };
    const t = await exchangeCode(cfg, "CODIGO_BOM");
    assert.equal(t.token, "LI_TOKEN");
    assert.ok(t.expiresAt.getTime() > Date.now() + 59 * 86_400_000);
    const tok = m.seen.find((s: { path: string }) => s.path === "/oauth/v2/accessToken");
    assert.equal(tok.form.client_secret, "SEGREDO");
    assert.equal(tok.form.grant_type, "authorization_code");
    assert.deepEqual(await fetchMember("LI_TOKEN"), { id: "abc123XYZ", name: "Paulo Teste" });
    await assert.rejects(() => exchangeCode(cfg, "CODIGO_RUIM"), (e: Error) => e instanceof PublishError && /authorization code not found/.test(e.message));
    await assert.rejects(() => fetchMember("OUTRO"), /Conecte de novo/);

    // texto
    m.seen.length = 0;
    const r = await publishLinkedin({ format: "feed", personId: "abc123XYZ", token: "LI_TOKEN", caption: "Olá (mundo) #BestMedical", media: null });
    assert.equal(r.id, "urn:li:share:7000000000000000001");
    assert.equal(r.url, "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/");
    const post = m.seen.find((s: { path: string }) => s.path === "/rest/posts");
    assert.equal(post.auth, "Bearer LI_TOKEN");
    assert.match(post.version, /^\d{6}$/);
    assert.equal(post.restli, "2.0.0");
    assert.deepEqual(post.body, {
      author: "urn:li:person:abc123XYZ",
      commentary: "Olá \\(mundo\\) #BestMedical",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });

    // imagem
    m.seen.length = 0;
    await publishLinkedin({ format: "feed", personId: "abc123XYZ", token: "LI_TOKEN", caption: "Foto", media: media("image", 3000) });
    const init = m.seen.find((s: { path: string }) => s.path === "/rest/images");
    assert.deepEqual(init.body, { initializeUploadRequest: { owner: "urn:li:person:abc123XYZ" } });
    const put = m.seen.find((s: { path: string }) => s.path === "/dms/img/1");
    assert.equal(put.method, "PUT");
    assert.equal(put.bytes, 3000);
    assert.equal(put.auth, "Bearer LI_TOKEN");
    assert.deepEqual(m.seen.find((s: { path: string }) => s.path === "/rest/posts").body.content, { media: { id: "urn:li:image:IMG1" } });

    // vídeo em 3 partes de até 4 MB (9 MB): ETags voltam na ordem, partes sem cabeçalho de acesso
    m.seen.length = 0;
    const size = 9 * 1024 * 1024;
    await publishLinkedin({ format: "video", personId: "abc123XYZ", token: "LI_TOKEN", caption: "Vídeo", media: media("video", size) });
    const vinit = m.seen.find((s: { path: string; action: string }) => s.path === "/rest/videos" && s.action === "initializeUpload");
    assert.deepEqual(vinit.body.initializeUploadRequest, { owner: "urn:li:person:abc123XYZ", fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false });
    const parts = m.seen.filter((s: { path: string }) => s.path.startsWith("/dms/vid/"));
    assert.deepEqual(parts.map((p: { bytes: number }) => p.bytes), [4194304, 4194304, size - 2 * 4194304]);
    assert.ok(parts.every((p: { auth?: string; ctype: string }) => !p.auth && p.ctype === "application/octet-stream"));
    const fin = m.seen.find((s: { action: string }) => s.action === "finalizeUpload");
    assert.deepEqual(fin.body.finalizeUploadRequest, { video: "urn:li:video:VID1", uploadToken: "TOK1", uploadedPartIds: ["etag-1", "etag-2", "etag-3"] });
    assert.deepEqual(m.seen.find((s: { path: string }) => s.path === "/rest/posts").body.content, { media: { id: "urn:li:video:VID1" } });
    // o post só sai depois do vídeo ficar disponível
    const order = m.seen.map((s: { path: string }) => s.path);
    assert.ok(order.lastIndexOf("/rest/posts") > order.findIndex((p: string) => p.startsWith("/rest/videos/")));

    // erros: etapa e frase em português
    await assert.rejects(() => publishLinkedin({ format: "feed", personId: "x", token: "LI_TOKEN", caption: "FALHAR", media: null }), (e: Error) => /O LinkedIn recusou: Invalid commentary for test \(etapa: publicação do post\)/.test(e.message));
    await assert.rejects(() => publishLinkedin({ format: "feed", personId: "x", token: "LI_EXPIRADO", caption: "x", media: null }), /Conecte de novo/);
    await assert.rejects(() => publishLinkedin({ format: "feed", personId: "x", token: "LI_SEM_PERMISSAO", caption: "x", media: null }), /Share on LinkedIn/);
    await assert.rejects(() => publishLinkedin({ format: "video", personId: "x", token: "LI_TOKEN", caption: "x", media: null }), /precisa de um arquivo de vídeo/);
    await assert.rejects(() => publishLinkedin({ format: "documento", personId: "x", token: "LI_TOKEN", caption: "x", media: null }), /manualmente/);
    // o arquivo do Drive vem menor do que o informado: não publica
    await assert.rejects(() => publishLinkedin({ format: "video", personId: "x", token: "LI_TOKEN", caption: "x", media: { ...media("video", 1000), size: 5000 } }), /tamanho diferente/);
  } finally {
    for (const k of ["LINKEDIN_OAUTH_BASE", "LINKEDIN_API_BASE", "LINKEDIN_POLL_MS"]) delete process.env[k];
    await m.close();
  }
});
