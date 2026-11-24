/**
 * Extrai o dia (AAAA-MM-DD) de uma URL de tela do dia (`/clientes/<id>/dia/<AAAA-MM-DD>`).
 */
export function extractDayFromPath(path: string): string | null {
  const m = path.match(/^\/clientes\/[^/]+\/dia\/(\d{4}-\d{2}-\d{2})(?:[?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Decide para qual caminho redirecionar após salvar um post em edição.
 * Se a página de origem era um dia específico e o post não tem mais nenhum destino naquele dia,
 * redireciona para o dia do destino movido (ou o menor dia restante do post), evitando cair em `/posts/novo`.
 */
export function resolveEditRedirect(params: {
  clientId: string;
  back: string;
  remainingDays: string[];
  movedDays: string[];
}): string {
  const backDay = extractDayFromPath(params.back);
  if (!backDay) return params.back;
  if (params.remainingDays.includes(backDay)) return params.back;
  if (!params.remainingDays.length) return params.back;
  const targetDay = params.movedDays[0] ?? [...params.remainingDays].sort()[0];
  return `/clientes/${params.clientId}/dia/${targetDay}`;
}

/** Formata aviso explícito quando destinos mudam de dia (ex.: "Destino movido para 28/11."). */
export function formatMovedTargetsNotice(movedDays: string[]): string | null {
  if (!movedDays.length) return null;
  const unique = [...new Set(movedDays)].map((d) => {
    const parts = d.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
  });
  if (movedDays.length === 1) return `Destino movido para ${unique[0]}.`;
  if (unique.length === 1) return `Destinos movidos para ${unique[0]}.`;
  return `Destinos movidos para ${unique.join(", ")}.`;
}
