import { TONES } from "../config/tones.ts";
import type { ContentItem, Pillar } from "./editorial-types.ts";

export type PromptClient = {
  name: string;
  segment: string;
  tone: string;
  notes: string;
};

/** Monta o prompt para classificar itens já existentes (acervo/cortes do Drive) por pilar, convidado, assunto, capa e legenda base. */
export function buildClassificationPrompt(input: {
  client: PromptClient;
  pillars: Pillar[];
  items: (Pick<ContentItem, "id" | "title" | "transcript" | "brief" | "drive_meta"> & {
    guest_name?: string;
    topic_tag?: string;
    cover_idea?: string;
    source_folder_name?: string;
    caption_draft?: string;
    caption_instagram?: string;
    caption_linkedin?: string;
  })[];
  memoryBlock?: string;
}): string {
  const pillarLines = input.pillars.length
    ? input.pillars
        .map((p) => `- id: "${p.id}" | nome: "${p.name}" | peso: ${p.weight_pct}% | descrição: ${p.description || "sem descrição"}`)
        .join("\n")
    : "- (nenhum pilar cadastrado; use pillar_id: null)";

  const itemLines = input.items
    .map((it) => {
      const folderPart = it.source_folder_name ? ` | pasta: "${it.source_folder_name}"` : "";
      const fileName = it.drive_meta?.name ? ` | arquivo: "${it.drive_meta.name}"` : "";
      const guestPart = it.guest_name ? ` | convidado detectado: "${it.guest_name}"` : "";
      const topicPart = it.topic_tag ? ` | assunto detectado: "${it.topic_tag}"` : "";
      const coverPart = it.cover_idea ? ` | referência de capa: "${it.cover_idea}"` : "";
      const docRef = it.brief || it.transcript || "(sem texto do .doc/resumo)";
      const capIg = it.caption_instagram ? `\n  legenda base Instagram: ${it.caption_instagram.slice(0, 350)}` : "";
      const capLi = it.caption_linkedin ? `\n  legenda base LinkedIn: ${it.caption_linkedin.slice(0, 350)}` : "";
      return `- item_id: "${it.id}" | título atual: "${it.title}"${folderPart}${fileName}${guestPart}${topicPart}${coverPart}\n  referência principal (.doc/resumo): ${docRef.slice(0, 900)}${capIg}${capLi}`;
    })
    .join("\n");

  return [
    `Você é um estrategista de conteúdo para redes sociais. Organize e classifique os cortes/conteúdos existentes abaixo para a marca "${input.client.name}" (${input.client.segment || "segmento não informado"}).`,
    input.client.tone ? `Tom de voz da marca: ${input.client.tone}` : "",
    input.client.notes ? `Observações da marca: ${input.client.notes}` : "",
    input.memoryBlock ? `\nMEMÓRIA E APRENDIZADO DO CLIENTE:\n${input.memoryBlock}` : "",
    "",
    "PILARES DISPONÍVEIS:",
    pillarLines,
    "",
    "ITENS EXISTENTES PARA CLASSIFICAR (use o conteúdo do .doc, nome da pasta e capa como referência principal — não assuma transcrição de áudio):",
    itemLines,
    "",
    "REGRAS:",
    "- Responda APENAS com JSON válido (sem texto antes ou depois).",
    "- Use exatamente os UUIDs informados em item_id e pillar_id.",
    "- Identifique e normalize guest_name (convidado/participante do corte, ou \"\" se não houver) e topic_tag (tag curta do assunto/tema principal, ex: \"IA na Medicina\").",
    "- Registre ou refine cover_idea (ideia/texto curto de capa) e estruture legendas base em caption_instagram e caption_linkedin mantendo o tom de voz e a memória do cliente.",
    "- Gere um theme_key em slug ASCII minúsculo (ex: '5-erros-manutencao') para evitar repetição futura.",
    "- Melhore o title (até 160 caracteres), resuma em brief e sugira um hook (gancho inicial).",
    "",
    "FORMATO JSON ESPERADO:",
    `{"classifications":[{"item_id":"uuid","pillar_id":"uuid|null","title":"...","theme_key":"slug-ascii","guest_name":"Prof. Lucio Flavio","topic_tag":"IA na Medicina","cover_idea":"...","brief":"...","hook":"...","caption_instagram":"...","caption_linkedin":"...","caption_draft":"...","confidence":0.9}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Monta o prompt para gerar calendário alternando conteúdos prontos (`existing_ready`), convidados, assuntos e inéditos (`needs_creation`) sem repetir temas. */
export function buildCalendarPrompt(input: {
  client: PromptClient;
  pillars: Pillar[];
  existingReady: (Pick<ContentItem, "id" | "pillar_id" | "title" | "theme_key" | "brief"> & {
    guest_name?: string;
    topic_tag?: string;
    cover_idea?: string;
  })[];
  recentThemeKeys: string[];
  slots: { planned_day: string; planned_time: string | null; network: string; format: string }[];
  memoryBlock?: string;
}): string {
  const pillarLines = input.pillars
    .map((p) => `- id: "${p.id}" | "${p.name}" (${p.weight_pct}%): ${p.description || "sem descrição"}`)
    .join("\n");

  const existingLines = input.existingReady.length
    ? input.existingReady
        .map((e) => {
          const guest = e.guest_name ? ` | convidado: "${e.guest_name}"` : "";
          const topic = e.topic_tag ? ` | assunto/tag: "${e.topic_tag}"` : "";
          const cover = e.cover_idea ? ` | capa: "${e.cover_idea.slice(0, 80)}"` : "";
          return `- existing_item_id: "${e.id}" | pillar_id: "${e.pillar_id ?? ""}" | theme_key: "${e.theme_key}"${guest}${topic}${cover} | título: "${e.title}" | resumo: ${e.brief.slice(0, 200)}`;
        })
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
    input.memoryBlock ? `\nMEMÓRIA E APRENDIZADO DO CLIENTE:\n${input.memoryBlock}` : "",
    "",
    "PILARES E PESOS (%):",
    pillarLines,
    "",
    "CONTEÚDOS JÁ PRONTOS (existing_ready) — distribua respeitando alternância de convidado e assunto:",
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
    "- ALTERNÂNCIA DE CONVIDADOS/PARTICIPANTES: nunca agende dois cortes consecutivos do mesmo convidado/participante quando houver outros convidados disponíveis (intercale os participantes ao longo dos dias).",
    "- ALTERNÂNCIA DE ASSUNTOS/TEMAS: evite agendar dois conteúdos consecutivos com o mesmo assunto/tag (topic_tag) ou temas muito parecidos.",
    "- Alterne conteúdos 'existing_ready' (usando existing_item_id da lista e new_item: null) com conteúdos inéditos 'needs_creation' (existing_item_id: null e new_item completo). Se houver acervo pronto suficiente para cobrir os slots de cortes, priorize o acervo pronto respeitando a alternância de convidados e assuntos.",
    "- Em new_item.content_format, alterne os formatos: 'video' (vídeo curto falando para a câmera), 'carousel' e 'static_image'.",
    "- Quando content_format for 'video', preencha obrigatoriamente script_structured com: hook_0_3s (Gancho 0-3s), development_topics (tópicos objetivos para falar) e cta (Chamada para Ação).",
    "- Nunca repita o mesmo existing_item_id nem um theme_key da lista de recentes ou dentro do próprio calendário.",
    "- Respeite aproximadamente os pesos percentuais dos pilares.",
    `- Em tones (opcional, até 3), use apenas ids válidos: ${toneIds}.`,
    "",
    "FORMATO JSON ESPERADO:",
    `{"entries":[{"planned_day":"AAAA-MM-DD","planned_time":"HH:MM|null","network":"instagram","format":"reels","source_kind":"existing_ready|needs_creation","existing_item_id":"uuid|null","pillar_id":"uuid","new_item":{"title":"...","content_format":"video|carousel|static_image","theme_key":"slug-ascii","hook":"...","angle":"...","brief":"...","script_structured":{"hook_0_3s":"...","development_topics":["tópico 1","tópico 2"],"cta":"..."},"caption_draft":"...","tones":["profissional"]}}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Monta o prompt para sugerir pilares estratégicos de conteúdo com pesos somando 100%. */
export function buildPillarsPrompt(client: PromptClient): string {
  return [
    `Você é um estrategista de redes sociais. Sugira de 4 a 6 pilares de conteúdo para a marca "${client.name}" (${client.segment || "segmento não informado"}).`,
    client.tone ? `Tom de voz da marca: ${client.tone}` : "",
    client.notes ? `Observações da marca: ${client.notes}` : "",
    "",
    "REGRAS:",
    "- Responda APENAS com JSON válido (sem texto extra).",
    "- A soma de weight_pct de todos os pilares deve ser exatamente 100.",
    "- Cada cor deve estar em hexadecimal (#RRGGBB), usando cores distintas e legíveis.",
    "- name deve ser curto (até 40 caracteres) e description objetiva (até 160 caracteres).",
    "",
    "FORMATO JSON ESPERADO:",
    `{"pillars":[{"name":"Educativo","description":"Dicas práticas e tutoriais","color":"#3347D6","weight_pct":30,"weekly_target":2}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt para recriar um tópico específico da lista cronológica evitando repetição. */
export function buildRecreateTopicPrompt(input: {
  client: PromptClient;
  pillar: { id: string; name: string; description: string } | null;
  network: string;
  format: string;
  contentFormat: "video" | "carousel" | "static_image";
  rejectedTitle: string;
  rejectedThemeKey: string;
  reason?: string;
  avoidThemeKeys: string[];
  memoryBlock?: string;
}): string {
  const toneIds = TONES.map((t) => t.id).join(", ");
  return [
    `Você é estrategista editorial da marca "${input.client.name}" (${input.client.segment || "segmento não informado"}).`,
    input.client.tone ? `Tom de voz: ${input.client.tone}` : "",
    input.memoryBlock ? `\nMEMÓRIA E APRENDIZADO DO CLIENTE:\n${input.memoryBlock}` : "",
    "",
    `CONTEXTO DA POSIÇÃO NO CRONOGRAMA:`,
    `- Rede/Formato: ${input.network} / ${input.format}`,
    `- Formato de produção: ${input.contentFormat}`,
    input.pillar ? `- Pilar: "${input.pillar.name}" (${input.pillar.description || "sem descrição"})` : "- Pilar: livre",
    `- Tópico substituído (NÃO REPETIR): "${input.rejectedTitle}" (chave: ${input.rejectedThemeKey})`,
    input.reason ? `- Motivo/direcionamento do usuário para recriar: ${input.reason}` : "",
    "",
    "TEMAS A EVITAR (JÁ NO CRONOGRAMA OU RECENTES):",
    input.avoidThemeKeys.length ? input.avoidThemeKeys.join(", ") : "(nenhum)",
    "",
    "REGRAS:",
    "- Responda APENAS com JSON válido (sem markdown ou texto extra).",
    "- Gere um NOVO tema, novo ângulo/foco e o motivo estratégico (reason_why) pelo qual este tópico funciona melhor para esta posição.",
    "- Se content_format for 'video', preencha script_structured com hook_0_3s, development_topics e cta.",
    `- Em tones (até 3), use apenas ids válidos: ${toneIds}.`,
    "",
    "FORMATO JSON ESPERADO:",
    `{"title":"...","content_format":"${input.contentFormat}","theme_key":"slug-ascii-inedito","hook":"...","angle":"...","reason_why":"...","brief":"...","script_structured":{"hook_0_3s":"...","development_topics":["..."],"cta":"..."},"caption_draft":"...","tones":["profissional"]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt para evoluir/recriar um rascunho existente com base na sugestão do usuário e memória do cliente. */
export function buildRefineDraftPrompt(input: {
  client: PromptClient;
  pillarName?: string | null;
  contentFormat: "video" | "carousel" | "static_image";
  title: string;
  currentBrief: string;
  currentCaption: string;
  currentScript: string;
  suggestion: string;
  memoryBlock?: string;
}): string {
  return [
    `Você é estrategista e redator sênior da marca "${input.client.name}" (${input.client.segment || "segmento não informado"}).`,
    input.client.tone ? `Tom de voz da marca: ${input.client.tone}` : "",
    input.client.notes ? `Observações da marca: ${input.client.notes}` : "",
    input.memoryBlock ? `\nMEMÓRIA E APRENDIZADO DO CLIENTE:\n${input.memoryBlock}` : "",
    "",
    `TEMA ATUAL: "${input.title}" (${input.contentFormat}${input.pillarName ? `, pilar: ${input.pillarName}` : ""})`,
    `RASCUNHO ATUAL (Brief):\n${input.currentBrief || "(vazio)"}`,
    input.currentCaption ? `LEGENDA ATUAL:\n${input.currentCaption}` : "",
    input.currentScript ? `ROTEIRO ATUAL:\n${input.currentScript}` : "",
    "",
    `SUGESTÃO / DIRECIONAMENTO DO USUÁRIO:\n${input.suggestion || "Deixe o gancho mais forte, o argumento mais concreto e o CTA mais claro."}`,
    "",
    "REGRAS:",
    "- Responda APENAS com JSON válido (sem markdown ou texto extra).",
    "- Evolua e refine o rascunho incorporando exatamente a sugestão do usuário e mantendo a voz da marca.",
    "- Entregue gancho, ângulo, brief evoluído, roteiro estruturado (hook_0_3s, development_topics, cta) e legenda sugerida.",
    "",
    "FORMATO JSON ESPERADO:",
    `{"title":"...","hook":"...","angle":"...","brief":"...","script_hook":"...","script_dev":"- tópico 1\\n- tópico 2","script_cta":"...","caption_draft":"..."}`,
  ]
    .filter(Boolean)
    .join("\n");
}
