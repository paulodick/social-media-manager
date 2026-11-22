import { decryptToken, encryptToken } from "./crypto";
import { db } from "./db";
import { PublishError } from "./publish/meta";
import { refreshAccess, tiktokConfig } from "./publish/tiktok-oauth";

/**
 * Token de acesso do TikTok de um cliente, renovado se faltarem menos de 5 minutos. O token de renovação gira (cada uso
 * invalida o anterior), então a leitura e a renovação acontecem numa transação com a linha travada: duas publicações ao
 * mesmo tempo não gastam o mesmo token de renovação.
 */
export async function freshTiktokToken(clientId: string): Promise<string> {
  const cfg = tiktokConfig();
  if ("error" in cfg) throw new PublishError(cfg.error);
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await c.query<{ token_enc: string; refresh_token_enc: string | null; access_expires_at: Date | null }>(
      "select token_enc, refresh_token_enc, access_expires_at from network_connections where client_id = $1 and network = 'tiktok' for update",
      [clientId],
    );
    const row = r.rows[0];
    if (!row) throw new PublishError("A conta do TikTok ainda não está conectada.");
    if (row.access_expires_at && row.access_expires_at.getTime() > Date.now() + 5 * 60_000) {
      const token = decryptToken(row.token_enc);
      await c.query("commit");
      return token;
    }
    if (!row.refresh_token_enc) throw new PublishError("O acesso ao TikTok venceu. Conecte de novo em Editar cliente › Contas conectadas.");
    const t = await refreshAccess(cfg, decryptToken(row.refresh_token_enc));
    await c.query(
      `update network_connections set token_enc = $2, refresh_token_enc = $3, access_expires_at = $4, expires_at = $5, updated_at = now()
        where client_id = $1 and network = 'tiktok'`,
      [clientId, encryptToken(t.accessToken), encryptToken(t.refreshToken), t.accessExpiresAt, t.refreshExpiresAt],
    );
    await c.query("commit");
    return t.accessToken;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
