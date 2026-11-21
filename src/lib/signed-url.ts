import crypto from "node:crypto";

// Endereço temporário e assinado de um arquivo ligado a um post. Serve para a Meta baixar imagens
// (o Instagram só aceita imagem por endereço público). Vale por pouco tempo e só para aquele arquivo.
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET precisa ter pelo menos 16 caracteres.");
  return s;
}

function sig(payload: string): string {
  return crypto.createHmac("sha256", secret()).update("media:" + payload).digest("hex");
}

export function signMediaToken(fileId: string, ttlSeconds = 3600, now = Date.now()): string {
  const payload = `${fileId}.${Math.floor(now / 1000) + ttlSeconds}`;
  return `${payload}.${sig(payload)}`;
}

/** Devolve o ID do arquivo se o token for válido e não tiver vencido. */
export function verifyMediaToken(token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [fileId, exp, given] = parts;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId) || !/^\d+$/.test(exp)) return null;
  const want = sig(`${fileId}.${exp}`);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < now) return null;
  return fileId;
}

/** Endereço público do app (ex.: https://app.ebuks.com.br), sem barra no fim. */
export function appUrl(): string | null {
  const u = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return u ? u : null;
}

export function signedMediaUrl(fileId: string, ttlSeconds = 3600): string | null {
  const base = appUrl();
  return base ? `${base}/api/pub/${signMediaToken(fileId, ttlSeconds)}` : null;
}

/** Endereço público para redirecionar: APP_URL, senão o que o proxy repassa (o Render entrega localhost:10000 em req.url). */
export function publicOrigin(req: Request): string {
  const env = appUrl();
  if (env) return env;
  const h = req.headers;
  const u = new URL(req.url);
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || u.host;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
