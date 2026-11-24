import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonPayload,
  normalizeThemeKey,
  parseAiCalendar,
  parseAiClassification,
  parseAiRecreatedTopic,
  parseAiRefinedDraft,
  parsePillarsInput,
  summarizePillarWeights,
  validateSlides,
} from "../src/lib/editorial-rules.ts";
import { createServer } from "node:http";
import { assetFolderNames } from "../src/lib/post-folders.ts";
import { buildCalendarPrompt, buildClassificationPrompt, buildPillarsPrompt } from "../src/lib/editorial-prompts.ts";
import { editorialAiConfigured, explainGeminiError, generateEditorialJson } from "../src/lib/editorial-ai.ts";
import { buildMemoryBlock, summarizeCaptionDiff } from "../src/lib/ai-memory.ts";
import { buildCaptionPrompt } from "../src/lib/prompt.ts";

test("normalizeThemeKey gera slug ASCII sem acentos", () => {
  assert.equal(normalizeThemeKey("5 Erros em Manutenção!"), "5-erros-em-manutencao");
  assert.equal(normalizeThemeKey("  Bastidores: Produção & Edição  "), "bastidores-producao-edicao");
});

test("validateSlides respeita regras de imagem estática e carrossel", () => {
  const slide = { headline: "Capa", body: "Texto", cta: "Saiba mais", visual_notes: "Fundo claro" };
  assert.equal(validateSlides("static", [slide]), null);
  assert.notEqual(validateSlides("static", [slide, slide]), null);
  assert.notEqual(validateSlides("carousel", [slide]), null);
  assert.equal(validateSlides("carousel", [slide, slide]), null);
  assert.notEqual(validateSlides("carousel", Array.from({ length: 11 }, () => slide)), null);
});

test("summarizePillarWeights soma pesos e indica equilíbrio em 100%", () => {
  assert.deepEqual(summarizePillarWeights([40, 30, 30]), { total: 100, balanced: true });
  assert.deepEqual(summarizePillarWeights([50, 20]), { total: 70, balanced: false });
});

test("assetFolderNames segue padrão AAAA / MM - Mês / DD / Artes / Título", () => {
  assert.deepEqual(assetFolderNames("2026-11-23", "Carrossel: Dicas/Úteis"), [
    "2026",
    "11 - Novembro",
    "23",
    "Artes",
    "Carrossel: Dicas Úteis",
  ]);
  assert.deepEqual(assetFolderNames("2026-11-23", ""), ["2026", "11 - Novembro", "23", "Artes", "Sem título"]);
});

test("parseAiClassification valida UUIDs do cliente e normaliza theme_key", () => {
  const itemA = "11111111-1111-4111-8111-111111111111";
  const pillarA = "22222222-2222-4222-8222-222222222222";
  const raw = extractJsonPayload(`\`\`\`json
  {
    "classifications": [
      {
        "item_id": "${itemA}",
        "pillar_id": "${pillarA}",
        "title": "Como evitar falhas no compressor",
        "theme_key": "Como Evitar Falhas no Compressor",
        "brief": "Resumo do vídeo pronto.",
        "hook": "Você está cometendo esse erro?",
        "confidence": 0.92
      }
    ]
  }
  \`\`\``);
  const ok = parseAiClassification(raw, {
    validItemIds: new Set([itemA]),
    validPillarIds: new Set([pillarA]),
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.entries[0].theme_key, "como-evitar-falhas-no-compressor");
  }

  const bad = parseAiClassification(
    { classifications: [{ item_id: "33333333-3333-4333-8333-333333333333", pillar_id: null, title: "X", theme_key: "x", brief: "", confidence: 0.5 }] },
    { validItemIds: new Set([itemA]), validPillarIds: new Set([pillarA]) },
  );
  assert.equal(bad.ok, false);
});

