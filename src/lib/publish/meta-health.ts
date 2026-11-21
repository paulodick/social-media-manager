// Saúde da conexão com a Meta: pergunta à Meta se o acesso guardado ainda vale (debug_token, só leitura).
// Não publica nada e não altera nada. O token da Página não tem data de vencimento própria, mas pode ser
// invalidado (troca de senha, app removido das "Integrações de negócios", app inativo): sem esta checagem
// o app continuaria dizendo "conectado" até o dia da publicação.
import crypto from "node:crypto";
import { graphBase, graphVersion } from "./meta.ts";
import { META_SCOPES, metaConfig } from "./meta-oauth.ts";

export type TokenHealth = {
  /** ok: pode publicar; attention: funciona, mas vale olhar; reconnect: precisa conectar de novo; unknown: não deu para consultar. */
  state: "ok" | "attention" | "reconnect" | "unknown";
  message: string;
  missing: string[];
  /** Vencimento do acesso (ms), ou null quando não vence. */
  expiresAt: number | null;
};

type DebugData = {
  is_valid?: boolean;
  expires_at?: number;
  scopes?: string[];
  error?: { code?: number; message?: string };
};

const DAY = 86_400_000;

function fmtDate(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}

/** Traduz a resposta do debug_token. Função pura (testada). */
export function interpretDebugToken(data: DebugData | undefined, now = Date.now()): TokenHealth {
  if (!data) return { state: "unknown", message: "A Meta não respondeu sobre este acesso.", missing: [], expiresAt: null };
  if (data.is_valid === false) {
    const why = data.error?.message ? ` (${data.error.message.slice(0, 160)})` : "";
    return { state: "reconnect", message: `A Meta não aceita mais o acesso desta conta${why}. Conecte de novo.`, missing: [], expiresAt: null };
  }
  const expiresAt = data.expires_at && data.expires_at > 0 ? data.expires_at * 1000 : null;
  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  const missing = scopes.length ? META_SCOPES.filter((s) => !scopes.includes(s)) : [];
  if (missing.length) {
    return { state: "reconnect", message: `Faltam permissões neste acesso: ${missing.join(", ")}. Conecte de novo e aceite todas.`, missing, expiresAt };
  }
  if (expiresAt && expiresAt - now < 7 * DAY) {
    const left = expiresAt - now;
    return {
      state: "attention",
      message: left <= 0 ? "O acesso desta conta venceu. Conecte de novo." : `O acesso desta conta vence em ${fmtDate(expiresAt)}. Conecte de novo antes disso.`,
      missing,
      expiresAt,
    };
  }
  return { state: "ok", message: "Conexão ativa: a Meta aceita o acesso e as permissões de publicação estão liberadas.", missing, expiresAt };
}

const cache = new Map<string, { at: number; health: TokenHealth }>();
const TTL_MS = 2 * 60_000;

/** Consulta a Meta sobre o token (resultado guardado por 2 minutos para não chamar a cada tela). */
export async function checkMetaToken(token: string): Promise<TokenHealth> {
  const cfg = metaConfig();
  if ("error" in cfg) return { state: "unknown", message: cfg.error, missing: [], expiresAt: null };
  const key = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.health;
  let health: TokenHealth;
  try {
    // O segredo do app vai no cabeçalho, não na URL.
    const url = `${graphBase()}/${graphVersion()}/debug_token?input_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.appId}|${cfg.secret}` }, signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as { data?: DebugData; error?: { message?: string; code?: number } };
    if (body.data) health = interpretDebugToken(body.data);
    else if (body.error) {
      health = { state: "unknown", message: `A Meta não deixou conferir o acesso agora: ${(body.error.message ?? "").slice(0, 160)}`, missing: [], expiresAt: null };
    } else health = interpretDebugToken(undefined);
  } catch {
    return { state: "unknown", message: "Não foi possível falar com a Meta para conferir o acesso agora.", missing: [], expiresAt: null };
  }
  if (health.state !== "unknown") cache.set(key, { at: Date.now(), health });
  return health;
}
