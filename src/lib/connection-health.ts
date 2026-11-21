import { decryptToken } from "./crypto";
import { getConnection } from "./queries";
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
