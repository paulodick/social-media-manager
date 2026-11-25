// Sequência de postagem: leitura dos vídeos prontos em "Reels Editados", gravação do plano da IA e
// movimento das pastas "Vídeo N" para o dia da postagem (e de volta). As partes puras ficam em editorial-sequence.ts.
import type { MediaMeta } from "./checks.ts";
import { db } from "./db.ts";
import {
  findReadyVideosFolder,
  getFileMeta,
  listFolderAllFiles,
  listSubfolders,
  moveItem,
  readDriveDocumentText,
} from "./drive.ts";
import { groupFolderIntoCutBundle, parseCutDocument } from "./drive-cuts.ts";
import { normalizeThemeKey } from "./editorial-rules.ts";
import type { ReadyVideo, SequenceEntry } from "./editorial-sequence.ts";

const TRANSCRIPT_MAX = 20000;
type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type SyncResult = { folder: string | null; created: number; updated: number; warnings: string[] };

/** Título de referência: "Video 3" sozinho não diz nada, então junta o começo da fala da transcrição. */
export function readyVideoTitle(parsedTitle: string, folderName: string, transcript: string): string {
  const generic = /^v[ií]deo\s*\d+$/i.test(parsedTitle.trim()) || !parsedTitle.trim() || parsedTitle.trim() === folderName.trim();
  if (!generic) return parsedTitle.slice(0, 160);
  // Transcrição com cabeçalho "Tema: ..." (jeito que a Best Medical organiza): o tema é o melhor título.
  const tema = transcript.match(/^\s*tema\s*:\s*(.+)$/im)?.[1]?.trim();
  if (tema) return tema.slice(0, 160);
  // Pula cabeçalhos como "TRANSCRIÇÃO — arquivo.mp4" e linhas que são só nome de arquivo.
  const speech = transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(transcri[çc][aã]o|fala|tema)\b/i.test(l) && !/\.(mp4|mov|m4v|webm)\b/i.test(l))
    .join(" ")
    .replace(/\s+/g, " ");
  const start = speech.slice(0, 70);
  return (start ? `${folderName}: ${start}${speech.length > 70 ? "…" : ""}` : folderName).slice(0, 160);
}

/**
 * Lê cada subpasta de "Reels Editados" (vídeo + transcrição) e cria ou atualiza o item "Já gravado" correspondente.
 * A subpasta é identificada pelo ID do Drive, não pelo número do nome.
 */
