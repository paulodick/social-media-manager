import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockDrive } from "./support/mock-drive.mjs";

test("folderPathFromRoot guarda resultado em memória por fileId + pasta raiz dentro da janela de cache", async () => {
  const drive = await startMockDrive(4038);
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  try {
    const { folderPathFromRoot, clearFolderPathCache } = await import("../src/lib/drive.ts");
    clearFolderPathCache();

    const t0 = 1_700_000_000_000;
    const first = await folderPathFromRoot("VIDEO_CACHE_01", "PASTA", { now: t0, ttlMs: 300_000 });
    assert.deepEqual(first, []);
    const callsAfterFirst = drive.seen.length;
    assert.equal(callsAfterFirst, 1);

    // Segunda chamada dentro da janela de cache não consulta o Drive novamente
    const second = await folderPathFromRoot("VIDEO_CACHE_01", "PASTA", { now: t0 + 60_000, ttlMs: 300_000 });
    assert.deepEqual(second, []);
    assert.equal(drive.seen.length, callsAfterFirst);

    // Chave diferente (outra pasta raiz) faz consulta ao Drive e também cacheia o resultado null
    const otherRoot = await folderPathFromRoot("VIDEO_CACHE_01", "OUTRA_RAIZ", { now: t0 + 60_000, ttlMs: 300_000 });
    assert.equal(otherRoot, null);
    const callsAfterOther = drive.seen.length;
    assert.ok(callsAfterOther > callsAfterFirst);

    const otherRootCached = await folderPathFromRoot("VIDEO_CACHE_01", "OUTRA_RAIZ", { now: t0 + 120_000, ttlMs: 300_000 });
    assert.equal(otherRootCached, null);
    assert.equal(drive.seen.length, callsAfterOther);

    // Após expirar a janela de cache, consulta novamente
    const afterExpiry = await folderPathFromRoot("VIDEO_CACHE_01", "PASTA", { now: t0 + 301_000, ttlMs: 300_000 });
    assert.deepEqual(afterExpiry, []);
    assert.equal(drive.seen.length, callsAfterOther + 1);
  } finally {
    await drive.close();
  }
});
