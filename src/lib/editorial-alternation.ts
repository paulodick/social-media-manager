import type { AiCalendarEntry } from "./editorial-types.ts";

export type AlternationMeta = {
  guest?: string | null;
  topic?: string | null;
  pillar?: string | null;
};

/** Normaliza texto de convidado/assunto para comparação sem acentos nem caixa. */
export function normalizeAlternationKey(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Ordena itens minimizando repetições consecutivas de:
 * 1) convidado/participante (`guest`) — prioridade máxima
 * 2) assunto/tema (`topic`) — segunda prioridade
 * 3) pilar (`pillar`) — terceira prioridade
 *
 * Usa seleção gulosa pelo maior saldo restante (max-frequency interleaving),
 * garantindo alternância perfeita sempre que matematicamente possível.
 */
export function orderWithAlternation<T>(items: T[], getMeta: (item: T) => AlternationMeta): T[] {
  if (items.length <= 2) {
    // Ainda evita colisão se possível em 2 itens? Com 2 itens a ordem não muda adjacência, mas mantém estabilidade.
    return [...items];
  }

  const annotated = items.map((item, idx) => {
    const m = getMeta(item);
    return {
      item,
      idx,
      guest: normalizeAlternationKey(m.guest),
      topic: normalizeAlternationKey(m.topic),
      pillar: normalizeAlternationKey(m.pillar),
      used: false,
    };
  });

  const guestRemaining = new Map<string, number>();
  const topicRemaining = new Map<string, number>();
  for (const a of annotated) {
    if (a.guest) guestRemaining.set(a.guest, (guestRemaining.get(a.guest) ?? 0) + 1);
    if (a.topic) topicRemaining.set(a.topic, (topicRemaining.get(a.topic) ?? 0) + 1);
  }

  const result: T[] = [];
  let prevGuest = "";
  let prevTopic = "";
  let prevPillar = "";

  for (let step = 0; step < annotated.length; step++) {
    let bestIdx = -1;
    let bestPenalty = Infinity;
    let bestGuestFreq = -1;
    let bestTopicFreq = -1;

    for (let i = 0; i < annotated.length; i++) {
      const cand = annotated[i];
      if (cand.used) continue;

      let penalty = 0;
      if (prevGuest && cand.guest && cand.guest === prevGuest) penalty += 1000;
      if (prevTopic && cand.topic && cand.topic === prevTopic) penalty += 100;
      if (prevPillar && cand.pillar && cand.pillar === prevPillar) penalty += 10;

      const gFreq = cand.guest ? (guestRemaining.get(cand.guest) ?? 0) : 0;
      const tFreq = cand.topic ? (topicRemaining.get(cand.topic) ?? 0) : 0;

      const better =
        penalty < bestPenalty ||
        (penalty === bestPenalty && gFreq > bestGuestFreq) ||
        (penalty === bestPenalty && gFreq === bestGuestFreq && tFreq > bestTopicFreq);

      if (better) {
        bestIdx = i;
        bestPenalty = penalty;
        bestGuestFreq = gFreq;
        bestTopicFreq = tFreq;
      }
    }

    const chosen = annotated[bestIdx];
    chosen.used = true;
    result.push(chosen.item);
    if (chosen.guest) guestRemaining.set(chosen.guest, Math.max(0, (guestRemaining.get(chosen.guest) ?? 1) - 1));
    if (chosen.topic) topicRemaining.set(chosen.topic, Math.max(0, (topicRemaining.get(chosen.topic) ?? 1) - 1));
    prevGuest = chosen.guest;
    prevTopic = chosen.topic;
    prevPillar = chosen.pillar;
  }

  return result;
}

/** Conta quantas colisões consecutivas de convidado e de assunto existem numa sequência. */
export function countAlternationCollisions<T>(
  items: T[],
  getMeta: (item: T) => AlternationMeta,
): { guestCollisions: number; topicCollisions: number } {
  let guestCollisions = 0;
  let topicCollisions = 0;
  let prevGuest = "";
  let prevTopic = "";

  for (const item of items) {
    const m = getMeta(item);
    const g = normalizeAlternationKey(m.guest);
    const t = normalizeAlternationKey(m.topic);
    if (prevGuest && g && g === prevGuest) guestCollisions++;
    if (prevTopic && t && t === prevTopic) topicCollisions++;
    prevGuest = g;
    prevTopic = t;
  }

  return { guestCollisions, topicCollisions };
}

/**
 * Reordena o conteúdo atribuído aos slots de um calendário gerado (por trilha de rede/formato)
 * preservando datas e horários, mas garantindo alternância de convidados e assuntos.
 */
export function enforceCalendarAlternation(
  entries: AiCalendarEntry[],
  itemMetaById: Map<string, AlternationMeta>,
): AiCalendarEntry[] {
  if (entries.length <= 2) return [...entries];

  // Agrupa índices por (network, format) para manter cada trilha coerente cronologicamente
  const byTrack = new Map<string, number[]>();
  entries.forEach((e, idx) => {
    const key = `${e.network}:${e.format}`;
    byTrack.set(key, [...(byTrack.get(key) ?? []), idx]);
  });

  const out = [...entries];

  for (const indices of byTrack.values()) {
    if (indices.length <= 2) continue;
    // Ordena os índices desta trilha por data/hora
    const sortedIndices = [...indices].sort((ia, ib) => {
      const a = entries[ia];
      const b = entries[ib];
      if (a.planned_day !== b.planned_day) return a.planned_day.localeCompare(b.planned_day);
      return (a.planned_time ?? "99:99").localeCompare(b.planned_time ?? "99:99");
    });

    const payloads = sortedIndices.map((i) => {
      const e = entries[i];
      return {
        source_kind: e.source_kind,
        existing_item_id: e.existing_item_id,
        pillar_id: e.pillar_id,
        new_item: e.new_item,
      };
    });

    const reordered = orderWithAlternation(payloads, (p) => {
      if (p.source_kind === "existing_ready" && p.existing_item_id) {
        const meta = itemMetaById.get(p.existing_item_id);
        return {
          guest: meta?.guest,
          topic: meta?.topic,
          pillar: meta?.pillar ?? p.pillar_id,
        };
      }
      return {
        guest: "",
        topic: p.new_item?.theme_key ?? "",
        pillar: p.pillar_id,
      };
    });

    sortedIndices.forEach((origIdx, pos) => {
      const slot = entries[origIdx];
      const p = reordered[pos];
      out[origIdx] = {
        planned_day: slot.planned_day,
        planned_time: slot.planned_time,
        network: slot.network,
        format: slot.format,
        source_kind: p.source_kind,
        existing_item_id: p.existing_item_id,
        pillar_id: p.pillar_id,
        new_item: p.new_item,
      };
    });
  }

  return out;
}