export async function syncReadyVideos(clientId: string): Promise<SyncResult> {
  const pool = await db();
  const c = await pool.query<{ drive_folder_id: string | null }>("select drive_folder_id from clients where id = $1", [clientId]);
  const root = c.rows[0]?.drive_folder_id;
  if (!root) return { folder: null, created: 0, updated: 0, warnings: ["Este cliente ainda não tem pasta do Drive no cadastro."] };
  const ready = await findReadyVideosFolder(root);
  if (ready && "error" in ready) return { folder: null, created: 0, updated: 0, warnings: [ready.error] };
  if (!ready) return { folder: null, created: 0, updated: 0, warnings: ['Não achei a pasta "Reels Editados" dentro da pasta do cliente.'] };

  const subs = await listSubfolders(ready.id, { max: 200 });
  if ("error" in subs) return { folder: ready.name, created: 0, updated: 0, warnings: [subs.error] };
  let created = 0;
  let updated = 0;
  const warnings: string[] = [];
  for (const folder of subs.folders) {
    const listing = await listFolderAllFiles(folder.id, { pageSize: 30 });
    if ("error" in listing) {
      warnings.push(`${folder.name}: ${listing.error}`);
      continue;
    }
    const bundle = groupFolderIntoCutBundle(folder, listing.files);
    if (!bundle?.video) {
      warnings.push(`${folder.name}: ainda sem vídeo, ficou de fora.`);
      continue;
    }
    let transcript = "";
    if (bundle.doc) {
      const doc = await readDriveDocumentText(bundle.doc);
      transcript = doc.text.slice(0, TRANSCRIPT_MAX);
      if (doc.warning) warnings.push(`${folder.name}: ${doc.warning}`);
    } else {
      warnings.push(`${folder.name}: sem transcrição; a IA só vai ver o nome.`);
    }
    const parsed = parseCutDocument({ folderName: folder.name, videoName: bundle.video.name, coverName: bundle.cover?.name, docText: transcript });
    const meta = await getFileMeta(bundle.video.id);
    const title = readyVideoTitle(parsed.title, folder.name, transcript);
    const driveUrl = `https://drive.google.com/file/d/${bundle.video.id}/view`;
    const values = [
      clientId, title, normalizeThemeKey(parsed.topic_tag || title), parsed.guest_name, parsed.topic_tag, transcript,
      parsed.caption_draft, parsed.caption_instagram, parsed.caption_linkedin, driveUrl, bundle.video.id,
      meta.error ? null : JSON.stringify(meta), folder.id, folder.name, ready.id, bundle.doc?.id ?? null,
    ];
    const upd = await pool.query(
      `update content_items set title=$2, theme_key=$3, guest_name=$4, topic_tag=$5, transcript=$6,
              caption_draft=$7, caption_instagram=$8, caption_linkedin=$9, drive_url=$10, drive_file_id=$11,
              drive_meta=$12, source_folder_name=$14, ready_folder_parent_id=$15, doc_drive_file_id=$16,
              source_kind='existing_ready', status=case when status='archived' then status else 'ready' end, updated_at=now()
        where client_id=$1 and source_folder_id=$13`,
      values,
    );
    if (upd.rowCount) {
      updated++;
      continue;
    }
    try {
      await pool.query(
        `insert into content_items (client_id, title, theme_key, guest_name, topic_tag, transcript, caption_draft,
                caption_instagram, caption_linkedin, drive_url, drive_file_id, drive_meta, source_folder_id,
                source_folder_name, ready_folder_parent_id, doc_drive_file_id, source_kind, content_format, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'existing_ready','video','ready')`,
        values,
      );
      created++;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") warnings.push(`${folder.name}: este vídeo já está cadastrado em outro item.`);
      else throw e;
    }
  }
  return { folder: ready.name, created, updated, warnings };
}

/** Vídeos prontos que a IA pode usar: da "Reels Editados", ainda na pasta e sem post na fila. */
export async function listAvailableReady(clientId: string): Promise<ReadyVideo[]> {
  const pool = await db();
  const r = await pool.query<ReadyVideo>(
    `select i.id, i.title, i.topic_tag as topic, i.guest_name as guest, i.transcript
       from content_items i
      where i.client_id = $1 and i.source_kind = 'existing_ready' and i.status = 'ready'
        and i.ready_folder_parent_id is not null and i.ready_folder_moved_to is null
        and not exists (select 1 from editorial_schedule s where s.content_item_id = i.id
                          and (s.post_target_id is not null or s.plan_status = 'approved'))
      order by i.source_folder_name, i.created_at`,
    [clientId],
  );
  return r.rows;
}

/** O que saiu ou vai sair nas últimas semanas, para a IA não repetir tema. */
export async function listRecentForSequence(clientId: string): Promise<{ day: string; title: string; topic: string }[]> {
  const pool = await db();
  const r = await pool.query(
    `select to_char(s.planned_day, 'YYYY-MM-DD') as day, i.title, coalesce(nullif(i.topic_tag, ''), i.theme_key) as topic
       from editorial_schedule s join content_items i on i.id = s.content_item_id
      where s.client_id = $1 and (s.post_target_id is not null or s.plan_status = 'approved')
        and s.planned_day >= current_date - 45
      group by s.planned_day, i.title, i.topic_tag, i.theme_key
      order by s.planned_day desc limit 20`,
    [clientId],
  );
  return r.rows;
}

