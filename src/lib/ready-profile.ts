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
export function profileHash(transcript: string): string {
  return createHash("sha1").update(`v${PROFILE_VERSION}\n${transcript.replace(/\s+/g, " ").trim()}`).digest("hex");
}

/** Avisos que pedem um olhar humano antes de o vídeo entrar no planejamento. */
export function qualityFlags(transcript: string): QualityFlag[] {
  const t = transcript.trim();
  if (!t) return ["no_transcript"];
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
}): string {
  const text = input.transcript.trim();
  const transcript = text.length > PROFILE_TRANSCRIPT_CHARS ? `${text.slice(0, PROFILE_TRANSCRIPT_CHARS)}…` : text;
  return [
    `Você é o estrategista de conteúdo de redes sociais do cliente "${input.clientName}"${input.segment ? ` (${input.segment})` : ""}.`,
    input.tone ? `Tom de voz do cliente: ${input.tone}` : "",
    input.notes ? `Observações do cliente (inclui contatos e regras): ${input.notes}` : "",
    input.styleNotes ? `Diretrizes de estilo: ${input.styleNotes}` : "",
    input.pillars.length ? `Pilares de conteúdo do cliente: ${input.pillars.join("; ")}.` : "",
    "",
    "TAREFA: leia a transcrição deste vídeo já gravado e editado e monte a ficha dele para o planejamento.",
    "",
    "Regras:",
    "- Use só fatos que estão na transcrição. Não invente números, lugares, nomes, resultados ou quem fez o quê.",
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
