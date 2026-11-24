import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockDrive } from "./support/mock-drive.mjs";
import { extractDayFromPath, formatMovedTargetsNotice, resolveEditRedirect } from "../src/lib/post-redirect.ts";

test("resolveEditRedirect redireciona para o novo dia quando o único destino sai do dia de origem", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  assert.equal(extractDayFromPath(`/clientes/${clientId}/dia/2026-11-20`), "2026-11-20");

  // Único destino movido de 20/11 para 25/11 -> redireciona para 25/11
  assert.equal(
    resolveEditRedirect({
      clientId,
      back: `/clientes/${clientId}/dia/2026-11-20`,
      remainingDays: ["2026-11-25"],
      movedDays: ["2026-11-25"],
    }),
    `/clientes/${clientId}/dia/2026-11-25`,
  );

  // Post ainda tem outro destino no dia antigo -> permanece no dia antigo
  assert.equal(
    resolveEditRedirect({
      clientId,
      back: `/clientes/${clientId}/dia/2026-11-20`,
      remainingDays: ["2026-11-20", "2026-11-25"],
      movedDays: ["2026-11-25"],
    }),
    `/clientes/${clientId}/dia/2026-11-20`,
  );

  // Sem movedDays explícito mas saiu do dia de origem -> menor dia do post
  assert.equal(
    resolveEditRedirect({
      clientId,
      back: `/clientes/${clientId}/dia/2026-11-20`,
      remainingDays: ["2026-11-28", "2026-11-22"],
      movedDays: [],
    }),
    `/clientes/${clientId}/dia/2026-11-22`,
  );

  assert.equal(formatMovedTargetsNotice([]), null);
  assert.equal(formatMovedTargetsNotice(["2026-11-25"]), "Destino movido para 25/11.");
  assert.equal(formatMovedTargetsNotice(["2026-11-25", "2026-11-25"]), "Destinos movidos para 25/11.");
  assert.equal(formatMovedTargetsNotice(["2026-11-25", "2026-11-28"]), "Destinos movidos para 25/11, 28/11.");
});

test("ensureTargetFolders recria pasta no novo dia usando mock-drive e retorna erro sem quebrar quando somente leitura", async () => {
  const drive = await startMockDrive(4037);
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  try {
    const { ensureTargetFolders } = await import("../src/lib/post-folders.ts");

    // Dois destinos do mesmo grupo (Reels + Shorts) movidos para 2026-11-25 compartilham a mesma pasta via reuse
    const reuse = new Map<string, string>();
    const res = await ensureTargetFolders(
      "ROOT_CLIENTE_12345",
      [
        { network: "instagram", format: "reels", day: "2026-11-25" },
        { network: "youtube", format: "shorts", day: "2026-11-25" },
      ],
      reuse,
    );
    assert.equal(res.error, null);
    assert.equal(res.ids.length, 2);
    assert.ok(res.ids[0]);
    assert.equal(res.ids[0], res.ids[1]);
    assert.deepEqual(
      drive.createdFolders.map((f: { name: string }) => f.name),
      ["2026", "11 - Novembro", "25", "Reels-Shorts-TikTok-Kwai"],
    );

    // Pasta somente leitura: retorna erro explicativo e ids nulos
    const ro = await ensureTargetFolders(
      "ROOT_READONLY",
      [{ network: "instagram", format: "reels", day: "2026-11-26" }],
    );
    assert.ok(ro.error && ro.error.includes("permissão de leitura"));
    assert.deepEqual(ro.ids, [null]);
  } finally {
    await drive.close();
  }
});
