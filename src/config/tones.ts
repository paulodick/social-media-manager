// Tons de voz que a pessoa escolhe POR POST (checkboxes no Novo post e na tela do dia). Fonte única:
// as instruções que vão para o pedido de legenda vêm só daqui, nunca de texto digitado.
// O tom de voz e as observações do cadastro do cliente continuam valendo para as regras de marca.

export type ToneId =
  | "formal" | "profissional" | "tecnico" | "didatico" | "descontraido" | "humorado"
  | "carinhoso" | "inspirador" | "narrativo" | "persuasivo" | "urgente";

export type ToneCfg = { id: ToneId; label: string; instruction: string };

export const TONES: ToneCfg[] = [
  { id: "formal", label: "Formal", instruction: "Formal: linguagem polida e correta, sem gírias, sem abreviações e sem emoji." },
  { id: "profissional", label: "Profissional", instruction: "Profissional: claro, objetivo e confiável, com foco em resultado e no máximo 1 emoji." },
  { id: "tecnico", label: "Técnico", instruction: "Técnico: use termos do setor, cite causas e dados e explique o porquê das coisas." },
  { id: "didatico", label: "Didático", instruction: "Didático: explique passo a passo em linguagem simples, com exemplos do dia a dia." },
  { id: "descontraido", label: "Descontraído", instruction: "Descontraído: conversa direta, frases curtas, gíria leve e emoji com moderação." },
  { id: "humorado", label: "Humorado", instruction: "Humorado: leve e bem-humorado, com ironia suave ou trocadilho, sem ofender e sem piadas sobre saúde, doença ou dinheiro." },
  { id: "carinhoso", label: "Carinhoso", instruction: "Carinhoso: acolhedor e empático, falando com 'você' e demonstrando cuidado." },
  { id: "inspirador", label: "Inspirador", instruction: "Inspirador: otimista e voltado à transformação, com uma frase de impacto." },
  { id: "narrativo", label: "Narrativo", instruction: "Narrativo: conte uma história com começo, conflito e desfecho, na primeira pessoa." },
  { id: "persuasivo", label: "Persuasivo", instruction: "Persuasivo: destaque o benefício, quebre uma objeção e termine com uma chamada para ação clara." },
  { id: "urgente", label: "Urgente", instruction: "Urgente: direto e curto, com a informação mais importante na primeira linha." },
];

/** No máximo este número de tons por post. A ordem em que são marcados é a prioridade (o primeiro pesa mais). */
export const MAX_TONES = 3;

/** Pares que não combinam: marcar um desativa o outro. */
export const TONE_CONFLICTS: [ToneId, ToneId][] = [
  ["formal", "descontraido"],
  ["formal", "humorado"],
  ["urgente", "humorado"],
];

export function toneById(id: string): ToneCfg | undefined {
  return TONES.find((t) => t.id === id);
}

/** O tom (já marcado) com o qual `id` não combina, ou null. */
export function conflictingTone(id: string, selected: string[]): ToneCfg | null {
  for (const [a, b] of TONE_CONFLICTS) {
    const other = id === a ? b : id === b ? a : null;
    if (other && selected.includes(other)) return toneById(other) ?? null;
  }
  return null;
}

/**
 * Por que `id` não pode ser marcado agora (texto curto para a tela), ou null se pode.
 * Só vale para tons ainda não marcados: um tom marcado sempre pode ser desmarcado.
 */
export function toneBlockedReason(id: string, selected: string[]): string | null {
  if (selected.includes(id)) return null;
  const c = conflictingTone(id, selected);
  if (c) return `Não combina com ${c.label}`;
  if (selected.length >= MAX_TONES) return `Limite de ${MAX_TONES} tons`;
  return null;
}

/** Validação do servidor: só ids que existem, sem repetir, no máximo 3 e sem pares que se excluem. Mantém a ordem. */
export function validateTones(raw: string[]): { tones: ToneId[] } | { error: string } {
  const ids = raw.map((v) => String(v).trim()).filter(Boolean);
  const unique = [...new Set(ids)];
  for (const id of unique) if (!toneById(id)) return { error: "Tom de voz inválido." };
  if (unique.length > MAX_TONES) return { error: `Escolha no máximo ${MAX_TONES} tons de voz.` };
  for (const [a, b] of TONE_CONFLICTS) {
    if (unique.includes(a) && unique.includes(b)) {
      return { error: `Os tons ${toneById(a)!.label} e ${toneById(b)!.label} não combinam.` };
    }
  }
  return { tones: unique as ToneId[] };
}
