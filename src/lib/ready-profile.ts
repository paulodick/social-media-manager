// Ficha de cada vídeo pronto ("Reels Editados"): a IA lê a transcrição UMA vez, na sincronização, e guarda tema,
// resumo, pilar, público, gancho e bases de legenda para Instagram e LinkedIn. A sequência usa a ficha em vez de
// reinterpretar tudo a cada vez. Aqui ficam só as partes puras (pedido, conferência, avisos de qualidade), com teste.
import { createHash } from "node:crypto";

/** Mudou o pedido? Suba este número para refazer as fichas na próxima sincronização. */
export const PROFILE_VERSION = 1;
export const PROFILE_TRANSCRIPT_CHARS = 6000;

import type { Audience, QualityFlag } from "./ready-profile-labels.ts";
export { AUDIENCE_LABEL, FLAG_LABEL, type Audience, type QualityFlag } from "./ready-profile-labels.ts";

export type ReadyProfile = {
  theme: string;
  summary: string;
  pillar: string;
  audience: Audience;
  hook: string;
  caption_instagram: string;
  caption_linkedin: string;
};

/** Impressão digital da transcrição: só refaz a ficha quando o texto (ou o pedido) mudou. */
export function profileHash(transcript: string, suggestedCaption = ""): string {
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const caption = norm(suggestedCaption);
  // Sem legenda sugerida, a impressão digital é a mesma de antes (não refaz fichas à toa).
  const body = caption ? `${norm(transcript)}\n--legenda--\n${caption}` : norm(transcript);
  return createHash("sha1").update(`v${PROFILE_VERSION}\n${body}`).digest("hex");
}

/** Avisos que pedem um olhar humano antes de o vídeo entrar no planejamento. */
export function qualityFlags(transcript: string, suggestedCaption = ""): QualityFlag[] {
  const t = transcript.trim();
  if (!t) return suggestedCaption.trim() ? ["caption_only"] : ["no_transcript"];
  const flags: QualityFlag[] = [];
  if (/\[(trecho incerto|\?|inaud[ií]vel)[^\]]*\]/i.test(t) || /leitura autom[aá]tica pouco confi[aá]vel/i.test(t)) flags.push("uncertain");
  if (/(grava[çc][ãa]o comercial|m[úu]sica comercial|direitos autorais|copyright)/i.test(t)) flags.push("commercial_music");
  if (/^\s*fala\s*:\s*sem fala/im.test(t) || /este v[ií]deo n[ãa]o tem fala/i.test(t)) flags.push("no_speech");
  return flags;
}

