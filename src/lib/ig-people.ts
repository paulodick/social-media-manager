// Marcações e collabs do Instagram: lista de @ digitada pela pessoa. Funções puras, com teste.

/** Limites da Meta (POST /<IG_ID>/media, conferido em 2026-11-25): até 3 collabs; marcações por post: 20. */
export const MAX_COLLABS = 3;
export const MAX_USER_TAGS = 20;

const HANDLE = /^[a-z0-9._]{1,30}$/;

/**
 * "@fulano, beltrano; @ciclano" -> ["fulano", "beltrano", "ciclano"]. Aceita vírgula, ponto e vírgula, espaço e quebra de linha,
 * links do Instagram (instagram.com/fulano) e repete-se só uma vez.
 */
export function parseHandles(raw: string, max: number, what: string): { handles: string[] } | { error: string } {
  const out: string[] = [];
  for (let part of raw.split(/[\s,;]+/)) {
    part = part.trim();
    if (!part) continue;
    const fromUrl = part.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    const h = (fromUrl ? fromUrl[1] : part).replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
    if (!h) continue;
    if (!HANDLE.test(h) || h.startsWith(".") || h.endsWith(".")) return { error: `"${part}" não parece um usuário do Instagram (${what}).` };
    if (!out.includes(h)) out.push(h);
  }
  if (out.length > max) return { error: `${what}: no máximo ${max} usuários (você colocou ${out.length}).` };
  return { handles: out };
}

/** Para mostrar no campo: ["a","b"] -> "@a, @b". */
export function formatHandles(h: readonly string[]): string {
  return h.map((x) => `@${x}`).join(", ");
}

/**
 * Parâmetro user_tags da Meta. Em imagem do feed a posição é obrigatória: o app marca no centro (0,5 × 0,5);
 * em Reels, vídeo e Stories ela não vai.
 */
export function userTagsParam(handles: readonly string[], withPosition: boolean): { username: string; x?: number; y?: number }[] {
  return handles.map((username) => (withPosition ? { username, x: 0.5, y: 0.5 } : { username }));
}
