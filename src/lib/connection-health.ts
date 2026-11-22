import { decryptToken } from "./crypto";
import { getConnection } from "./queries";
import { linkedinHealthFrom } from "./publish/linkedin-health";
import { tiktokHealthFrom } from "./publish/tiktok-health";
import { checkMetaToken, type TokenHealth } from "./publish/meta-health";

/**
 * Saúde da conexão da Meta de um cliente (Facebook e Instagram usam o mesmo acesso, o da Página).
 * Devolve null quando o cliente não tem conta conectada. Só lê: não publica nem altera nada.
 */
export async function clientMetaHealth(clientId: string): Promise<TokenHealth | null> {
  const conn = (await getConnection(clientId, "facebook")) ?? (await getConnection(clientId, "instagram"));
  if (!conn) return null;
  let token: string;
  try {
    token = decryptToken(conn.token_enc);
  } catch {
    return { state: "reconnect", message: "O acesso guardado não pode mais ser lido (a chave de criptografia mudou). Conecte de novo.", missing: [], expiresAt: null };
  }
  return checkMetaToken(token);
}

/** Saúde da conexão do LinkedIn: o acesso vale 60 dias e não se renova sozinho, então a data guardada diz tudo (sem chamar a rede). */
export async function clientLinkedinHealth(clientId: string): Promise<TokenHealth | null> {
  const conn = await getConnection(clientId, "linkedin");
  if (!conn) return null;
  return linkedinHealthFrom(conn.expires_at);
}

/** Saúde da conexão do TikTok: o acesso é renovado sozinho, então só a data de vencimento da autorização importa (sem chamar a rede). */
export async function clientTiktokHealth(clientId: string): Promise<TokenHealth | null> {
  const conn = await getConnection(clientId, "tiktok");
  if (!conn) return null;
  return tiktokHealthFrom(conn.expires_at);
}
