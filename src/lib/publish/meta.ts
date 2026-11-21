// Publicação no Instagram e no Facebook pela Graph API da Meta.
// Fluxos conforme a documentação oficial (conferida em 2026-11-21):
//  - Instagram: cria um "container" (imagem por endereço público; vídeo por upload resumable), espera ficar
//    FINISHED e publica com media_publish. Feed com vídeo sai como Reels. Stories não levam legenda.
//  - Facebook Página: Reels por video_reels (start, upload, finish); vídeo do feed por /videos; foto por /photos;
//    Stories por photo_stories e video_stories.
// META_GRAPH_BASE e META_GRAPH_VERSION existem para testes com um servidor falso.

export type MediaSource = {
  kind: "video" | "image";
  size: number;
  /** Endereço público e temporário do arquivo, para as partes da API que só aceitam URL. */
  publicUrl: string | null;
  /** Abre o arquivo (corpo em fluxo, sem carregar tudo na memória). */
  open: () => Promise<Response>;
};

export type MetaPublishInput = {
  network: "instagram" | "facebook";
  format: string;
  /** ID do usuário do Instagram ou da Página do Facebook. */
  accountId: string;
  token: string;
  caption: string;
  title?: string;
  media: MediaSource;
};

export type MetaPublishResult = { id: string; url: string };

export class PublishError extends Error {}

export const graphBase = () => (process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
export const graphVersion = () => process.env.META_GRAPH_VERSION || "v26.0";
const pollMs = () => Number(process.env.META_POLL_MS || 3000);
const pollMax = () => Number(process.env.META_POLL_MAX || 200);

type GraphError = { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };

/** Traduz o erro da Meta para uma frase que diz o que fazer. */
export function explainMetaError(e: GraphError | undefined, status = 0): string {
  const code = e?.code;
  const raw = (e?.error_user_msg || e?.message || "").trim();
  if (code === 190) return "O acesso desta conta à Meta expirou ou foi revogado. Conecte a conta de novo.";
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    // Mostra também o que a Meta respondeu (código e texto original): é ele que diz qual permissão falta.
    const detail = [`código ${code}`, e?.error_subcode ? `subcódigo ${e.error_subcode}` : "", raw ? `"${raw.slice(0, 220)}"` : ""].filter(Boolean).join(", ");
    return `A Meta recusou por falta de permissão. Confira se o app tem as permissões de publicação e se a sua conta tem função de administrador na Página. Resposta da Meta: ${detail}.`;
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return "A Meta limitou as chamadas do app por enquanto. Tente de novo em alguns minutos.";
  }
  if (status >= 500) return "A Meta está com problema neste momento. Tente de novo em alguns minutos.";
  return raw ? `A Meta recusou: ${raw}` : `A Meta recusou o pedido (código ${status || "desconhecido"}).`;
}

async function parse(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.error) {
    throw new PublishError(explainMetaError(body.error as GraphError | undefined, res.status));
  }
  return body;
}

