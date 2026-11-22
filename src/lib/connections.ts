import { db } from "./db";
import { decryptToken, encryptToken } from "./crypto";
import type { MetaPage } from "./publish/meta-oauth";
import type { TiktokTokens } from "./publish/tiktok-oauth";

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

/** Guarda o perfil pessoal do LinkedIn. O acesso vale 60 dias (sem renovação automática): expires_at avisa antes. */
export async function saveLinkedinConnection(clientId: string, m: { id: string; name: string; token: string; expiresAt: Date }): Promise<void> {
  const pool = await db();
  await pool.query(
    `insert into network_connections (client_id, network, account_id, account_name, page_id, token_enc, expires_at)
     values ($1, 'linkedin', $2, $3, null, $4, $5)
     on conflict (client_id, network) do update
       set account_id = excluded.account_id, account_name = excluded.account_name, token_enc = excluded.token_enc,
           expires_at = excluded.expires_at, updated_at = now()`,
    [clientId, m.id, m.name, encryptToken(m.token), m.expiresAt],
  );
}

export async function removeLinkedinConnection(clientId: string): Promise<void> {
  const pool = await db();
  await pool.query("delete from network_connections where client_id = $1 and network = 'linkedin'", [clientId]);
}

/** Guarda a conta do TikTok. expires_at = vencimento da autorização (token de renovação); access_expires_at = do acesso. */
export async function saveTiktokConnection(clientId: string, a: { id: string; name: string; tokens: TiktokTokens }): Promise<void> {
  const pool = await db();
  await pool.query(
    `insert into network_connections (client_id, network, account_id, account_name, page_id, token_enc, refresh_token_enc, access_expires_at, expires_at)
     values ($1, 'tiktok', $2, $3, null, $4, $5, $6, $7)
     on conflict (client_id, network) do update
       set account_id = excluded.account_id, account_name = excluded.account_name, token_enc = excluded.token_enc,
           refresh_token_enc = excluded.refresh_token_enc, access_expires_at = excluded.access_expires_at,
           expires_at = excluded.expires_at, updated_at = now()`,
    [clientId, a.id, a.name, encryptToken(a.tokens.accessToken), encryptToken(a.tokens.refreshToken), a.tokens.accessExpiresAt, a.tokens.refreshExpiresAt],
  );
}

/** Apaga a conexão do TikTok e devolve o token de acesso que estava guardado (para revogar no TikTok), se houver. */
export async function removeTiktokConnection(clientId: string): Promise<string | null> {
  const pool = await db();
  const r = await pool.query<{ token_enc: string }>("delete from network_connections where client_id = $1 and network = 'tiktok' returning token_enc", [clientId]);
  const enc = r.rows[0]?.token_enc;
  if (!enc) return null;
  try {
    return decryptToken(enc);
  } catch {
    return null;
  }
}
