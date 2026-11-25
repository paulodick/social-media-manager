import { isFormat, isNetwork } from "../config/networks.ts";
import { validateTones } from "../config/tones.ts";
import { isDay, isTime } from "./dates.ts";
import {
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  type AiCalendarEntry,
  type AiClassificationEntry,
  type AssetKind,
  type SlideInput,
} from "./editorial-types.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Normaliza um tema para slug ASCII (ex.: "5 Erros em Manutenção!" -> "5-erros-em-manutencao"). */
export function normalizeThemeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Valida slides de carrossel ou imagem estática. Devolve mensagem em português ou null se válido. */
export function validateSlides(kind: AssetKind, slides: SlideInput[]): string | null {
  if (!Array.isArray(slides)) return "A lista de slides é inválida.";
  if (kind === "static") {
    if (slides.length !== 1) return "Imagem estática precisa ter exatamente 1 slide.";
  } else {
    if (slides.length < CAROUSEL_MIN_SLIDES) {
      return `Carrossel precisa ter pelo menos ${CAROUSEL_MIN_SLIDES} slides.`;
    }
    if (slides.length > CAROUSEL_MAX_SLIDES) {
      return `Carrossel pode ter no máximo ${CAROUSEL_MAX_SLIDES} slides.`;
    }
  }
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!s || typeof s !== "object") return `O slide ${i + 1} é inválido.`;
    if (s.id !== undefined && !isUuid(s.id)) return `O identificador do slide ${i + 1} é inválido.`;
    if (typeof s.headline !== "string" || s.headline.length > 200) return `O título do slide ${i + 1} é inválido.`;
    if (typeof s.body !== "string" || s.body.length > 2000) return `O texto do slide ${i + 1} é inválido.`;
    if (typeof s.cta !== "string" || s.cta.length > 200) return `O CTA do slide ${i + 1} é inválido.`;
    if (typeof s.visual_notes !== "string" || s.visual_notes.length > 1000) {
      return `As notas visuais do slide ${i + 1} são inválidas.`;
    }
  }
  return null;
}

/** Calcula a soma dos pesos percentuais de pilares ativos (aviso quando != 100%, sem bloquear). */
export function summarizePillarWeights(weights: number[]): { total: number; balanced: boolean } {
  const total = weights.reduce((acc, w) => acc + (Number.isFinite(w) ? Math.max(0, Math.round(w)) : 0), 0);
  return { total, balanced: total === 100 };
}

/** Extrai JSON de resposta do LLM ou texto colado (aceita bloco ```json ... ``` ou JSON cercado por texto). */
export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBracket = candidate.search(/[\[{]/);
    const lastSquare = candidate.lastIndexOf("]");
    const lastCurly = candidate.lastIndexOf("}");
    const lastBracket = Math.max(lastSquare, lastCurly);
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return JSON.parse(candidate.slice(firstBracket, lastBracket + 1));
    }
    throw new SyntaxError("JSON inválido");
  }
}

