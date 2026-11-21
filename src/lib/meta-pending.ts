import { cookies } from "next/headers";
import { decryptToken, encryptToken } from "./crypto";

// Entre o login da Meta e a escolha da Página, o token do usuário fica num cookie criptografado (10 minutos).
const NAME = "smm_meta_pending";
const NONCE = "smm_meta_nonce";
const TTL = 600;

const opts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

export async function setNonce(nonce: string): Promise<void> {
  (await cookies()).set(NONCE, nonce, opts(TTL));
}

export async function takeNonce(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(NONCE)?.value ?? null;
  if (v) jar.delete(NONCE);
  return v;
}

export async function setPending(clientId: string, userToken: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  (await cookies()).set(NAME, encryptToken(JSON.stringify({ clientId, userToken, exp })), opts(TTL));
}

export async function readPending(clientId: string): Promise<string | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(decryptToken(raw)) as { clientId?: string; userToken?: string; exp?: number };
    if (p.clientId !== clientId || !p.userToken || !p.exp || p.exp < Date.now() / 1000) return null;
    return p.userToken;
  } catch {
    return null;
  }
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete(NAME);
}
