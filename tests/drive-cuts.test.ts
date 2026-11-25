import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
// @ts-expect-error módulo .mjs de apoio, sem tipos
import { startMockDrive } from "./support/mock-drive.mjs";
import {
  extractTextFromDocBuffer,
  groupFolderIntoCutBundle,
  inferGuestAndTopicFromFolderName,
  parseCutDocument,
} from "../src/lib/drive-cuts.ts";
import {
  countAlternationCollisions,
  enforceCalendarAlternation,
  orderWithAlternation,
  type AlternationMeta,
} from "../src/lib/editorial-alternation.ts";
import { resolveCaptionForNetwork } from "../src/lib/editorial-enqueue.ts";
import { buildCalendarPrompt, buildClassificationPrompt } from "../src/lib/editorial-prompts.ts";
import { parseAiClassification } from "../src/lib/editorial-rules.ts";
import type { AiCalendarEntry } from "../src/lib/editorial-types.ts";

/** Cria um buffer ZIP mínimo contendo `word/document.xml` (formato .docx válido). */
function makeMinimalDocx(paragraphs: string[]): Buffer {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("") +
    `</w:body></w:document>`;
  const nameBuf = Buffer.from("word/document.xml", "utf8");
  const rawXml = Buffer.from(xml, "utf8");
  const compressed = deflateRawSync(rawXml);

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(rawXml.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, nameBuf, compressed]);
}

test("agrupamento por pasta de corte: 1 subpasta (vídeo + capa + .doc) vira 1 único bundle sem transcrição pesada de vídeo", () => {
  const bundle = groupFolderIntoCutBundle(
    { id: "FOLDER_CORTE_01", name: "01 - Prof. Lucio Flavio - IA na Medicina" },
    [
      { id: "VID_01_A", name: "corte_01_vertical.mp4", mimeType: "video/mp4", size: 25_000_000 },
      { id: "IMG_01_A", name: "capa_lucio.png", mimeType: "image/png", size: 420_000 },
      { id: "DOC_01_A", name: "legenda_corte_01.doc", mimeType: "application/msword", size: 18_000 },
    ],
  );
  assert.ok(bundle);
  assert.equal(bundle.folder_id, "FOLDER_CORTE_01");
  assert.equal(bundle.video?.id, "VID_01_A");
  assert.equal(bundle.cover?.id, "IMG_01_A");
  assert.equal(bundle.doc?.id, "DOC_01_A");
  assert.equal(bundle.skip_video_transcription, true);
  assert.equal(bundle.detected_guest, "Prof. Lucio Flavio");
  assert.equal(bundle.detected_topic, "IA na Medicina");

  // Pasta vazia é ignorada
  assert.equal(groupFolderIntoCutBundle({ id: "EMPTY_01", name: "Vazia" }, []), null);

  // Inferência de nomes variados
  assert.deepEqual(inferGuestAndTopicFromFolderName("Corte 03 - Leonardo Milner - Gestão de Clínicas"), {
    guest: "Leonardo Milner",
    topic: "Gestão de Clínicas",
  });
  assert.deepEqual(inferGuestAndTopicFromFolderName("05 - Dr. Phillip Dmitruk"), {
    guest: "Dr. Phillip Dmitruk",
    topic: "",
  });
});

test("extração de texto de .docx, .doc binário UTF-16LE, texto puro e fallback seguro em binário corrompido", () => {
  // 1) .docx real compactado com DEFLATE
  const docxBuf = makeMinimalDocx([
    "Convidado: Prof. Lucio Flavio",
    "Assunto: IA no diagnóstico &amp; triagem",
    "Ideia de capa: A IA vai substituir o médico?",
    "Legenda Instagram: Descubra o que muda na prática clínica!",
    "Legenda LinkedIn: Reflexão sobre inteligência artificial na medicina.",
  ]);
  const docxRes = extractTextFromDocBuffer(docxBuf, "corte01.docx");
  assert.equal(docxRes.format, "docx");
  assert.ok(docxRes.text.includes("Prof. Lucio Flavio"));
  assert.ok(docxRes.text.includes("IA no diagnóstico & triagem"));

  // 2) .doc binário legado com texto em UTF-16LE + ruído OLE
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const noise = Buffer.from("Root Entry", "utf16le");
  const separator = Buffer.alloc(4, 0);
  const body = Buffer.from("Convidado: Leonardo Milner\nAssunto: Gestão de Clínicas\nCapa: Pare de perder margem", "utf16le");
  const binRes = extractTextFromDocBuffer(Buffer.concat([oleHeader, noise, separator, body]), "corte02.doc");
  assert.equal(binRes.format, "doc_binary");
  assert.ok(binRes.text.includes("Leonardo Milner"));
  assert.ok(!binRes.text.includes("Root Entry"));

  // 3) Fallback seguro em buffer binário ilegível (nunca lança exceção)
  const garbage = Buffer.from([0x00, 0xff, 0x01, 0x02, 0xfe, 0x00, 0x10, 0x80]);
  const fbRes = extractTextFromDocBuffer(garbage, "quebrado.doc");
  assert.equal(fbRes.format, "fallback");
  assert.equal(fbRes.text, "");
  assert.ok(fbRes.warning && fbRes.warning.includes("quebrado.doc"));
});