/**
 * Grava o plano: apaga o rascunho anterior da sequência a partir de `start` (só o que ainda não foi aprovado)
 * e cria horários (um por rede) para cada data, pautas novas como itens "Para gravar" e os dias sem post.
 */
export async function saveSequence(
  clientId: string,
  start: string,
  entries: SequenceEntry[],
  targets: { network: string; format: string; time: string }[],
): Promise<void> {
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("begin");
    await clearDraftSequence(c, clientId, start);
    for (const [pos, e] of entries.entries()) {
      if (e.kind === "skip") {
        await c.query(
          `insert into editorial_sequence_skips (client_id, day, reason) values ($1, $2::date, $3)
           on conflict (client_id, day) do update set reason = excluded.reason, created_at = now()`,
          [clientId, e.date, e.reason],
        );
        continue;
      }
      let itemId: string;
      if (e.kind === "ready") {
        itemId = e.item_id;
      } else {
        const ins = await c.query<{ id: string }>(
          `insert into content_items (client_id, source_kind, content_format, title, theme_key, topic_tag, hook, brief, script, status)
           values ($1, 'needs_creation', 'video', $2, $3, $4, $5, $6, $7, 'idea') returning id`,
          [clientId, e.idea.title, e.idea.theme_key, e.theme, e.idea.hook, e.idea.brief, e.idea.script],
        );
        itemId = ins.rows[0].id;
      }
      if (e.kind === "ready" && e.theme) {
        await c.query("update content_items set topic_tag = $2 where id = $1 and topic_tag = ''", [itemId, e.theme]);
      }
      for (const t of targets) {
        await c.query(
          `insert into editorial_schedule (client_id, content_item_id, planned_day, planned_time, position, network, format,
                                           status, plan_status, ai_reason, sequence_kind)
           values ($1, $2, $3::date, $4::time, $5, $6, $7, 'planned', 'draft', $8, $9)`,
          [clientId, itemId, e.date, t.time, pos, t.network, t.format, e.reason, e.kind],
        );
      }
    }
    await c.query("commit");
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function clearDraftSequence(c: Pg, clientId: string, start: string): Promise<void> {
  const del = await c.query(
    `delete from editorial_schedule
      where client_id = $1 and planned_day >= $2::date and sequence_kind <> ''
        and plan_status = 'draft' and post_target_id is null
      returning content_item_id, sequence_kind`,
    [clientId, start],
  );
  const newIds = [...new Set(del.rows.filter((r) => r.sequence_kind === "new").map((r) => r.content_item_id))];
  if (newIds.length) {
    // Pauta nova que só existia neste rascunho (ainda ideia, sem outro horário) sai junto.
    await c.query(
      `delete from content_items i where i.id = any($1::uuid[]) and i.status = 'idea'
         and not exists (select 1 from editorial_schedule s where s.content_item_id = i.id)`,
      [newIds],
    );
  }
  await c.query("delete from editorial_sequence_skips where client_id = $1 and day >= $2::date", [clientId, start]);
}

export type SequenceRow = {
  day: string;
  kind: "ready" | "new" | "skip";
  item_id: string | null;
  title: string;
  theme: string;
  reason: string;
  slot_ids: string[];
  networks: string[];
  approved: boolean;
  has_transcript: boolean;
  hook: string;
  brief: string;
};

/** Sequência a partir de `from` (dias com conteúdo e dias sem post), na ordem das datas. */
export async function readSequence(clientId: string, from: string): Promise<SequenceRow[]> {
  const pool = await db();
  const slots = await pool.query(
    `select to_char(s.planned_day, 'YYYY-MM-DD') as day, s.sequence_kind as kind, i.id as item_id, i.title,
            coalesce(nullif(i.topic_tag, ''), '') as theme, max(s.ai_reason) as reason,
            array_agg(s.id::text order by s.network) as slot_ids,
            array_agg(s.network || ':' || s.format order by s.network) as networks,
            bool_or(s.post_target_id is not null or s.plan_status = 'approved') as approved,
            (length(i.transcript) > 0) as has_transcript, i.hook, i.brief
       from editorial_schedule s join content_items i on i.id = s.content_item_id
      where s.client_id = $1 and s.planned_day >= $2::date and s.sequence_kind <> '' and s.status = 'planned'
      group by s.planned_day, s.sequence_kind, i.id
      order by s.planned_day`,
    [clientId, from],
  );
  const skips = await pool.query(
    `select to_char(day, 'YYYY-MM-DD') as day, reason from editorial_sequence_skips where client_id = $1 and day >= $2::date`,
    [clientId, from],
  );
  const rows: SequenceRow[] = [
    ...slots.rows,
    ...skips.rows.map((s) => ({
      day: s.day, kind: "skip" as const, item_id: null, title: "Sem post neste dia", theme: "", reason: s.reason,
      slot_ids: [], networks: [], approved: false, has_transcript: false, hook: "", brief: "",
    })),
  ];
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Depois de aprovar (post criado), move a pasta "Vídeo N" de "Reels Editados" para a pasta do post no dia.
 * Falha do Drive vira aviso: o post já está ligado ao vídeo pelo ID e funciona de qualquer jeito.
 */
export async function moveReadyFolderToDay(itemId: string, dayFolderId: string | null): Promise<string | null> {
  if (!dayFolderId) return null;
  const pool = await db();
  const r = await pool.query<{ source_folder_id: string | null; ready_folder_parent_id: string | null; ready_folder_moved_to: string | null; source_folder_name: string }>(
    "select source_folder_id, ready_folder_parent_id, ready_folder_moved_to, source_folder_name from content_items where id = $1",
    [itemId],
  );
  const it = r.rows[0];
  if (!it?.source_folder_id || !it.ready_folder_parent_id || it.ready_folder_moved_to) return null;
  const res = await moveItem(it.source_folder_id, it.ready_folder_parent_id, dayFolderId);
  if ("error" in res) return `A pasta "${it.source_folder_name}" não foi movida para o dia: ${res.error}`;
  await pool.query("update content_items set ready_folder_moved_to = $2, updated_at = now() where id = $1", [itemId, dayFolderId]);
  return null;
}

/**
 * Quando o post de um vídeo pronto sai da fila (destino excluído), devolve a pasta "Vídeo N" para "Reels Editados",
 * se nenhum outro post ainda usar esse vídeo.
 */
export async function returnReadyFolders(itemIds: string[]): Promise<string[]> {
  if (!itemIds.length) return [];
  const pool = await db();
  const r = await pool.query<{ id: string; source_folder_id: string; ready_folder_parent_id: string; ready_folder_moved_to: string; source_folder_name: string }>(
    `select i.id, i.source_folder_id, i.ready_folder_parent_id, i.ready_folder_moved_to, i.source_folder_name
       from content_items i
      where i.id = any($1::uuid[]) and i.ready_folder_moved_to is not null and i.source_folder_id is not null
        and not exists (select 1 from editorial_schedule s where s.content_item_id = i.id and s.post_target_id is not null)`,
    [itemIds],
  );
  const warnings: string[] = [];
  for (const it of r.rows) {
    const res = await moveItem(it.source_folder_id, it.ready_folder_moved_to, it.ready_folder_parent_id);
    if ("error" in res) {
      warnings.push(`A pasta "${it.source_folder_name}" não voltou para "Reels Editados": ${res.error}`);
      continue;
    }
    await pool.query(
      `update content_items set ready_folder_moved_to = null, updated_at = now() where id = $1`,
      [it.id],
    );
    // O plano volta a rascunho para o vídeo poder entrar de novo numa sequência.
    await pool.query(
      `update editorial_schedule set plan_status = 'draft', approved_at = null where content_item_id = $1 and post_target_id is null`,
      [it.id],
    );
  }
  return warnings;
}

export type { MediaMeta };
