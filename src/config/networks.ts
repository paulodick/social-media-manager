// Configuração editável das redes e dos formatos.
// Limites marcados como null não são checados: confirmar os valores atuais de cada rede
// antes de ligar a checagem (eles mudam com frequência).

export type NetworkId = "instagram" | "facebook" | "linkedin" | "tiktok" | "kwai" | "youtube";

export type FormatCfg = {
  label: string;
  /** Nome da pasta no Drive, dentro da pasta da rede. */
  folder: string;
  /** Proporção esperada da mídia, quando o formato exige uma. */
  ratio?: "9:16" | "4:5" | "1:1" | "16:9";
  /** Tipo de mídia esperado. */
  media: "video" | "image" | "document" | "any";
  /**
   * Orientação para quem produz a mídia. Só informa na tela, não bloqueia nada.
   * Conferido em 2026-11-21: LinkedIn e YouTube em páginas oficiais; Instagram, Facebook e TikTok em guias de terceiros
   * (as páginas oficiais não trazem os números). "Ideal" é sugestão de mercado, não regra da rede.
   * "tempo a confirmar" = não achamos fonte confiável; reconferir antes de mostrar um número.
   */
  guide?: { size: string; length: string };
  /**
   * Formatos com miniatura (capa) própria, enviada à parte. Habilita o campo "Link da miniatura no Drive",
   * as checagens e a prévia da miniatura. YouTube conferido em página oficial em 2026-11-21
   * (support.google.com/youtube/answer/72431): vídeo 16:9, recomendado 3840×2160, largura mínima 640 px;
   * Shorts 9:16, recomendado 2160×3840, altura mínima 640 px; JPG ou PNG; até 2 MB pelo celular e 50 MB pelo computador.
   */
  thumb?: { ratio: "16:9" | "9:16"; minSide: number; side: "width" | "height"; guide: string };
  /** Substitui o `cutAt` da rede nesta prévia (ex.: legenda sobre o vídeo vertical, que corta antes do feed). Só aparência. */
  cutAt?: number;
};

export type NetworkCfg = {
  label: string;
  color: string;
  /** Nome da pasta no Drive. */
  folder: string;
  captionLimit: number | null;
  /** Limite do título do post nesta rede (YouTube: 100 caracteres, página oficial conferida em 2026-11-21). Ausente = sem checagem. */
  titleLimit?: number;
  hashtagLimit: number | null;
  /** Caracteres que aparecem antes do "ver mais" (aproximação para a prévia). */
  cutAt: number;
  formats: Record<string, FormatCfg>;
};

export const NETWORKS: Record<NetworkId, NetworkCfg> = {
  instagram: {
    label: "Instagram",
    color: "#D62976",
    folder: "Instagram",
    captionLimit: 2200,
    hashtagLimit: 30,
    cutAt: 110,
    formats: {
      feed: { label: "Feed", folder: "Feed", ratio: "4:5", media: "any", guide: { size: "4:5 · 1080×1350 px", length: "vídeo ideal de 30 a 60 s" } },
      reels: { label: "Reels", folder: "Reels", ratio: "9:16", media: "video", guide: { size: "9:16 · 1080×1920 px", length: "até 3 min · ideal de 15 a 30 s" } },
      stories: { label: "Stories", folder: "Stories", ratio: "9:16", media: "any", guide: { size: "9:16 · 1080×1920 px", length: "até 60 s por story · ideal de 7 a 15 s" } },
    },
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    folder: "Facebook",
    captionLimit: 63206,
    hashtagLimit: null,
    cutAt: 150,
    formats: {
      feed: { label: "Feed", folder: "Feed", media: "any", guide: { size: "4:5 ou 1:1 · 1080×1350 px", length: "vídeo ideal de 30 a 90 s (mesma referência do LinkedIn)" } },
      reels: { label: "Reels", folder: "Reels", ratio: "9:16", media: "video", cutAt: 100, guide: { size: "9:16 · 1080×1920 px", length: "sem limite fixo · ideal de 15 a 30 s" } },
      stories: { label: "Stories", folder: "Stories", ratio: "9:16", media: "any", cutAt: 100, guide: { size: "9:16 · 1080×1920 px", length: "ideal de 7 a 15 s por story (mesma referência do Instagram)" } },
    },
  },
  linkedin: {
    label: "LinkedIn",
    color: "#0A66C2",
    folder: "LinkedIn",
    captionLimit: 3000,
    hashtagLimit: null,
    cutAt: 150,
    formats: {
      feed: { label: "Feed", folder: "Feed", media: "any", guide: { size: "1:1 ou 4:5 · 1080×1080 ou 1080×1350 px", length: "vídeo de 3 s a 10 min · ideal de 30 a 90 s" } },
      video: { label: "Vídeo", folder: "Video", media: "video", guide: { size: "16:9 · 1920×1080 px (ou 1:1)", length: "3 s a 10 min (15 min no computador) · ideal de 30 a 90 s" } },
      documento: { label: "Documento", folder: "Documento", media: "document", guide: { size: "PDF · 1080×1080 ou 1080×1350 px por página", length: "até 300 páginas e 100 MB" } },
    },
  },
  tiktok: {
    label: "TikTok",
    color: "#111111",
    folder: "TikTok",
    captionLimit: null,
    hashtagLimit: null,
    cutAt: 100,
    formats: {
      video: { label: "Vídeo", folder: "Video", ratio: "9:16", media: "video", guide: { size: "9:16 · 1080×1920 px", length: "até 3 min (10 min em algumas contas)" } },
      fotos: { label: "Fotos", folder: "Fotos", media: "image", guide: { size: "9:16 · 1080×1920 px", length: "carrossel de 2 a 10 imagens" } },
    },
  },
  kwai: {
    label: "Kwai",
    color: "#FF6A00",
    folder: "Kwai",
    captionLimit: null,
    hashtagLimit: null,
    cutAt: 100,
    formats: {
      video: { label: "Vídeo", folder: "Video", ratio: "9:16", media: "video", guide: { size: "9:16 · 1080×1920 px", length: "até 3 min (mesma referência do TikTok)" } },
    },
  },
  youtube: {
    label: "YouTube",
    color: "#D92D20",
    folder: "YouTube",
    captionLimit: 5000,
    titleLimit: 100,
    hashtagLimit: null,
    cutAt: 100,
    formats: {
      shorts: {
        label: "Shorts", folder: "Shorts", ratio: "9:16", media: "video",
        guide: { size: "9:16 · 1080×1920 px", length: "até 3 min · ideal de 15 a 60 s" },
        thumb: { ratio: "9:16", minSide: 640, side: "height", guide: "9:16 · 2160×3840 px (altura mínima 640 px) · JPG ou PNG · só no Studio, pelo computador" },
      },
      longo: {
        label: "Vídeo longo", folder: "Video longo", ratio: "16:9", media: "video",
        guide: { size: "16:9 · 1920×1080 px", length: "até 15 min (12 h em canais verificados)" },
        thumb: { ratio: "16:9", minSide: 640, side: "width", guide: "16:9 · 3840×2160 px (largura mínima 640 px) · JPG ou PNG · até 2 MB pelo celular, 50 MB pelo computador" },
      },
    },
  },
};

export const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

export function isNetwork(v: string): v is NetworkId {
  return v in NETWORKS;
}

export function isFormat(network: NetworkId, v: string): boolean {
  return v in NETWORKS[network].formats;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  posted: "Postado",
};
