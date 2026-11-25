import sharp from "sharp";

/** Limite da Meta para a capa do Reels (POST /<IG_ID>/media, conferido em 2026-11-25). */
export const COVER_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Converte qualquer imagem em JPEG sRGB de até 1080×1920 (sem aumentar) e abaixo de 8 MB, para a capa do Reels.
 * Se ainda passar do limite, reduz a qualidade.
 */
export async function toCoverJpeg(input: Buffer): Promise<Buffer> {
  for (const quality of [88, 75, 60]) {
    const out = await sharp(input)
      .rotate()
      .resize({ width: 1080, height: 1920, fit: "inside", withoutEnlargement: true })
      .toColorspace("srgb")
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= COVER_MAX_BYTES) return out;
  }
  throw new Error("capa grande demais mesmo depois de reduzir");
}