/** Valida e normaliza o JSON de classificação de itens existentes retornado pelo LLM. */
export function parseAiClassification(
  input: unknown,
  opts: { validItemIds: Set<string>; validPillarIds: Set<string> },
): { ok: true; entries: AiClassificationEntry[] } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Resposta da IA inválida (objeto esperado)." };
  const rawList = (input as { classifications?: unknown }).classifications;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { ok: false, error: "Resposta da IA sem classificações." };
  }
  const entries: AiClassificationEntry[] = [];
  for (const row of rawList) {
    if (!row || typeof row !== "object") return { ok: false, error: "Item de classificação inválido." };
    const r = row as Record<string, unknown>;
    if (!isUuid(r.item_id) || !opts.validItemIds.has(r.item_id)) {
      return { ok: false, error: "A classificação referencia um item que não pertence ao cliente." };
    }
    let pillarId: string | null = null;
    if (r.pillar_id !== null && r.pillar_id !== undefined) {
      if (!isUuid(r.pillar_id) || !opts.validPillarIds.has(r.pillar_id)) {
        return { ok: false, error: "A classificação referencia um pilar inexistente neste cliente." };
      }
      pillarId = r.pillar_id;
    }
    const title = String(r.title ?? "").trim().slice(0, 160);
    if (!title) return { ok: false, error: "Título vazio na classificação da IA." };
    const themeKey = normalizeThemeKey(String(r.theme_key ?? title));
    if (!themeKey) return { ok: false, error: "Chave de tema inválida na classificação da IA." };
    const brief = String(r.brief ?? "").trim().slice(0, 1500);
    const hook = String(r.hook ?? "").trim().slice(0, 240);
    const guestName = r.guest_name !== undefined ? String(r.guest_name ?? "").trim().slice(0, 120) : undefined;
    const topicTag = r.topic_tag !== undefined ? String(r.topic_tag ?? "").trim().slice(0, 120) : undefined;
    const coverIdea = r.cover_idea !== undefined ? String(r.cover_idea ?? "").trim().slice(0, 300) : undefined;
    const captionInstagram =
      r.caption_instagram !== undefined ? String(r.caption_instagram ?? "").trim().slice(0, 4000) : undefined;
    const captionLinkedin =
      r.caption_linkedin !== undefined ? String(r.caption_linkedin ?? "").trim().slice(0, 4000) : undefined;
    const captionDraft =
      r.caption_draft !== undefined ? String(r.caption_draft ?? "").trim().slice(0, 4000) : undefined;
    const conf = typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : 0.5;
    entries.push({
      item_id: r.item_id,
      pillar_id: pillarId,
      title,
      theme_key: themeKey,
      ...(guestName !== undefined ? { guest_name: guestName } : {}),
      ...(topicTag !== undefined ? { topic_tag: topicTag } : {}),
      ...(coverIdea !== undefined ? { cover_idea: coverIdea } : {}),
      ...(captionInstagram !== undefined ? { caption_instagram: captionInstagram } : {}),
      ...(captionLinkedin !== undefined ? { caption_linkedin: captionLinkedin } : {}),
      ...(captionDraft !== undefined ? { caption_draft: captionDraft } : {}),
      brief,
      hook,
      confidence: conf,
    });
  }
  return { ok: true, entries };
}

