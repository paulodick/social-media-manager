import sharp from "sharp";

export const LOGO_MAX_SIDE = 512;

/** Reduz o logo para no máximo 512 px no maior lado, em PNG, mantendo a transparência. */
export async function processLogo(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
