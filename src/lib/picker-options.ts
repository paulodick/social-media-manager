import { NETWORKS, captionLabel, isNetwork } from "@/config/networks";

export type PickerOption = {
  key: string; // "rede:formato"
  network: string;
  networkLabel: string;
  formatLabel: string;
  size?: string;
  length?: string;
  /** Formatos com miniatura própria: orientação de tamanho. Presente = mostra o campo do link da miniatura. */
  thumbGuide?: string;
  /** Formato com título separado da legenda (YouTube, documento do LinkedIn): mostra o campo Título. */
  hasTitle?: boolean;
  /** Limite de caracteres do título, quando a rede tem um conferido. */
  titleLimit?: number;
  /** "Legenda", ou "Descrição" no YouTube vídeo longo. */
  captionLabel: string;
};

/** Uma opção (rede + formato) para cada formato das redes do cliente. */
export function pickerOptions(networks: { network: string }[]): PickerOption[] {
  return networks
    .filter((n) => isNetwork(n.network))
    .flatMap((n) => {
      const cfg = NETWORKS[n.network as keyof typeof NETWORKS];
      return Object.entries(cfg.formats).map(([fid, f]) => ({
        key: `${n.network}:${fid}`,
        network: n.network,
        networkLabel: cfg.label,
        formatLabel: f.label,
        size: f.guide?.size,
        length: f.guide?.length,
        thumbGuide: f.thumb?.guide,
        hasTitle: !!f.title,
        titleLimit: f.title ? cfg.titleLimit : undefined,
        captionLabel: captionLabel(n.network, fid),
      }));
    });
}
