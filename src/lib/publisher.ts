import { decryptToken } from "./crypto";
import { db } from "./db";
import { driveConfigured, openMedia } from "./drive";
import { publishLinkedin } from "./publish/linkedin";
import { publishTiktokDraft, TIKTOK_VIDEO_TYPES } from "./publish/tiktok";
import { freshTiktokToken } from "./tiktok-token";
import { PublishError, publishToMeta, type MediaSource } from "./publish/meta";
import { getConnection, listTargets, type Connection, type Target } from "./queries";
import { signedMediaUrl } from "./signed-url";

/** Redes que o app já sabe publicar sozinho. As outras seguem manuais. */
export const AUTO_PUBLISH_NETWORKS = ["instagram", "facebook", "linkedin", "tiktok"] as const;
export function canAutoPublish(network: string, format?: string): boolean {
  // Documento (PDF) do LinkedIn ainda é manual: o upload de documento não foi feito.
  if (network === "linkedin" && format === "documento") return false;
  // TikTok: o app envia como rascunho para a caixa de entrada do TikTok (publicar direto exige a auditoria do TikTok).
  if (network === "tiktok" && format !== "video" && format !== "fotos") return false;
  return (AUTO_PUBLISH_NETWORKS as readonly string[]).includes(network);
}

export type StartResult = { ok: true } | { ok: false; error: string };

/** Confere tudo, trava o destino como "publicando" e dispara a publicação em segundo plano. */
export async function startPublish(targetId: string): Promise<StartResult> {
  const [t] = await listTargets({ targetId });
  if (!t) return { ok: false, error: "Post não encontrado." };
  if (!canAutoPublish(t.network, t.format)) return { ok: false, error: "Esta rede ainda é publicada manualmente." };
  if (t.status === "posted") return { ok: false, error: "Este post já está marcado como postado." };
  if (t.publish_state === "publishing") return { ok: false, error: "Este post já está sendo publicado." };
  if (t.network === "linkedin" && t.format === "documento") return { ok: false, error: "Documento (PDF) do LinkedIn ainda é publicado manualmente." };
  // LinkedIn aceita post só de texto no Feed; as demais redes (e o Vídeo do LinkedIn) precisam do arquivo.
  const textOnly = t.network === "linkedin" && t.format === "feed" && !t.drive_file_id;
  if (!textOnly) {
    if (!t.drive_file_id || !t.drive_meta) return { ok: false, error: "Ligue o arquivo do Drive ao post antes de publicar." };
    if (t.drive_meta.error) return { ok: false, error: `O arquivo do Drive não foi lido: ${t.drive_meta.error}` };
    const mime = t.drive_meta.mimeType ?? "";
    if (!mime.startsWith("video/") && !mime.startsWith("image/")) return { ok: false, error: "O arquivo precisa ser uma imagem ou um vídeo." };
    if (mime.startsWith("video/") && !t.drive_meta.size) return { ok: false, error: "Não sei o tamanho do vídeo. Salve o post de novo para reler o arquivo no Drive." };
    if (t.network === "tiktok") {
      if (t.format === "video" && !TIKTOK_VIDEO_TYPES.includes(mime)) return { ok: false, error: "O TikTok só aceita vídeo MP4, MOV ou WebM." };
      if (t.format === "fotos" && !mime.startsWith("image/")) return { ok: false, error: "TikTok Fotos precisa de uma imagem ligada ao post." };
    }
  }
  if (!t.caption.trim() && t.format !== "stories") return { ok: false, error: "Escreva a legenda antes de publicar." };
  if (!textOnly && !driveConfigured()) return { ok: false, error: "O Google Drive não está configurado." };
  const conn = await getConnection(t.client_id, t.network);
  if (!conn) return { ok: false, error: "A conta desta rede ainda não está conectada." };
  if (conn.expires_at && conn.expires_at.getTime() <= Date.now()) {
    return { ok: false, error: "O acesso desta conta venceu. Conecte de novo em Editar cliente › Contas conectadas." };
  }

  // Trava: só um clique vale. Um "publicando" parado há mais de 15 minutos conta como falha e pode ser refeito.
  const pool = await db();
  const lock = await pool.query(
    `update post_targets set publish_state='publishing', publish_started_at=now(), publish_error=''
      where id=$1 and status <> 'posted'
        and (publish_state <> 'publishing' or publish_started_at < now() - interval '15 minutes')
      returning id`,
    [targetId],
  );
  if (!lock.rows[0]) return { ok: false, error: "Este post já está sendo publicado." };

  void runPublish(t, conn);
  return { ok: true };
}

async function runPublish(t: Target, conn: Connection): Promise<void> {
  const pool = await db();
  try {
    // TikTok: o acesso dura poucas horas, então vem renovado (e o novo token de renovação já fica guardado).
    const token = t.network === "tiktok" ? await freshTiktokToken(t.client_id) : decryptToken(conn.token_enc);
    const meta = t.drive_meta;
    const fileId = t.drive_file_id;
    const media: MediaSource | null =
      fileId && meta
        ? {
            kind: meta.mimeType?.startsWith("video/") ? "video" : "image",
            size: meta.size ?? 0,
            publicUrl: signedMediaUrl(fileId, 3600),
            open: () => openMedia(fileId, null),
          }
        : null;
    if (t.network === "tiktok") {
      const d = await publishTiktokDraft({ format: t.format, token, caption: t.caption, media: media as MediaSource, mime: meta?.mimeType });
      // Rascunho na caixa de entrada: ainda NÃO está publicado. A pessoa finaliza no app do TikTok e marca como postado.
      await pool.query("update post_targets set publish_state='drafted', external_id=$2, external_url='', publish_error='' where id=$1", [t.id, d.id]);
      return;
    }
    const r =
      t.network === "linkedin"
        ? await publishLinkedin({ format: t.format, personId: conn.account_id, token, caption: t.caption, media })
        : await publishToMeta({
            network: t.network as "instagram" | "facebook",
            format: t.format,
            accountId: conn.account_id,
            token,
            caption: t.caption,
            title: t.target_title,
            media: media as MediaSource,
          });
    await pool.query(
      `update post_targets set publish_state='published', status='posted', posted_at=coalesce(posted_at, now()),
              external_id=$2, external_url=$3, publish_error='' where id=$1`,
      [t.id, r.id, r.url],
    );
  } catch (e) {
    // Nunca registrar o token. A mensagem de PublishError já vem em português e sem dados sensíveis.
    const msg = e instanceof PublishError || e instanceof Error ? e.message : "Erro desconhecido ao publicar.";
    console.error(`[publicar] ${t.network}/${t.format} destino ${t.id} falhou: ${msg}`);
    await pool
      .query("update post_targets set publish_state='failed', publish_error=$2 where id=$1", [t.id, msg.slice(0, 500)])
      .catch(() => {});
  }
}
