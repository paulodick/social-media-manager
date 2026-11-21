import { fmtDate, type TokenHealth } from "./meta-health.ts";

/** Saúde da conexão do LinkedIn a partir da data de vencimento guardada (60 dias, sem renovação automática). */
export function linkedinHealthFrom(expiresAt: Date | null, now = Date.now()): TokenHealth {
  if (!expiresAt) return { state: "unknown", message: "Não sei até quando este acesso vale. Se a publicação falhar, conecte de novo.", missing: [], expiresAt: null };
  const ms = expiresAt.getTime();
  const left = ms - now;
  if (left <= 0) return { state: "reconnect", message: `O acesso ao LinkedIn venceu em ${fmtDate(ms)}. Conecte de novo.`, missing: [], expiresAt: ms };
  if (left < 7 * 86_400_000) {
    return { state: "attention", message: `O acesso ao LinkedIn vence em ${fmtDate(ms)}. Conecte de novo antes disso.`, missing: [], expiresAt: ms };
  }
  return { state: "ok", message: `Conexão ativa até ${fmtDate(ms)}. O LinkedIn não renova sozinho: o app avisa 7 dias antes.`, missing: [], expiresAt: ms };
}
