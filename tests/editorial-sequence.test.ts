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

/** Sincroniza e espera a IA terminar as fichas (que rodam em segundo plano). */
async function syncAndWait(store: typeof import("../src/lib/editorial-sequence-store.ts"), clientId: string) {
  const res = await store.syncContents(clientId);
  for (let i = 0; i < 200 && store.profilingStatus(clientId)?.running; i++) await new Promise((r) => setTimeout(r, 25));
  const st = store.profilingStatus(clientId);
  return { ...res, profiled: res.profiling ? (st?.profiled ?? 0) : res.profiled, warnings: [...res.warnings, ...(res.profiling ? (st?.warnings ?? []) : [])] };
}

test("Reels Editados → itens prontos; aprovar não move; publicar leva a pasta para Reels Postados e desfazer devolve", { skip: !process.env.DATABASE_URL }, async () => {
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

    // Aprovar: cria o post, mas a pasta continua em "Reels Editados" até a publicação.
    const res = await enqueueSlots(clientId, rows[0].slot_ids, { fallbackTime: "10:00" });
    assert.ok(res.ok, JSON.stringify(res));
    const v1 = tree.find((t) => t.id === "PASTA_SEQ_VIDEO1") as { parents: string[] };
    assert.deepEqual(v1.parents, ["PASTA_REELS_SEQ1"], "aprovar não move a pasta");
    assert.equal((await store.listAvailableReady(clientId)).length, 0, "vídeo aprovado não entra em outra sequência");
    if (!res.ok) return;

    // Publicado (pelo app ou "Postei manualmente"): a pasta vai para "Reels Postados / AAAA-MM".
    await pool.query("update post_targets set status = 'posted', posted_at = now() where id = any($1::uuid[])", [res.post_target_ids]);
    assert.deepEqual(await store.syncPostedFolders(res.post_target_ids), []);
    const posted = drive.createdFolders.find((f: { name: string }) => f.name === "Reels Postados") as { id: string; parentId: string } | undefined;
    assert.ok(posted, "criou a pasta Reels Postados");
    assert.equal(posted.parentId, "ROOT_SEQ_CLIENTE");
    const month = drive.createdFolders.find((f: { parentId: string }) => f.parentId === posted.id) as { id: string; name: string };
    assert.match(month.name, /^\d{4}-\d{2}$/);
    assert.deepEqual(v1.parents, [month.id], "a pasta do vídeo foi para o mês");
    // Chamar de novo não move outra vez.
    assert.deepEqual(await store.syncPostedFolders(res.post_target_ids), []);
    assert.deepEqual(v1.parents, [month.id]);
    // A próxima sincronização não acha a pasta em Reels Editados, mas não marca como "sumiu" (foi postada).
    const s3 = await store.syncReadyVideos(clientId);
    assert.equal(s3.removed, 0);

    // Desfazer o postado: a pasta volta para onde estava.
    await pool.query("update post_targets set status = 'draft', posted_at = null where id = any($1::uuid[])", [res.post_target_ids]);
    assert.deepEqual(await store.syncPostedFolders(res.post_target_ids), []);
    assert.deepEqual(v1.parents, ["PASTA_REELS_SEQ1"]);

    // Excluir o destino: o vídeo volta a ficar disponível.
    await pool.query("delete from post_targets where id = any($1::uuid[])", [res.post_target_ids]);
    const warn = await store.returnReadyFolders([ready[0].id]);
    assert.deepEqual(warn, []);
    assert.deepEqual(v1.parents, ["PASTA_REELS_SEQ1"]);
    assert.equal((await store.listAvailableReady(clientId)).length, 1);

    // "Já foi postado" (postado fora do app): vai para Reels Postados e sai da lista.
    const mark = await store.markReadyPosted(clientId, ready[0].id);
    assert.ok(mark.ok && !mark.warning, JSON.stringify(mark));
    assert.deepEqual(v1.parents, [month.id]);
    assert.equal((await store.listAvailableReady(clientId)).length, 0);
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
  }
});

