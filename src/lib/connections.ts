import { db } from "./db";
import { encryptToken } from "./crypto";
import type { MetaPage } from "./publish/meta-oauth";

/** Guarda a Página do Facebook e, se houver, o Instagram profissional ligado a ela. Tokens vão criptografados. */
export async function saveMetaConnections(clientId: string, page: MetaPage): Promise<{ instagram: string | null }> {
  const pool = await db();
  const enc = encryptToken(page.token);
  const upsert = `insert into network_connections (client_id, network, account_id, account_name, page_id, token_enc)
                  values ($1, $2, $3, $4, $5, $6)
                  on conflict (client_id, network) do update
                    set account_id = excluded.account_id, account_name = excluded.account_name,
                        page_id = excluded.page_id, token_enc = excluded.token_enc, updated_at = now()`;
  await pool.query(upsert, [clientId, "facebook", page.id, page.name, page.id, enc]);
  if (page.ig) {
    const name = page.ig.username ? `@${page.ig.username}` : page.ig.id;
    await pool.query(upsert, [clientId, "instagram", page.ig.id, name, page.id, enc]);
    return { instagram: name };
  }
  return { instagram: null };
}

export async function removeMetaConnections(clientId: string): Promise<void> {
  const pool = await db();
  await pool.query("delete from network_connections where client_id = $1 and network in ('facebook','instagram')", [clientId]);
}
