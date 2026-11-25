import { NETWORKS, isFormat, isNetwork } from "../config/networks.ts";
import type { MediaMeta } from "./checks.ts";
import { TZ, isTime } from "./dates.ts";
import { db } from "./db.ts";
import { isUuid } from "./editorial-rules.ts";
import { ensureTargetFolders } from "./post-folders.ts";
import { getFileMeta } from "./drive.ts";
import { moveReadyFolderToDay } from "./editorial-sequence-store.ts";

export type EnqueueResult =
  | { ok: true; post_id: string; post_target_ids: string[]; day: string; warnings: string[] }
  | { ok: false; status: 400 | 404 | 409; error: string };

export type ApprovalGroupFailure = { slot_ids: string[]; error: string };

export type ApprovalBatchResult = {
  approved_slot_ids: string[];
  enqueued_targets: number;
  warnings: string[];
  failed: ApprovalGroupFailure[];
};

/**
 * Calcula o horário efetivo de um slot:
 * prioridade: horário explícito (`opts.time`) > horário planejado do slot > fallback (`opts.fallbackTime`).
 */
export function resolveSlotTime(
  plannedTime: string | null,
  opts: { time?: string; fallbackTime?: string } = {},
): string | null {
  return opts.time ?? plannedTime ?? opts.fallbackTime ?? null;
}

/**
 * Processa o envio em lote dos grupos de um cronograma.
 * Marca como aprovados apenas os grupos cujo envio deu certo e coleta falhas sem esconder erros.
 */
export async function processScheduleApproval(
  groups: string[][],
  enqueueFn: (slotIds: string[]) => Promise<EnqueueResult>,
): Promise<ApprovalBatchResult> {
  const approvedSlotIds: string[] = [];
  let enqueuedTargets = 0;
  const warnings: string[] = [];
  const failed: ApprovalGroupFailure[] = [];

  for (const groupSlotIds of groups) {
    const res = await enqueueFn(groupSlotIds);
    if (res.ok) {
      approvedSlotIds.push(...groupSlotIds);
      enqueuedTargets += res.post_target_ids.length;
      warnings.push(...res.warnings);
    } else {
      failed.push({ slot_ids: groupSlotIds, error: res.error });
    }
  }

  return {
    approved_slot_ids: approvedSlotIds,
    enqueued_targets: enqueuedTargets,
    warnings,
    failed,
  };
}

type SlotRow = {
  id: string;
  content_item_id: string;
  network: string;
  format: string;
  day: string;
  time: string | null;
  post_target_id: string | null;
  title: string;
  brief: string;
  caption_draft: string;
  caption_instagram: string;
  caption_linkedin: string;
  tones: string[];
  item_drive_file_id: string | null;
  item_drive_url: string;
  item_drive_meta: MediaMeta | null;
  /** Capa do item (imagem na pasta do corte): vira a capa do Reels no Instagram. */
  item_cover_file_id: string | null;
  root: string | null;
  asset_kind: "carousel" | "static" | null;
  slide_file_id: string | null;
  slide_file_url: string | null;
  slide_file_meta: MediaMeta | null;
};

/** Escolhe a legenda mais adequada para a rede (Instagram/LinkedIn ou base geral). */
export function resolveCaptionForNetwork(
  network: string,
  captions: { caption_draft?: string; caption_instagram?: string; caption_linkedin?: string },
): string {
  if (network === "instagram" && captions.caption_instagram?.trim()) return captions.caption_instagram.trim();
  if (network === "linkedin" && captions.caption_linkedin?.trim()) return captions.caption_linkedin.trim();
  return (captions.caption_draft || captions.caption_instagram || captions.caption_linkedin || "").trim();
}

/**
 * Envia slots planejados (do MESMO item e do MESMO dia) para a fila real:
 * cria 1 linha em `posts` + N linhas em `post_targets`, sempre em `status = 'draft'`
 * e SEM `auto_confirmed_at` (nada publica sem clique explícito da pessoa).
 */
