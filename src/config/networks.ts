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
};

export type NetworkCfg = {
  label: string;
  color: string;
  /** Nome da pasta no Drive. */
  folder: string;
  captionLimit: number | null;
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
      feed: { label: "Feed", folder: "Feed", ratio: "4:5", media: "any" },
      reels: { label: "Reels", folder: "Reels", ratio: "9:16", media: "video" },
      stories: { label: "Stories", folder: "Stories", ratio: "9:16", media: "any" },
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
      feed: { label: "Feed", folder: "Feed", media: "any" },
      reels: { label: "Reels", folder: "Reels", ratio: "9:16", media: "video" },
      stories: { label: "Stories", folder: "Stories", ratio: "9:16", media: "any" },
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
      feed: { label: "Feed", folder: "Feed", media: "any" },
      video: { label: "Vídeo", folder: "Video", media: "video" },
      documento: { label: "Documento", folder: "Documento", media: "document" },
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
      video: { label: "Vídeo", folder: "Video", ratio: "9:16", media: "video" },
      fotos: { label: "Fotos", folder: "Fotos", media: "image" },
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
      video: { label: "Vídeo", folder: "Video", ratio: "9:16", media: "video" },
    },
  },
  youtube: {
    label: "YouTube",
    color: "#D92D20",
    folder: "YouTube",
    captionLimit: 5000,
    hashtagLimit: null,
    cutAt: 100,
    formats: {
      shorts: { label: "Shorts", folder: "Shorts", ratio: "9:16", media: "video" },
      longo: { label: "Vídeo longo", folder: "Video longo", ratio: "16:9", media: "video" },
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
