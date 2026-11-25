// Sequência de postagem: datas, pedido e conferência da resposta da IA, leitura de "Reels Editados" e movimento da pasta.
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockDrive } from "./support/mock-drive.mjs";
import {
  buildSequencePrompt,
  parseSequencePlan,
  recordByDay,
  sequenceDates,
  transcriptExcerpt,
} from "../src/lib/editorial-sequence.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("sequenceDates anda de N em N dias e recordByDay volta o prazo de gravação", () => {
  assert.deepEqual(sequenceDates("2026-11-26", 2, 4), ["2026-11-26", "2026-11-28", "2026-11-30", "2026-12-02"]);
  assert.equal(recordByDay("2026-11-28", 2), "2026-11-26");
  assert.equal(transcriptExcerpt("a  b\n c", 100), "a b c");
  assert.ok(transcriptExcerpt("x".repeat(50), 10).endsWith("…"));
});

test("parseSequencePlan aceita um plano válido e devolve na ordem das datas", () => {
  const dates = sequenceDates("2026-11-26", 2, 3);
  const r = parseSequencePlan(
    {
      entries: [
        { date: "2026-11-30", kind: "skip", reason: "Acervo acabou" },
        { date: "2026-11-26", kind: "ready", item_id: A, theme: "Serviço", reason: "Pronto" },
        { date: "2026-11-28", kind: "new", theme: "Dicas práticas", reason: "Tema novo", idea: { title: "Checklist antes de chamar a assistência", hook: "Pare!" } },
      ],
    },
    { dates, readyIds: new Set([A, B]), today: "2026-11-25", leadDays: 2 },
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.entries.map((e) => e.kind), ["ready", "new", "skip"]);
    const n = r.entries[1];
    assert.ok(n.kind === "new" && n.idea.theme_key === "dicas-praticas");
  }
});

