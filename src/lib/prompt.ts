import { NETWORKS, type NetworkId } from "../config/networks.ts";

export type PromptClient = {
  name: string;
  segment: string;
  site: string;
  tone: string;
  notes: string;
};

/**
 * Monta o pedido de legenda para colar numa IA (Claude, Gemini...). O app não chama nenhuma IA:
 * só reúne o que já sabe (cliente, tom de voz, rede, formato, limites) e o que o Paulo planejou.
 */
export function buildCaptionPrompt(input: {
  client: PromptClient;
  network: NetworkId;
  format: string;
  plan: string;
  captionDraft?: string;
}): string {
  const cfg = NETWORKS[input.network];
  const fmt = cfg.formats[input.format];
  const c = input.client;
  const lines: string[] = [];

  lines.push(
    `Você é social media de ${c.name}${c.segment ? ` (${c.segment})` : ""}. Escreva a legenda de um post para ${cfg.label}${fmt ? `, formato ${fmt.label}` : ""}, em português do Brasil.`,
    "",
  );

  const info: string[] = [];
  if (c.tone.trim()) info.push(`Tom de voz do cliente:\n${c.tone.trim()}`);
  if (c.notes.trim()) info.push(`Observações sobre o cliente:\n${c.notes.trim()}`);
  if (c.site.trim()) info.push(`Site: ${c.site.trim()}`);
  if (info.length) lines.push(info.join("\n\n"), "");

  lines.push(
    `O que o post precisa dizer:\n${input.plan.trim() || "(não informado: proponha uma legenda coerente com o tom de voz e peça o tema, se faltar)"}`,
    "",
  );
  if (input.captionDraft?.trim()) {
    lines.push(`Rascunho atual da legenda (melhore, sem perder a ideia):\n${input.captionDraft.trim()}`, "");
  }

  const rules: string[] = [];
  if (cfg.captionLimit) rules.push(`No máximo ${cfg.captionLimit} caracteres.`);
  if (cfg.hashtagLimit != null) rules.push(`No máximo ${cfg.hashtagLimit} hashtags.`);
  if (cfg.cutAt) rules.push(`Os primeiros ${cfg.cutAt} caracteres aparecem antes do "ver mais": a ideia principal e o gancho vão ali.`);
  if (fmt?.guide) rules.push(`A mídia é ${fmt.guide.size}, ${fmt.guide.length}. A legenda deve combinar com isso.`);
  rules.push("Nada de promessas que o cliente não possa cumprir nem informações inventadas.");
  rules.push("Entregue só a legenda pronta para colar, sem explicações antes ou depois.");
  lines.push("Regras:", ...rules.map((r) => `- ${r}`));

  return lines.join("\n");
}
