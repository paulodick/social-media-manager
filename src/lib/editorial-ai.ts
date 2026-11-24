// Cliente de IA (Google Gemini) exclusivo do módulo Editorial. Só roda no servidor.
// A chave vem de GEMINI_API_KEY (variável de ambiente, nunca no repositório).

export const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

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

async function callGemini(prompt: string, responseMimeType?: "application/json"): Promise<EditorialAiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    return { error: "a chave do Gemini ainda não foi cadastrada (variável GEMINI_API_KEY no Render)." };
  }
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const custom = process.env.GEMINI_MODEL?.trim();
  const candidates = custom ? [custom] : [...GEMINI_MODELS];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const payload: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      };
      if (responseMimeType) {
        payload.generationConfig = { responseMimeType };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
      const body = (await res.json().catch(() => null)) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
      } | null;

      if (!res.ok) {
        if ((res.status === 404 || res.status === 429 || res.status >= 500) && i < candidates.length - 1) continue;
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
  return { error: explainGeminiError(404, "") };
}

/**
 * Chama a API REST oficial do Google Gemini forçando resposta JSON estruturada
 * (`responseMimeType: "application/json"`) para evitar blocos markdown extras.
 */
export async function generateEditorialJson(prompt: string): Promise<EditorialAiResult> {
  return callGemini(prompt, "application/json");
}

/** Chama a API REST oficial do Google Gemini em texto livre (usado na geração de legendas). */
export async function generateGeminiText(prompt: string): Promise<EditorialAiResult> {
  return callGemini(prompt);
}
