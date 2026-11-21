import { NETWORKS, type NetworkId } from "../config/networks.ts";

export type Check = { level: "ok" | "warn"; text: string };

export type MediaMeta = {
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  error?: string;
};

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** Corta o texto como a rede faz antes do "ver mais" (aproximação). */
export function cutCaption(text: string, n: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, "") + "…";
}

export function captionChecks(network: NetworkId, caption: string): Check[] {
  const cfg = NETWORKS[network];
  const out: Check[] = [];
  if (!caption.trim()) {
    out.push({ level: "warn", text: `${cfg.label}: a legenda está vazia.` });
    return out;
  }
  if (cfg.captionLimit != null) {
    out.push(
      caption.length <= cfg.captionLimit
        ? { level: "ok", text: `${cfg.label}: legenda dentro do limite de ${fmtNumber(cfg.captionLimit)} caracteres.` }
        : {
            level: "warn",
            text: `${cfg.label}: legenda com ${fmtNumber(caption.length)} caracteres, acima do limite de ${fmtNumber(cfg.captionLimit)}.`,
          },
    );
  }
  if (cfg.hashtagLimit != null) {
    const n = countHashtags(caption);
    if (n > cfg.hashtagLimit) {
      out.push({ level: "warn", text: `${cfg.label}: ${n} hashtags, acima do limite de ${cfg.hashtagLimit}.` });
    }
  }
  return out;
}

export function aspectOf(meta: MediaMeta | null | undefined): number | null {
  if (!meta?.width || !meta?.height) return null;
  return meta.width / meta.height;
}

function ratioLabel(a: number): string {
  if (Math.abs(a - 9 / 16) < 0.04) return "9:16";
  if (Math.abs(a - 16 / 9) < 0.1) return "16:9";
  if (Math.abs(a - 1) < 0.04) return "1:1";
  if (Math.abs(a - 4 / 5) < 0.03) return "4:5";
  return a.toFixed(2).replace(".", ",") + ":1";
}

/** Checagens da miniatura (capa) de formatos que têm `thumb` na configuração. Vazio se o formato não usa miniatura. */
export function thumbChecks(network: NetworkId, format: string, meta: MediaMeta | null | undefined): Check[] {
  const cfg = NETWORKS[network];
  const spec = cfg.formats[format]?.thumb;
  if (!spec) return [];
  const where = `${cfg.label}, miniatura`;
  if (!meta) return [{ level: "warn", text: `${where}: ainda não há miniatura ligada a este post.` }];
  if (meta.error) return [{ level: "warn", text: `${where}: ${meta.error}` }];
  const out: Check[] = [];
  if (meta.mimeType && !meta.mimeType.startsWith("image/")) {
    out.push({ level: "warn", text: `${where}: o arquivo precisa ser uma imagem (JPG ou PNG), mas é ${meta.mimeType}.` });
    return out;
  }
  const a = aspectOf(meta);
  if (a != null) {
    const okRatio = spec.ratio === "16:9" ? Math.abs(a - 16 / 9) < 0.08 : Math.abs(a - 9 / 16) < 0.03;
    out.push(
      okRatio
        ? { level: "ok", text: `${where}: proporção ${ratioLabel(a)}, adequada.` }
        : { level: "warn", text: `${where}: proporção ${ratioLabel(a)}, a rede pede ${spec.ratio}.` },
    );
  }
  const side = spec.side === "width" ? meta.width : meta.height;
  if (side != null) {
    const label = spec.side === "width" ? "largura" : "altura";
    out.push(
      side >= spec.minSide
        ? { level: "ok", text: `${where}: ${label} de ${fmtNumber(side)} px (mínimo ${spec.minSide} px).` }
        : { level: "warn", text: `${where}: ${label} de ${fmtNumber(side)} px, o mínimo é ${spec.minSide} px.` },
    );
  }
  if (meta.size != null) {
    const mb = meta.size / (1024 * 1024);
    const shown = mb.toFixed(1).replace(".", ",");
    if (mb > 50) out.push({ level: "warn", text: `${where}: ${shown} MB, acima do limite de 50 MB.` });
    else if (mb > 2) out.push({ level: "warn", text: `${where}: ${shown} MB. Pelo celular o limite é 2 MB; pelo computador, 50 MB.` });
    else out.push({ level: "ok", text: `${where}: ${shown} MB, dentro do limite de 2 MB.` });
  }
  return out;
}

/** Título do post contra o limite da rede (hoje só o YouTube tem limite configurado). */
export function titleChecks(network: NetworkId, title: string): Check[] {
  const cfg = NETWORKS[network];
  if (!cfg.titleLimit) return [];
  const n = title.trim().length;
  return n > cfg.titleLimit
    ? [{ level: "warn", text: `${cfg.label}: o título tem ${fmtNumber(n)} caracteres e o limite é ${fmtNumber(cfg.titleLimit)}.` }]
    : [{ level: "ok", text: `${cfg.label}: título com ${fmtNumber(n)} de ${fmtNumber(cfg.titleLimit)} caracteres.` }];
}

export function mediaChecks(network: NetworkId, format: string, meta: MediaMeta | null | undefined): Check[] {
  const cfg = NETWORKS[network];
  const fmt = cfg.formats[format];
  if (!fmt) return [];
  const out: Check[] = [];
  const where = `${cfg.label} ${fmt.label}`;
  if (!meta) {
    out.push({ level: "warn", text: `${where}: ainda não há mídia ligada a este post.` });
    return out;
  }
  if (meta.error) {
    out.push({ level: "warn", text: `${where}: ${meta.error}` });
    return out;
  }
  const isVideo = meta.mimeType?.startsWith("video/");
  const isImage = meta.mimeType?.startsWith("image/");
  if (fmt.media === "video" && meta.mimeType && !isVideo) {
    out.push({ level: "warn", text: `${where}: este formato pede vídeo, mas o arquivo é ${meta.mimeType}.` });
  }
  if (fmt.media === "image" && meta.mimeType && !isImage) {
    out.push({ level: "warn", text: `${where}: este formato pede imagem, mas o arquivo é ${meta.mimeType}.` });
  }
  if (fmt.media === "document" && meta.mimeType && meta.mimeType !== "application/pdf") {
    out.push({ level: "warn", text: `${where}: este formato pede um PDF.` });
  }
  const a = aspectOf(meta);
  if (a != null && fmt.ratio) {
    let okRatio = true;
    if (fmt.ratio === "9:16") okRatio = Math.abs(a - 9 / 16) < 0.03;
    else if (fmt.ratio === "16:9") okRatio = Math.abs(a - 16 / 9) < 0.08;
    else if (fmt.ratio === "4:5") okRatio = a >= 0.75 && a <= 1.92; // faixa aceita no feed do Instagram
    out.push(
      okRatio
        ? { level: "ok", text: `${where}: proporção ${ratioLabel(a)}, adequada ao formato.` }
        : { level: "warn", text: `${where}: proporção ${ratioLabel(a)}, o formato pede ${fmt.ratio}.` },
    );
  }
  if (a != null && network === "linkedin" && a < 0.8) {
    out.push({ level: "warn", text: "LinkedIn: vídeo vertical aparece menor no feed. Considere uma versão 4:5 ou 1:1." });
  }
  return out;
}
