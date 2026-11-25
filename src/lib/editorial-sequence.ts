// Sequência de postagem montada pela IA: mistura vídeos já gravados (pasta "Reels Editados", com transcrição)
// com pautas novas e dias sem post, numa cadência fixa ("a cada N dias"). Aqui ficam as partes puras (datas, pedido
// para a IA e conferência da resposta), com teste. Banco e Drive ficam na rota e em editorial-sequence-store.ts.
import { addDays } from "./dates.ts";
import { isUuid, normalizeThemeKey } from "./editorial-rules.ts";

export const SEQUENCE_MAX_POSTS = 30;
export const TRANSCRIPT_EXCERPT_CHARS = 1500;

/** Datas dos posts: `count` datas a partir de `start`, de `everyDays` em `everyDays` dias. */
export function sequenceDates(start: string, everyDays: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i * everyDays));
}

/** Último dia para gravar e editar uma pauta nova que sai em `day`. */
export function recordByDay(day: string, leadDays: number): string {
  return addDays(day, -leadDays);
}

export type ReadyVideo = {
  id: string;
  title: string;
  topic: string;
  guest: string;
  transcript: string;
  /** Ficha feita pela IA na sincronização (vazio enquanto não houver ficha). */
  summary?: string;
  pillar?: string;
  audience?: string;
  flags?: string[];
  hook?: string;
  caption_instagram?: string;
  caption_linkedin?: string;
  drive_url?: string;
  folder?: string;
  profiled?: boolean;
};

/** Com ficha, a IA da sequência precisa de menos transcrição: o resumo já diz do que o vídeo trata. */
export const TRANSCRIPT_EXCERPT_WITH_PROFILE = 600;

export type SequenceEntry =
  | { date: string; kind: "ready"; item_id: string; theme: string; reason: string }
  | {
      date: string;
      kind: "new";
      theme: string;
      reason: string;
      idea: { title: string; theme_key: string; hook: string; brief: string; script: string };
    }
  | { date: string; kind: "skip"; reason: string };

