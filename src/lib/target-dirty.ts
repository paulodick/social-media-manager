export type TargetEditableFields = {
  caption: string;
  title: string;
  day: string;
  time: string;
  driveUrl: string;
  thumbUrl: string;
};

/**
 * Informa se os campos editáveis de um destino na tela divergem do que está salvo no banco.
 * Qualquer mudança em legenda, título, data, horário, arquivo ou miniatura exige salvar antes de publicar.
 */
export function isTargetDirty(current: TargetEditableFields, saved: TargetEditableFields): boolean {
  return (
    current.caption !== saved.caption ||
    current.title !== saved.title ||
    current.day !== saved.day ||
    current.time !== saved.time ||
    current.driveUrl.trim() !== saved.driveUrl.trim() ||
    current.thumbUrl.trim() !== saved.thumbUrl.trim()
  );
}

/** Resumo curto do que está salvo e será publicado (arquivo e data/horário). */
export function formatSavedPublishSummary(saved: {
  day: string;
  time: string;
  fileName?: string | null;
  driveUrl: string;
}): string {
  const parts = saved.day.split("-");
  const ddmm = parts.length === 3 ? `${parts[2]}/${parts[1]}` : saved.day;
  const when = `${ddmm} às ${saved.time}`;
  const file = saved.fileName?.trim()
    ? saved.fileName.trim()
    : saved.driveUrl.trim()
      ? "arquivo salvo"
      : "sem arquivo";
  return `${file} · ${when}`;
}