test("ficha do vídeo pronto: avisos de qualidade, impressão digital, pedido e conferência", async () => {
  const rp = await import("../src/lib/ready-profile.ts");
  assert.deepEqual(rp.qualityFlags(""), ["no_transcript"]);
  assert.deepEqual(rp.qualityFlags("Tema: X\nFala: Paulo\nPerdi a conexão [trecho incerto] do trem"), ["uncertain"]);
  assert.deepEqual(rp.qualityFlags("Duas ressonâncias [?] paradas"), ["uncertain"]);
  assert.deepEqual(
    rp.qualityFlags("Fala: Sem fala — apenas texto na tela\nA trilha é a gravação comercial de uma música"),
    ["commercial_music", "no_speech"],
  );
  assert.deepEqual(rp.qualityFlags("Hoje vamos falar do plantão"), []);

  assert.equal(rp.profileHash("a  b\nc"), rp.profileHash("a b c"), "espaços não mudam a impressão digital");
  assert.notEqual(rp.profileHash("a"), rp.profileHash("b"));

  const prompt = rp.buildReadyProfilePrompt({
    clientName: "Best Medical", segment: "Manutenção", tone: "Técnico", notes: "WhatsApp 11 9999", styleNotes: "",
    pillars: ["Bastidores", "Técnico"], title: "Duas ressonâncias", transcript: "Nenhuma das duas tem estabilizador.",
  });
  assert.match(prompt, /Bastidores; Técnico/);
  assert.match(prompt, /Não invente/);
  assert.match(prompt, /\[trecho incerto\]/);
  assert.match(prompt, /estabilizador/);
  assert.match(prompt, /WhatsApp 11 9999/);

  const ok = rp.parseReadyProfile(
    { theme: "Rede elétrica", summary: "Falta de estabilizador.", pillar: "técnico", audience: "Gestor", hook: "Pararam juntas",
      caption_instagram: "IG", caption_linkedin: "LI" },
    ["Bastidores", "Técnico"],
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.profile.pillar, "Técnico", "pilar casa sem diferenciar maiúsculas");
    assert.equal(ok.profile.audience, "gestor");
  }
  const strange = rp.parseReadyProfile({ theme: "T", summary: "S", pillar: "Inventado", audience: "x", caption_instagram: "a", caption_linkedin: "b" }, ["Técnico"]);
  assert.ok(strange.ok && strange.profile.pillar === "" && strange.profile.audience === "geral");
  assert.equal(rp.parseReadyProfile({ theme: "T", summary: "S", caption_instagram: "a" }, []).ok, false);
  assert.equal(rp.parseReadyProfile(null, []).ok, false);

  const order: number[] = [];
  const out = await rp.mapLimit([30, 10, 20], 2, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    order.push(ms);
    return ms * 2;
  });
  assert.deepEqual(out, [60, 20, 40], "resultado na ordem original");
  assert.equal(order.length, 3);
});

test("buildSequencePrompt usa a ficha (resumo, pilar, público) e avisa transcrição incerta", () => {
  const p = buildSequencePrompt({
    clientName: "Best Medical", segment: "", tone: "", notes: "", styleNotes: "", memoryBlock: "", pillars: [],
    ready: [{ id: A, title: "Video 6", topic: "Rede elétrica", guest: "", transcript: "x".repeat(2000), summary: "Sem estabilizador, três máquinas pararam.", pillar: "Técnico", audience: "gestor", flags: ["uncertain"] }],
    recent: [], dates: ["2026-11-26"], today: "2026-11-25", leadDays: 2, networks: ["Instagram reels"],
  });
  assert.match(p, /resumo: Sem estabilizador/);
  assert.match(p, /pilar: Técnico/);
  assert.match(p, /público: gestor/);
  assert.match(p, /trechos incertos/);
  assert.ok(!p.includes("x".repeat(700)), "com ficha, a transcrição vai mais curta");
});