test("parseCutDocument extrai convidado, assunto, capa, gancho e separa legendas de Instagram e LinkedIn sem transcrever vídeo", () => {
  const docText = [
    "Título: Como a IA acelera diagnósticos sem perder humanidade",
    "Convidado: Prof. Lucio Flavio",
    "Assunto: IA na Medicina",
    "Ideia de capa: A IA VAI SUBSTITUIR O MÉDICO?",
    "Gancho: Se você acha que IA é ameaça, precisa ouvir isso.",
    "",
    "Legenda Instagram:",
    "A tecnologia não substitui quem cuida, ela amplia o alcance.",
    "Salve este corte para rever com sua equipe!",
    "",
    "Legenda LinkedIn:",
    "No episódio do PodBest, o Prof. Lucio Flavio analisa como a IA apoia decisões clínicas.",
    "Qual sua visão sobre adoção responsável na saúde?",
  ].join("\n");

  const parsed = parseCutDocument({
    folderName: "01 - Prof. Lucio Flavio - IA na Medicina",
    videoName: "corte_01.mp4",
    coverName: "capa_01.png",
    docText,
  });

  assert.equal(parsed.used_video_transcription, false);
  assert.equal(parsed.guest_name, "Prof. Lucio Flavio");
  assert.equal(parsed.topic_tag, "IA na Medicina");
  assert.equal(parsed.cover_idea, "A IA VAI SUBSTITUIR O MÉDICO?");
  assert.equal(parsed.hook, "Se você acha que IA é ameaça, precisa ouvir isso.");
  assert.ok(parsed.caption_instagram.includes("Salve este corte"));
  assert.ok(!parsed.caption_instagram.includes("LinkedIn"));
  assert.ok(parsed.caption_linkedin.includes("decisões clínicas"));
  assert.equal(resolveCaptionForNetwork("instagram", parsed), parsed.caption_instagram);
  assert.equal(resolveCaptionForNetwork("linkedin", parsed), parsed.caption_linkedin);

  // Fallback quando .doc está vazio: usa pasta + nome da capa
  const fallbackParsed = parseCutDocument({
    folderName: "04 - Dr. Phillip Dmitruk - Carreira Médica",
    videoName: "corte_04.mp4",
    coverName: "capa_phillip_carreira.png",
    docText: "",
  });
  assert.equal(fallbackParsed.guest_name, "Dr. Phillip Dmitruk");
  assert.equal(fallbackParsed.topic_tag, "Carreira Médica");
  assert.ok(fallbackParsed.cover_idea.includes("capa_phillip_carreira"));
});

