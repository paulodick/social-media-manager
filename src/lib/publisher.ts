import { decryptToken } from "./crypto";
import { db } from "./db";
import { driveConfigured, openMedia } from "./drive";
import { PublishError, publishToMeta, type MediaSource } from "./publish/meta";
import { getConnection, listTargets, type Connection, type Target } from "./queries";
import { signedMediaUrl } from "./signed-url";

/** Redes que o app já sabe publicar sozinho. As outras seguem manuais. */
export const AUTO_PUBLISH_NETWORKS = ["instagram", "facebook"] as const;
export function canAutoPublish(network: string): boolean {
  return (AUTO_PUBLISH_NETWORKS as readonly string[]).includes(network);
}

export type StartResult = { ok: true } | { ok: false; error: string };

/** Confere tudo, trava o destino como "publicando" e dispara a publicação em segundo plano. */
export async function startPublish(targetId: string): Promise<StartResult> {
  const [t] = await listTargets({ targetId });
  if (!t) return { ok: false, error: "Post não encontrado." };
  if (!canAutoPublish(t.network)) return { ok: false, error: "Esta rede ainda é publicada manualmente." };
  if (t.status === "posted") return { ok: false, error: "Este post já está marcado como postado." };
  if (t.publish_state === "publishing") return { ok: false, error: "Este post já está sendo publicado." };
  if (!t.drive_file_id || !t.drive_meta) return { ok: false, error: "Ligue o arquivo do Drive ao post antes de publicar." };
  if (t.drive_meta.error) return { ok: false, error: `O arquivo do Drive não foi lido: ${t.drive_meta.error}` };
  const mime = t.drive_meta.mimeType ?? "";
  if (!mime.startsWith("video/") && !mime.startsWith("image/")) return { ok: false, error: "O arquivo precisa ser uma imagem ou um vídeo." };
  if (mime.startsWith("video/") && !t.drive_meta.size) return { ok: false, error: "Não sei o tamanho do vídeo. Salve o post de novo para reler o arquivo no Drive." };
  if (!t.caption.trim() && t.format !== "stories") return { ok: false, error: "Escreva a legenda antes de publicar." };
  if (!driveConfigured()) return { ok: false, error: "O Google Drive não está configurado." };
  const conn = await getConnection(t.client_id, t.network);
  if (!conn) return { ok: false, error: "A conta desta rede ainda não está conectada." };

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
    const token = decryptToken(conn.token_enc);
    const fileId = t.drive_file_id as string;
    const meta = t.drive_meta!;
    const media: MediaSource = {
      kind: meta.mimeType?.startsWith("video/") ? "video" : "image",
      size: meta.size ?? 0,
      publicUrl: signedMediaUrl(fileId, 3600),
      open: () => openMedia(fileId, null),
    };
    const r = await publishToMeta({
      network: t.network as "instagram" | "facebook",
      format: t.format,
      accountId: conn.account_id,
      token,
      caption: t.caption,
      title: t.title,
      media,
    });
    await pool.query(
      `update post_targets set publish_state='published', status='posted', posted_at=coalesce(posted_at, now()),
              external_id=$2, external_url=$3, publish_error='' where id=$1`,
      [t.id, r.id, r.url],
    );
  } catch (e) {
    // Nunca registrar o token. A mensagem de PublishError já vem em português e sem dados sensíveis.
    const msg = e instanceof PublishError || e instanceof Error ? e.message : "Erro desconhecido ao publicar.";
    await pool
      .query("update post_targets set publish_state='failed', publish_error=$2 where id=$1", [t.id, msg.slice(0, 500)])
      .catch(() => {});
  }
}