test("parseAiCalendar alterna existing_ready e needs_creation e bloqueia tema repetido", () => {
  const existingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const pillarId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const ok = parseAiCalendar(
    {
      entries: [
        {
          planned_day: "2026-12-01",
          planned_time: "09:30",
          network: "instagram",
          format: "reels",
          source_kind: "existing_ready",
          existing_item_id: existingId,
          pillar_id: pillarId,
          new_item: null,
        },
        {
          planned_day: "2026-12-03",
          planned_time: "18:00",
          network: "instagram",
          format: "feed",
          source_kind: "needs_creation",
          existing_item_id: null,
          pillar_id: pillarId,
          new_item: {
            title: "3 sinais de desgaste na peça",
            theme_key: "3-sinais-de-desgaste-na-peca",
            hook: "Se ouvir esse barulho, pare imediatamente.",
            angle: "Prevenção prática para gestores",
            brief: "Explicar os 3 sinais visuais e sonoros.",
            script: "Cena 1: close na peça...",
            caption_draft: "Fique atento aos 3 sinais.",
            tones: ["profissional"],
          },
        },
      ],
    },
    {
      validPillarIds: new Set([pillarId]),
      validExistingIds: new Set([existingId]),
      existingThemeKeys: new Set(["tema-antigo"]),
    },
  );
  assert.equal(ok.ok, true);

  // Bloqueia theme_key já existente no histórico do cliente
  const dup = parseAiCalendar(
    {
      entries: [
        {
          planned_day: "2026-12-05",
          planned_time: null,
          network: "instagram",
          format: "feed",
          source_kind: "needs_creation",
          existing_item_id: null,
          pillar_id: pillarId,
          new_item: {
            title: "Tema antigo repetido",
            theme_key: "tema-antigo",
            hook: "Gancho",
            angle: "Ângulo",
            brief: "Resumo",
            script: "",
            caption_draft: "",
            tones: [],
          },
        },
      ],
    },
    {
      validPillarIds: new Set([pillarId]),
      validExistingIds: new Set([existingId]),
      existingThemeKeys: new Set(["tema-antigo"]),
    },
  );
  assert.equal(dup.ok, false);
});

test("buildClassificationPrompt e buildCalendarPrompt incluem pilares, prontos e temas recentes", () => {
  const pillar = {
    id: "22222222-2222-4222-8222-222222222222",
    client_id: "00000000-0000-4000-8000-000000000001",
    name: "Educativo",
    description: "Dicas práticas",
    color: "#3347D6",
    weight_pct: 50,
    weekly_target: 2,
    position: 0,
    archived_at: null,
  };
  const client = { name: "Best Medical", segment: "Equipamentos", tone: "Profissional", notes: "" };

  const cp = buildClassificationPrompt({
    client,
    pillars: [pillar],
    items: [{ id: "11111111-1111-4111-8111-111111111111", title: "Video 1", transcript: "Como limpar o filtro", brief: "", drive_meta: null }],
  });
  assert.ok(cp.includes("Educativo"));
  assert.ok(cp.includes("50%"));
  assert.ok(cp.includes("Como limpar o filtro"));

  const calp = buildCalendarPrompt({
    client,
    pillars: [pillar],
    existingReady: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", pillar_id: pillar.id, title: "Pronto", theme_key: "pronto-1", brief: "Resumo" }],
    recentThemeKeys: ["tema-ja-postado"],
    slots: [{ planned_day: "2026-12-01", planned_time: "09:30", network: "instagram", format: "reels" }],
  });
  assert.ok(calp.includes("existing_ready"));
  assert.ok(calp.includes("needs_creation"));
  assert.ok(calp.includes("tema-ja-postado"));
  assert.ok(calp.includes("2026-12-01"));
});

