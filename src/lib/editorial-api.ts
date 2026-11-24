import { isAuthed } from "./auth";
import { isUuid } from "./editorial-rules";
import { getClient } from "./queries";

export async function requireApiAuth(): Promise<Response | null> {
  if (!(await isAuthed())) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  return null;
}

export function jsonError(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

export async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return null;
    return body as T;
  } catch {
    return null;
  }
}

export async function requireClient(clientId: string) {
  if (!isUuid(clientId)) return null;
  return getClient(clientId);
}

export function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