test("scanClientCutFolders e readDriveDocumentText agrupam subpastas no mock-drive sem baixar bytes de vídeo", async () => {
  const docxBuf = makeMinimalDocx([
    "Convidado: Leonardo Milner",
    "Assunto: Liderança",
    "Legenda Instagram: Liderar clínica exige método.",
    "Legenda LinkedIn: Como estruturar liderança médica.",
  ]);

  const drive = await startMockDrive(4039, {
    tree: [
      { id: "ROOT_PODBEST_01", name: "PodBest", mimeType: "application/vnd.google-apps.folder", parents: [] },
      { id: "SUB_LOGOTIPO_01", name: "Logotipo", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT_PODBEST_01"] },
      { id: "SUB_YEAR_2026", name: "2026", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT_PODBEST_01"] },
      { id: "SUB_CORTE_01", name: "01 - Prof. Lucio Flavio - IA na Medicina", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT_PODBEST_01"] },
      { id: "SUB_CORTE_02", name: "02 - Leonardo Milner - Liderança", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT_PODBEST_01"] },
      { id: "SUB_CORTE_03", name: "03 - Dr. Phillip Dmitruk - Carreira", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT_PODBEST_01"] },
      // Corte 1 (Google Doc + vídeo + capa)
      { id: "VID_CORTE_001", name: "corte1.mp4", mimeType: "video/mp4", size: 90_000_000, parents: ["SUB_CORTE_01"] },
      { id: "IMG_CORTE_001", name: "capa_corte1.jpg", mimeType: "image/jpeg", size: 300_000, parents: ["SUB_CORTE_01"] },
      {
        id: "GDOC_CORTE_01",
        name: "legenda_corte1",
        mimeType: "application/vnd.google-apps.document",
        parents: ["SUB_CORTE_01"],
        exportText: "Convidado: Prof. Lucio Flavio\nAssunto: IA na Medicina\nLegenda Instagram: Texto IG 1\nLegenda LinkedIn: Texto LI 1",
      },
      // Corte 2 (.docx + vídeo + capa)
      { id: "VID_CORTE_002", name: "corte2.mp4", mimeType: "video/mp4", size: 80_000_000, parents: ["SUB_CORTE_02"] },
      { id: "IMG_CORTE_002", name: "thumb_corte2.png", mimeType: "image/png", size: 250_000, parents: ["SUB_CORTE_02"] },
      {
        id: "DOCX_CORTE_02",
        name: "legenda_corte2.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        parents: ["SUB_CORTE_02"],
        content: docxBuf,
      },
      // Corte 3 (.doc que falha no download -> testa fallback seguro)
      { id: "VID_CORTE_003", name: "corte3.mp4", mimeType: "video/mp4", size: 75_000_000, parents: ["SUB_CORTE_03"] },
      {
        id: "DOC_BROKEN_03",
        name: "legenda_corte3.doc",
        mimeType: "application/msword",
        parents: ["SUB_CORTE_03"],
        failMediaStatus: 500,
      },
    ],
  });

  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });

  try {
    const { scanClientCutFolders, readDriveDocumentText } = await import("../src/lib/drive.ts");
    const scanned = await scanClientCutFolders("ROOT_PODBEST_01");
    assert.ok(!("error" in scanned));
    // Deve agrupar exatamente as 3 subpastas de corte (ignorando Logotipo e 2026)
    assert.equal(scanned.cut_folders.length, 3);
    assert.equal(scanned.loose_files.length, 0);

    const c1 = scanned.cut_folders.find((c) => c.folder_id === "SUB_CORTE_01")!;
    const c2 = scanned.cut_folders.find((c) => c.folder_id === "SUB_CORTE_02")!;
    const c3 = scanned.cut_folders.find((c) => c.folder_id === "SUB_CORTE_03")!;
    assert.equal(c1.video?.id, "VID_CORTE_001");
    assert.equal(c1.cover?.id, "IMG_CORTE_001");
    assert.equal(c1.doc?.id, "GDOC_CORTE_01");

    const doc1 = await readDriveDocumentText(c1.doc!);
    assert.equal(doc1.format, "google_doc");
    assert.ok(doc1.text.includes("Prof. Lucio Flavio"));

    const doc2 = await readDriveDocumentText(c2.doc!);
    assert.equal(doc2.format, "docx");
    assert.ok(doc2.text.includes("Leonardo Milner"));

    const doc3 = await readDriveDocumentText(c3.doc!);
    assert.equal(doc3.format, "fallback");
    assert.equal(doc3.text, "");
    assert.ok(doc3.warning);

    // Garante que NENHUM vídeo teve seus bytes baixados (`alt=media`) para transcrição pesada
    const videoDownloads = drive.seen.filter(
      (req: { path: string; query: string }) => req.path.includes("VID_CORTE_") && req.query.includes("alt=media"),
    );
    assert.equal(videoDownloads.length, 0);
  } finally {
    await drive.close();
  }
});

test("alternância inteligente: 30 cortes agrupados por convidado/assunto são intercalados com zero repetições consecutivas", () => {
  const guests = ["Prof. Lucio Flavio", "Leonardo Milner", "Dr. Phillip Dmitruk"];
  const topics = ["IA na Medicina", "Gestão de Clínicas", "Carreira Médica", "Inovação", "Atendimento"];

  // Entrada no pior caso: 10 cortes seguidos de cada convidado
  const cuts = Array.from({ length: 30 }, (_, idx) => {
    const guest = guests[Math.floor(idx / 10)];
    const topic = topics[idx % topics.length];
    return { id: `cut-${idx + 1}`, guest, topic };
  });

  const before = countAlternationCollisions(cuts, (c) => ({ guest: c.guest, topic: c.topic }));
  assert.ok(before.guestCollisions >= 25);

  const ordered = orderWithAlternation(cuts, (c) => ({ guest: c.guest, topic: c.topic }));
  assert.equal(ordered.length, 30);
  const after = countAlternationCollisions(ordered, (c) => ({ guest: c.guest, topic: c.topic }));
  assert.equal(after.guestCollisions, 0);
  assert.equal(after.topicCollisions, 0);
});

test("enforceCalendarAlternation corrige sequência gerada pela IA mantendo datas/horários e zerando colisões de convidado e assunto", () => {
  const pillarA = "11111111-1111-4111-8111-111111111111";
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
  ];
  const meta = new Map<string, AlternationMeta>([
    [ids[0], { guest: "Prof. Lucio Flavio", topic: "IA na Medicina", pillar: pillarA }],
    [ids[1], { guest: "Prof. Lucio Flavio", topic: "IA na Medicina", pillar: pillarA }],
    [ids[2], { guest: "Leonardo Milner", topic: "Gestão", pillar: pillarA }],
    [ids[3], { guest: "Leonardo Milner", topic: "Gestão", pillar: pillarA }],
    [ids[4], { guest: "Dr. Phillip Dmitruk", topic: "Carreira", pillar: pillarA }],
    [ids[5], { guest: "Dr. Phillip Dmitruk", topic: "Carreira", pillar: pillarA }],
  ]);

  // IA devolveu convidados agrupados lado a lado
  const rawEntries: AiCalendarEntry[] = ids.map((id, i) => ({
    planned_day: `2026-12-0${i + 1}`,
    planned_time: "10:00",
    network: "instagram",
    format: "reels",
    source_kind: "existing_ready",
    existing_item_id: id,
    pillar_id: pillarA,
    new_item: null,
  }));

  const fixed = enforceCalendarAlternation(rawEntries, meta);
  // Datas originais preservadas na ordem
  assert.deepEqual(
    fixed.map((e) => e.planned_day),
    ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"],
  );
  const collisions = countAlternationCollisions(fixed, (e) => meta.get(e.existing_item_id ?? "") ?? {});
  assert.equal(collisions.guestCollisions, 0);
  assert.equal(collisions.topicCollisions, 0);
});

test("prompts e parseAiClassification incluem memória do cliente, referência do .doc, convidado, capa e legendas por rede", () => {
  const pillar = {
    id: "22222222-2222-4222-8222-222222222222",
    client_id: "00000000-0000-4000-8000-000000000001",
    name: "Inovação",
    description: "Tecnologia e saúde",
    color: "#3347D6",
    weight_pct: 100,
    weekly_target: 3,
    position: 0,
    archived_at: null,
  };
  const client = { name: "PodBest", segment: "Podcast Médico", tone: "Autoridade acessível", notes: "" };
  const itemId = "11111111-1111-4111-8111-111111111111";

  const cp = buildClassificationPrompt({
    client,
    pillars: [pillar],
    memoryBlock: "Evitar promessas exageradas; sempre creditar o convidado.",
    items: [
      {
        id: itemId,
        title: "Corte 01",
        transcript: "",
        brief: "Texto do .doc sobre IA na Medicina",
        drive_meta: { name: "corte01.mp4" },
        source_folder_name: "01 - Prof. Lucio Flavio - IA na Medicina",
        guest_name: "Prof. Lucio Flavio",
        topic_tag: "IA na Medicina",
        cover_idea: "A IA vai substituir o médico?",
        caption_instagram: "Legenda IG",
        caption_linkedin: "Legenda LI",
      },
    ],
  });
  assert.ok(cp.includes("Evitar promessas exageradas"));
  assert.ok(cp.includes("Prof. Lucio Flavio"));
  assert.ok(cp.includes("A IA vai substituir o médico?"));
  assert.ok(cp.includes("caption_instagram"));
  assert.ok(cp.includes("caption_linkedin"));

  const parsed = parseAiClassification(
    {
      classifications: [
        {
          item_id: itemId,
          pillar_id: pillar.id,
          title: "IA na Medicina sem perder humanidade",
          theme_key: "ia-medicina-humanidade",
          guest_name: "Prof. Lucio Flavio",
          topic_tag: "IA na Medicina",
          cover_idea: "A IA vai substituir o médico?",
          brief: "Resumo estruturado a partir do .doc",
          hook: "Você acha que a IA substitui o médico?",
          caption_instagram: "Versão IG refinada",
          caption_linkedin: "Versão LI refinada",
          confidence: 0.95,
        },
      ],
    },
    { validItemIds: new Set([itemId]), validPillarIds: new Set([pillar.id]) },
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.entries[0].guest_name, "Prof. Lucio Flavio");
    assert.equal(parsed.entries[0].topic_tag, "IA na Medicina");
    assert.equal(parsed.entries[0].cover_idea, "A IA vai substituir o médico?");
    assert.equal(parsed.entries[0].caption_instagram, "Versão IG refinada");
    assert.equal(parsed.entries[0].caption_linkedin, "Versão LI refinada");
  }

  const calp = buildCalendarPrompt({
    client,
    pillars: [pillar],
    existingReady: [
      {
        id: itemId,
        pillar_id: pillar.id,
        title: "IA na Medicina",
        theme_key: "ia-medicina",
        brief: "Resumo",
        guest_name: "Prof. Lucio Flavio",
        topic_tag: "IA na Medicina",
        cover_idea: "A IA vai substituir o médico?",
      },
    ],
    recentThemeKeys: [],
    slots: [{ planned_day: "2026-12-01", planned_time: "10:00", network: "instagram", format: "reels" }],
  });
  assert.ok(calp.includes("ALTERNÂNCIA DE CONVIDADOS"));
  assert.ok(calp.includes("ALTERNÂNCIA DE ASSUNTOS"));
  assert.ok(calp.includes('convidado: "Prof. Lucio Flavio"'));
});

test("guestFromEpisodeFolderName tira o convidado do nome do episódio", async () => {
  const { guestFromEpisodeFolderName, guestFromAncestors } = await import("../src/lib/drive-cuts.ts");
  assert.equal(guestFromEpisodeFolderName("Ep - 1 Lúcio Flávio"), "Lúcio Flávio");
  assert.equal(guestFromEpisodeFolderName("Ep -2 Leonardo Milner"), "Leonardo Milner");
  assert.equal(guestFromEpisodeFolderName("Ep - 3 Philllip Dmitruk"), "Philllip Dmitruk");
  assert.equal(guestFromEpisodeFolderName("PodBest #1 - Prof. Lúcio Flávio Magalhães"), "Prof. Lúcio Flávio Magalhães");
  assert.equal(guestFromEpisodeFolderName("Episódio 12: Dra. Ana"), "Dra. Ana");
  assert.equal(guestFromEpisodeFolderName("PodbestFast 1 - Hospitalar 2026"), "");
  assert.equal(guestFromEpisodeFolderName("Cortes_Reels"), "");
  assert.equal(guestFromEpisodeFolderName("01 - O que faz um físico médico hoje"), "");
  assert.equal(guestFromAncestors(["Ep - 1 Lúcio Flávio", "Cortes_Reels"]), "Lúcio Flávio");
  assert.equal(guestFromAncestors([]), "");
});

test("scanClientCutFolders varre a pasta inteira (episódios e subpastas) e ignora ano, Logotipo e Reels Editados", async () => {
  const F = "application/vnd.google-apps.folder";
  const drive = await startMockDrive(4074, {
    tree: [
      { id: "ROOT_PODREC_0001", name: "PodBest", mimeType: F, parents: [] },
      { id: "LOGO_PODREC_0001", name: "Logotipo", mimeType: F, parents: ["ROOT_PODREC_0001"] },
      { id: "LOGO_PODREC_FILE", name: "logo.png", mimeType: "image/png", size: 10, parents: ["LOGO_PODREC_0001"] },
      { id: "YEAR_PODREC_2026", name: "2026", mimeType: F, parents: ["ROOT_PODREC_0001"] },
      { id: "MONT_PODREC_0011", name: "11 - Novembro", mimeType: F, parents: ["YEAR_PODREC_2026"] },
      { id: "YVID_PODREC_0001", name: "postado.mp4", mimeType: "video/mp4", size: 10, parents: ["MONT_PODREC_0011"] },
      { id: "REEL_PODREC_0001", name: "Reels Editados", mimeType: F, parents: ["ROOT_PODREC_0001"] },
      { id: "RVID_PODREC_0001", name: "pronto.mp4", mimeType: "video/mp4", size: 10, parents: ["REEL_PODREC_0001"] },
      // Episódio 1: Ep / Cortes_Reels / 01 - ... (corte sem vídeo, só legenda e capa) e 07 - ... (com vídeo)
      { id: "EP01_PODREC_0001", name: "Ep - 1 Lúcio Flávio", mimeType: F, parents: ["ROOT_PODREC_0001"] },
      { id: "CRTS_PODREC_0001", name: "Cortes_Reels", mimeType: F, parents: ["EP01_PODREC_0001"] },
      { id: "C101_PODREC_0001", name: "01 - Quer ser médico só pra vestir branco", mimeType: F, parents: ["CRTS_PODREC_0001"] },
      { id: "C101_PODREC_CAPA", name: "capa.jpg", mimeType: "image/jpeg", size: 10, parents: ["C101_PODREC_0001"] },
      { id: "C101_PODREC_LEGE", name: "Podbest_Ep1_corte01_legenda.txt", mimeType: "text/plain", parents: ["C101_PODREC_0001"], content: "Legenda Instagram: IG 1" },
      { id: "C101_PODREC_TEXT", name: "Podbest_Ep1_corte01_textos_Instagram_LinkedIn.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", parents: ["C101_PODREC_0001"], content: "x" },
      { id: "C107_PODREC_0001", name: "07 - Interesse é fome de conhecimento", mimeType: F, parents: ["CRTS_PODREC_0001"] },
      { id: "C107_PODREC_VIDE", name: "corte07_vertical.mp4", mimeType: "video/mp4", size: 10, parents: ["C107_PODREC_0001"] },
      // Episódio 2: Ep / 01 - ... direto
      { id: "EP02_PODREC_0001", name: "Ep -2 Leonardo Milner", mimeType: F, parents: ["ROOT_PODREC_0001"] },
      { id: "C201_PODREC_0001", name: "01 - Comprar equipamento sem ouvir quem entende", mimeType: F, parents: ["EP02_PODREC_0001"] },
      { id: "C201_PODREC_VIDE", name: "EP 2 Corte 1.mp4", mimeType: "video/mp4", size: 10, parents: ["C201_PODREC_0001"] },
      // Pasta vazia não vira corte.
      { id: "VAZI_PODREC_0001", name: "Rascunhos", mimeType: F, parents: ["ROOT_PODREC_0001"] },
    ],
  });
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${drive.port}`;
  process.env.DRIVE_TEST_TOKEN = "token-teste";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "teste@mock.local", private_key: "fake-key" });
  try {
    const { scanClientCutFolders } = await import("../src/lib/drive.ts");
    const scanned = await scanClientCutFolders("ROOT_PODREC_0001");
    assert.ok(!("error" in scanned));
    assert.deepEqual(
      scanned.cut_folders.map((c) => [...c.path, c.folder_name].join(" / ")),
      [
        "Ep - 1 Lúcio Flávio / Cortes_Reels / 01 - Quer ser médico só pra vestir branco",
        "Ep - 1 Lúcio Flávio / Cortes_Reels / 07 - Interesse é fome de conhecimento",
        "Ep -2 Leonardo Milner / 01 - Comprar equipamento sem ouvir quem entende",
      ],
    );
    assert.equal(scanned.folders_truncated, false);
    const c101 = scanned.cut_folders[0];
    assert.equal(c101.detected_guest, "Lúcio Flávio");
    assert.equal(c101.detected_topic, "Quer ser médico só pra vestir branco");
    assert.equal(c101.docs.length, 2, "lê a legenda e os textos por rede");
    assert.equal(scanned.cut_folders[2].detected_guest, "Leonardo Milner");
  } finally {
    await drive.close();
  }
});
