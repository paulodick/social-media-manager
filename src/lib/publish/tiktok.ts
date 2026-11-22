// Envio para o TikTok como RASCUNHO (modo "Upload" da Content Posting API; documentação oficial conferida em 2026-11-21).
// O arquivo vai para a caixa de entrada do TikTok da pessoa; ela toca na notificação, escolhe a privacidade e publica no
// app do TikTok. Esse modo não exige a auditoria do TikTok (a publicação direta exige, e antes dela só sai privada).
//  - Vídeo: POST /v2/post/publish/inbox/video/init/ (FILE_UPLOAD) devolve publish_id e upload_url; os bytes vão por PUT
//    em partes (Content-Range). Esse endpoint não aceita legenda: a pessoa cola a legenda no TikTok.
//  - Fotos: POST /v2/post/publish/content/init/ com post_mode MEDIA_UPLOAD. As fotos só podem ser PULL_FROM_URL, de um
//    endereço verificado no painel do TikTok (aqui, o endereço assinado do app). Título e descrição vão junto.
//  - Depois: POST /v2/post/publish/status/fetch/ até SEND_TO_USER_INBOX (o rascunho chegou) ou FAILED.
// TIKTOK_API_BASE, TIKTOK_POLL_MS e TIKTOK_POLL_MAX existem para testes e ajustes.
import { PublishError, type MediaSource, type MetaPublishResult } from "./meta.ts";
import { apiBase, explainTiktokError, isTiktokOk } from "./tiktok-oauth.ts";

const pollMs = () => Number(process.env.TIKTOK_POLL_MS || 3000);
const pollMax = () => Number(process.env.TIKTOK_POLL_MAX || 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const TIKTOK_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export type TiktokDraftInput = {
  format: string;
  token: string;
  caption: string;
  media: MediaSource;
  /** Tipo do arquivo no Drive (video/mp4, video/quicktime ou video/webm). */
  mime?: string;
};

/**
 * Tamanho de cada parte do vídeo. O TikTok exige partes de 5 MB a 64 MB (a última pode chegar a 128 MB, pois recebe o
 * resto), no máximo 1000 partes, e vídeo menor que 5 MB inteiro numa parte só. Até 20 MB vai numa parte; acima disso,
 * partes de 10 MB e o resto vai para a última.
 */
export function chunkPlan(size: number): number[] {
  if (size <= 20_000_000) return [size];
  const n = Math.floor(size / 10_000_000);
  const sizes = new Array<number>(n).fill(10_000_000);
  sizes[n - 1] = size - (n - 1) * 10_000_000;
  return sizes;
}

type Json = Record<string, unknown>;

async function tt(path: string, token: string, step: string, json: unknown): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(json),
    });
  } catch {
    throw new PublishError(`Não foi possível falar com o TikTok agora. Tente de novo em alguns minutos. (etapa: ${step})`);
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!isTiktokOk(res.status, body)) throw new PublishError(`${explainTiktokError(res.status, body)} (etapa: ${step})`);
  return body;
}

const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: "o formato do arquivo não é aceito (use MP4, MOV ou WebM)",
  duration_check_failed: "a duração do vídeo está fora do limite",
  frame_rate_check_failed: "a taxa de quadros do vídeo não é aceita",
  picture_size_check_failed: "o tamanho da imagem não é aceito",
  internal: "erro interno do TikTok",
  video_pull_failed: "o TikTok não conseguiu baixar o arquivo",
  photo_pull_failed: "o TikTok não conseguiu baixar a foto (confira se o endereço do app está verificado no painel do TikTok)",
};

/** Espera o rascunho chegar à caixa de entrada do TikTok. */
async function waitInbox(publishId: string, token: string): Promise<void> {
  for (let i = 0; i < pollMax(); i++) {
    const body = await tt("v2/post/publish/status/fetch/", token, "conferência do envio", { publish_id: publishId });
    const d = (body.data ?? {}) as Json;
    const status = String(d.status ?? "");
    if (status === "SEND_TO_USER_INBOX" || status === "PUBLISH_COMPLETE") return;
    if (status === "FAILED") {
      const reason = String(d.fail_reason ?? "");
      throw new PublishError(`O TikTok não aceitou o envio: ${FAIL_REASONS[reason] ?? (reason || "motivo não informado")}.`);
    }
    await sleep(pollMs());
  }
  throw new PublishError("O TikTok ainda não terminou de processar o envio. Olhe a caixa de entrada do TikTok; se o rascunho não chegar, envie de novo.");
}

