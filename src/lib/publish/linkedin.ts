// Publicação no perfil pessoal do LinkedIn pela Posts API (documentação oficial conferida em 2026-11-21):
//  - POST /rest/posts com author urn:li:person:{id}; o id do post volta no cabeçalho x-restli-id (resposta 201).
//  - Imagem: POST /rest/images?action=initializeUpload, PUT dos bytes no uploadUrl, e o URN vai em content.media.id.
//  - Vídeo: POST /rest/videos?action=initializeUpload (fileSizeBytes), PUT de cada parte (4 MB) no uploadUrl dela
//    guardando o ETag, POST /rest/videos?action=finalizeUpload com os ETags, e o URN vai em content.media.id.
//  - Todas as chamadas levam Linkedin-Version (AAAAMM) e X-Restli-Protocol-Version: 2.0.0.
// Perfil pessoal usa a permissão w_member_social (produto "Share on LinkedIn"). Página de empresa exige
// w_organization_social, que depende de aprovação da LinkedIn, e fica para depois.
// LINKEDIN_API_BASE, LINKEDIN_API_VERSION, LINKEDIN_POLL_MS e LINKEDIN_POLL_MAX existem para testes e ajustes.
import { PublishError, type MediaSource, type MetaPublishResult } from "./meta.ts";
import { apiBase, explainLinkedinError } from "./linkedin-oauth.ts";