/** Corta a transcrição para caber no pedido sem perder o começo (onde costuma estar o assunto). */
export function transcriptExcerpt(text: string, max = TRANSCRIPT_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

export function buildSequencePrompt(input: {
  clientName: string;
  segment: string;
  tone: string;
  notes: string;
  styleNotes: string;
  memoryBlock: string;
  pillars: string[];
  ready: ReadyVideo[];
  recent: { day: string; title: string; topic: string }[];
  dates: string[];
  today: string;
  leadDays: number;
  networks: string[];
}): string {
  const firstNewDay = addDays(input.today, input.leadDays);
  const ready = input.ready.length
    ? input.ready
        .map(
          (v, i) =>
            [
              `${i + 1}. item_id: ${v.id}`,
              `   título: ${v.title}`,
              v.topic ? `   tema: ${v.topic}` : "",
              v.summary ? `   resumo: ${v.summary}` : "",
              v.pillar ? `   pilar: ${v.pillar}` : "",
              v.audience ? `   público: ${v.audience}` : "",
              v.guest ? `   convidado: ${v.guest}` : "",
              v.flags?.includes("uncertain") ? "   atenção: transcrição com trechos incertos" : "",
              `   transcrição: ${transcriptExcerpt(v.transcript, v.summary ? TRANSCRIPT_EXCERPT_WITH_PROFILE : TRANSCRIPT_EXCERPT_CHARS) || "(sem transcrição)"}`,
            ]
              .filter(Boolean)
              .join("\n"),
        )
        .join("\n")
    : "(nenhum vídeo pronto disponível)";
  const recent = input.recent.length
    ? input.recent.map((r) => `- ${r.day}: ${r.title}${r.topic ? ` (${r.topic})` : ""}`).join("\n")
    : "(nada publicado ou agendado recentemente)";
  return [
    `Você é o estrategista de conteúdo de redes sociais do cliente "${input.clientName}"${input.segment ? ` (${input.segment})` : ""}.`,
    input.tone ? `Tom de voz do cliente: ${input.tone}` : "",
    input.notes ? `Observações do cliente: ${input.notes}` : "",
    input.styleNotes ? `Diretrizes de estilo: ${input.styleNotes}` : "",
    input.memoryBlock,
    input.pillars.length ? `Pilares de conteúdo: ${input.pillars.join("; ")}.` : "",
    `Redes onde cada post sai: ${input.networks.join(", ")}.`,
    "",
    "TAREFA: decidir o que postar em CADA uma destas datas, uma entrada por data, nesta ordem:",
    input.dates.join(", "),
    "",
    "Para cada data escolha UM tipo:",
    `- "ready": um dos vídeos já gravados abaixo (use o item_id exato). Cada vídeo pode ser usado no máximo uma vez.`,
    `- "new": uma pauta nova para gravar, com tema DIFERENTE do que as transcrições já cobrem, para o conteúdo parecer sempre renovado. Só é permitido em datas a partir de ${firstNewDay} (a pessoa precisa de ${input.leadDays} dia(s) para gravar e editar).`,
    `- "skip": não postar nesse dia. Use SÓ quando não houver vídeo pronto que caiba sem repetir o tema do post anterior E ainda não der tempo de gravar uma pauta nova. Nunca use para "pausa estratégica", "equilibrar frequência" ou "responder comentários": a pessoa escolheu postar nessas datas. Explique o motivo.`,
    "",
    "Como decidir a ordem: use o tema, o resumo, o pilar e o público de cada vídeo (e a transcrição) para entender o assunto real; evite dois posts seguidos do mesmo tema ou do mesmo pilar;",
    "alterne vídeos prontos e pautas novas para nunca ficar sem conteúdo; pense no que prende a atenção e alcança mais gente nas redes hoje;",
    "não repita temas publicados recentemente.",
    "",
    "VÍDEOS JÁ GRAVADOS (com transcrição):",
    ready,
    "",
    "PUBLICADO OU AGENDADO RECENTEMENTE (não repetir):",
    recent,
    "",
    'Responda SOMENTE com JSON neste formato: {"entries":[',
    '{"date":"AAAA-MM-DD","kind":"ready","item_id":"<id>","theme":"<tema em até 4 palavras>","reason":"<por que aqui, 1 frase>"},',
    '{"date":"AAAA-MM-DD","kind":"new","theme":"<tema em até 4 palavras>","reason":"<por que aqui>","idea":{"title":"<título>","hook":"<gancho dos primeiros 3 segundos>","brief":"<o que falar>","script":"<roteiro curto>"}},',
    '{"date":"AAAA-MM-DD","kind":"skip","reason":"<por que não postar>"}',
    "]}",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Tema curto para a etiqueta: corta em até 60 caracteres sem partir palavra. */
export function shortTheme(t: string): string {
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim()}…`;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Confere a resposta da IA antes de gravar: uma entrada por data pedida, vídeo pronto existente e sem repetir,
 * pauta nova só quando dá tempo de gravar. Devolve as entradas na ordem das datas ou a frase do problema.
 */
export function parseSequencePlan(
  raw: unknown,
  opts: { dates: string[]; readyIds: Set<string>; today: string; leadDays: number },
): { ok: true; entries: SequenceEntry[] } | { ok: false; error: string } {
  const list = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return { ok: false, error: 'A resposta não tem a lista "entries".' };
  const wanted = new Set(opts.dates);
  const byDate = new Map<string, SequenceEntry>();
  const usedReady = new Set<string>();
  const firstNewDay = addDays(opts.today, opts.leadDays);

  for (const e of list as Record<string, unknown>[]) {
    const date = str(e?.date, 10);
    if (!wanted.has(date)) return { ok: false, error: `A resposta trouxe a data ${date || "(vazia)"}, que não foi pedida.` };
    if (byDate.has(date)) return { ok: false, error: `A resposta trouxe mais de um conteúdo para ${date}.` };
    const kind = str(e.kind, 10);
    const reason = str(e.reason, 400);
    const theme = shortTheme(str(e.theme, 200));
    if (kind === "ready") {
      const id = str(e.item_id, 40);
      if (!isUuid(id) || !opts.readyIds.has(id)) {
        return { ok: false, error: `Em ${date} a resposta usou um vídeo que não está entre os prontos.` };
      }
      if (usedReady.has(id)) return { ok: false, error: `A resposta usou o mesmo vídeo pronto mais de uma vez (${date}).` };
      usedReady.add(id);
      byDate.set(date, { date, kind, item_id: id, theme, reason });
    } else if (kind === "new") {
      if (date < firstNewDay) {
        return {
          ok: false,
          error: `Em ${date} a resposta pôs uma pauta nova, mas não dá tempo de gravar (prazo de ${opts.leadDays} dia(s)).`,
        };
      }
      const idea = (e.idea ?? {}) as Record<string, unknown>;
      const title = str(idea.title, 160);
      if (!title) return { ok: false, error: `A pauta nova de ${date} veio sem título.` };
      byDate.set(date, {
        date,
        kind,
        theme,
        reason,
        idea: {
          title,
          theme_key: normalizeThemeKey(theme || title),
          hook: str(idea.hook, 1000),
          brief: str(idea.brief, 4000),
          script: str(idea.script, 8000),
        },
      });
    } else if (kind === "skip") {
      byDate.set(date, { date, kind, reason: reason || "Sem conteúdo bom para este dia." });
    } else {
      return { ok: false, error: `Em ${date} o tipo "${kind}" não existe (use ready, new ou skip).` };
    }
  }
  const missing = opts.dates.filter((d) => !byDate.has(d));
  if (missing.length) return { ok: false, error: `A resposta não decidiu as datas ${missing.join(", ")}.` };
  return { ok: true, entries: opts.dates.map((d) => byDate.get(d) as SequenceEntry) };
}
