import test from "node:test";
import assert from "node:assert/strict";
import { parseDriveUrl, driveQuote, folderUrl, cleanFolderName } from "../src/lib/drive.ts";
import { hasTitle, captionLabel, folderGroup, targetFolders, legacyTargetFolders, acceptedFolders } from "../src/config/networks.ts";
import { captionChecks, mediaChecks, thumbChecks, titleChecks, readiness, countHashtags, cutCaption } from "../src/lib/checks.ts";
import { hashPassword, verifyPassword, passwordProblem } from "../src/lib/password.ts";
import sharp from "sharp";
import { processLogo } from "../src/lib/logo-image.ts";
import { explainAiError } from "../src/lib/ai.ts";
import { buildCaptionPrompt, buildToneBlock, splitGenerated } from "../src/lib/prompt.ts";
import { TONES, MAX_TONES, validateTones, toneBlockedReason } from "../src/config/tones.ts";
import { monthGrid, addMonths, dayLabel, isDay, isTime, dayFolders, weekStart, weekDays, weekLabel, weekdayShort } from "../src/lib/dates.ts";

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

test("checagem de miniatura do YouTube", () => {
  const MB = 1024 * 1024;
  const boa = { mimeType: "image/png", width: 3840, height: 2160, size: 1.5 * MB };
  assert.ok(thumbChecks("youtube", "longo", boa).length >= 3);
  assert.ok(thumbChecks("youtube", "longo", boa).every((c) => c.level === "ok"));
  // 16:9 mas pequena demais (largura mínima 640 px)
  assert.ok(thumbChecks("youtube", "longo", { ...boa, width: 480, height: 270 }).some((c) => c.level === "warn" && /mínimo/.test(c.text)));
  // vertical num vídeo longo
  assert.ok(thumbChecks("youtube", "longo", { ...boa, width: 1080, height: 1920 }).some((c) => c.level === "warn" && /proporção/.test(c.text)));
  // pesada: avisa o limite de 2 MB do celular, mas não passa de 50 MB
  assert.ok(thumbChecks("youtube", "longo", { ...boa, size: 5 * MB }).some((c) => c.level === "warn" && /2 MB/.test(c.text)));
  assert.ok(thumbChecks("youtube", "longo", { ...boa, size: 60 * MB }).some((c) => c.level === "warn" && /50 MB/.test(c.text)));
  // não é imagem
  assert.ok(thumbChecks("youtube", "longo", { mimeType: "video/mp4" }).some((c) => c.level === "warn"));
  // Shorts pedem 9:16 e altura mínima
  assert.ok(thumbChecks("youtube", "shorts", { mimeType: "image/jpeg", width: 1080, height: 1920, size: MB }).every((c) => c.level === "ok"));
  // sem miniatura ligada; erro do Drive; formato que não usa miniatura
  assert.ok(thumbChecks("youtube", "longo", null).some((c) => /ainda não há/.test(c.text)));
  assert.ok(thumbChecks("youtube", "longo", { error: "sem acesso" }).some((c) => /sem acesso/.test(c.text)));
  assert.deepEqual(thumbChecks("instagram", "reels", null), []);
});

