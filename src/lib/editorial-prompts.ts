import { TONES } from "../config/tones.ts";
import type { ContentItem, Pillar } from "./editorial-types.ts";

export type PromptClient = {
  name: string;
  segment: string;
  tone: string;
  notes: string;
};

/** Monta o prompt para classificar itens já existentes (acervo do Drive) por pilar e tema. */
export function buildClassificationPrompt(input: {
  client: PromptClient;
  pillars: Pillar[];
  items: Pick<ContentItem, "id" | "title" | "transcript" | "brief" | "drive_meta">[];
}): string {
  const pillarLines = input.pillars.length
    ? input.pillars
        .map((p) => `- id: "${p.id}" | nome: "${p.name}" | peso: ${p.weight_pct}% | descrição: ${p.description || "sem descrição"}`)
        .join("\n")
    : "- (nenhum pilar cadastrado; use pillar_id: null)";

  const itemLines = input.items
    .map((it) => {
      const fileName = it.drive_meta?.name ? ` | arquivo: "${it.drive_meta.name}"` : "";
      const text = it.transcript || it.brief || "(sem transcrição/resumo)";
      return `- item_id: "${it.id}" | título atual: "${it.title}"${fileName}\n  conteúdo/transcrição: ${text.slice(0, 800)}`;
    })
    .join("\n");

  return [
    `Você é um estrategista de conteúdo para redes sociais. Classifique os conteúdos existentes abaixo para a marca "${input.client.name}" (${input.client.segment || "segmento não informado"}).`,
    input.client.tone ? `Tom de voz da marca: ${input.client.tone}` : "",
    "",
    "PILARES DISPONÍVEIS:",
    pillarLines,
    "",
    "ITENS EXISTENTES PARA CLASSIFICAR:",
    itemLines,
    "",
    "REGRAS:",
    "- Responda APENAS com JSON válido (sem texto antes ou depois).",
    "- Use exatamente os UUIDs informados em item_id e pillar_id.",
    "- Gere um theme_key em slug ASCII minúsculo (ex: '5-erros-manutencao') para evitar repetição futura.",
    "- Melhore o title (até 160 caracteres), resuma em brief e sugira um hook (gancho inicial).",
    "",
    "FORMATO JSON ESPERADO:",
    `{"classifications":[{"item_id":"uuid","pillar_id":"uuid|null","title":"...","theme_key":"slug-ascii","brief":"...","hook":"...","confidence":0.9}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Monta o prompt para gerar calendário alternando conteúdos prontos (`existing_ready`) e inéditos (`needs_creation`) sem repetir temas. */
export function buildCalendarPrompt(input: {
  client: PromptClient;
  pillars: Pillar[];
  existingReady: Pick<ContentItem, "id" | "pillar_id" | "title" | "theme_key" | "brief">[];
  recentThemeKeys: string[];
  slots: { planned_day: string; planned_time: string | null; network: string; format: string }[];
}): string {
  const pillarLines = input.pillars
    .map((p) => `- id: "${p.id}" | "${p.name}" (${p.weight_pct}%): ${p.description || "sem descrição"}`)
    .join("\n");

  const existingLines = input.existingReady.length
    ? input.existingReady
        .map((e) => `- existing_item_id: "${e.id}" | pillar_id: "${e.pillar_id ?? ""}" | theme_key: "${e.theme_key}" | título: "${e.title}" | resumo: ${e.brief.slice(0, 200)}`)
        .join("\n")
    : "- (nenhum conteúdo pronto disponível; gere todos como needs_creation)";

  const slotLines = input.slots
    .map((s) => `- dia: ${s.planned_day} | hora: ${s.planned_time ?? "null"} | network: "${s.network}" | format: "${s.format}"`)
    .join("\n");

  const toneIds = TONES.map((t) => t.id).join(", ");

  return [
    `Você é um planejador editorial para a marca "${input.client.name}" (${input.client.segment || "segmento não informado"}).`,
    input.client.tone ? `Tom de voz: ${input.client.tone}` : "",
    input.client.notes ? `Observações da marca: ${input.client.notes}` : "",
    "",
    "PILARES E PESOS (%):",
    pillarLines,
    "",
    "CONTEÚDOS JÁ PRONTOS (existing_ready) — distribua de forma alternada nos dias:",
    existingLines,
    "",
    "TEMAS JÁ USADOS RECENTEMENTE (NUNCA REPETIR):",
    input.recentThemeKeys.length ? input.recentThemeKeys.join(", ") : "(nenhum)",
    "",
    "SLOTS A PREENCHER (preencha todos os dias/redes abaixo na mesma ordem):",
    slotLines,
    "",
    "REGRAS OBRIGATÓRIAS:",
    "- Responda APENAS com JSON válido (sem markdown ou explicações extras).",
    "- Alterne conteúdos 'existing_ready' (usando existing_item_id da lista e new_item: null) com conteúdos inéditos 'needs_creation' (existing_item_id: null e new_item completo).",
    "- Nunca repita o mesmo existing_item_id nem um theme_key da lista de recentes ou dentro do próprio calendário.",
    "- Respeite aproximadamente os pesos percentuais dos pilares.",
    `- Em tones (opcional, até 3), use apenas ids válidos: ${toneIds}.`,
    "",
    "FORMATO JSON ESPERADO:",
    `{"entries":[{"planned_day":"AAAA-MM-DD","planned_time":"HH:MM|null","network":"instagram","format":"reels","source_kind":"existing_ready|needs_creation","existing_item_id":"uuid|null","pillar_id":"uuid","new_item":{"title":"...","theme_key":"slug-ascii","hook":"...","angle":"...","brief":"...","script":"...","caption_draft":"...","tones":["profissional"]}}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}
