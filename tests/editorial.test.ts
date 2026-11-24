import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonPayload,
  normalizeThemeKey,
  parseAiCalendar,
  parseAiClassification,
  summarizePillarWeights,
  validateSlides,
} from "../src/lib/editorial-rules.ts";
import { createServer } from "node:http";
import { assetFolderNames } from "../src/lib/post-folders.ts";
import { buildCalendarPrompt, buildClassificationPrompt } from "../src/lib/editorial-prompts.ts";
import { editorialAiConfigured, explainGeminiError, generateEditorialJson } from "../src/lib/editorial-ai.ts";

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

test("generateEditorialJson envia responseMimeType application/json para o Gemini", async () => {
  let receivedMime = "";
  let receivedKey = "";
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    receivedKey = url.searchParams.get("key") ?? "";
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      generationConfig?: { responseMimeType?: string };
    };
    receivedMime = body.generationConfig?.responseMimeType ?? "";
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