export const linkedinVersion = () => process.env.LINKEDIN_API_VERSION?.trim() || "202611";
const pollMs = () => Number(process.env.LINKEDIN_POLL_MS || 3000);
const pollMax = () => Number(process.env.LINKEDIN_POLL_MAX || 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LinkedinPublishInput = {
  format: string;
  /** Identificador do membro (o `sub` do login); vira urn:li:person:{id}. */
  personId: string;
  token: string;
  caption: string;
  /** Null = post só de texto. */
  media: MediaSource | null;
};

/**
 * Texto do post no formato "little text" da LinkedIn: estes caracteres são reservados e levam barra invertida, senão o
 * texto é cortado ou vira formatação: \ | { } @ [ ] ( ) < > # * _ ~. A única exceção é o "#" de uma hashtag (#palavra),
 * que a LinkedIn reconhece como hashtag.
 */
export function escapeCommentary(text: string): string {
  return text.replace(/(^|\s)#([\p{L}\p{N}]+)|[\\|{}@[\]()<>#*_~]/gu, (m, pre: string | undefined, tag: string | undefined) =>
    tag !== undefined ? `${pre}#${tag}` : `\\${m}`,
  );
}

async function li(
  path: string,
  token: string,
  step: string,
  init: { method?: string; json?: unknown; body?: Uint8Array; headers?: Record<string, string>; auth?: boolean } = {},
): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : `${apiBase()}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (url.startsWith(apiBase())) {
    headers["Linkedin-Version"] = linkedinVersion();
    headers["X-Restli-Protocol-Version"] = "2.0.0";
  }
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : (init.body as BodyInit | undefined),
    });
  } catch {
    throw new PublishError(`Não foi possível falar com o LinkedIn agora. Tente de novo em alguns minutos. (etapa: ${step})`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new PublishError(`${explainLinkedinError(res.status, body)} (etapa: ${step})`);
  }
  return res;
}

async function readBytes(media: MediaSource): Promise<Buffer> {
  const src = await media.open();
  if (!src.ok || !src.body) throw new PublishError("Não foi possível ler o arquivo no Google Drive.");
  return Buffer.from(await src.arrayBuffer());
}

async function uploadImage(owner: string, token: string, media: MediaSource): Promise<string> {
  const init = (await (await li("rest/images?action=initializeUpload", token, "preparo da imagem", { json: { initializeUploadRequest: { owner } } })).json()) as {
    value?: { uploadUrl?: string; image?: string };
  };
  const { uploadUrl, image } = init.value ?? {};
  if (!uploadUrl || !image) throw new PublishError("O LinkedIn não devolveu o endereço de envio da imagem.");
  const bytes = await readBytes(media);
  await li(uploadUrl, token, "envio da imagem", { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream" } });
  return image;
}

type VideoInit = { value?: { video?: string; uploadToken?: string; uploadInstructions?: Array<{ uploadUrl?: string; firstByte?: number; lastByte?: number }> } };

async function uploadVideo(owner: string, token: string, media: MediaSource): Promise<string> {
  const init = (await (
    await li("rest/videos?action=initializeUpload", token, "preparo do vídeo", {
      json: { initializeUploadRequest: { owner, fileSizeBytes: media.size, uploadCaptions: false, uploadThumbnail: false } },
    })
  ).json()) as VideoInit;
  const v = init.value ?? {};
  const parts = v.uploadInstructions ?? [];
  if (!v.video || !parts.length) throw new PublishError("O LinkedIn não devolveu o endereço de envio do vídeo.");

  const src = await media.open();
  if (!src.ok || !src.body) throw new PublishError("Não foi possível ler o arquivo no Google Drive.");
  const reader = src.body.getReader();
  let pending: Buffer = Buffer.alloc(0);
  let ended = false;
  // Junta o fluxo do Drive em pedaços do tamanho que o LinkedIn pediu para cada parte (sem carregar o vídeo inteiro).
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

  const etags: string[] = [];
  for (const p of parts) {
    if (!p.uploadUrl || typeof p.firstByte !== "number" || typeof p.lastByte !== "number") throw new PublishError("O LinkedIn devolveu as partes do vídeo num formato inesperado.");
    const size = p.lastByte - p.firstByte + 1;
    const bytes = await take(size);
    if (bytes.length !== size) throw new PublishError("O arquivo do Google Drive veio com tamanho diferente do informado. Salve o post de novo para reler o arquivo.");
    // As partes vão para endereços assinados: sem o cabeçalho de acesso.
    const res = await li(p.uploadUrl, token, `envio do vídeo (parte ${etags.length + 1} de ${parts.length})`, {
      method: "PUT",
      body: bytes,
      auth: false,
      headers: { "Content-Type": "application/octet-stream" },
    });
    const etag = res.headers.get("etag")?.replace(/"/g, "");
    if (!etag) throw new PublishError("O LinkedIn não confirmou o recebimento de uma parte do vídeo.");
    etags.push(etag);
  }
  await li("rest/videos?action=finalizeUpload", token, "fechamento do envio do vídeo", {
    json: { finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: etags } },
  });
  await waitVideo(v.video, token);
  return v.video;
}

/** Espera o processamento do vídeo. Se o LinkedIn não deixar consultar o estado, segue sem esperar. */
async function waitVideo(urn: string, token: string): Promise<void> {
  for (let i = 0; i < pollMax(); i++) {
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/rest/videos/${encodeURIComponent(urn)}`, {
        headers: { Authorization: `Bearer ${token}`, "Linkedin-Version": linkedinVersion(), "X-Restli-Protocol-Version": "2.0.0" },
      });
    } catch {
      return;
    }
    if (!res.ok) return;
    const s = (await res.json().catch(() => ({}))) as { status?: string; processingFailureReason?: string };
    if (s.status === "AVAILABLE") return;
    if (s.status === "PROCESSING_FAILED") {
      throw new PublishError(`O LinkedIn não conseguiu processar o vídeo${s.processingFailureReason ? ` (${s.processingFailureReason})` : ""}. Confira o formato (MP4), o tamanho e a duração.`);
    }
    await sleep(pollMs());
  }
}

export async function publishLinkedin(i: LinkedinPublishInput): Promise<MetaPublishResult> {
  if (i.format === "documento") throw new PublishError("Documento (PDF) do LinkedIn ainda é publicado manualmente.");
  const owner = `urn:li:person:${i.personId}`;
  let content: Record<string, unknown> | undefined;
  if (i.media) {
    const id = i.media.kind === "video" ? await uploadVideo(owner, i.token, i.media) : await uploadImage(owner, i.token, i.media);
    content = { media: { id } };
  } else if (i.format === "video") {
    throw new PublishError("Vídeo do LinkedIn precisa de um arquivo de vídeo ligado ao post.");
  }
  const body: Record<string, unknown> = {
    author: owner,
    commentary: escapeCommentary(i.caption),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(content ? { content } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const res = await li("rest/posts", i.token, "publicação do post", { json: body });
  const id = res.headers.get("x-restli-id") ?? "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : "" };
}