export function buildReadyProfilePrompt(input: {
  clientName: string;
  segment: string;
  tone: string;
  notes: string;
  styleNotes: string;
  pillars: string[];
  title: string;
  transcript: string;
  suggestedCaption?: string;
}): string {
  const cut = (x: string, max: number) => (x.length > max ? `${x.slice(0, max)}…` : x);
  const transcript = cut(input.transcript.trim(), PROFILE_TRANSCRIPT_CHARS);
  const suggested = cut((input.suggestedCaption ?? "").trim(), 4000);
  return [
    `Você é o estrategista de conteúdo de redes sociais do cliente "${input.clientName}"${input.segment ? ` (${input.segment})` : ""}.`,
    input.tone ? `Tom de voz do cliente: ${input.tone}` : "",
    input.notes ? `Observações do cliente (inclui contatos e regras): ${input.notes}` : "",
    input.styleNotes ? `Diretrizes de estilo: ${input.styleNotes}` : "",
    input.pillars.length ? `Pilares de conteúdo do cliente: ${input.pillars.join("; ")}.` : "",
    "",
    suggested && !transcript
      ? "TAREFA: este vídeo já gravado e editado veio SEM transcrição, só com a legenda sugerida por quem cortou. Entenda o assunto pela legenda e monte a ficha dele para o planejamento."
      : "TAREFA: leia o material deste vídeo já gravado e editado e monte a ficha dele para o planejamento.",
    suggested
      ? "- A legenda sugerida veio de quem cortou o vídeo: aproveite as ideias e o texto dela, ajustando ao tom do cliente e a cada rede, sem inventar nada que não esteja nela ou na transcrição."
      : "",
    "",
    "Regras:",
    "- Use só fatos que estão na transcrição ou na legenda sugerida. Não invente números, lugares, nomes, resultados ou quem fez o quê.",
    "- Trechos marcados como [trecho incerto] ou [?] não são confiáveis: não use esses detalhes.",
    "- Se a pessoa diz que não participou de algo, não atribua isso a ela.",
    "- Tom profissional, técnico e humano, sem frases épicas, sem bajulação e sem linguagem de coach.",
    "- Instagram: gancho na primeira linha, texto curto e escaneável, chamada para ação com os contatos das observações (se houver), 3 a 6 hashtags no fim. Até 2.000 caracteres.",
    "- LinkedIn: tom executivo, contexto, lição prática para quem decide, sem emojis em excesso, 3 a 5 hashtags no fim. Até 2.800 caracteres.",
    input.pillars.length
      ? `- "pillar": escolha exatamente um dos pilares listados, ou "" se nenhum servir.`
      : `- "pillar": deixe "".`,
    `- "audience": "gestor" (quem decide compra e contrato), "tecnico" (quem faz manutenção) ou "geral".`,
    "",
    `TÍTULO DE REFERÊNCIA: ${input.title}`,
    "TRANSCRIÇÃO:",
    transcript || "(sem transcrição)",
    suggested ? `LEGENDA SUGERIDA POR QUEM CORTOU O VÍDEO:\n${suggested}` : "",
    "",
    'Responda SOMENTE com JSON neste formato: {"theme":"<tema em até 4 palavras>","summary":"<do que o vídeo trata, 1 a 2 frases>",',
    '"pillar":"<pilar>","audience":"gestor|tecnico|geral","hook":"<gancho dos primeiros 3 segundos>",',
    '"caption_instagram":"<legenda pronta>","caption_linkedin":"<legenda pronta>"}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Confere a ficha devolvida pela IA. O pilar só vale se for um dos pilares do cliente. */
export function parseReadyProfile(
  raw: unknown,
  pillars: string[],
): { ok: true; profile: ReadyProfile } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "A resposta não é um objeto JSON." };
  const o = raw as Record<string, unknown>;
  const theme = str(o.theme, 60);
  const summary = str(o.summary, 600);
  const caption_instagram = str(o.caption_instagram, 2200);
  const caption_linkedin = str(o.caption_linkedin, 3000);
  if (!theme) return { ok: false, error: "A ficha veio sem tema." };
  if (!summary) return { ok: false, error: "A ficha veio sem resumo." };
  if (!caption_instagram || !caption_linkedin) return { ok: false, error: "A ficha veio sem as duas legendas." };
  const wanted = str(o.pillar, 120).toLowerCase();
  const pillar = pillars.find((p) => p.trim().toLowerCase() === wanted) ?? "";
  const a = str(o.audience, 20).toLowerCase();
  const audience: Audience = a === "gestor" || a === "tecnico" || a === "técnico" ? (a === "gestor" ? "gestor" : "tecnico") : "geral";
  return { ok: true, profile: { theme, summary, pillar, audience, hook: str(o.hook, 240), caption_instagram, caption_linkedin } };
}

/** Roda `fn` em todos os itens, no máximo `limit` ao mesmo tempo, mantendo a ordem dos resultados. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type TextKind = "transcript" | "caption";

const CAPTION_NAME_RE = /(legenda|caption|copy|descri[cç][aã]o|texto[\s_-]*do[\s_-]*post|post)/i;
const TRANSCRIPT_NAME_RE = /(transcri|fala|roteiro|script|legendas?[\s_-]*do[\s_-]*v[ií]deo|srt)/i;

/**
 * Diz se um arquivo de texto da pasta do vídeo é a TRANSCRIÇÃO da fala ou uma LEGENDA SUGERIDA (quem corta o vídeo
 * às vezes manda a legenda pronta). Primeiro pelo nome do arquivo, depois pelo conteúdo. Na dúvida, transcrição.
 */
export function classifyTextFile(name: string, text: string): TextKind {
  const base = name.replace(/\.[^.]+$/, "");
  if (TRANSCRIPT_NAME_RE.test(base)) return "transcript";
  if (CAPTION_NAME_RE.test(base)) return "caption";
  const t = text.trim();
  if (/^\s*transcri[çc][ãa]o\b/im.test(t) || /\[\d{1,2}:\d{2}/.test(t) || /-->/.test(t)) return "transcript";
  const hashtags = (t.match(/(^|\s)#[\p{L}\p{N}_]{2,}/gu) ?? []).length;
  if (/^\s*legenda\b/im.test(t) || hashtags >= 2) return "caption";
  return "transcript";
}

/** Material que a IA lê de cada vídeo: a transcrição e, se houver, a legenda sugerida por quem cortou. */
export function readyMaterial(transcript: string, suggestedCaption: string): string {
  const parts: string[] = [];
  if (transcript.trim()) parts.push(transcript.trim());
  if (suggestedCaption.trim()) parts.push(`LEGENDA SUGERIDA POR QUEM CORTOU O VÍDEO:\n${suggestedCaption.trim()}`);
  return parts.join("\n\n");
}