export async function enqueueSlots(
  clientId: string,
  slotIds: string[],
  opts: { time?: string; fallbackTime?: string } = {},
): Promise<EnqueueResult> {
  if (!isUuid(clientId) || !slotIds.length || !slotIds.every((s) => isUuid(s))) {
    return { ok: false, status: 400, error: "Pedido inválido." };
  }
  if (opts.time !== undefined && !isTime(opts.time)) {
    return { ok: false, status: 400, error: "Horário inválido." };
  }
  if (opts.fallbackTime !== undefined && !isTime(opts.fallbackTime)) {
    return { ok: false, status: 400, error: "Horário inválido." };
  }

  const pool = await db();
  const { rows } = await pool.query<SlotRow>(
    `select s.id, s.content_item_id, s.network, s.format,
            to_char(s.planned_day, 'YYYY-MM-DD') as day,
            to_char(s.planned_time, 'HH24:MI') as time,
            s.post_target_id,
            i.title, i.brief, i.caption_draft, i.caption_instagram, i.caption_linkedin, i.tones,
            i.drive_file_id as item_drive_file_id, i.drive_url as item_drive_url, i.drive_meta as item_drive_meta,
            i.cover_drive_file_id as item_cover_file_id,
            c.drive_folder_id as root,
            a.kind as asset_kind,
            sl.drive_file_id as slide_file_id, sl.drive_url as slide_file_url, sl.drive_meta as slide_file_meta
       from editorial_schedule s
       join content_items i on i.id = s.content_item_id
       join clients c on c.id = s.client_id
       left join content_visual_assets a on a.id = s.asset_id
       left join content_visual_asset_slides sl on sl.asset_id = a.id and sl.position = 0
      where s.client_id = $1 and s.id = any($2::uuid[]) and s.status = 'planned'`,
    [clientId, slotIds],
  );

  if (rows.length !== new Set(slotIds).size) {
    return { ok: false, status: 404, error: "Algum horário planejado não foi encontrado." };
  }
  if (rows.some((r) => r.post_target_id)) {
    return { ok: false, status: 409, error: "Algum horário já foi enviado para a fila." };
  }
  if (new Set(rows.map((r) => r.content_item_id)).size > 1 || new Set(rows.map((r) => r.day)).size > 1) {
    return { ok: false, status: 400, error: "Envie de uma vez só horários do mesmo conteúdo e do mesmo dia." };
  }
  if (rows.some((r) => !isNetwork(r.network) || !isFormat(r.network, r.format))) {
    return { ok: false, status: 400, error: "Rede ou formato inválido." };
  }
  const times = rows.map((r) => resolveSlotTime(r.time, opts));
  if (times.some((t) => !t)) {
    return { ok: false, status: 400, error: "Informe o horário para enviar à fila." };
  }

  const warnings: string[] = [];
  const first = rows[0];
  const folders = await ensureTargetFolders(
    first.root,
    rows.map((r) => ({ network: r.network, format: r.format, day: r.day })),
  );
  if (folders.error) warnings.push(`A pasta no Drive não foi criada: ${folders.error}`);

  // Capa: só em formatos com capa própria (Instagram Reels). Lê os dados da imagem antes da transação.
  const coverMeta = new Map<string, MediaMeta>();
  for (const r of rows) {
    const id = r.item_cover_file_id;
    if (!id || coverMeta.has(id) || !(isNetwork(r.network) && NETWORKS[r.network].formats[r.format]?.thumb)) continue;
    const m = await getFileMeta(id);
    if (!m.error) coverMeta.set(id, m);
  }

  const c = await pool.connect();
  try {
    await c.query("begin");
    const p = await c.query<{ id: string }>(
      "insert into posts (client_id, title, idea, tones) values ($1,$2,$3,$4) returning id",
      [clientId, first.title.slice(0, 120), first.brief.slice(0, 4000), first.tones],
    );
    const ids: string[] = [];
    for (const [i, r] of rows.entries()) {
      // Carrossel nunca vincula arquivo único em post_targets (evita publicar apenas a capa).
      // Imagem estática usa o slide 0; item pronto sem asset usa a mídia própria do content_item.
      let linkUrl = "";
      let linkId: string | null = null;
      let linkMeta: MediaMeta | null = null;

      if (r.asset_kind === "carousel") {
        warnings.push(`${r.network}/${r.format}: carrossel ainda não é publicado pelo app; publique manualmente.`);
      } else if (r.asset_kind === "static" && r.slide_file_id && r.slide_file_meta && !r.slide_file_meta.error) {
        linkUrl = r.slide_file_url ?? "";
        linkId = r.slide_file_id;
        linkMeta = r.slide_file_meta;
      } else if (!r.asset_kind && r.item_drive_file_id && r.item_drive_meta && !r.item_drive_meta.error) {
        linkUrl = r.item_drive_url ?? "";
        linkId = r.item_drive_file_id;
        linkMeta = r.item_drive_meta;
      }

      const targetCaption = resolveCaptionForNetwork(r.network, r).slice(0, 70000);
      const t = await c.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, caption, drive_url, drive_file_id, drive_meta, post_folder_id,
                                   thumb_url, thumb_file_id, thumb_meta)
         values ($1,$2,$3,($4::date + $5::time) at time zone '${TZ}',$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [
          p.rows[0].id,
          r.network,
          r.format,
          r.day,
          times[i],
          targetCaption,
          linkUrl,
          linkId,
          linkMeta ? JSON.stringify(linkMeta) : null,
          folders.ids[i],
          ...(() => {
            const cid = r.item_cover_file_id;
            const m = cid && isNetwork(r.network) && NETWORKS[r.network].formats[r.format]?.thumb ? coverMeta.get(cid) : undefined;
            return m && cid ? [`https://drive.google.com/file/d/${cid}/view`, cid, JSON.stringify(m)] : ["", null, null];
          })(),
        ],
      );
      const g = await c.query(
        `update editorial_schedule
            set post_target_id = $1, planned_time = $2::time, updated_at = now()
          where id = $3 and post_target_id is null
          returning id`,
        [t.rows[0].id, times[i], r.id],
      );
      if (!g.rowCount) throw Object.assign(new Error("conflito"), { conflict: true });
      ids.push(t.rows[0].id);
    }
    await c.query("commit");
    // Vídeo pronto de "Reels Editados": a pasta "Vídeo N" vai para a pasta do post no dia (depois do commit,
    // porque o Drive não volta atrás junto com o banco).
    const moveWarn = await moveReadyFolderToDay(first.content_item_id, folders.ids.find((x) => !!x) ?? null).catch(
      () => "A pasta do vídeo não foi movida para o dia: falha ao falar com o Google Drive.",
    );
    if (moveWarn) warnings.push(moveWarn);
    return { ok: true, post_id: p.rows[0].id, post_target_ids: ids, day: first.day, warnings };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    if ((e as { conflict?: boolean }).conflict) {
      return { ok: false, status: 409, error: "Algum horário já foi enviado para a fila." };
    }
    throw e;
  } finally {
    c.release();
  }
}