test("Sincronizar conteúdos: a IA faz a ficha uma vez, refaz quando a transcrição muda e não apaga edição manual", { skip: !process.env.DATABASE_URL }, async () => {
  const http = await import("node:http");
  let calls = 0;
  let round = 1;
  const gemini = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls++;
      const profile = {
        theme: round === 1 ? "Rede elétrica" : "Estabilizador",
        summary: `Resumo ${round}`,
        pillar: "Técnico",
        audience: "gestor",
        hook: `Gancho ${round}`,
        caption_instagram: `IG ${round}`,
        caption_linkedin: `LI ${round}`,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] }));
    });
  });
  await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", r));
  const addr = gemini.address();
  const gport = typeof addr === "object" && addr ? addr.port : 0;

  const tree = [
    { id: "ROOT_PRF_CLIENTE", name: "Cliente Ficha", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_PRF1", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_PRF_CLIENTE"] },
    { id: "PASTA_PRF_VIDEO6", name: "Video 6", mimeType: FOLDER, parents: ["PASTA_REELS_PRF1"] },
    { id: "VIDEO_PRF_ARQ006", name: "duas_ressonancias.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_PRF_VIDEO6"] },
    { id: "GDOC_PRF_TRANS06", name: "transcricao", mimeType: "application/vnd.google-apps.document", parents: ["PASTA_PRF_VIDEO6"],
      exportText: "Tema: Duas ressonâncias e uma tomografia paradas no mesmo dia por oscilação de energia\nFala: Paulo\nNenhuma das duas tem estabilizador [?]." },
  ];
  const drive = await startMockDrive(4072, { tree });
  const prev = { key: process.env.GEMINI_API_KEY, base: process.env.GEMINI_API_BASE, model: process.env.GEMINI_MODEL };
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${gport}`;
  process.env.GEMINI_MODEL = "modelo-teste";
  const { db } = await import("../src/lib/db.ts");
  const store = await import("../src/lib/editorial-sequence-store.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name, drive_folder_id) values ($1, 'ROOT_PRF_CLIENTE') returning id", [`Teste Ficha ${Date.now()}`])
  ).rows[0].id;
  await pool.query("insert into content_pillars (client_id, name, position) values ($1, 'Técnico', 0)", [clientId]);
  try {
    const first = await syncAndWait(store, clientId);
    assert.equal(first.created, 1, JSON.stringify(first));
    assert.equal(first.profiled, 1, JSON.stringify(first));
    assert.equal(calls, 1);
    let [v] = await store.listAvailableReady(clientId);
    assert.equal(v.topic, "Rede elétrica", "tema curto da ficha no lugar da linha Tema: inteira");
    assert.equal(v.summary, "Resumo 1");
    assert.equal(v.pillar, "Técnico");
    assert.equal(v.caption_instagram, "IG 1");
    assert.deepEqual(v.flags, ["uncertain"]);
    const synced = await pool.query("select ready_synced_at from clients where id = $1", [clientId]);
    assert.ok(synced.rows[0].ready_synced_at);

    // Sem mudança na transcrição: não chama a IA de novo e não apaga a ficha.
    const again = await syncAndWait(store, clientId);
    assert.equal(again.profiled, 0);
    assert.equal(calls, 1);
    [v] = await store.listAvailableReady(clientId);
    assert.equal(v.caption_instagram, "IG 1");
    assert.equal(v.topic, "Rede elétrica");

    // A pessoa edita a legenda do Instagram; a transcrição muda; a IA refaz a ficha sem apagar a edição.
    await pool.query("update content_items set caption_instagram = 'Minha legenda' where id = $1", [v.id]);
    (tree.find((t) => t.id === "GDOC_PRF_TRANS06") as { exportText: string }).exportText += "\nAgora com estabilizador.";
    round = 2;
    const third = await syncAndWait(store, clientId);
    assert.equal(third.profiled, 1, JSON.stringify(third));
    assert.equal(calls, 2);
    [v] = await store.listAvailableReady(clientId);
    assert.equal(v.caption_instagram, "Minha legenda", "edição manual fica");
    assert.equal(v.caption_linkedin, "LI 2", "o que ainda era da IA é atualizado");
    assert.equal(v.topic, "Estabilizador");
    assert.equal(v.summary, "Resumo 2");
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
    await new Promise<void>((r) => gemini.close(() => r()));
    for (const [k, val] of [["GEMINI_API_KEY", prev.key], ["GEMINI_API_BASE", prev.base], ["GEMINI_MODEL", prev.model]] as const) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  }
});

test("classifyTextFile separa transcrição de legenda sugerida; ficha e sequência usam a legenda quando não há transcrição", async () => {
  const rp = await import("../src/lib/ready-profile.ts");
  assert.equal(rp.classifyTextFile("legenda_sugerida.txt", "qualquer coisa"), "caption");
  assert.equal(rp.classifyTextFile("Copy do post.docx", "x"), "caption");
  assert.equal(rp.classifyTextFile("transcricao.txt", "#a #b"), "transcript", "nome manda mais que conteúdo");
  assert.equal(rp.classifyTextFile("corte1.txt", "TRANSCRIÇÃO — corte1.mp4\nTexto"), "transcript");
  assert.equal(rp.classifyTextFile("corte1.txt", "[00:01,2] fala"), "transcript");
  assert.equal(rp.classifyTextFile("texto.txt", "Equipamento parado?\nChame a gente.\n#ressonancia #manutencao"), "caption");
  assert.equal(rp.classifyTextFile("Video 7.txt", "E aí pessoal, hoje eu vim mostrar o reparo"), "transcript", "na dúvida, transcrição");

  assert.deepEqual(rp.qualityFlags("", "Legenda pronta #a #b"), ["caption_only"]);
  assert.deepEqual(rp.qualityFlags("", ""), ["no_transcript"]);
  assert.equal(rp.profileHash("fala"), rp.profileHash("fala", ""), "sem legenda a impressão digital não muda");
  assert.notEqual(rp.profileHash("fala"), rp.profileHash("fala", "legenda"));

  const p = rp.buildReadyProfilePrompt({
    clientName: "Best Medical", segment: "", tone: "", notes: "", styleNotes: "", pillars: [],
    title: "Video 7", transcript: "", suggestedCaption: "Troca de cold head em 6 horas. #ressonancia",
  });
  assert.match(p, /SEM transcrição, só com a legenda sugerida/);
  assert.match(p, /LEGENDA SUGERIDA POR QUEM CORTOU O VÍDEO:\nTroca de cold head/);

  const seq = buildSequencePrompt({
    clientName: "Best Medical", segment: "", tone: "", notes: "", styleNotes: "", memoryBlock: "", pillars: [],
    ready: [{ id: A, title: "Video 7", topic: "", guest: "", transcript: "", suggested_caption: "Troca de cold head em 6 horas." }],
    recent: [], dates: ["2026-11-26"], today: "2026-11-25", leadDays: 2, networks: ["Instagram reels"],
  });
  assert.match(seq, /legenda sugerida por quem cortou: Troca de cold head/);
  assert.ok(!seq.includes("(sem transcrição)"));
});

test("Sincronizar conteúdos lê legenda sugerida (sozinha ou junto da transcrição)", { skip: !process.env.DATABASE_URL }, async () => {
  const http = await import("node:http");
  const prompts: string[] = [];
  const gemini = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      prompts.push(JSON.parse(body).contents[0].parts[0].text);
      const profile = { theme: "Cold head", summary: "Troca rápida.", pillar: "", audience: "gestor", hook: "6 horas",
        caption_instagram: "IG da IA", caption_linkedin: "LI da IA" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] }));
    });
  });
  await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", r));
  const addr = gemini.address();
  const gport = typeof addr === "object" && addr ? addr.port : 0;
  const GDOC = "application/vnd.google-apps.document";
  const tree = [
    { id: "ROOT_LEG_CLIENTE", name: "Cliente Legenda", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_LEG1", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_LEG_CLIENTE"] },
    // Só legenda sugerida, com seção do Instagram.
    { id: "PASTA_LEG_VIDEO7", name: "Video 7", mimeType: FOLDER, parents: ["PASTA_REELS_LEG1"] },
    { id: "VIDEO_LEG_ARQ007", name: "cold_head.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_LEG_VIDEO7"] },
    { id: "GDOC_LEG_CAPT07", name: "legenda", mimeType: GDOC, parents: ["PASTA_LEG_VIDEO7"],
      exportText: "Legenda Instagram:\nTrocamos o cold head em 6 horas.\n#ressonancia #manutencao" },
    // Transcrição + legenda sugerida.
    { id: "PASTA_LEG_VIDEO8", name: "Video 8", mimeType: FOLDER, parents: ["PASTA_REELS_LEG1"] },
    { id: "VIDEO_LEG_ARQ008", name: "chiller.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_LEG_VIDEO8"] },
    { id: "GDOC_LEG_TRAN08", name: "transcricao", mimeType: GDOC, parents: ["PASTA_LEG_VIDEO8"],
      exportText: "Tema: Chiller da ressonância\nFala: Paulo\nO chiller parou no domingo." },
    { id: "GDOC_LEG_CAPT08", name: "copy do post", mimeType: GDOC, parents: ["PASTA_LEG_VIDEO8"],
      exportText: "Domingo, 3 da manhã, chiller parado. #ressonancia #plantao" },
  ];
  const drive = await startMockDrive(4073, { tree });
  const prev = { key: process.env.GEMINI_API_KEY, base: process.env.GEMINI_API_BASE, model: process.env.GEMINI_MODEL };
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${gport}`;
  process.env.GEMINI_MODEL = "modelo-teste";
  const { db } = await import("../src/lib/db.ts");
  const store = await import("../src/lib/editorial-sequence-store.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name, drive_folder_id) values ($1, 'ROOT_LEG_CLIENTE') returning id", [`Teste Legenda ${Date.now()}`])
  ).rows[0].id;
  try {
    const sync = await syncAndWait(store, clientId);
    assert.equal(sync.created, 2, JSON.stringify(sync));
    assert.equal(sync.profiled, 2, JSON.stringify(sync));
    const ready = await store.listAvailableReady(clientId);
    const v7 = ready.find((r) => r.folder === "Video 7");
    const v8 = ready.find((r) => r.folder === "Video 8");
    assert.ok(v7 && v8);
    assert.equal(v7.transcript, "");
    assert.match(v7.suggested_caption ?? "", /cold head em 6 horas/);
    assert.deepEqual(v7.flags, ["caption_only"]);
    assert.equal(v7.caption_instagram, "Trocamos o cold head em 6 horas.\n#ressonancia #manutencao", "seção do Instagram de quem cortou fica");
    assert.equal(v7.caption_linkedin, "LI da IA", "LinkedIn vem da ficha da IA");
    assert.match(v8.transcript, /chiller parou/);
    assert.match(v8.suggested_caption ?? "", /3 da manhã/);
    assert.deepEqual(v8.flags, []);
    assert.ok(prompts.some((p) => /SEM transcrição, só com a legenda sugerida/.test(p) && /cold head/.test(p)));
    assert.ok(prompts.some((p) => /chiller parou/.test(p) && /LEGENDA SUGERIDA[^\n]*\n[^\n]*3 da manhã/.test(p)));
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
    await new Promise<void>((r) => gemini.close(() => r()));
    for (const [k, val] of [["GEMINI_API_KEY", prev.key], ["GEMINI_API_BASE", prev.base], ["GEMINI_MODEL", prev.model]] as const) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  }
});

