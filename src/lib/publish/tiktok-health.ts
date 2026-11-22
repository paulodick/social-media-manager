import { fmtDate, type TokenHealth } from "./meta-health.ts";

/**
 * Saúde da conexão do TikTok a partir do vencimento da AUTORIZAÇÃO (o token de renovação). O acesso em si vale poucas
 * horas e o app renova sozinho a cada publicação; o que exige a pessoa de novo é a autorização vencer ou ser revogada.
 */
export function tiktokHealthFrom(expiresAt: Date | null, now = Date.now()): TokenHealth {
  if (!expiresAt) return { state: "unknown", message: "Não sei até quando esta autorização vale. Se o envio falhar, conecte de novo.", missing: [], expiresAt: null };
  const ms = expiresAt.getTime();
  const left = ms - now;
  if (left <= 0) return { state: "reconnect", message: `A autorização do TikTok venceu em ${fmtDate(ms)}. Conecte de novo.`, missing: [], expiresAt: ms };
  if (left < 14 * 86_400_000) {
    return { state: "attention", message: `A autorização do TikTok vence em ${fmtDate(ms)}. Conecte de novo antes disso.`, missing: [], expiresAt: ms };
  }
  return { state: "ok", message: `Conexão ativa. O app renova o acesso sozinho; a autorização vale até ${fmtDate(ms)} e o app avisa 14 dias antes.`, missing: [], expiresAt: ms };
}
