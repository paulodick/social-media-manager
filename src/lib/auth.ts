import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { verifyPassword } from "./password";

const COOKIE = "smm_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET precisa ter pelo menos 16 caracteres.");
  return s;
}

function sign(exp: number): string {
  return crypto.createHmac("sha256", secret()).update(String(exp)).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Se APP_PASSWORD estiver definida, ela vale (serve de recuperação). Senão vale a senha guardada no banco.
async function storedHash(): Promise<string | null> {
  const r = await (await db()).query<{ value: string }>("select value from app_settings where key = 'password_hash'");
  return r.rows[0]?.value ?? null;
}

export async function hasPassword(): Promise<boolean> {
  if (process.env.APP_PASSWORD) return true;
  return (await storedHash()) !== null;
}

export async function checkPassword(input: string): Promise<boolean> {
  const fromEnv = process.env.APP_PASSWORD;
  if (fromEnv) return safeEqual(input, fromEnv);
  const hash = await storedHash();
  return hash !== null && verifyPassword(input, hash);
}

export async function createSession(): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const jar = await cookies();
  jar.set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !mac || exp < Date.now() / 1000) return false;
  try {
    return safeEqual(mac, sign(exp));
  } catch {
    return false;
  }
}

export async function requireAuth(): Promise<void> {
  if (!(await isAuthed())) redirect("/login");
}