test("IA do Editorial: Claude primeiro com a chave da Anthropic e Gemini de reserva", async () => {
  const http = await import("node:http");
  const hits: string[] = [];
  let claudeFails = false;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/v1/messages")) {
        hits.push("claude");
        if (claudeFails) {
          res.statusCode = 529;
          res.end(JSON.stringify({ error: { message: "overloaded" } }));
          return;
        }
        res.end(JSON.stringify({ content: [{ type: "text", text: '{"ok":"claude"}' }], stop_reason: "end_turn" }));
        return;
      }
      hits.push("gemini");
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":"gemini"}' }] } }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const keys = ["GEMINI_API_KEY", "GEMINI_API_BASE", "GEMINI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "EDITORIAL_AI_PROVIDER"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, {
      GEMINI_API_KEY: "g", GEMINI_API_BASE: `http://127.0.0.1:${port}`, GEMINI_MODEL: "m",
      ANTHROPIC_API_KEY: "a", ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    });
    delete process.env.EDITORIAL_AI_PROVIDER;
    const ai = await import("../src/lib/editorial-ai.ts");
    assert.deepEqual(ai.editorialProviders(), ["claude", "gemini"]);
    assert.deepEqual(await ai.generateEditorialJson("x"), { text: '{"ok":"claude"}' });
    claudeFails = true;
    assert.deepEqual(await ai.generateEditorialJson("x"), { text: '{"ok":"gemini"}' }, "Claude fora do ar: usa o Gemini");
    assert.deepEqual(hits, ["claude", "claude", "gemini"]);
    process.env.EDITORIAL_AI_PROVIDER = "gemini";
    assert.deepEqual(ai.editorialProviders(), ["gemini", "claude"]);
    delete process.env.ANTHROPIC_API_KEY;
    assert.deepEqual(ai.editorialProviders(), ["gemini"]);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    await new Promise<void>((r) => srv.close(() => r()));
  }
});

