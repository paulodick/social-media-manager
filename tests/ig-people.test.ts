import test from "node:test";
import assert from "node:assert/strict";
import { formatHandles, parseHandles, userTagsParam } from "../src/lib/ig-people.ts";
import { instagramExtras, publishToMeta, type MediaSource } from "../src/lib/publish/meta.ts";
import { isTargetDirty } from "../src/lib/target-dirty.ts";
import { thumbChecks } from "../src/lib/checks.ts";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockMeta } from "./support/mock-meta.mjs";

test("parseHandles aceita @, vírgula, espaço, link do Instagram e repete uma vez só", () => {
  assert.deepEqual(parseHandles("@Fulano, beltrano;  @ciclano\nhttps://www.instagram.com/dra.ana/ fulano", 20, "x"), {
    handles: ["fulano", "beltrano", "ciclano", "dra.ana"],
  });
  assert.deepEqual(parseHandles("  ", 3, "x"), { handles: [] });
  const many = parseHandles("@a @b @c @d", 3, "Collabs");
  assert.ok("error" in many && /no máximo 3/.test(many.error));
  const bad = parseHandles("@nome com-hífen", 3, "Collabs");
  assert.ok("error" in bad && /com-hífen/.test(bad.error));
  assert.equal(formatHandles(["a", "b.c"]), "@a, @b.c");
});

test("extras do Instagram: capa só em Reels, posição só em foto, collab nunca em Stories", () => {
  const i = { format: "reels", coverUrl: "https://app/api/pub/t?jpg=1", userTags: ["ana"], collaborators: ["parceiro", "b", "c", "d"] };
  assert.deepEqual(instagramExtras(i, "reels"), {
    cover_url: "https://app/api/pub/t?jpg=1",
    user_tags: [{ username: "ana" }],
    collaborators: ["parceiro", "b", "c"],
  });
  assert.deepEqual(instagramExtras(i, "image"), { user_tags: [{ username: "ana", x: 0.5, y: 0.5 }], collaborators: ["parceiro", "b", "c"] });
  assert.deepEqual(instagramExtras(i, "stories"), { user_tags: [{ username: "ana" }] });
  assert.deepEqual(instagramExtras({ format: "reels" }, "reels"), {});
  assert.deepEqual(userTagsParam([], true), []);
});

test("marcações e collabs contam como edição não salva; capa do Instagram é opcional", () => {
  const base = { caption: "a", title: "", day: "2026-11-26", time: "10:00", driveUrl: "x", thumbUrl: "" };
  assert.equal(isTargetDirty({ ...base, tags: "@Ana, b" }, { ...base, tags: "@ana, @b" }), false);
  assert.equal(isTargetDirty({ ...base, collabs: "@novo" }, { ...base, collabs: "" }), true);
  assert.equal(isTargetDirty(base, base), false);
  assert.deepEqual(thumbChecks("instagram", "reels", null), [], "sem capa não gera aviso no Instagram");
  assert.equal(thumbChecks("youtube", "shorts", null).length, 1, "no YouTube a miniatura continua sendo cobrada");
  const capa = thumbChecks("instagram", "reels", { mimeType: "image/png", width: 1080, height: 1920 });
  assert.ok(capa.some((c) => c.level === "ok" && /capa/.test(c.text)));
});

test("Reels sai com capa, marcações e collab; Stories sem collab", async () => {
  const m = await startMockMeta(4027);
  process.env.META_GRAPH_BASE = "http://localhost:4027";
  process.env.META_POLL_MS = "5";
  const media = (kind: "video" | "image"): MediaSource => ({ kind, size: 10, publicUrl: "http://app.test/api/pub/x", open: async () => new Response("x") });
  try {
    await publishToMeta({
      network: "instagram", format: "reels", accountId: "IG1", token: "TK", caption: "Oi", media: media("video"),
      coverUrl: "http://app.test/api/pub/capa?jpg=1", userTags: ["ana"], collaborators: ["parceiro"],
    });
    const reel = m.seen.find((s: { path: string; body: { media_type?: string } }) => s.path.endsWith("/IG1/media") && s.body.media_type === "REELS");
    assert.equal(reel.body.cover_url, "http://app.test/api/pub/capa?jpg=1");
    assert.deepEqual(reel.body.user_tags, [{ username: "ana" }]);
    assert.deepEqual(reel.body.collaborators, ["parceiro"]);
    await publishToMeta({
      network: "instagram", format: "stories", accountId: "IG1", token: "TK", caption: "", media: media("image"),
      userTags: ["ana"], collaborators: ["parceiro"],
    });
    const story = m.seen.find((s: { path: string; body: { media_type?: string } }) => s.path.endsWith("/IG1/media") && s.body.media_type === "STORIES");
    assert.deepEqual(story.body.user_tags, [{ username: "ana" }]);
    assert.equal(story.body.collaborators, undefined);
  } finally {
    await m.close();
  }
});

test("capa do Reels vira JPEG de até 1080×1920 e menos de 8 MB", async () => {
  const sharp = (await import("sharp")).default;
  const { toCoverJpeg } = await import("../src/lib/cover-image.ts");
  const png = await sharp({ create: { width: 2160, height: 3840, channels: 4, background: { r: 255, g: 107, b: 61, alpha: 1 } } }).png().toBuffer();
  const jpg = await toCoverJpeg(png);
  const meta = await sharp(jpg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.ok(jpg.length < 8 * 1024 * 1024);
});
