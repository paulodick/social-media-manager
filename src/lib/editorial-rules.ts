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

/** Extrai JSON de resposta do LLM (aceita bloco ```json ... ``` ou JSON puro). */
export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const text = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(text);
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
    const conf = typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : 0.5;
    entries.push({ item_id: r.item_id, pillar_id: pillarId, title, theme_key: themeKey, brief, hook, confidence: conf });
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
      const title = String(ni.title ?? "").trim().slice(0, 160);
      const themeKey = normalizeThemeKey(String(ni.theme_key ?? title));
      const hook = String(ni.hook ?? "").trim().slice(0, 240);
      const angle = String(ni.angle ?? "").trim().slice(0, 300);
      const brief = String(ni.brief ?? "").trim().slice(0, 1500);
      const script = String(ni.script ?? "").trim().slice(0, 4000);
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
        new_item: { title, theme_key: themeKey, hook, angle, brief, script, caption_draft: captionDraft, tones },
      });
    }
  }
  return { ok: true, entries };
}
