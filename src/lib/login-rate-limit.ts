export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
export const LOGIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutos
const MAX_TRACKED_IPS = 2000;

type AttemptRecord = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
};

type G = typeof globalThis & { _smmLoginAttempts?: Map<string, AttemptRecord> };

function store(): Map<string, AttemptRecord> {
  const g = globalThis as G;
  if (!g._smmLoginAttempts) g._smmLoginAttempts = new Map();
  return g._smmLoginAttempts;
}

/** Limpa o estado em memória de tentativas de login (útil em testes). */
export function clearLoginRateLimit(): void {
  store().clear();
}

/** Extrai o IP do cliente a partir dos cabeçalhos HTTP (proxy reverso do Render ou acesso direto). */
export function extractClientIp(h: { get(name: string): string | null }): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 100);
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 100);
  return "unknown";
}

/** Verifica se o IP pode tentar autenticar agora. */
export function checkLoginRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const map = store();
  const rec = map.get(ip);
  if (!rec) return { allowed: true, retryAfterMs: 0 };
  if (rec.blockedUntil > now) {
    return { allowed: false, retryAfterMs: rec.blockedUntil - now };
  }
  if (rec.blockedUntil > 0 && rec.blockedUntil <= now) {
    map.delete(ip);
    return { allowed: true, retryAfterMs: 0 };
  }
  if (now - rec.firstFailureAt > LOGIN_WINDOW_MS) {
    map.delete(ip);
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Registra uma falha de login para o IP e devolve o atraso recomendado (crescente) e se o bloqueio foi ativado.
 */
export function recordLoginFailure(
  ip: string,
  now = Date.now(),
): { failures: number; delayMs: number; blocked: boolean } {
  const map = store();
  if (map.size >= MAX_TRACKED_IPS) {
    for (const [k, v] of map) {
      if ((v.blockedUntil > 0 && v.blockedUntil <= now) || now - v.firstFailureAt > LOGIN_WINDOW_MS) {
        map.delete(k);
      }
    }
    if (map.size >= MAX_TRACKED_IPS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }

  const prev = map.get(ip);
  const expired = !prev || now - prev.firstFailureAt > LOGIN_WINDOW_MS || (prev.blockedUntil > 0 && prev.blockedUntil <= now);
  const failures = expired ? 1 : prev.failures + 1;
  const firstFailureAt = expired ? now : prev.firstFailureAt;
  const blocked = failures >= LOGIN_MAX_FAILURES;
  const blockedUntil = blocked ? now + LOGIN_LOCKOUT_MS : 0;

  map.set(ip, { failures, firstFailureAt, blockedUntil });

  // Atraso crescente em ms: 600, 1200, 2000, 3000, 4000
  const delays = [600, 1200, 2000, 3000, 4000];
  const delayMs = delays[Math.min(failures - 1, delays.length - 1)];
  return { failures, delayMs, blocked };
}

/** Limpa o histórico de falhas após um login bem-sucedido. */
export function resetLoginRateLimit(ip: string): void {
  store().delete(ip);
}