test("Sincronizar lê Reels Editados em qualquer profundidade (episódio / cortes / corte)", { skip: !process.env.DATABASE_URL }, async () => {
  const GDOC = "application/vnd.google-apps.document";
  const tree = [
    { id: "ROOT_NEST_CLIENTE", name: "Cliente Nest", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_NEST1", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_NEST_CLIENTE"] },
    { id: "PASTA_NEST_EP0001", name: "Ep - 1 Lúcio Flávio", mimeType: FOLDER, parents: ["PASTA_REELS_NEST1"] },
    { id: "PASTA_NEST_CORTES", name: "Cortes_Reels", mimeType: FOLDER, parents: ["PASTA_NEST_EP0001"] },
    { id: "PASTA_NEST_C01000", name: "01 - Quer ser médico", mimeType: FOLDER, parents: ["PASTA_NEST_CORTES"] },
    { id: "VIDEO_NEST_C01000", name: "corte01.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_NEST_C01000"] },
    { id: "GDOC_NEST_LEGE01", name: "corte01_legenda", mimeType: GDOC, parents: ["PASTA_NEST_C01000"], exportText: "Médico de branco? #medicina #carreira" },
    { id: "PASTA_NEST_C02000", name: "02 - Sem vídeo ainda", mimeType: FOLDER, parents: ["PASTA_NEST_CORTES"] },
  ];
  const drive = await startMockDrive(4075, { tree });
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  const { db } = await import("../src/lib/db.ts");
  const store = await import("../src/lib/editorial-sequence-store.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name, drive_folder_id) values ($1, 'ROOT_NEST_CLIENTE') returning id", [`Teste Nest ${Date.now()}`])
  ).rows[0].id;
  try {
    const sync = await store.syncReadyVideos(clientId);
    assert.equal(sync.created, 1, JSON.stringify(sync));
    assert.ok(sync.warnings.some((w) => /02 - Sem vídeo ainda: ainda sem vídeo/.test(w)), JSON.stringify(sync.warnings));
    const [v] = await store.listAvailableReady(clientId);
    assert.equal(v.folder, "Ep - 1 Lúcio Flávio / Cortes_Reels / 01 - Quer ser médico");
    assert.equal(v.guest, "Lúcio Flávio");
    assert.match(v.suggested_caption ?? "", /Médico de branco/);
    const row = await pool.query("select ready_folder_parent_id from content_items where id = $1", [v.id]);
    assert.equal(row.rows[0].ready_folder_parent_id, "PASTA_NEST_CORTES", "volta para a pasta de onde saiu");
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
  }
});

