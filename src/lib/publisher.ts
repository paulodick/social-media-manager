import { decryptToken } from "./crypto";
import { db } from "./db";
import { driveConfigured, openMedia } from "./drive";
import { publishLinkedin } from "./publish/linkedin";
import { publishTiktokDraft, TIKTOK_VIDEO_TYPES } from "./publish/tiktok";
import { freshTiktokToken } from "./tiktok-token";
import { PublishError, publishToMeta, type MediaSource } from "./publish/meta";
import { getConnection, listTargets, type Connection, type Target } from "./queries";
import { signedMediaUrl } from "./signed-url";
import { AUTO_WINDOW_MIN, canAutoSchedule } from "./auto-publish";
import { captionChecks, titleChecks } from "./checks";
import { isNetwork } from "../config/networks";
import { notifyProblem } from "./notify";
import { syncPostedFolders } from "./editorial-sequence-store";

/** Redes que o app já sabe publicar sozinho. As outras seguem manuais. */
export const AUTO_PUBLISH_NETWORKS = ["instagram", "facebook", "linkedin", "tiktok"] as const;
export function canAutoPublish(network: string, format?: string): boolean {
  // Documento (PDF) do LinkedIn ainda é manual: o upload de documento não foi feito.
  if (network === "linkedin" && format === "documento") return false;
  // TikTok: o app envia como rascunho para a caixa de entrada do TikTok (publicar direto exige a auditoria do TikTok).
  if (network === "tiktok" && format !== "video" && format !== "fotos") return false;
  return (AUTO_PUBLISH_NETWORKS as readonly string[]).includes(network);
}

export type StartResult = { ok: true } | { ok: false; error: string; /** outro processo já pegou este destino: não é falha */ skipped?: boolean };

/** Confere tudo o que o destino precisa para ser publicado (sem travar nada). */
export async function checkPublishable(t: Target | undefined): Promise<{ ok: true; conn: Connection } | { ok: false; error: string }> {
  if (!t) return { ok: false, error: "Post não encontrado." };
  if (!canAutoPublish(t.network, t.format)) return { ok: false, error: "Esta rede ainda é publicada manualmente." };
  if (t.status === "posted") return { ok: false, error: "Este post já está marcado como postado." };
  if (t.publish_state === "publishing") return { ok: false, error: "Este post já está sendo publicado." };
  // Já saiu na rede pelo app: publicar de novo duplicaria o post, mesmo que a situação tenha voltado para agendado.
  if (t.publish_state === "published") return { ok: false, error: "Este post já foi publicado pelo app." };
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
  // Rede desmarcada no cadastro do cliente não publica, mesmo que a conta continue conectada.
  const active = await (await db()).query("select 1 from client_networks where client_id = $1 and network = $2", [t.client_id, t.network]);
  if (!active.rows[0]) {
    return { ok: false, error: "Esta rede está desmarcada no cadastro do cliente. Marque-a de novo em Editar cliente para publicar." };
  }
  const conn = await getConnection(t.client_id, t.network);
  if (!conn) return { ok: false, error: "A conta desta rede ainda não está conectada." };
  if (conn.expires_at && conn.expires_at.getTime() <= Date.now()) {
    return { ok: false, error: "O acesso desta conta venceu. Conecte de novo em Editar cliente › Contas conectadas." };
  }
  return { ok: true, conn };
}

/**
 * Checagens a mais para a publicação AUTOMÁTICA (confirmar e, de novo, na hora de publicar): nada que a rede vá recusar
 * por tamanho de legenda, título ou excesso de hashtags. Devolve a frase do problema, ou null se está tudo certo.
 */
export function autoBlocker(t: Pick<Target, "network" | "format" | "caption" | "target_title">): string | null {
  if (!canAutoSchedule(t.network, t.format)) return "Esta rede e formato ainda não publicam sozinhos no horário.";
  if (!isNetwork(t.network)) return null;
  // Stories saem sem legenda: a checagem de legenda vazia não vale.
  const caption = t.format === "stories" ? [] : captionChecks(t.network, t.caption);
  const warn = [...caption, ...titleChecks(t.network, t.target_title)].find((c) => c.level === "warn");
  return warn ? warn.text : null;
}

