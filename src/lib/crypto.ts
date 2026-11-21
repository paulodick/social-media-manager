import crypto from "node:crypto";

// Tokens das redes ficam no banco criptografados (AES-256-GCM). A chave vem de TOKEN_ENC_KEY (nunca do repositório).
// Trocar a chave invalida os tokens guardados: as contas precisam ser conectadas de novo.
function key(): Buffer {
  const k = process.env.TOKEN_ENC_KEY;
  if (!k || k.length < 16) throw new Error("TOKEN_ENC_KEY não está definida (mínimo de 16 caracteres).");
  return crypto.createHash("sha256").update(k).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, enc] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Token guardado em formato desconhecido.");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Não foi possível abrir o token guardado. A TOKEN_ENC_KEY mudou? Conecte a conta de novo.");
  }
}