async function uploadVideo(i: TiktokDraftInput): Promise<string> {
  const { media } = i;
  if (!media.size || media.size <= 0) throw new PublishError("Não sei o tamanho do vídeo. Salve o post de novo para reler o arquivo no Drive.");
  const mime = i.mime && TIKTOK_VIDEO_TYPES.includes(i.mime) ? i.mime : null;
  if (!mime) throw new PublishError("O TikTok só aceita vídeo MP4, MOV ou WebM.");
  const plan = chunkPlan(media.size);
  const init = await tt("v2/post/publish/inbox/video/init/", i.token, "preparo do vídeo", {
    source_info: { source: "FILE_UPLOAD", video_size: media.size, chunk_size: plan.length === 1 ? media.size : 10_000_000, total_chunk_count: plan.length },
  });
  const d = (init.data ?? {}) as Json;
  const publishId = String(d.publish_id ?? "");
  const uploadUrl = String(d.upload_url ?? "");
  if (!publishId || !uploadUrl) throw new PublishError("O TikTok não devolveu o endereço de envio do vídeo.");

  const src = await media.open();
  if (!src.ok || !src.body) throw new PublishError("Não foi possível ler o arquivo no Google Drive.");
  const reader = src.body.getReader();
  let pending: Buffer = Buffer.alloc(0);
  let ended = false;
  // Junta o fluxo do Drive em partes do tamanho combinado (sem carregar o vídeo inteiro na memória).
  const take = async (n: number): Promise<Buffer> => {
    const chunks: Buffer[] = pending.length ? [pending] : [];
    let have = pending.length;
    while (have < n && !ended) {
      const r = await reader.read();
      if (r.done) ended = true;
      else {
        chunks.push(Buffer.from(r.value));
        have += r.value.length;
      }
    }
    const all = Buffer.concat(chunks);
    pending = all.subarray(Math.min(n, all.length));
    return all.subarray(0, Math.min(n, all.length));
  };

  let first = 0;
  for (let k = 0; k < plan.length; k++) {
    const bytes = await take(plan[k]);
    if (bytes.length !== plan[k]) throw new PublishError("O arquivo do Google Drive veio com tamanho diferente do informado. Salve o post de novo para reler o arquivo.");
    const last = first + bytes.length - 1;
    let res: Response;
    try {
      // O endereço de envio já vem assinado: sem cabeçalho de acesso.
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "Content-Range": `bytes ${first}-${last}/${media.size}` },
        body: bytes as unknown as BodyInit,
      });
    } catch {
      throw new PublishError(`Não foi possível enviar o vídeo ao TikTok. Tente de novo em alguns minutos. (etapa: envio do vídeo, parte ${k + 1} de ${plan.length})`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Json;
      throw new PublishError(`${explainTiktokError(res.status, body)} (etapa: envio do vídeo, parte ${k + 1} de ${plan.length})`);
    }
    first = last + 1;
  }
  return publishId;
}

const runes = (s: string, n: number) => Array.from(s).slice(0, n).join("");

async function uploadPhoto(i: TiktokDraftInput): Promise<string> {
  const url = i.media.publicUrl;
  if (!url) throw new PublishError("Falta a variável APP_URL no Render: o TikTok baixa a foto pelo endereço público do app.");
  const caption = i.caption.trim();
  const firstLine = caption.split(/\r?\n/)[0] ?? "";
  const init = await tt("v2/post/publish/content/init/", i.token, "preparo da foto", {
    media_type: "PHOTO",
    post_mode: "MEDIA_UPLOAD",
    // A pessoa revisa tudo no editor do TikTok antes de publicar.
    post_info: { ...(firstLine ? { title: runes(firstLine, 90) } : {}), ...(caption ? { description: runes(caption, 4000) } : {}) },
    source_info: { source: "PULL_FROM_URL", photo_images: [url], photo_cover_index: 0 },
  });
  const publishId = String(((init.data ?? {}) as Json).publish_id ?? "");
  if (!publishId) throw new PublishError("O TikTok não confirmou o recebimento da foto.");
  return publishId;
}

/** Envia o vídeo ou a foto como rascunho para a caixa de entrada do TikTok. O id devolvido é o publish_id. */
export async function publishTiktokDraft(i: TiktokDraftInput): Promise<MetaPublishResult> {
  if (i.format === "video" && i.media.kind !== "video") throw new PublishError("TikTok Vídeo precisa de um arquivo de vídeo ligado ao post.");
  if (i.format === "fotos" && i.media.kind !== "image") throw new PublishError("TikTok Fotos precisa de uma imagem ligada ao post.");
  if (i.format !== "video" && i.format !== "fotos") throw new PublishError("Este formato do TikTok ainda é publicado manualmente.");
  const publishId = i.format === "video" ? await uploadVideo(i) : await uploadPhoto(i);
  await waitInbox(publishId, i.token);
  return { id: publishId, url: "" };
}