test("parseSequencePlan recusa o que a IA não pode fazer", () => {
  const dates = sequenceDates("2026-11-26", 2, 2);
  const opts = { dates, readyIds: new Set([A]), today: "2026-11-25", leadDays: 2 };
  const bad = (entries: unknown[]) => {
    const r = parseSequencePlan({ entries }, opts);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  // pauta nova sem tempo de gravar (26/11 com prazo de 2 dias a partir de 25/11)
  assert.match(bad([
    { date: "2026-11-26", kind: "new", idea: { title: "X" } },
    { date: "2026-11-28", kind: "ready", item_id: A },
  ]), /não dá tempo de gravar/);
  // vídeo que não existe
  assert.match(bad([
    { date: "2026-11-26", kind: "ready", item_id: B },
    { date: "2026-11-28", kind: "skip" },
  ]), /não está entre os prontos/);
  // mesmo vídeo duas vezes
  assert.match(bad([
    { date: "2026-11-26", kind: "ready", item_id: A },
    { date: "2026-11-28", kind: "ready", item_id: A },
  ]), /mais de uma vez/);
  // data fora do pedido e data faltando
  assert.match(bad([{ date: "2026-11-27", kind: "skip" }]), /não foi pedida/);
  assert.match(bad([{ date: "2026-11-26", kind: "skip" }]), /não decidiu as datas 2026-11-28/);
  assert.match(bad([{ date: "2026-11-26", kind: "ready", item_id: A }, { date: "2026-11-28", kind: "foo" }]), /não existe/);
});

test("readyVideoTitle pula o cabeçalho da transcrição e o nome do arquivo", async () => {
  const { readyVideoTitle } = await import("../src/lib/editorial-sequence-store.ts");
  const t = readyVideoTitle("Video 1", "Video 1", "TRANSCRIÇÃO — Best_Medical_Corte1_Cold_Head_REELS.mp4\n\nQuer mexer em Cold Head sem saber instalar o Windows?");
  assert.equal(t, "Video 1: Quer mexer em Cold Head sem saber instalar o Windows?");
  assert.equal(readyVideoTitle("Plantão 24h", "Video 2", "x"), "Plantão 24h");
  assert.equal(
    readyVideoTitle("Video 2", "Video 2", "TRANSCRIÇÃO — corte2.mp4\nTema: O acelerador de aprendizado\nFala: Paulo\nTexto"),
    "O acelerador de aprendizado",
  );
  const { shortTheme } = await import("../src/lib/editorial-sequence.ts");
  assert.equal(shortTheme("Reparar antes de trocar: a lógica do reparo de placas eletrônicas"), "Reparar antes de trocar: a lógica do reparo de placas…");
});

test("buildSequencePrompt leva transcrições, datas e o primeiro dia possível para pauta nova", () => {
  const p = buildSequencePrompt({
    clientName: "Best Medical", segment: "Manutenção", tone: "", notes: "", styleNotes: "", memoryBlock: "",
    pillars: ["Educativo"], ready: [{ id: A, title: "Video 1", topic: "", guest: "", transcript: "Hoje vamos falar do plantão 24h" }],
    recent: [], dates: ["2026-11-26", "2026-11-28"], today: "2026-11-25", leadDays: 2, networks: ["Instagram reels"],
  });
  assert.match(p, new RegExp(A));
  assert.match(p, /plantão 24h/);
  assert.match(p, /a partir de 2026-11-27/);
  assert.match(p, /2026-11-26, 2026-11-28/);
  assert.match(p, /Nunca use para "pausa estratégica"/);
});

const FOLDER = "application/vnd.google-apps.folder";

test("Reels Editados → itens prontos com transcrição; aprovar move a pasta para o dia e excluir devolve", { skip: !process.env.DATABASE_URL }, async () => {
  const tree = [
    { id: "ROOT_SEQ_CLIENTE", name: "Cliente Seq", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_SEQ1", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_SEQ_CLIENTE"] },
    { id: "PASTA_SEQ_VIDEO1", name: "Video 1", mimeType: FOLDER, parents: ["PASTA_REELS_SEQ1"] },
    { id: "VIDEO_SEQ_ARQ001", name: "corte1.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_SEQ_VIDEO1"] },
    { id: "GDOC_SEQ_TRANS01", name: "transcricao", mimeType: "application/vnd.google-apps.document", parents: ["PASTA_SEQ_VIDEO1"], exportText: "Hoje vou explicar como funciona o plantão 24 horas da Best Medical." },
    { id: "PASTA_SEQ_VIDEO2", name: "Video 2", mimeType: FOLDER, parents: ["PASTA_REELS_SEQ1"] },
  ];
  const drive = await startMockDrive(4071, { tree });
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  const { db } = await import("../src/lib/db.ts");
  const store = await import("../src/lib/editorial-sequence-store.ts");
  const { enqueueSlots } = await import("../src/lib/editorial-enqueue.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name, drive_folder_id) values ($1, 'ROOT_SEQ_CLIENTE') returning id", [`Teste Seq ${Date.now()}`])
  ).rows[0].id;
  try {
    const sync = await store.syncReadyVideos(clientId);
    assert.equal(sync.created, 1, JSON.stringify(sync));
    assert.ok(sync.warnings.some((w) => /Video 2/.test(w)), "pasta sem vídeo vira aviso");
    const again = await store.syncReadyVideos(clientId);
    assert.equal(again.created, 0);
    assert.equal(again.updated, 1);

    const ready = await store.listAvailableReady(clientId);
    assert.equal(ready.length, 1);
    assert.match(ready[0].transcript, /plantão 24 horas/);
    assert.match(ready[0].title, /^Video 1: Hoje vou explicar/);

    await store.saveSequence(
      clientId,
      "2030-01-02",
      [
        { date: "2030-01-02", kind: "ready", item_id: ready[0].id, theme: "Serviço", reason: "Pronto e forte" },
        { date: "2030-01-04", kind: "new", theme: "Dicas", reason: "Tema novo", idea: { title: "Checklist", theme_key: "dicas", hook: "Pare", brief: "", script: "" } },
        { date: "2030-01-06", kind: "skip", reason: "Nada bom" },
      ],
      [{ network: "instagram", format: "reels", time: "10:00" }],
    );
    let rows = await store.readSequence(clientId, "2030-01-01");
    assert.deepEqual(rows.map((r) => r.kind), ["ready", "new", "skip"]);
    assert.equal(rows[0].reason, "Pronto e forte");

    // Gerar de novo apaga o rascunho anterior (inclusive a pauta nova órfã) e os dias sem post.
    await store.saveSequence(clientId, "2030-01-02", [{ date: "2030-01-02", kind: "ready", item_id: ready[0].id, theme: "", reason: "R2" }], [
      { network: "instagram", format: "reels", time: "10:00" },
    ]);
    rows = await store.readSequence(clientId, "2030-01-01");
    assert.deepEqual(rows.map((r) => r.kind), ["ready"]);
    const orphan = await pool.query("select 1 from content_items where client_id = $1 and title = 'Checklist'", [clientId]);
    assert.equal(orphan.rowCount, 0);

    // Aprovar: cria o post e move a pasta "Video 1" para a pasta do dia.
    const res = await enqueueSlots(clientId, rows[0].slot_ids, { fallbackTime: "10:00" });
    assert.ok(res.ok, JSON.stringify(res));
    const v1 = tree.find((t) => t.id === "PASTA_SEQ_VIDEO1") as { parents: string[] };
    assert.notDeepEqual(v1.parents, ["PASTA_REELS_SEQ1"], "a pasta saiu de Reels Editados");
    assert.equal((await store.listAvailableReady(clientId)).length, 0, "vídeo aprovado não entra em outra sequência");

    // Excluir o destino devolve a pasta.
    if (res.ok) await pool.query("delete from post_targets where id = any($1::uuid[])", [res.post_target_ids]);
    const warn = await store.returnReadyFolders([ready[0].id]);
    assert.deepEqual(warn, []);
    assert.deepEqual(v1.parents, ["PASTA_REELS_SEQ1"]);
    assert.equal((await store.listAvailableReady(clientId)).length, 1);
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
  }
});
