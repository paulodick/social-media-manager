// Cliente de IA (Google Gemini) exclusivo do módulo Editorial. Só roda no servidor.
// A chave vem de GEMINI_API_KEY (variável de ambiente, nunca no repositório).

export const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

const hasGemini = (): boolean => !!process.env.GEMINI_API_KEY?.trim();
const hasClaude = (): boolean => !!process.env.ANTHROPIC_API_KEY?.trim();

/** IA do Editorial ligada: Gemini (GEMINI_API_KEY) e/ou Claude (ANTHROPIC_API_KEY). */
export const editorialAiConfigured = (): boolean => hasGemini() || hasClaude();

/**
 * Ordem de tentativa no Editorial. Com a chave da Anthropic, Claude vem primeiro (respostas longas em JSON, como a
 * sequência, falhavam muito no Gemini) e o Gemini fica de reserva; EDITORIAL_AI_PROVIDER=gemini inverte.
 */
export function editorialProviders(): ("claude" | "gemini")[] {
  const order: ("claude" | "gemini")[] = process.env.EDITORIAL_AI_PROVIDER?.trim() === "gemini" ? ["gemini", "claude"] : ["claude", "gemini"];
  return order.filter((p) => (p === "claude" ? hasClaude() : hasGemini()));
}

export const EDITORIAL_CLAUDE_MODEL_DEFAULT = "claude-sonnet-5-5";

/** Traduz um erro da API do Gemini para uma frase amigável em português. Função pura, com teste. */
export function explainGeminiError(status: number, message: string): string {
  const m = message.toLowerCase();
  if (status === 400 && (m.includes("api key") || m.includes("api_key"))) {
    return "a chave do Gemini foi recusada. Confira a variável GEMINI_API_KEY no Render.";
  }
  if (status === 401 || status === 403) {
    return "a chave do Gemini foi recusada ou não tem permissão. Confira GEMINI_API_KEY no Render.";
  }
  if (status === 404) {
    return "nenhum modelo compatível do Gemini está habilitado para esta chave. Use \"Copiar pedido para a IA\" ou confira GEMINI_MODEL.";
  }
  if (status === 429) {
    return "limite de uso da API do Gemini atingido. Tente de novo em alguns minutos ou use \"Copiar pedido para a IA\".";
  }
  if (status >= 500) {
    return "o serviço do Gemini está instável agora. Tente de novo em instantes.";
  }
  return `o Gemini não respondeu (código ${status}). Use "Copiar pedido para a IA" por enquanto.`;
}

export type EditorialAiResult = { text: string } | { error: string };

async function callGemini(prompt: string, responseMimeType?: "application/json", timeoutMs = 45_000): Promise<EditorialAiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    return { error: "a chave do Gemini ainda não foi cadastrada (variável GEMINI_API_KEY no Render)." };
  }
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const custom = process.env.GEMINI_MODEL?.trim();
  const candidates = custom ? [custom] : [...GEMINI_MODELS];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    // A chave vai no cabeçalho, não no endereço: endereços aparecem em logs de proxies e servidores.
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const payload: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      };
      if (responseMimeType) {
        payload.generationConfig = { responseMimeType };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await res.json().catch(() => null)) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        error?: { message?: string };
      } | null;

      if (!res.ok) {
        if ((res.status === 404 || res.status === 429 || res.status >= 500) && i < candidates.length - 1) continue;
        return { error: explainGeminiError(res.status, body?.error?.message ?? "") };
      }
      if (body?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        return { error: "a resposta do Gemini veio cortada por ser longa demais. Tente de novo pedindo um texto mais curto." };
      }
      const parts = body?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return text ? { text } : { error: "o Gemini devolveu uma resposta vazia. Tente de novo." };
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return {
        error: timeout
          ? "o Gemini demorou demais para responder. Tente de novo."
          : "não foi possível falar com o Gemini agora. Tente de novo.",
      };
    }
  }
  return { error: explainGeminiError(404, "") };
}

/**
 * Chama a API REST oficial do Google Gemini forçando resposta JSON estruturada
 * (`responseMimeType: "application/json"`) para evitar blocos markdown extras.
 */
export async function generateEditorialJson(prompt: string): Promise<EditorialAiResult> {
  const providers = editorialProviders();
  if (!providers.length) return callGemini(prompt, "application/json");
  const errors: string[] = [];
  for (const p of providers) {
    // Sequências longas demoram: 2 minutos no Gemini (antes 45 s, que cortava a resposta) e 3 no Claude.
    const res = p === "claude" ? await callClaudeJson(prompt) : await callGemini(prompt, "application/json", 120_000);
    if ("text" in res) return res;
    errors.push(`${p === "claude" ? "Claude" : "Gemini"}: ${res.error}`);
  }
  return { error: `a IA não conseguiu responder (${errors.join(" / ")}).` };
}

/** Claude pela API da Anthropic, pedindo só JSON. Modelo em EDITORIAL_CLAUDE_MODEL (padrão Sonnet). */
async function callClaudeJson(prompt: string): Promise<EditorialAiResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { error: "a chave da Anthropic não foi cadastrada (ANTHROPIC_API_KEY no Render)." };
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = process.env.EDITORIAL_CLAUDE_MODEL?.trim() || EDITORIAL_CLAUDE_MODEL_DEFAULT;
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 16_000,
        system: "Responda somente com o JSON pedido, sem texto antes ou depois e sem bloco de código.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      const m = (body?.error?.message ?? "").toLowerCase();
      if (res.status === 401) return { error: "a chave da Anthropic foi recusada (ANTHROPIC_API_KEY)." };
      if (res.status === 429) return { error: "limite de uso da API da Anthropic atingido; tente em alguns minutos." };
      if (m.includes("credit balance") || m.includes("billing")) return { error: "a conta da API da Anthropic está sem saldo." };
      if (res.status === 529 || res.status >= 500) return { error: "a API da Anthropic está sobrecarregada agora." };
      return { error: `a API da Anthropic respondeu com erro ${res.status}.` };
    }
    if (body?.stop_reason === "max_tokens") return { error: "a resposta veio cortada por ser longa demais; peça menos posts." };
    const text = (body?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    return text ? { text } : { error: "a API da Anthropic devolveu resposta vazia." };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { error: timeout ? "o Claude demorou demais para responder." : "não foi possível falar com a API da Anthropic agora." };
  }
}

/** Chama a API REST oficial do Google Gemini em texto livre (usado na geração de legendas). */
export async function generateGeminiText(prompt: string): Promise<EditorialAiResult> {
  return callGemini(prompt);
}