test("reorganizeDates: segue a grade da sequência, pula dias aprovados e cabe todos os vídeos prontos", async () => {
  const { reorganizeDates } = await import("../src/lib/editorial-sequence-run.ts");
  const params = { start: "2030-01-01", every_days: 2, count: 4, lead_days: 2, targets: [{ network: "instagram", format: "reels", time: "10:00" }] };
  // A grade começou antes: continua no mesmo passo (dias ímpares), a partir de `from`.
  assert.deepEqual(
    reorganizeDates({ params, from: "2030-01-04", locked: new Set(["2030-01-05"]), draftCount: 2, readyCount: 0 }),
    ["2030-01-07", "2030-01-09"],
  );
  // Mais vídeos prontos que rascunhos: aumenta para caber todos.
  assert.equal(reorganizeDates({ params, from: "2030-01-01", locked: new Set(), draftCount: 2, readyCount: 5 }).length, 5);
  // Nunca passa do limite.
  assert.equal(reorganizeDates({ params, from: "2030-01-01", locked: new Set(), draftCount: 1, readyCount: 99 }).length, 30);
});

test("Sincronizar: vídeo que saiu de Reels Editados sai da lista e volta se a pasta voltar", { skip: !process.env.DATABASE_URL }, async () => {
  const tree = [
    { id: "ROOT_GONE_CLIENT", name: "Cliente Gone", mimeType: FOLDER, parents: [] },
    { id: "PASTA_REELS_GONE", name: "Reels Editados", mimeType: FOLDER, parents: ["ROOT_GONE_CLIENT"] },
    { id: "PASTA_GONE_VID01", name: "Video 1", mimeType: FOLDER, parents: ["PASTA_REELS_GONE"] },
    { id: "VIDEO_GONE_ARQ01", name: "a.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_GONE_VID01"] },
    { id: "PASTA_GONE_VID02", name: "Video 2", mimeType: FOLDER, parents: ["PASTA_REELS_GONE"] },
    { id: "VIDEO_GONE_ARQ02", name: "b.mp4", mimeType: "video/mp4", size: 5000, parents: ["PASTA_GONE_VID02"] },
    { id: "PASTA_GONE_OUTRA", name: "Outra", mimeType: FOLDER, parents: ["ROOT_GONE_CLIENT"] },
  ];
  const drive = await startMockDrive(4076, { tree });
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  const { db } = await import("../src/lib/db.ts");
  const store = await import("../src/lib/editorial-sequence-store.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name, drive_folder_id) values ($1, 'ROOT_GONE_CLIENT') returning id", [`Teste Gone ${Date.now()}`])
  ).rows[0].id;
  try {
    assert.equal((await store.syncReadyVideos(clientId)).created, 2);
    assert.equal((await store.listAvailableReady(clientId)).length, 2);
    // A pessoa tira "Video 2" de Reels Editados no Drive.
    (tree.find((t) => t.id === "PASTA_GONE_VID02") as { parents: string[] }).parents = ["PASTA_GONE_OUTRA"];
    const s2 = await store.syncReadyVideos(clientId);
    assert.equal(s2.removed, 1);
    assert.equal((await store.listAvailableReady(clientId)).length, 1);
    // Volta para a pasta: volta para a lista.
    (tree.find((t) => t.id === "PASTA_GONE_VID02") as { parents: string[] }).parents = ["PASTA_REELS_GONE"];
    const s3 = await store.syncReadyVideos(clientId);
    assert.equal(s3.removed, 0);
    assert.equal((await store.listAvailableReady(clientId)).length, 2);
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
    await drive.close();
  }
});
