import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILURES,
  checkLoginRateLimit,
  clearLoginRateLimit,
  extractClientIp,
  recordLoginFailure,
  resetLoginRateLimit,
} from "../src/lib/login-rate-limit.ts";

test("extractClientIp usa o IP gravado pela Cloudflare e, sem ele, o último IP de x-forwarded-for (não forjável)", () => {
  const make = (map: Record<string, string>) => ({ get: (k: string) => map[k.toLowerCase()] ?? null });
  // O primeiro item do x-forwarded-for vem do visitante: trocá-lo não pode mudar o IP contado.
  assert.equal(extractClientIp(make({ "x-forwarded-for": "1.1.1.1, 203.0.113.10" })), "203.0.113.10");
  assert.equal(extractClientIp(make({ "x-forwarded-for": "9.9.9.9, 203.0.113.10" })), "203.0.113.10");
  assert.equal(
    extractClientIp(make({ "cf-connecting-ip": "198.51.100.20", "x-forwarded-for": "6.6.6.6, 172.70.1.1" })),
    "198.51.100.20",
  );
  assert.equal(extractClientIp(make({ "true-client-ip": "198.51.100.21" })), "198.51.100.21");
  assert.equal(extractClientIp(make({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(extractClientIp(make({})), "unknown");
});

test("login rate limit: atraso crescente nas 5 falhas e bloqueio temporário na 6ª tentativa", () => {
  clearLoginRateLimit();
  const ip = "203.0.113.55";
  const otherIp = "203.0.113.99";
  const t0 = 1_700_000_000_000;

  const delays: number[] = [];
  for (let i = 1; i <= LOGIN_MAX_FAILURES; i++) {
    assert.equal(checkLoginRateLimit(ip, t0 + i * 1000).allowed, true);
    const r = recordLoginFailure(ip, t0 + i * 1000);
    delays.push(r.delayMs);
    assert.equal(r.failures, i);
    assert.equal(r.blocked, i === LOGIN_MAX_FAILURES);
  }
  assert.deepEqual(delays, [600, 1200, 2000, 3000, 4000]);

  // 6ª tentativa seguida dispara o bloqueio temporário
  const sixth = checkLoginRateLimit(ip, t0 + 6_000);
  assert.equal(sixth.allowed, false);
  assert.ok(sixth.retryAfterMs > 0);

  // Outro IP continua livre
  assert.equal(checkLoginRateLimit(otherIp, t0 + 6_000).allowed, true);

  // Após expirar o bloqueio temporário, volta a permitir
  const afterLockout = checkLoginRateLimit(ip, t0 + 5_000 + LOGIN_LOCKOUT_MS + 1);
  assert.equal(afterLockout.allowed, true);
});

test("resetLoginRateLimit limpa as falhas após login bem-sucedido", () => {
  clearLoginRateLimit();
  const ip = "198.51.100.20";
  const t0 = 1_700_000_000_000;
  recordLoginFailure(ip, t0);
  recordLoginFailure(ip, t0 + 1000);
  resetLoginRateLimit(ip);
  const next = recordLoginFailure(ip, t0 + 2000);
  assert.equal(next.failures, 1);
  assert.equal(next.blocked, false);
});