/** Valida e normaliza o JSON de calendário editorial gerado pelo LLM, bloqueando repetição de tema. */
export function parseAiCalendar(
  input: unknown,
  opts: {
    validPillarIds: Set<string>;
    validExistingIds: Set<string>;
    existingThemeKeys: Set<string>;
  },
): { ok: true; entries: AiCalendarEntry[] } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Resposta da IA inválida (objeto esperado)." };
  const rawList = (input as { entries?: unknown }).entries;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { ok: false, error: "Resposta da IA sem entradas de calendário." };
  }
  const seenThemes = new Set<string>(opts.existingThemeKeys);
  const seenExisting = new Set<string>();
  const entries: AiCalendarEntry[] = [];

  for (const row of rawList) {
    if (!row || typeof row !== "object") return { ok: false, error: "Entrada de calendário inválida." };
    const r = row as Record<string, unknown>;
    const day = String(r.planned_day ?? "");
    if (!isDay(day)) return { ok: false, error: `Data planejada inválida: "${day}".` };
    let time: string | null = null;
    if (r.planned_time !== null && r.planned_time !== undefined && r.planned_time !== "") {
      const t = String(r.planned_time);
      if (!isTime(t)) return { ok: false, error: `Horário planejado inválido: "${t}".` };
      time = t;
    }
    const network = String(r.network ?? "");
    const format = String(r.format ?? "");
    if (!isNetwork(network) || !isFormat(network, format)) {
      return { ok: false, error: `Rede ou formato inválido no calendário: ${network}/${format}.` };
    }
    if (!isUuid(r.pillar_id) || !opts.validPillarIds.has(r.pillar_id)) {
      return { ok: false, error: "Entrada do calendário referencia um pilar inexistente neste cliente." };
    }
    const sourceKind = r.source_kind;
    if (sourceKind !== "existing_ready" && sourceKind !== "needs_creation") {
      return { ok: false, error: "Tipo de origem inválido no calendário." };
    }

    if (sourceKind === "existing_ready") {
      if (!isUuid(r.existing_item_id) || !opts.validExistingIds.has(r.existing_item_id)) {
        return { ok: false, error: "Conteúdo existente referenciado não pertence ao cliente." };
      }
      if (seenExisting.has(r.existing_item_id)) {
        return { ok: false, error: "O mesmo conteúdo pronto foi repetido no calendário." };
      }
      seenExisting.add(r.existing_item_id);
      entries.push({
        planned_day: day,
        planned_time: time,
        network,
        format,
        source_kind: "existing_ready",
        existing_item_id: r.existing_item_id,
        pillar_id: r.pillar_id,
        new_item: null,
      });
    } else {
      const ni = r.new_item as Record<string, unknown> | null | undefined;
      if (!ni || typeof ni !== "object") {
        return { ok: false, error: "Entrada needs_creation exige o objeto new_item." };
      }
      const rawFormat = String(ni.content_format ?? "video").trim();
      const contentFormat =
        rawFormat === "video" || rawFormat === "carousel" || rawFormat === "static_image"
          ? rawFormat
          : "video";

      const title = String(ni.title ?? "").trim().slice(0, 160);
      const themeKey = normalizeThemeKey(String(ni.theme_key ?? title));
      const hook = String(ni.hook ?? "").trim().slice(0, 240);
      const angle = String(ni.angle ?? "").trim().slice(0, 300);
      const brief = String(ni.brief ?? "").trim().slice(0, 1500);

      const ss = (ni.script_structured ?? null) as Record<string, unknown> | null;
      const scriptHook = String(ss?.hook_0_3s ?? ni.script_hook ?? hook).trim().slice(0, 500);
      const devRaw = ss?.development_topics ?? ni.script_dev;
      const scriptDev = Array.isArray(devRaw)
        ? devRaw.map((x) => `- ${String(x).trim()}`).join("\n").slice(0, 2500)
        : String(devRaw ?? "").trim().slice(0, 2500);
      const scriptCta = String(ss?.cta ?? ni.script_cta ?? "").trim().slice(0, 500);

      let script = String(ni.script ?? "").trim().slice(0, 4000);
      if (!script && (scriptHook || scriptDev || scriptCta)) {
        script = [
          scriptHook ? `Gancho (0-3s): ${scriptHook}` : "",
          scriptDev ? `Desenvolvimento:\n${scriptDev}` : "",
          scriptCta ? `CTA: ${scriptCta}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000);
      }

      const captionDraft = String(ni.caption_draft ?? "").trim().slice(0, 4000);
      if (!title || !themeKey || !hook || !angle || !brief) {
        return { ok: false, error: "Item inédito precisa de título, theme_key, gancho, ângulo e resumo." };
      }
      if (seenThemes.has(themeKey)) {
        return { ok: false, error: `Tema repetido detectado no calendário: "${themeKey}".` };
      }
      seenThemes.add(themeKey);

      const rawTones = Array.isArray(ni.tones) ? ni.tones.map(String) : [];
      const tonesCheck = validateTones(rawTones);
      const tones = "tones" in tonesCheck ? tonesCheck.tones : [];

      entries.push({
        planned_day: day,
        planned_time: time,
        network,
        format,
        source_kind: "needs_creation",
        existing_item_id: null,
        pillar_id: r.pillar_id,
        new_item: {
          title,
          content_format: contentFormat,
          theme_key: themeKey,
          hook,
          angle,
          brief,
          script,
          script_hook: scriptHook,
          script_dev: scriptDev,
          script_cta: scriptCta,
          caption_draft: captionDraft,
          tones,
        },
      });
    }
  }
  return { ok: true, entries };
}

export type PillarImportEntry = {
  name: string;
  description: string;
  color: string;
  weight_pct: number;
  weekly_target: number | null;
};

const DEFAULT_PILLAR_COLORS = ["#3347D6", "#c2410c", "#1b4d2e", "#6b4a00", "#912018", "#596579"];

/**
 * Valida e normaliza um array de pilares (ou `{ pillars: [...] }`) para importação em lote ou resposta do Gemini.
 */
export function parsePillarsInput(
  input: unknown,
): { ok: true; pillars: PillarImportEntry[] } | { ok: false; error: string } {
  const rawList = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? (input as { pillars?: unknown }).pillars
      : null;

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { ok: false, error: "Informe um array JSON com ao menos um pilar." };
  }
  if (rawList.length > 20) {
    return { ok: false, error: "Importe no máximo 20 pilares por vez." };
  }

  const pillars: PillarImportEntry[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const row = rawList[i];
    if (!row || typeof row !== "object") {
      return { ok: false, error: `O pilar na posição ${i + 1} é inválido.` };
    }
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? "").trim().slice(0, 80);
    if (!name) return { ok: false, error: `O pilar na posição ${i + 1} precisa de um nome.` };
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const description = String(r.description ?? "").trim().slice(0, 300);
    const rawColor = String(r.color ?? "").trim();
    const color = HEX_COLOR_RE.test(rawColor)
      ? rawColor
      : DEFAULT_PILLAR_COLORS[i % DEFAULT_PILLAR_COLORS.length];

    const rawWeight = Number(r.weight_pct ?? r.target_share ?? r.weight ?? r.peso ?? r.percentage ?? 0);
    const weight_pct = Number.isFinite(rawWeight) ? Math.min(100, Math.max(0, Math.round(rawWeight))) : 0;

    let weekly_target: number | null = null;
    if (r.weekly_target !== undefined && r.weekly_target !== null && r.weekly_target !== "") {
      const wt = Number(r.weekly_target);
      if (Number.isFinite(wt)) weekly_target = Math.min(21, Math.max(0, Math.round(wt)));
    }

    pillars.push({ name, description, color, weight_pct, weekly_target });
  }

  return { ok: true, pillars };
}

export type AiRecreatedTopic = {
  title: string;
  content_format: "video" | "carousel" | "static_image";
  theme_key: string;
  hook: string;
  angle: string;
  reason_why: string;
  brief: string;
  script: string;
  script_hook: string;
  script_dev: string;
  script_cta: string;
  caption_draft: string;
  tones: string[];
};

export function parseAiRecreatedTopic(
  input: unknown,
  opts: { avoidThemeKeys: Set<string>; fallbackFormat: "video" | "carousel" | "static_image" },
): { ok: true; topic: AiRecreatedTopic } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Resposta da IA inválida ao recriar tópico." };
  }
  const r = input as Record<string, unknown>;
  const title = String(r.title ?? "").trim().slice(0, 160);
  const themeKey = normalizeThemeKey(String(r.theme_key ?? title));
  const hook = String(r.hook ?? "").trim().slice(0, 240);
  const angle = String(r.angle ?? "").trim().slice(0, 300);
  const reasonWhy = String(r.reason_why ?? "").trim().slice(0, 400);
  const brief = String(r.brief ?? "").trim().slice(0, 1500);
  if (!title || !themeKey || !hook || !brief) {
    return { ok: false, error: "O tópico recriado pela IA precisa de título, gancho e resumo." };
  }
  if (opts.avoidThemeKeys.has(themeKey)) {
    return { ok: false, error: `A IA sugeriu um tema repetido ("${themeKey}"). Tente recriar novamente.` };
  }

  const rawFmt = String(r.content_format ?? opts.fallbackFormat).trim();
  const content_format =
    rawFmt === "video" || rawFmt === "carousel" || rawFmt === "static_image" ? rawFmt : opts.fallbackFormat;

  const ss = (r.script_structured ?? null) as Record<string, unknown> | null;
  const scriptHook = String(ss?.hook_0_3s ?? r.script_hook ?? hook).trim().slice(0, 500);
  const devRaw = ss?.development_topics ?? r.script_dev;
  const scriptDev = Array.isArray(devRaw)
    ? devRaw.map((x) => `- ${String(x).trim()}`).join("\n").slice(0, 2500)
    : String(devRaw ?? "").trim().slice(0, 2500);
  const scriptCta = String(ss?.cta ?? r.script_cta ?? "").trim().slice(0, 500);
  const script =
    String(r.script ?? "").trim().slice(0, 4000) ||
    [
      scriptHook ? `Gancho (0-3s): ${scriptHook}` : "",
      scriptDev ? `Desenvolvimento:\n${scriptDev}` : "",
      scriptCta ? `CTA: ${scriptCta}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);

  const rawTones = Array.isArray(r.tones) ? r.tones.map(String) : [];
  const tonesCheck = validateTones(rawTones);
  const tones = "tones" in tonesCheck ? tonesCheck.tones : [];

  return {
    ok: true,
    topic: {
      title,
      content_format,
      theme_key: themeKey,
      hook,
      angle,
      reason_why: reasonWhy,
      brief,
      script,
      script_hook: scriptHook,
      script_dev: scriptDev,
      script_cta: scriptCta,
      caption_draft: String(r.caption_draft ?? "").trim().slice(0, 4000),
      tones,
    },
  };
}

export type AiRefinedDraft = {
  title?: string;
  hook: string;
  angle: string;
  brief: string;
  script_hook: string;
  script_dev: string;
  script_cta: string;
  caption_draft: string;
};

export function parseAiRefinedDraft(input: unknown): { ok: true; draft: AiRefinedDraft } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Resposta da IA inválida ao refinar rascunho." };
  }
  const r = input as Record<string, unknown>;
  const brief = String(r.brief ?? "").trim().slice(0, 1500);
  const hook = String(r.hook ?? "").trim().slice(0, 240);
  if (!brief && !hook) {
    return { ok: false, error: "A IA não retornou um rascunho refinado." };
  }
  const title = String(r.title ?? "").trim().slice(0, 160);
  const devRaw = r.script_dev;
  const scriptDev = Array.isArray(devRaw)
    ? devRaw.map((x) => `- ${String(x).trim()}`).join("\n").slice(0, 2500)
    : String(devRaw ?? "").trim().slice(0, 2500);

  return {
    ok: true,
    draft: {
      ...(title ? { title } : {}),
      hook,
      angle: String(r.angle ?? "").trim().slice(0, 300),
      brief,
      script_hook: String(r.script_hook ?? hook).trim().slice(0, 500),
      script_dev: scriptDev,
      script_cta: String(r.script_cta ?? "").trim().slice(0, 500),
      caption_draft: String(r.caption_draft ?? "").trim().slice(0, 4000),
    },
  };
}

