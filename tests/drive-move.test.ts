// Teste "Testar mover no Drive" (Configurações): acha Reels Editados, consulta permissão e move só uma subpasta vazia, ida e volta.
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockDrive } from "./support/mock-drive.mjs";

const FOLDER = "application/vnd.google-apps.folder";

function tree(denyMove: boolean) {
  return [
    { id: "ROOT_CLIENTE_01", name: "Best Medical", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_EDT", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_CLIENTE_01"] },
    { id: "PASTA_VIDEO_001", name: "Video 1", mimeType: FOLDER, parents: ["PASTA_REELS_EDT"], denyMove },
    { id: "PASTA_VIDEO_002", name: "Video 2", mimeType: FOLDER, parents: ["PASTA_REELS_EDT"], denyMove },
    { id: "VIDEO_DENTRO_02", name: "corte.mp4", mimeType: "video/mp4", size: 1000, parents: ["PASTA_VIDEO_002"] },
  ];
}

async function withDrive<T>(port: number, items: ReturnType<typeof tree>, fn: () => Promise<T>): Promise<T> {
  const drive = await startMockDrive(port, { tree: items });
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  try {
    return await fn();
  } finally {
    await drive.close();
  }
}

test("normalizeFolderName aceita variações do nome da pasta", async () => {
  const { normalizeFolderName } = await import("../src/lib/drive.ts");
  for (const n of ["Reels Editados", "reels-editados", "Reels_Editados", "REELS EDITADOS"]) {
    assert.equal(normalizeFolderName(n), "reelseditados");
  }
});

test("runDriveMoveTest: com permissão, move só a subpasta vazia e a devolve", async () => {
  const items = tree(false);
  await withDrive(4061, items, async () => {
    const { runDriveMoveTest } = await import("../src/lib/drive.ts");
    const r = await runDriveMoveTest("ROOT_CLIENTE_01");
    assert.equal(r.verdict, "move", r.lines.join(" | "));
    const v1 = items.find((i) => i.id === "PASTA_VIDEO_001") as { parents: string[]; moves?: number };
    const v2 = items.find((i) => i.id === "PASTA_VIDEO_002") as { parents: string[]; moves?: number };
    assert.deepEqual(v1.parents, ["PASTA_REELS_EDT"]);
    assert.equal(v1.moves, 2);
    assert.equal(v2.moves, undefined, "pasta com vídeo não pode ser movida");
  });
});

test("runDriveMoveTest: sem permissão, recomenda atalho e nada sai do lugar", async () => {
  const items = tree(true);
  await withDrive(4062, items, async () => {
    const { runDriveMoveTest } = await import("../src/lib/drive.ts");
    const r = await runDriveMoveTest("ROOT_CLIENTE_01");
    assert.equal(r.verdict, "shortcut", r.lines.join(" | "));
    assert.ok(r.lines.some((l) => /recusou/.test(l)));
    for (const i of items) assert.equal((i as { moves?: number }).moves, undefined);
  });
});

test("runDriveMoveTest: sem a pasta Reels Editados, pede para criá-la", async () => {
  const items = tree(false).filter((i) => i.id === "ROOT_CLIENTE_01");
  await withDrive(4063, items, async () => {
    const { runDriveMoveTest } = await import("../src/lib/drive.ts");
    const r = await runDriveMoveTest("ROOT_CLIENTE_01");
    assert.equal(r.verdict, "setup");
    assert.match(r.lines[0], /Reels Editados/);
  });
});