/**
 * Confere tudo, trava o destino como "publicando" e dispara a publicação em segundo plano.
 * `auto: true` é o relógio interno: só pega o que foi confirmado, está parado ("idle") e dentro da janela de tolerância.
 */
export async function startPublish(targetId: string, opts: { auto?: boolean } = {}): Promise<StartResult> {
  const [t] = await listTargets({ targetId });
  const check = await checkPublishable(t);
  if (!check.ok) return check;
  const { conn } = check;
  if (opts.auto) {
    const why = autoBlocker(t);
    if (why) return { ok: false, error: why };
  }

  // Trava: só um clique (ou um relógio) vale. Um "publicando" parado há mais de 15 minutos conta como falha e pode ser refeito.
  const pool = await db();
  const lock = await pool.query(
    opts.auto
      ? `update post_targets set publish_state='publishing', publish_started_at=now(), publish_error=''
          where id=$1 and status <> 'posted' and publish_state = 'idle' and auto_confirmed_at is not null
            and scheduled_at <= now() and scheduled_at > now() - interval '${AUTO_WINDOW_MIN} minutes'
          returning id`
      : `update post_targets set publish_state='publishing', publish_started_at=now(), publish_error=''
          where id=$1 and status <> 'posted' and publish_state <> 'published'
            and (publish_state <> 'publishing' or publish_started_at < now() - interval '15 minutes')
          returning id`,
    [targetId],
  );
  if (!lock.rows[0]) return { ok: false, error: "Este post já está sendo publicado.", skipped: !!opts.auto };

  void runPublish(t, conn, !!opts.auto);
  return { ok: true };
}

async function runPublish(t: Target, conn: Connection, auto = false): Promise<void> {
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
            // Capa do Reels: a Meta exige JPEG; o endereço assinado com ?jpg=1 converte na hora (o arquivo do Drive não muda).
            coverUrl:
              t.network === "instagram" && t.thumb_file_id && t.thumb_meta && !t.thumb_meta.error
                ? (() => {
                    const u = signedMediaUrl(t.thumb_file_id, 3600);
                    return u ? `${u}?jpg=1` : null;
                  })()
                : null,
            userTags: t.network === "instagram" ? t.user_tags ?? [] : [],
            collaborators: t.network === "instagram" ? t.collaborators ?? [] : [],
          });
    await pool.query(
      `update post_targets set publish_state='published', status='posted', posted_at=coalesce(posted_at, now()),
              external_id=$2, external_url=$3, publish_error='' where id=$1`,
      [t.id, r.id, r.url],
    );
    // Primeira publicação do vídeo pronto: a pasta sai de "Reels Editados" e vai para "Reels Postados".
    const folderWarn = await syncPostedFolders([t.id]).catch(() => [] as string[]);
    if (folderWarn.length) console.warn(`[reels-postados] ${folderWarn.join(" ")}`);
  } catch (e) {
    // Nunca registrar o token. A mensagem de PublishError já vem em português e sem dados sensíveis.
    const msg = e instanceof PublishError || e instanceof Error ? e.message : "Erro desconhecido ao publicar.";
    console.error(`[publicar] ${t.network}/${t.format} destino ${t.id} falhou: ${msg}`);
    await pool
      .query("update post_targets set publish_state='failed', publish_error=$2 where id=$1", [t.id, msg.slice(0, 500)])
      .catch(() => {});
    if (auto) await alertProblem(t, "falhou", msg);
  }
}

/** Avisa por e-mail (uma vez por destino) que a publicação automática falhou ou perdeu o horário. */
export async function alertProblem(t: Pick<Target, "id" | "client_id" | "client_name" | "network" | "format" | "day" | "time">, kind: "falhou" | "perdeu", reason: string): Promise<void> {
  try {
    const pool = await db();
    const claim = await pool.query("update post_targets set auto_notified_at=now() where id=$1 and auto_notified_at is null returning id", [t.id]);
    if (!claim.rows[0]) return;
    const base = process.env.APP_URL?.trim().replace(/\/$/, "");
    await notifyProblem({
      kind,
      client: t.client_name,
      network: t.network,
      format: t.format,
      day: t.day,
      time: t.time,
      reason,
      link: base ? `${base}/clientes/${t.client_id}/dia/${t.day}` : undefined,
    });
  } catch (e) {
    console.error(`[aviso] falha ao registrar o aviso: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }
}
