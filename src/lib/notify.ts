/**
 * Aviso por e-mail quando uma publicação automática falha ou perde o horário.
 *
 * Usa o Resend (https://resend.com) por HTTP, sem dependência nova. Precisa de duas variáveis no Render:
 *   RESEND_API_KEY   chave da conta no Resend
 *   NOTIFY_EMAIL_TO  e-mail que recebe o aviso
 * Opcional: NOTIFY_EMAIL_FROM (padrão "Social Media Manager <onboarding@resend.dev>", que só entrega para o e-mail
 * dono da conta no Resend; para outro destinatário é preciso verificar um domínio lá). RESEND_API_BASE existe só
 * para testes com servidor de mentira.
 * Sem as variáveis, nada é enviado e o motivo fica só na tela e no log. O aviso nunca leva token nem segredo.
 */

export function notifyConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!process.env.NOTIFY_EMAIL_TO?.trim();
}

export type Problem = {
  kind: "falhou" | "perdeu";
  client: string;
  network: string;
  format: string;
  day: string;
  time: string;
  reason: string;
  /** Endereço da tela do dia no app, quando APP_URL existe. */
  link?: string;
};

export function problemMail(p: Problem): { subject: string; text: string } {
  const where = `${p.client} · ${p.network} ${p.format}`;
  const subject = p.kind === "falhou" ? `Publicação automática falhou: ${where}` : `Publicação automática perdeu o horário: ${where}`;
  const lines = [
    p.kind === "falhou"
      ? `A publicação automática de ${where}, marcada para ${p.day} às ${p.time}, não foi concluída.`
      : `A publicação automática de ${where}, marcada para ${p.day} às ${p.time}, não saiu no horário e passou da janela de tolerância. Nada foi publicado.`,
    "",
    `Motivo: ${p.reason}`,
    "",
    p.kind === "falhou"
      ? "Confira na rede se o post não saiu mesmo antes de tentar de novo, para não duplicar."
      : "Ajuste o horário e confirme de novo, ou publique agora pela tela do dia.",
  ];
  if (p.link) lines.push("", `Abrir no app: ${p.link}`);
  return { subject, text: lines.join("\n") };
}

/** Envia o aviso. Nunca lança erro: falha de e-mail não pode atrapalhar a publicação. Devolve true se enviou. */
export async function notifyProblem(p: Problem): Promise<boolean> {
  if (!notifyConfigured()) {
    console.warn(`[aviso] ${p.kind}: ${p.client} ${p.network}/${p.format} (${p.reason}). E-mail não configurado.`);
    return false;
  }
  const { subject, text } = problemMail(p);
  const base = process.env.RESEND_API_BASE?.trim() || "https://api.resend.com";
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM?.trim() || "Social Media Manager <onboarding@resend.dev>",
        to: [process.env.NOTIFY_EMAIL_TO!.trim()],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[aviso] o Resend recusou o e-mail (HTTP ${res.status}).`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[aviso] não deu para enviar o e-mail: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    return false;
  }
}
