export type DayNoteDecision = {
  shouldSave: boolean;
  replace: boolean;
};

/**
 * Decide se `savePost` deve gravar a nota do dia (`day_notes`) e se deve substituir o texto
 * existente ou acrescentar.
 *
 * Regras:
 * - Quando o formulário não envia o campo `note` (ex.: tela do dia, onde a nota fica fora de cada post),
 *   não altera `day_notes`.
 * - Só grava quando o texto foi realmente editado em relação ao original (`noteOrig`).
 *   Assim, abrir o dia D com nota e trocar a data para D2 sem editar nunca copia a nota para D2.
 * - Substitui quando está editando ou quando a nota já pertencia à data de destino (`noteFrom === noteDay`).
 * - Quando não substitui (ex.: envio sem recarregar a nota da nova data), texto vazio não é gravado.
 */
export function resolveDayNoteSave(input: {
  editing: boolean;
  hasNoteField: boolean;
  note: string;
  noteOrig: string;
  noteFrom: string;
  noteDay: string;
}): DayNoteDecision {
  if (!input.hasNoteField) {
    return { shouldSave: false, replace: false };
  }
  const note = input.note.trim();
  const noteOrig = input.noteOrig.trim();
  if (note === noteOrig) {
    return { shouldSave: false, replace: false };
  }
  const replace = input.editing || input.noteFrom === input.noteDay;
  if (!replace && !note) {
    return { shouldSave: false, replace: false };
  }
  return { shouldSave: true, replace };
}