test("checagem do título (YouTube, 100 caracteres)", () => {
  assert.ok(titleChecks("youtube", "x".repeat(100)).every((c) => c.level === "ok"));
  assert.ok(titleChecks("youtube", "x".repeat(101)).some((c) => c.level === "warn"));
  assert.deepEqual(titleChecks("instagram", "x".repeat(500)), []);
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

test("pastas do dia seguem o padrão do Drive", () => {
  assert.deepEqual(dayFolders("2026-11-21"), ["2026", "11 - Novembro", "21"]);
  assert.deepEqual(dayFolders("2027-03-05"), ["2027", "03 - Março", "05"]);
  assert.deepEqual(dayFolders("2026-12-31"), ["2026", "12 - Dezembro", "31"]);
});

test("busca de pasta no Drive: escape e link", () => {
  assert.equal(driveQuote("Vídeo longo"), "Vídeo longo");
  assert.equal(driveQuote("d'Água"), "d\\'Água");
  assert.equal(driveQuote("a\\b"), "a\\\\b");
  assert.equal(folderUrl("abc123"), "https://drive.google.com/drive/folders/abc123");
});

test("buildCaptionPrompt reúne cliente, tom, ideia, descrição, ajustes e limites da rede", () => {
  const client = { name: "Best Medical", segment: "Diagnóstico por imagem", site: "", tone: "Técnico e direto.", notes: "Evitar promessas de prazo." };
  const p = buildCaptionPrompt({ client, network: "instagram", format: "reels", plan: "Plantão 24h", captionDraft: "" });
  assert.match(p, /Best Medical \(Diagnóstico por imagem\)/);
  assert.match(p, /Instagram, formato Reels/);
  assert.match(p, /Técnico e direto\./);
  assert.match(p, /Evitar promessas de prazo\./);
  assert.match(p, /Ideia do post[^\n]*\nPlantão 24h/);
  assert.match(p, /9:16/);
  assert.doesNotMatch(p, /Descrição da legenda/);
  assert.doesNotMatch(p, /Legenda atual/);
  assert.doesNotMatch(p, /Ajustes pedidos/);
  assert.doesNotMatch(p, /Site:/);
  assert.doesNotMatch(p, /Título:/);

  // Hashtags: variam com o tema, mas as fixas da marca (nas Observações) ficam
  assert.match(p, /Hashtags: varie de acordo com o tema deste post/);
  assert.match(p, /mantenha todas elas/);
  const q = buildCaptionPrompt({ client, network: "linkedin", format: "feed", plan: "", captionDraft: "Minha legenda" });
  assert.match(q, /não informado/);
  assert.match(q, /Legenda atual[^\n]*\nMinha legenda/);

  const r = buildCaptionPrompt({
    client, network: "instagram", format: "feed", plan: "Ideia X", brief: "Falar do plantão e chamar no WhatsApp", captionDraft: "Versão antiga", custom: "Mais curta, sem tom de propaganda",
  });
  assert.match(r, /Ideia do post[^\n]*\nIdeia X/);
  assert.match(r, /Descrição da legenda[^\n]*\nFalar do plantão e chamar no WhatsApp/);
  assert.match(r, /Legenda atual[^\n]*\nVersão antiga/);
  assert.match(r, /Ajustes pedidos[^\n]*\nMais curta, sem tom de propaganda/);

  // só a descrição, sem ideia do dia: não pede o tema
  const only = buildCaptionPrompt({ client, network: "instagram", format: "feed", plan: "", brief: "Só a descrição" });
  assert.doesNotMatch(only, /não informado/);
  assert.match(only, /Só a descrição/);
});

test("buildCaptionPrompt pede título e legenda nos formatos com título", () => {
  const client = { name: "Best", segment: "", site: "", tone: "", notes: "" };
  const yt = buildCaptionPrompt({ client, network: "youtube", format: "longo", plan: "x" });
  assert.match(yt, /título separado da legenda \(até 100 caracteres\)/);
  assert.match(yt, /"Título:"/);
  assert.match(yt, /"Legenda:"/);
  const li = buildCaptionPrompt({ client, network: "linkedin", format: "documento", plan: "x" });
  assert.match(li, /título separado da legenda\./);
  assert.doesNotMatch(buildCaptionPrompt({ client, network: "linkedin", format: "feed", plan: "x" }), /Título:/);
});

test("splitGenerated separa título e legenda só quando o formato tem título", () => {
  assert.deepEqual(splitGenerated("Título: Plantão 24h\n\nLegenda: Texto da legenda\ncom duas linhas", true), {
    title: "Plantão 24h",
    caption: "Texto da legenda\ncom duas linhas",
  });
  assert.deepEqual(splitGenerated('título: "Reparar antes de trocar"\nDescrição: Vídeo explicando.', true), {
    title: "Reparar antes de trocar",
    caption: "Vídeo explicando.",
  });
  // fora do formato esperado: tudo vira legenda
  assert.deepEqual(splitGenerated("Só um texto solto", true), { title: "", caption: "Só um texto solto" });
  // formato sem título: não mexe no texto
  assert.deepEqual(splitGenerated("Título: não é título aqui\n\nLegenda: x", false), { title: "", caption: "Título: não é título aqui\n\nLegenda: x" });
});

test("cleanFolderName tira barras e caracteres de controle e limita o tamanho", () => {
  assert.equal(cleanFolderName("  Best   Medical  "), "Best Medical");
  assert.equal(cleanFolderName("Clínica A/B\\C"), "Clínica A B C");
  assert.equal(cleanFolderName("a\u0000b\nc"), "a b c");
  assert.equal(cleanFolderName("   "), "");
  assert.equal(cleanFolderName("x".repeat(300)).length, 120);
});

test("hasTitle e captionLabel seguem a configuração dos formatos", () => {
  assert.equal(hasTitle("youtube", "shorts"), true);
  assert.equal(hasTitle("youtube", "longo"), true);
  assert.equal(hasTitle("linkedin", "documento"), true);
  assert.equal(hasTitle("instagram", "reels"), false);
  assert.equal(hasTitle("linkedin", "feed"), false);
  assert.equal(hasTitle("nao-existe", "x"), false);
  assert.equal(captionLabel("youtube", "longo"), "Descrição");
  assert.equal(captionLabel("youtube", "shorts"), "Legenda");
  assert.equal(captionLabel("instagram", "feed"), "Legenda");
});

test("explainAiError traduz os erros da API", () => {
  assert.match(explainAiError(401, ""), /chave da API foi recusada/);
  assert.match(explainAiError(400, "Your credit balance is too low to access the API"), /sem saldo/);
  assert.match(explainAiError(429, ""), /limite de uso/);
  assert.match(explainAiError(529, ""), /sobrecarregada/);
  assert.match(explainAiError(418, ""), /código 418/);
});

test("processLogo reduz para 512 px e mantém a transparência", async () => {
  const big = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0 } } })
    .png()
    .toBuffer();
  const out = await processLogo(big);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 256);
  assert.equal(meta.hasAlpha, true);
  const small = await sharp({ create: { width: 100, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  assert.equal((await sharp(await processLogo(small)).metadata()).width, 100);
  await assert.rejects(() => processLogo(Buffer.from("isto não é uma imagem")));
});

test("semana vai de segunda a domingo", () => {
  assert.equal(weekStart("2026-11-21"), "2026-11-16"); // sábado
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // domingo fica na semana que termina nele
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // segunda
  assert.equal(weekStart("2026-01-01"), "2025-12-29"); // vira o ano
  assert.deepEqual(weekDays("2026-11-30"), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.equal(weekLabel("2026-11-16"), "16 a 22 de novembro de 2026");
  assert.equal(weekLabel("2026-11-30"), "30 de novembro a 6 de dezembro de 2026");
  assert.equal(weekLabel("2025-12-29"), "29 de dezembro de 2025 a 4 de janeiro de 2026");
  assert.equal(weekdayShort("2026-11-16"), "Seg");
  assert.equal(weekdayShort("2026-11-22"), "Dom");
});

test("situação do post na semana", () => {
  const base = { network: "instagram" as const, format: "reels", status: "scheduled", caption: "Legenda boa #um", title: "Plantão", thumb_meta: null };
  const video = { name: "a.mp4", mimeType: "video/mp4", width: 1080, height: 1920, size: 1000, durationMs: 20000 };
  assert.equal(readiness({ ...base, drive_meta: null }).state, "missing");
  assert.equal(readiness({ ...base, status: "posted", drive_meta: null }).state, "posted");
  assert.equal(readiness({ ...base, drive_meta: video }).state, "ok");
  const wrong = readiness({ ...base, drive_meta: { ...video, width: 1920, height: 1080 } });
  assert.equal(wrong.state, "warn");
  assert.equal(wrong.label, "1 aviso");
  const empty = readiness({ ...base, caption: "", drive_meta: { ...video, width: 1920, height: 1080 } });
  assert.equal(empty.warns, 2);
  assert.equal(empty.label, "2 avisos");
  // YouTube vídeo longo sem miniatura ligada vira aviso
  const yt = readiness({ network: "youtube", format: "longo", status: "draft", caption: "Descrição", title: "Título", thumb_meta: null, drive_meta: { mimeType: "video/mp4", width: 1920, height: 1080 } });
  assert.equal(yt.state, "warn");
});

test("pastas agrupadas: Reels, Shorts, TikTok e Kwai dividem uma pasta; Stories, outra", () => {
  for (const [n, f] of [["instagram", "reels"], ["facebook", "reels"], ["youtube", "shorts"], ["tiktok", "video"], ["kwai", "video"]]) {
    assert.equal(folderGroup(n, f)?.id, "curto", `${n}:${f}`);
    assert.deepEqual(targetFolders(n, f), ["Reels-Shorts-TikTok-Kwai"]);
  }
  for (const [n, f] of [["instagram", "stories"], ["facebook", "stories"]]) {
    assert.equal(folderGroup(n, f)?.id, "stories");
    assert.deepEqual(targetFolders(n, f), ["Stories"]);
  }
  // Fora dos grupos: continua Rede / Formato
  assert.equal(folderGroup("linkedin", "feed"), null);
  assert.deepEqual(targetFolders("linkedin", "feed"), ["LinkedIn", "Feed"]);
  assert.deepEqual(targetFolders("youtube", "longo"), ["YouTube", "Video longo"]);
  assert.deepEqual(targetFolders("instagram", "feed"), ["Instagram", "Feed"]);
  assert.deepEqual(targetFolders("tiktok", "fotos"), ["TikTok", "Fotos"]);
  assert.equal(targetFolders("orkut", "x"), null);
  assert.deepEqual(legacyTargetFolders("instagram", "reels"), ["Instagram", "Reels"]);
});

test("pastas aceitas na conferência: atual, antiga e a de outro formato do grupo", () => {
  const tiktok = acceptedFolders("tiktok", "video").map((p) => p.join("/"));
  assert.ok(tiktok.includes("Reels-Shorts-TikTok-Kwai"));
  assert.ok(tiktok.includes("TikTok/Video"));
  assert.ok(tiktok.includes("Instagram/Reels"));
  assert.ok(!tiktok.includes("Instagram/Stories"));
  assert.deepEqual(acceptedFolders("linkedin", "feed").map((p) => p.join("/")), ["LinkedIn/Feed"]);
});

test("tons de voz: 11 tons com instrução da configuração", () => {
  assert.equal(TONES.length, 11);
  assert.equal(new Set(TONES.map((t) => t.id)).size, 11);
  for (const t of TONES) assert.ok(t.instruction.startsWith(`${t.label}:`), t.id);
  assert.equal(MAX_TONES, 3);
});

test("tons de voz: limite de 3 e pares que se excluem", () => {
  assert.equal(toneBlockedReason("narrativo", []), null);
  assert.equal(toneBlockedReason("narrativo", ["tecnico", "didatico", "carinhoso"]), "Limite de 3 tons");
  // 4º tom bloqueado, mas os marcados podem ser desmarcados
  assert.equal(toneBlockedReason("tecnico", ["tecnico", "didatico", "carinhoso"]), null);
  assert.equal(toneBlockedReason("descontraido", ["formal"]), "Não combina com Formal");
  assert.equal(toneBlockedReason("humorado", ["formal"]), "Não combina com Formal");
  assert.equal(toneBlockedReason("formal", ["descontraido"]), "Não combina com Descontraído");
  assert.equal(toneBlockedReason("humorado", ["urgente"]), "Não combina com Urgente");
  assert.equal(toneBlockedReason("urgente", ["humorado"]), "Não combina com Humorado");
  assert.equal(toneBlockedReason("descontraido", ["humorado"]), null);
});

test("tons de voz: validação do servidor", () => {
  assert.deepEqual(validateTones([]), { tones: [] });
  assert.deepEqual(validateTones(["tecnico", "narrativo", "descontraido"]), { tones: ["tecnico", "narrativo", "descontraido"] });
  assert.deepEqual(validateTones(["tecnico", "tecnico"]), { tones: ["tecnico"] });
  assert.ok("error" in validateTones(["inventado"]));
  assert.ok("error" in validateTones(["tecnico", "didatico", "carinhoso", "narrativo"]));
  assert.ok("error" in validateTones(["formal", "descontraido"]));
  assert.ok("error" in validateTones(["formal", "humorado"]));
  assert.ok("error" in validateTones(["urgente", "humorado"]));
});

test("buildToneBlock: vazio sem tons; ordem de prioridade; ignora ids desconhecidos", () => {
  assert.equal(buildToneBlock(undefined), "");
  assert.equal(buildToneBlock([]), "");
  assert.equal(buildToneBlock(["x"]), "");
  const b = buildToneBlock(["tecnico", "narrativo", "descontraido"]);
  assert.ok(b.startsWith("Tom de voz deste post: combine os estilos abaixo, do mais importante para o menos importante.\n1. Técnico:"));
  assert.ok(b.includes("\n2. Narrativo:"));
  assert.ok(b.includes("\n3. Descontraído:"));
  assert.ok(b.endsWith("use os estilos acima para a forma de escrever."));
});

test("pedido de legenda: sem tons fica igual ao de antes; com tons entra o mesmo bloco e o ajuste vem depois", () => {
  const base = { client: { name: "Best Medical", segment: "Imagem", site: "", tone: "Direto e técnico", notes: "Não usar a palavra barato" }, network: "instagram" as const, format: "reels", plan: "Plantão 24h" };
  const sem = buildCaptionPrompt(base);
  assert.equal(sem, buildCaptionPrompt({ ...base, tones: [] }));
  assert.ok(!sem.includes("Tom de voz deste post"));
  const tones = ["tecnico", "narrativo", "descontraido"];
  const com = buildCaptionPrompt({ ...base, tones, custom: "mais curta" });
  assert.ok(com.includes(buildToneBlock(tones)));
  assert.ok(com.indexOf("Tom de voz do cliente") < com.indexOf("Tom de voz deste post"));
  assert.ok(com.indexOf("Tom de voz deste post") < com.indexOf("Ajustes pedidos para esta legenda (siga à risca)"));
});