/**
 * Valida a lista de dias da semana (0..6) do gerador editorial.
 * Exige ao menos um dia válido, sem fallback silencioso.
 */
export function parseGenerateWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const valid = [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))];
  return valid.length > 0 ? valid : null;
}

/**
 * Confere se o calendário devolvido pela IA (ou colado à mão) cabe nos horários pedidos: só dias do período e dos
 * dias da semana marcados, só as redes/formatos escolhidos, no máximo um item por dia + rede + formato.
 * Sem isso, uma resposta fora do pedido criava posts em domingos desmarcados, em redes não escolhidas ou em dobro.
 * Devolve a frase do problema, ou null se está tudo certo. Função pura, com teste.
 */
export function checkCalendarFitsSlots(
  entries: { planned_day: string; network: string; format: string }[],
  slots: { planned_day: string; network: string; format: string }[],
): string | null {
  const allowed = new Set(slots.map((s) => `${s.planned_day}|${s.network}|${s.format}`));
  const used = new Set<string>();
  for (const e of entries) {
    const key = `${e.planned_day}|${e.network}|${e.format}`;
    if (!allowed.has(key)) {
      return `A resposta trouxe ${e.planned_day} em ${e.network}/${e.format}, que está fora do período, dos dias da semana ou das redes escolhidas. Gere de novo.`;
    }
    if (used.has(key)) {
      return `A resposta trouxe mais de um conteúdo para ${e.planned_day} em ${e.network}/${e.format}. Gere de novo.`;
    }
    used.add(key);
  }
  return null;
}
