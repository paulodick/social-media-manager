/**
 * Regras da publicação automática por horário (funções puras, sem banco, para a tela e os testes usarem).
 *
 * O app só publica sozinho o destino que a pessoa CONFIRMOU ("Confirmar publicação") e que ainda esteja dentro da
 * janela de tolerância. Passou da janela, o post não sai: aparece "Perdeu o horário" e a pessoa decide.
 */

/** Minutos de tolerância depois do horário marcado. Passou disso (servidor fora do ar, deploy), o post NÃO sai sozinho. */
export const AUTO_WINDOW_MIN = 60;

/** Redes e formatos que o app publica sozinho no horário. TikTok (só rascunho), YouTube, Kwai e LinkedIn Documento ficam de fora. */
export function canAutoSchedule(network: string, format?: string): boolean {
  if (network === "linkedin") return format !== "documento";
  return network === "instagram" || network === "facebook";
}

export type AutoView = {
  /** O formato aceita publicação automática. */
  eligible: boolean;
  /** A pessoa já confirmou a publicação automática deste destino. */
  confirmed: boolean;
  /** Confirmado, mas o horário passou da janela sem publicar. */
  missed: boolean;
  /** "dd/mm às HH:MM", para o texto da tela. */
  when: string;
};

/** "2026-11-22" + "15:00" -> "22/11 às 15:00". */
export function whenLabel(day: string, time: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m} às ${time}`;
}