test("explainGeminiError traduz erros HTTP em frases em português", () => {
  assert.match(explainGeminiError(400, "API key not valid"), /GEMINI_API_KEY/);
  assert.match(explainGeminiError(403, "Forbidden"), /GEMINI_API_KEY/);
  assert.match(explainGeminiError(429, "Resource exhausted"), /limite de uso/);
  assert.match(explainGeminiError(503, "Unavailable"), /instável/);
});

test("generateEditorialJson envia responseMimeType application/json e faz fallback em 404", async () => {
  let receivedMime = "";
  let receivedKey = "";
  let calls = 0;
  const srv = createServer(async (req, res) => {
    calls++;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    receivedKey = url.searchParams.get("key") ?? "";
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      generationConfig?: { responseMimeType?: string };
    };
    receivedMime = body.generationConfig?.responseMimeType ?? "";
    if (calls === 1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"entries":[]}' }] } }] }));
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const prevKey = process.env.GEMINI_API_KEY;
  const prevBase = process.env.GEMINI_API_BASE;
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_API_BASE = `http://127.0.0.1:${port}`;
    assert.equal(editorialAiConfigured(), true);
    const out = await generateEditorialJson("Monte o calendário");
    assert.deepEqual(out, { text: '{"entries":[]}' });
    assert.equal(calls, 2);
    assert.equal(receivedMime, "application/json");
    assert.equal(receivedKey, "test-gemini-key");
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.GEMINI_API_BASE;
    else process.env.GEMINI_API_BASE = prevBase;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test("parsePillarsInput aceita array direto e { pillars } e buildPillarsPrompt inclui marca", () => {
  const fromArr = parsePillarsInput([
    { name: "Educativo", weight_pct: 60 },
    { name: "Oferta", weight_pct: 40, color: "#c2410c" },
  ]);
  assert.equal(fromArr.ok, true);
  if (fromArr.ok) {
    assert.equal(fromArr.pillars.length, 2);
    assert.equal(fromArr.pillars[1].color, "#c2410c");
  }

  const fromTargetShare = parsePillarsInput([
    { name: "Reparar antes de trocar", target_share: 35, description: "Critérios de decisão." },
    { name: "Disponibilidade", target_share: 25, description: "Suporte 24h." },
  ]);
  assert.equal(fromTargetShare.ok, true);
  if (fromTargetShare.ok) {
    assert.equal(fromTargetShare.pillars[0].weight_pct, 35);
    assert.equal(fromTargetShare.pillars[1].weight_pct, 25);
  }

  const fromObj = parsePillarsInput({ pillars: [{ name: "Bastidores", weight_pct: 100 }] });
  assert.equal(fromObj.ok, true);

  const empty = parsePillarsInput([]);
  assert.equal(empty.ok, false);

  const p = buildPillarsPrompt({ name: "Best Medical", segment: "Saúde", tone: "Técnico", notes: "" });
  assert.ok(p.includes("Best Medical"));
  assert.ok(p.includes("100"));
});

test("parseAiCalendar extrai script_structured e content_format para vídeos", () => {
  const pillarId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const parsed = parseAiCalendar(
    {
      entries: [
        {
          planned_day: "2026-12-10",
          planned_time: "10:00",
          network: "instagram",
          format: "reels",
          source_kind: "needs_creation",
          existing_item_id: null,
          pillar_id: pillarId,
          new_item: {
            title: "Quando reparar em vez de trocar",
            content_format: "video",
            theme_key: "quando-reparar-em-vez-de-trocar",
            hook: "Não troque antes de checar estes 3 pontos.",
            angle: "Economia técnica",
            brief: "Explicar critérios de reparo.",
            script_structured: {
              hook_0_3s: "Você pode estar jogando dinheiro fora.",
              development_topics: ["Checar placa", "Medir sensor", "Avaliar garantia"],
              cta: "Comente ORÇAMENTO para avaliar.",
            },
            caption_draft: "Legenda base.",
            tones: ["profissional"],
          },
        },
      ],
    },
    {
      validPillarIds: new Set([pillarId]),
      validExistingIds: new Set(),
      existingThemeKeys: new Set(),
    },
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const ni = parsed.entries[0].new_item!;
    assert.equal(ni.content_format, "video");
    assert.equal(ni.script_hook, "Você pode estar jogando dinheiro fora.");
    assert.ok(ni.script_dev.includes("Checar placa"));
    assert.equal(ni.script_cta, "Comente ORÇAMENTO para avaliar.");
  }
});

test("summarizeCaptionDiff, buildMemoryBlock e buildCaptionPrompt bilíngue", () => {
  assert.equal(summarizeCaptionDiff("Texto igual", "Texto igual"), null);
  const diff = summarizeCaptionDiff(
    "Texto bem longo gerado pela IA com várias hashtags #um #dois #tres #quatro para testar o resumo",
    "Texto direto.\nSegunda linha.",
  );
  assert.ok(diff && diff.includes("encurtou o texto") && diff.includes("reduziu hashtags"));

  const mem = buildMemoryBlock(
    [
      {
        id: "1",
        workspace_id: "w1",
        event_type: "caption_edited_on_publish",
        pillar_id: null,
        format: "reels",
        content_summary: "Manutenção",
        user_feedback_or_diff: "encurtou o texto",
        created_at: "2026-11-23",
      },
    ],
    "Evitar jargão complexo.",
  );
  assert.ok(mem.includes("Evitar jargão complexo."));
  assert.ok(mem.includes("encurtou o texto"));

  const capPrompt = buildCaptionPrompt({
    client: { name: "Best Medical", segment: "Saúde", site: "", tone: "Técnico", notes: "" },
    network: "instagram",
    format: "reels",
    plan: "Dica de manutenção",
    bilingual: true,
    memoryBlock: mem,
  });
  assert.ok(capPrompt.includes("Português do Brasil"));
  assert.ok(capPrompt.includes("Inglês"));
  assert.ok(capPrompt.includes("Evitar jargão complexo."));
});

test("parseAiRecreatedTopic evita tema repetido e parseAiRefinedDraft extrai campos evoluídos", () => {
  const avoid = new Set(["tema-antigo"]);
  const dup = parseAiRecreatedTopic(
    { title: "Tema Antigo", theme_key: "tema-antigo", hook: "Gancho", brief: "Resumo" },
    { avoidThemeKeys: avoid, fallbackFormat: "video" },
  );
  assert.equal(dup.ok, false);

  const ok = parseAiRecreatedTopic(
    {
      title: "Calibração preventiva em hospitais",
      theme_key: "calibracao-preventiva-em-hospitais",
      hook: "Um erro de calibração custa caro.",
      angle: "Segurança do paciente",
      reason_why: "Aborda dor direta de engenharia clínica sem repetir manutenção básica.",
      brief: "Mostrar impacto da calibração.",
      script_structured: {
        hook_0_3s: "Você confia na leitura do seu monitor?",
        development_topics: ["Erro de sensor", "Periodicidade"],
        cta: "Peça um checklist.",
      },
    },
    { avoidThemeKeys: avoid, fallbackFormat: "video" },
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.topic.reason_why, "Aborda dor direta de engenharia clínica sem repetir manutenção básica.");
    assert.equal(ok.topic.script_cta, "Peça um checklist.");
  }

  const refined = parseAiRefinedDraft({
    hook: "Gancho mais forte",
    angle: "Ângulo direto",
    brief: "Brief refinado com exemplo prático.",
    script_hook: "Gancho 0-3s",
    script_dev: ["Tópico 1", "Tópico 2"],
    script_cta: "Chame no WhatsApp",
    caption_draft: "Legenda evoluída.",
  });
  assert.equal(refined.ok, true);
  if (refined.ok) {
    assert.ok(refined.draft.script_dev.includes("Tópico 1"));
    assert.equal(refined.draft.caption_draft, "Legenda evoluída.");
  }
});
