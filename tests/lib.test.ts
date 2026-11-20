import test from "node:test";
import assert from "node:assert/strict";
import { parseDriveUrl } from "../src/lib/drive.ts";
import { captionChecks, mediaChecks, countHashtags, cutCaption } from "../src/lib/checks.ts";
import { hashPassword, verifyPassword, passwordProblem } from "../src/lib/password.ts";
import { monthGrid, addMonths, dayLabel, isDay, isTime } from "../src/lib/dates.ts";

test("parseDriveUrl", () => {
  assert.deepEqual(parseDriveUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"), { id: "1AbCdEfGhIjKlMnOp", kind: "file" });
  assert.deepEqual(parseDriveUrl("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing"), { id: "1AbCdEfGhIjKlMnOp", kind: "folder" });
  assert.deepEqual(parseDriveUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"), { id: "1AbCdEfGhIjKlMnOp", kind: "unknown" });
  assert.equal(parseDriveUrl("https://exemplo.com/x"), null);
  assert.equal(parseDriveUrl(""), null);
});

test("hashtags e cortes", () => {
  assert.equal(countHashtags("oi #um #dois\n#tres sem#tag"), 3);
  assert.equal(cutCaption("a ".repeat(100), 20).endsWith("…"), true);
  assert.equal(cutCaption("curto", 20), "curto");
});

test("checagem de legenda", () => {
  assert.equal(captionChecks("instagram", "x".repeat(2201))[0].level, "warn");
  assert.equal(captionChecks("instagram", "ok")[0].level, "ok");
  assert.equal(captionChecks("instagram", "")[0].level, "warn");
  assert.equal(captionChecks("kwai", "qualquer coisa").length, 0);
});

test("checagem de mídia", () => {
  const v = { mimeType: "video/mp4", width: 1080, height: 1920 };
  assert.ok(mediaChecks("instagram", "reels", v).every((c) => c.level === "ok"));
  assert.ok(mediaChecks("youtube", "longo", v).some((c) => c.level === "warn"));
  assert.ok(mediaChecks("linkedin", "feed", v).some((c) => /vertical/.test(c.text)));
  assert.ok(mediaChecks("instagram", "reels", null).some((c) => c.level === "warn"));
});

test("datas", () => {
  const g = monthGrid("2026-11");
  assert.equal(g.length, 35);
  assert.equal(g[0].day, "2026-11-01");
  assert.equal(g[34].day, "2026-12-05");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(dayLabel("2026-11-20"), "Sexta, 20 de novembro de 2026");
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isTime("09:30"), true);
});

test("senha: hash, verificação e regras", () => {
  const h = hashPassword("uma senha boa 123");
  assert.ok(h.startsWith("scrypt$"));
  assert.notEqual(h, hashPassword("uma senha boa 123"));
  assert.equal(verifyPassword("uma senha boa 123", h), true);
  assert.equal(verifyPassword("outra senha", h), false);
  assert.equal(verifyPassword("x", "lixo"), false);
  assert.equal(passwordProblem("curta", "curta") !== null, true);
  assert.equal(passwordProblem("senha-longa-1", "senha-longa-2") !== null, true);
  assert.equal(passwordProblem("senha-longa-1", "senha-longa-1"), null);
});
