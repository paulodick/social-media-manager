// Geração de legenda pela API da Anthropic. Só roda no servidor. A chave vem de ANTHROPIC_API_KEY
// (variável de ambiente, nunca no repositório) e nunca é escrita em log nem devolvida ao navegador.

export const AI_MODEL = "claude-haiku-5-5";

export type AiProvider = "gemini" | "claude";

/** Fornecedor de IA ativo para legendas: Gemini tem prioridade se GEMINI_API_KEY estiver definida. */
export function activeAiProvider(): AiProvider | null {
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "claude";
  return null;
}

export const aiConfigured = (): boolean => activeAiProvider() !== null;

/** Traduz um erro da API para uma frase em português. Função pura, com teste. */
export function explainAiError(status: number, message: string): string {
  const m = message.toLowerCase();
  if (status === 401) return "a chave da API foi recusada. Confira a variável ANTHROPIC_API_KEY no Render.";
  if (status === 403) return "a chave da API não tem permissão para isso.";
  if (status === 429) return "limite de uso da API atingido. Tente de novo em alguns minutos.";
  if ((status === 400 || status === 402) && (m.includes("credit balance") || m.includes("billing"))) {
    return "a conta da API está sem saldo. Adicione crédito no Claude Console ou use \"Copiar pedido para a IA\".";
  }
  if (status === 529 || status >= 500) return "a IA está sobrecarregada agora. Tente de novo em instantes.";
  return `a IA não respondeu (código ${status}). Use "Copiar pedido para a IA" por enquanto.`;
}

export type AiResult = { text: string } | { error: string };

export async function generateText(prompt: string): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "a chave da API ainda não foi cadastrada (variável ANTHROPIC_API_KEY no Render)." };
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) return { error: explainAiError(res.status, body?.error?.message ?? "") };
    const text = (body?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    return text ? { text } : { error: "a IA devolveu uma resposta vazia. Tente de novo." };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { error: timeout ? "a IA demorou demais para responder. Tente de novo." : "não foi possível falar com a IA agora. Tente de novo." };
  }
}
