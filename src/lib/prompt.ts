import { NETWORKS, type NetworkId } from "../config/networks.ts";
import { toneById } from "../config/tones.ts";

export type PromptClient = {
  name: string;
  segment: string;
  site: string;
  tone: string;
  notes: string;
};

/**
 * Bloco "Tom de voz deste post" a partir dos ids dos tons (na ordem de prioridade). As instruções vêm sempre de
 * `src/config/tones.ts`. Sem tons válidos devolve texto vazio e o pedido fica como era antes. É a mesma função para
 * "Gerar legenda" (API) e "Copiar pedido para a IA", porque os dois passam por `buildCaptionPrompt`.
 */
export function buildToneBlock(toneIds: string[] | undefined): string {
  const tones = (toneIds ?? []).map((id) => toneById(id)).filter((t): t is NonNullable<typeof t> => !!t);
  if (!tones.length) return "";
  return [
    "Tom de voz deste post: combine os estilos abaixo, do mais importante para o menos importante.",
    ...tones.map((t, i) => `${i + 1}. ${t.instruction}`),
    "Em caso de conflito, siga o Tom de voz e as Observações do cadastro do cliente para regras de marca (palavras proibidas, assinatura, termos obrigatórios) e use os estilos acima para a forma de escrever.",
  ].join("\n");
}

/**
 * Monta o pedido de legenda para colar numa IA (Claude, Gemini...) ou enviar à API. O app só reúne o que já sabe
 * (cliente, tom de voz, observações, rede, formato, limites) e o que a pessoa escreveu:
 *  - plan: a ideia do post, o planejamento do dia (item 1 do novo post);
 *  - brief: a descrição da legenda, o rascunho ou os pontos que ela quer ver na legenda (item 2);
 *  - captionDraft: a legenda que já está no campo, para refazer ou melhorar;
 *  - custom: "Personalizar legenda", os ajustes pedidos (tom, tamanho, o que mudar). Tem prioridade sobre os tons;
 *  - tones: ids dos tons de voz escolhidos para este post, do mais importante ao menos importante.
 */
export function buildCaptionPrompt(input: {
  client: PromptClient;
  network: NetworkId;
  format: string;
  plan: string;
  brief?: string;
  captionDraft?: string;
  custom?: string;
  tones?: string[];
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

  const toneBlock = buildToneBlock(input.tones);
  if (toneBlock) lines.push(toneBlock, "");

  const plan = input.plan.trim();
  const brief = input.brief?.trim() ?? "";
  if (plan || !brief) {
    lines.push(
      `Ideia do post (planejamento do dia):\n${plan || "(não informado: proponha uma legenda coerente com o tom de voz e peça o tema, se faltar)"}`,
      "",
    );
  }
  if (brief) lines.push(`Descrição da legenda (o que a pessoa quer ver na legenda; use como base):\n${brief}`, "");
  if (input.captionDraft?.trim()) {
    lines.push(`Legenda atual (escreva uma nova versão, sem copiar o texto igual):\n${input.captionDraft.trim()}`, "");
  }
  if (input.custom?.trim()) lines.push(`Ajustes pedidos para esta legenda (siga à risca):\n${input.custom.trim()}`, "");

  const rules: string[] = [];
  if (cfg.captionLimit) rules.push(`No máximo ${cfg.captionLimit} caracteres.`);
  if (cfg.hashtagLimit != null) rules.push(`No máximo ${cfg.hashtagLimit} hashtags.`);
  if (cfg.cutAt) rules.push(`Os primeiros ${cfg.cutAt} caracteres aparecem antes do "ver mais": a ideia principal e o gancho vão ali.`);
  if (fmt?.guide) rules.push(`A mídia é ${fmt.guide.size}, ${fmt.guide.length}. A legenda deve combinar com isso.`);
  rules.push("Nada de promessas que o cliente não possa cumprir nem informações inventadas.");
  if (fmt?.title) {
    rules.push(
      `${cfg.label} ${fmt.label} tem um título separado da legenda${cfg.titleLimit ? ` (até ${cfg.titleLimit} caracteres)` : ""}. Entregue em duas partes, exatamente assim: uma linha começando com "Título:" e, depois de uma linha em branco, o texto começando com "Legenda:".`,
    );
    rules.push("Entregue só isso, sem explicações antes ou depois.");
  } else {
    rules.push("Entregue só a legenda pronta para colar, sem explicações antes ou depois.");
  }
  lines.push("Regras:", ...rules.map((r) => `- ${r}`));

  return lines.join("\n");
}

/**
 * Separa a resposta da IA em título e legenda quando o formato tem título ("Título: ..." e "Legenda: ...").
 * Se a resposta não vier nesse formato, tudo vira legenda e o título fica vazio.
 */
export function splitGenerated(text: string, withTitle: boolean): { title: string; caption: string } {
  const t = text.trim();
  if (!withTitle) return { title: "", caption: t };
  const m = t.match(/^t[íi]tulo\s*:\s*(.+?)\s*\n+\s*(?:legenda|descri[çc][ãa]o)\s*:\s*([\s\S]*)$/i);
  if (!m) return { title: "", caption: t };
  return { title: m[1].trim().replace(/^["“]|["”]$/g, ""), caption: m[2].trim() };
}