async function graph(path: string, token: string, init: { method?: string; body?: Record<string, unknown> } = {}) {
  const url = `${graphBase()}/${graphVersion()}/${path.replace(/^\/+/, "")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new PublishError("Não foi possível falar com a Meta agora. Tente de novo em alguns minutos.");
  }
  return parse(res);
}

async function uploadFile(uploadUrl: string, token: string, media: MediaSource): Promise<void> {
  const src = await media.open();
  if (!src.ok || !src.body) throw new PublishError("Não foi possível ler o arquivo no Google Drive.");
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(media.size) },
      body: src.body,
      // Node exige `duplex` para enviar um corpo em fluxo.
      duplex: "half",
    } as RequestInit);
  } catch {
    throw new PublishError("O envio do vídeo para a Meta foi interrompido. Tente de novo.");
  }
  const body = await parse(res);
  if (body.success === false) throw new PublishError("A Meta não aceitou o envio do arquivo.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function needUrl(media: MediaSource): string {
  if (!media.publicUrl) {
    throw new PublishError("Falta a variável APP_URL (endereço público do app). A Meta precisa dele para baixar a imagem.");
  }
  return media.publicUrl;
}

// ---------- Instagram ----------

async function waitInstagram(containerId: string, token: string): Promise<void> {
  for (let i = 0; i < pollMax(); i++) {
    const s = (await graph(`${containerId}?fields=status_code,status`, token)) as { status_code?: string; status?: string };
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new PublishError(`O Instagram não conseguiu processar a mídia${s.status ? ` (${s.status})` : ""}. Confira o formato e o tamanho do arquivo.`);
    }
    await sleep(pollMs());
  }
  throw new PublishError("O Instagram demorou demais para processar a mídia. Confira na conta antes de tentar de novo.");
}

export async function publishInstagram(i: MetaPublishInput): Promise<MetaPublishResult> {
  const { accountId, token, media } = i;
  const stories = i.format === "stories";
  let container: string;
  if (media.kind === "video") {
    // Feed com vídeo é publicado como Reels (regra do Instagram desde 2023).
    const body: Record<string, unknown> = { media_type: stories ? "STORIES" : "REELS", upload_type: "resumable" };
    if (!stories && i.caption) body.caption = i.caption;
    const c = (await graph(`${accountId}/media`, token, { body })) as { id?: string; uri?: string };
    if (!c.id || !c.uri) throw new PublishError("O Instagram não devolveu o endereço de envio do vídeo.");
    await uploadFile(c.uri, token, media);
    container = c.id;
  } else {
    const body: Record<string, unknown> = { image_url: needUrl(media) };
    if (stories) body.media_type = "STORIES";
    else if (i.caption) body.caption = i.caption;
    const c = (await graph(`${accountId}/media`, token, { body })) as { id?: string };
    if (!c.id) throw new PublishError("O Instagram não criou o container da imagem.");
    container = c.id;
  }
  await waitInstagram(container, token);
  const pub = (await graph(`${accountId}/media_publish`, token, { body: { creation_id: container } })) as { id?: string };
  if (!pub.id) throw new PublishError("O Instagram não confirmou a publicação.");
  const info = (await graph(`${pub.id}?fields=permalink`, token).catch(() => ({}))) as { permalink?: string };
  return { id: pub.id, url: info.permalink ?? "" };
}

// ---------- Facebook (Página) ----------

async function waitFacebookVideo(videoId: string, token: string): Promise<void> {
  for (let i = 0; i < pollMax(); i++) {
    const s = (await graph(`${videoId}?fields=status`, token)) as { status?: { video_status?: string } };
    const st = s.status?.video_status;
    if (st === "error") throw new PublishError("O Facebook não conseguiu processar o vídeo. Confira o formato e o tamanho do arquivo.");
    if (st !== "processing" && st !== "uploading" && st !== "upload_complete") return;
    await sleep(pollMs());
  }
  // O vídeo já foi enviado: tentar de novo duplicaria o post. Segue como publicado e o link deixa conferir.
}

async function facebookResumable(kind: "video_reels" | "video_stories", i: MetaPublishInput, description?: string) {
  const { accountId, token, media } = i;
  const start = (await graph(`${accountId}/${kind}`, token, { body: { upload_phase: "start" } })) as { video_id?: string; upload_url?: string };
  if (!start.video_id || !start.upload_url) throw new PublishError("O Facebook não devolveu o endereço de envio do vídeo.");
  await uploadFile(start.upload_url, token, media);
  const body: Record<string, unknown> = { upload_phase: "finish", video_id: start.video_id };
  if (kind === "video_reels") {
    body.video_state = "PUBLISHED";
    if (description) body.description = description;
  }
  const fin = (await graph(`${accountId}/${kind}`, token, { body })) as { success?: boolean; post_id?: string | number };
  if (fin.success === false) throw new PublishError("O Facebook não confirmou a publicação.");
  await waitFacebookVideo(start.video_id, token);
  return { videoId: start.video_id, postId: fin.post_id != null ? String(fin.post_id) : undefined };
}

export async function publishFacebook(i: MetaPublishInput): Promise<MetaPublishResult> {
  const { accountId, token, media } = i;
  const fb = "https://www.facebook.com";
  if (i.format === "reels") {
    if (media.kind !== "video") throw new PublishError("Reels do Facebook precisam de um vídeo.");
    const r = await facebookResumable("video_reels", i, i.caption);
    return { id: r.videoId, url: `${fb}/reel/${r.videoId}` };
  }
  if (i.format === "stories") {
    if (media.kind === "video") {
      const r = await facebookResumable("video_stories", i);
      return { id: r.postId ?? r.videoId, url: `${fb}/${accountId}` };
    }
    // A foto do story não pode ter sido usada em outro post: sobe sem publicar e vira story.
    const ph = (await graph(`${accountId}/photos`, token, { body: { url: needUrl(media), published: false } })) as { id?: string };
    if (!ph.id) throw new PublishError("O Facebook não aceitou a foto do story.");
    const st = (await graph(`${accountId}/photo_stories`, token, { body: { photo_id: ph.id } })) as { success?: boolean; post_id?: string | number };
    if (st.success === false) throw new PublishError("O Facebook não confirmou o story.");
    return { id: st.post_id != null ? String(st.post_id) : ph.id, url: `${fb}/${accountId}` };
  }
  // feed
  if (media.kind === "video") {
    const body: Record<string, unknown> = { file_url: needUrl(media), description: i.caption };
    if (i.title) body.title = i.title;
    const v = (await graph(`${accountId}/videos`, token, { body })) as { id?: string };
    if (!v.id) throw new PublishError("O Facebook não aceitou o vídeo.");
    return { id: v.id, url: `${fb}/${v.id}` };
  }
  const p = (await graph(`${accountId}/photos`, token, { body: { url: needUrl(media), caption: i.caption } })) as { id?: string; post_id?: string };
  if (!p.id) throw new PublishError("O Facebook não aceitou a foto.");
  return { id: p.post_id ?? p.id, url: `${fb}/${p.post_id ?? p.id}` };
}

export function publishToMeta(i: MetaPublishInput): Promise<MetaPublishResult> {
  return i.network === "instagram" ? publishInstagram(i) : publishFacebook(i);
}
