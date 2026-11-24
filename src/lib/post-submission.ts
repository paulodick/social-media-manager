import type { PoolClient } from "pg";
import { isUuid } from "./editorial-rules.ts";

/** Valida `submission_id` vindo do formulário. Valores vazios ou inválidos viram `null`. */
export function parseSubmissionId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  return isUuid(s) ? s : null;
}

/**
 * Insere um post com proteção de idempotência por `submission_id`.
 * Se já existir um post com o mesmo `submission_id`, não cria outro e devolve `{ created: false }`.
 */
export async function insertPostIdempotent(
  client: PoolClient,
  params: {
    clientId: string;
    title: string;
    idea: string;
    tones: string[];
    submissionId: string | null;
  },
): Promise<{ created: true; id: string } | { created: false }> {
  const res = await client.query<{ id: string }>(
    `insert into posts (client_id, title, idea, tones, submission_id)
     values ($1, $2, $3, $4, $5)
     on conflict (submission_id) where submission_id is not null do nothing
     returning id`,
    [params.clientId, params.title, params.idea, params.tones, params.submissionId],
  );
  if (!res.rowCount) return { created: false };
  return { created: true, id: res.rows[0].id };
}
