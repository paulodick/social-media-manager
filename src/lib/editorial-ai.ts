// Cliente de IA (Google Gemini) exclusivo do módulo Editorial. Só roda no servidor.
// A chave vem de GEMINI_API_KEY (variável de ambiente, nunca no repositório).

export const GEMINI_MODEL = "gemini-2.5-flash";

export const editorialAiConfigured = (): boolean => !!process.env.GEMINI_API_KEY?.trim();

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
    return "o modelo do Gemini configurado não foi encontrado. Tente novamente mais tarde.";
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

/**
 * Chama a API REST oficial do Google Gemini forçando resposta JSON estruturada
 * (`responseMimeType: "application/json"`) para evitar blocos markdown extras.
 */
export async function generateEditorialJson(prompt: string): Promise<EditorialAiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    return { error: "a chave do Gemini ainda não foi cadastrada (variável GEMINI_API_KEY no Render)." };
  }
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const url = `${base}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      return { error: explainGeminiError(res.status, body?.error?.message ?? "") };
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
