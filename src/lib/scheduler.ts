import { db } from "./db";
import { AUTO_WINDOW_MIN } from "./auto-publish";
import { listTargets } from "./queries";
import { alertProblem, startPublish } from "./publisher";

/**
 * Relógio interno da publicação automática. A cada minuto procura os destinos que a pessoa CONFIRMOU e cujo horário
 * chegou, e publica pelo mesmo caminho do botão "Publicar agora" (mesmas validações, mesma trava no banco).
 *
 * Segurança:
 * - só pega destino com `auto_confirmed_at`, parado ("idle") e dentro da janela de tolerância (AUTO_WINDOW_MIN);
 * - a trava é uma atualização atômica no banco: se dois processos rodarem juntos (troca de versão no Render),
 *   só um consegue publicar;
 * - falha NÃO tenta de novo sozinha (uma segunda tentativa pode duplicar o post): vira "Falhou ao publicar" e avisa;
 * - passou da janela sem publicar: vira "Perdeu o horário" e avisa, sem publicar.
 */

const MAX_PER_TICK = 10;

export type TickResult = { started: number; failed: number; missed: number };

export async function runDueOnce(): Promise<TickResult> {
  const pool = await db();
  const out: TickResult = { started: 0, failed: 0, missed: 0 };

  const due = await pool.query<{ id: string }>(
    `select id from post_targets
      where auto_confirmed_at is not null and status <> 'posted' and publish_state = 'idle'
        and scheduled_at <= now() and scheduled_at > now() - interval '${AUTO_WINDOW_MIN} minutes'
      order by scheduled_at limit ${MAX_PER_TICK}`,
  );
  for (const r of due.rows) {
    const res = await startPublish(r.id, { auto: true });
    if (res.ok) {
      out.started++;
      continue;
    }
    if (res.skipped) continue; // outro processo já pegou
    // Não passou nas validações (token vencido, mídia sumiu, legenda longa...). Para de tentar e avisa.
    const marked = await pool.query(
      "update post_targets set publish_state='failed', publish_error=$2 where id=$1 and publish_state='idle' returning id",
      [r.id, res.error.slice(0, 500)],
    );
    if (marked.rows[0]) {
      out.failed++;
      const [t] = await listTargets({ targetId: r.id });
      if (t) await alertProblem(t, "falhou", res.error);
    }
  }

  // Confirmados que ficaram para trás (servidor fora do ar além da janela): avisa uma vez.
  const missed = await pool.query<{ id: string }>(
    `select id from post_targets
      where auto_confirmed_at is not null and status <> 'posted' and publish_state = 'idle'
        and scheduled_at <= now() - interval '${AUTO_WINDOW_MIN} minutes' and auto_notified_at is null
      order by scheduled_at limit ${MAX_PER_TICK}`,
  );
  for (const r of missed.rows) {
    const [t] = await listTargets({ targetId: r.id });
    if (!t) continue;
    out.missed++;
    await alertProblem(t, "perdeu", `o horário passou há mais de ${AUTO_WINDOW_MIN} minutos sem a publicação sair (o app pode ter estado fora do ar).`);
  }
  return out;
}

type G = typeof globalThis & { _smmScheduler?: NodeJS.Timeout; _smmTicking?: boolean };

/** Liga o relógio (uma vez por processo). Intervalo em ms: SCHEDULER_TICK_MS (padrão 60 s; menor só em teste). */
export function startScheduler(): void {
  const g = globalThis as G;
  if (g._smmScheduler) return;
  const every = Math.max(500, Number(process.env.SCHEDULER_TICK_MS) || 60_000);
  const tick = async () => {
    if (g._smmTicking) return;
    g._smmTicking = true;
    try {
      const r = await runDueOnce();
      if (r.started || r.failed || r.missed) console.log(`[agendador] iniciadas ${r.started}, falhas ${r.failed}, perdidas ${r.missed}`);
    } catch (e) {
      console.error(`[agendador] erro no ciclo: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    } finally {
      g._smmTicking = false;
    }
  };
  g._smmScheduler = setInterval(tick, every);
  g._smmScheduler.unref?.();
  setTimeout(tick, Math.min(every, 15_000)).unref?.();
  console.log(`[agendador] ligado (a cada ${Math.round(every / 1000)} s, tolerância de ${AUTO_WINDOW_MIN} min)`);
}
