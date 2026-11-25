// Sequência de postagem: leitura dos vídeos prontos em "Reels Editados", gravação do plano da IA e
// movimento das pastas "Vídeo N" para o dia da postagem (e de volta). As partes puras ficam em editorial-sequence.ts.
import type { MediaMeta } from "./checks.ts";
import { db } from "./db.ts";
import {
  scanClientCutFolders,
  findReadyVideosFolder,
  getFileMeta,
  moveItem,
  readDriveDocumentText,
} from "./drive.ts";
import { parseCutDocument } from "./drive-cuts.ts";
import { editorialAiConfigured, generateEditorialJson } from "./editorial-ai.ts";
import { extractJsonPayload, normalizeThemeKey } from "./editorial-rules.ts";
import type { ReadyVideo, SequenceEntry } from "./editorial-sequence.ts";
import {
  buildReadyProfilePrompt,
  classifyTextFile,
  mapLimit,
  parseReadyProfile,
  profileHash,
  qualityFlags,
  type ReadyProfile,
} from "./ready-profile.ts";

const TRANSCRIPT_MAX = 20000;
type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type SyncResult = {
  folder: string | null;
  created: number;
  updated: number;
  warnings: string[];
  /** Vídeos que a IA interpretou nesta sincronização (ficha nova ou refeita porque a transcrição mudou). */
  profiled?: number;
  /** Vídeos que ainda esperam ficha (limite por sincronização ou falha da IA). */
  profile_pending?: number;
  /** A IA começou a fazer as fichas em segundo plano. */
  profiling?: boolean;
};

/** Quantos vídeos a IA interpreta por sincronização (o resto fica para a próxima). */
export const PROFILE_MAX_PER_SYNC = 12;

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

  // Varre "Reels Editados" em qualquer profundidade (ex.: Reels Editados / Ep - 1 Convidado / Cortes_Reels / 01 - corte):
  // cada pasta com vídeo vira um vídeo pronto.
  const scan = await scanClientCutFolders(ready.id, { maxFolders: 300 });
  if ("error" in scan) return { folder: ready.name, created: 0, updated: 0, warnings: [scan.error] };
  let created = 0;
  let updated = 0;
  const warnings: string[] = [];
  if (scan.folders_truncated) warnings.push(`"${ready.name}" tem pastas demais: só as primeiras 300 foram lidas.`);
  for (const e of scan.empty_folders) warnings.push(`${e}: ainda sem vídeo, ficou de fora.`);
  for (const bundle of scan.cut_folders) {
    const folder = { id: bundle.folder_id, name: bundle.folder_name };
    const label = [...bundle.path, bundle.folder_name].join(" / ");
    if (!bundle.video) {
      warnings.push(`${label}: ainda sem vídeo, ficou de fora.`);
      continue;
    }
    // Lê todos os textos da pasta (até 4): transcrição da fala e/ou legenda sugerida por quem cortou o vídeo.
    const transcripts: string[] = [];
    const captions: string[] = [];
    for (const f of bundle.docs) {
      const doc = await readDriveDocumentText(f);
      if (doc.warning) warnings.push(`${label}: ${doc.warning}`);
      if (!doc.text.trim()) continue;
      (classifyTextFile(f.name, doc.text) === "caption" ? captions : transcripts).push(doc.text.trim());
    }
    const transcript = transcripts.join("\n\n").slice(0, TRANSCRIPT_MAX);
    const suggested = captions.join("\n\n").slice(0, TRANSCRIPT_MAX);
    if (!transcript && !suggested) warnings.push(`${label}: sem transcrição nem legenda; a IA só vai ver o nome.`);
    const fromTranscript = parseCutDocument({ folderName: folder.name, videoName: bundle.video.name, coverName: bundle.cover?.name, docText: transcript });
    const fromCaption = suggested
      ? parseCutDocument({ folderName: folder.name, videoName: bundle.video.name, coverName: bundle.cover?.name, docText: suggested })
      : null;
    const parsed = {
      ...fromTranscript,
      title: fromTranscript.title !== folder.name ? fromTranscript.title : (fromCaption?.title ?? fromTranscript.title),
      topic_tag: fromTranscript.topic_tag || fromCaption?.topic_tag || "",
      guest_name: fromTranscript.guest_name || fromCaption?.guest_name || bundle.detected_guest || "",
      caption_draft: fromCaption ? fromCaption.caption_draft || suggested : fromTranscript.caption_draft,
      caption_instagram: fromCaption?.caption_instagram || fromTranscript.caption_instagram,
      caption_linkedin: fromCaption?.caption_linkedin || fromTranscript.caption_linkedin,
    };
    const meta = await getFileMeta(bundle.video.id);
    const title = readyVideoTitle(parsed.title, folder.name, transcript || suggested);
    const driveUrl = `https://drive.google.com/file/d/${bundle.video.id}/view`;
    const values = [
      clientId, title, normalizeThemeKey(parsed.topic_tag || title), parsed.guest_name, parsed.topic_tag, transcript,
      parsed.caption_draft, parsed.caption_instagram, parsed.caption_linkedin, driveUrl, bundle.video.id,
      meta.error ? null : JSON.stringify(meta), folder.id, label.slice(0, 300), bundle.parent_id ?? ready.id, bundle.doc?.id ?? null,
      qualityFlags(transcript, suggested), suggested, bundle.cover?.id ?? null,
    ];
    const upd = await pool.query(
      // Campos vazios na transcrição não apagam o que a ficha da IA (ou a pessoa) já preencheu.
      `update content_items set title=$2, theme_key=$3, guest_name=$4,
              topic_tag=case when ai_profile is not null then topic_tag when $5<>'' then $5 else topic_tag end,
              transcript=$6,
              caption_draft=case when $7<>'' then $7 else caption_draft end,
              caption_instagram=case when $8<>'' then $8 else caption_instagram end,
              caption_linkedin=case when $9<>'' then $9 else caption_linkedin end,
              drive_url=$10, drive_file_id=$11,
              drive_meta=$12, source_folder_name=$14, ready_folder_parent_id=$15, doc_drive_file_id=$16, quality_flags=$17, suggested_caption=$18, cover_drive_file_id=coalesce($19, cover_drive_file_id),
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
                source_folder_name, ready_folder_parent_id, doc_drive_file_id, quality_flags, suggested_caption, cover_drive_file_id, source_kind, content_format, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'existing_ready','video','ready')`,
        values,
      );
      created++;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") warnings.push(`${label}: este vídeo já está cadastrado em outro item.`);
      else throw e;
    }
  }
  await pool.query("update clients set ready_synced_at = now() where id = $1", [clientId]);
  return { folder: ready.name, created, updated, warnings };
}

/**
 * "Sincronizar conteúdos": lê a pasta e, com a chave do Gemini, faz a ficha dos vídeos novos ou com transcrição
 * alterada. Sem chave, só lê (a sequência continua funcionando com o texto da transcrição).
 */
export async function syncContents(clientId: string): Promise<SyncResult> {
  const res = await syncReadyVideos(clientId);
  if (!res.folder) return res;
  if (!editorialAiConfigured()) {
    res.warnings.push("Sem chave de IA (Gemini ou Anthropic), os vídeos foram lidos mas não interpretados (sem ficha nem legenda).");
    return res;
  }
  // A IA leva de segundos a minutos por vídeo: a leitura da pasta volta já, e as fichas são feitas em segundo plano
  // (a tela acompanha por profilingStatus).
  startProfiling(clientId);
  res.profiling = true;
  return res;
}

export type ProfilingStatus = { running: boolean; profiled: number; pending: number; warnings: string[]; finished_at: string | null };
type G = typeof globalThis & { _smmProfiling?: Map<string, ProfilingStatus> };
const profilingMap = (): Map<string, ProfilingStatus> => ((globalThis as G)._smmProfiling ??= new Map());

export function profilingStatus(clientId: string): ProfilingStatus | null {
  return profilingMap().get(clientId) ?? null;
}

/** Faz as fichas em segundo plano, em rodadas, até não sobrar vídeo pendente (no máximo 5 rodadas). */
export function startProfiling(clientId: string): void {
  const map = profilingMap();
  if (map.get(clientId)?.running) return;
  const st: ProfilingStatus = { running: true, profiled: 0, pending: 0, warnings: [], finished_at: null };
  map.set(clientId, st);
  void (async () => {
    try {
      for (let round = 0; round < 5; round++) {
        const p = await profileReadyVideos(clientId);
        st.profiled += p.profiled;
        st.pending = p.pending;
        st.warnings = p.warnings;
        if (!p.pending || !p.profiled) break;
      }
    } catch (e) {
      st.warnings = [`a IA parou no meio: ${e instanceof Error ? e.message : String(e)}`];
      console.error("[fichas]", e);
    } finally {
      st.running = false;
      st.finished_at = new Date().toISOString();
    }
  })();
}

type ProfileRow = {
  id: string;
  title: string;
  transcript: string;
  suggested_caption: string;
  ai_profile: ReadyProfile | null;
  topic_tag: string;
  hook: string;
  brief: string;
  caption_instagram: string;
  caption_linkedin: string;
  pillar_id: string | null;
  source_folder_name: string;
};

/** Faz (ou refaz) a ficha dos vídeos prontos cuja transcrição mudou desde a última ficha. */
export async function profileReadyVideos(clientId: string): Promise<{ profiled: number; pending: number; warnings: string[] }> {
  const pool = await db();
  const c = await pool.query<{ name: string; segment: string | null; tone: string | null; notes: string | null; ai_style_notes: string }>(
    "select name, segment, tone, notes, ai_style_notes from clients where id = $1",
    [clientId],
  );
  const client = c.rows[0];
  if (!client) return { profiled: 0, pending: 0, warnings: [] };
  const pillarRows = await pool.query<{ id: string; name: string }>(
    "select id, name from content_pillars where client_id = $1 and archived_at is null order by position",
    [clientId],
  );
  const pillars = pillarRows.rows.map((p) => p.name);
  const items = await pool.query<ProfileRow & { ai_profile_hash: string | null }>(
    `select id, title, transcript, suggested_caption, ai_profile, ai_profile_hash, topic_tag, hook, brief, caption_instagram, caption_linkedin,
            pillar_id, source_folder_name
       from content_items
      where client_id = $1 and source_kind = 'existing_ready' and status <> 'archived'
        and ready_folder_parent_id is not null and (length(btrim(transcript)) > 0 or length(btrim(suggested_caption)) > 0)
      order by source_folder_name, created_at`,
    [clientId],
  );
  const todo = items.rows.filter((r) => r.ai_profile_hash !== profileHash(r.transcript, r.suggested_caption));
  const batch = todo.slice(0, PROFILE_MAX_PER_SYNC);
  const warnings: string[] = [];
  const results = await mapLimit(batch, 3, async (row) => {
    const prompt = buildReadyProfilePrompt({
      clientName: client.name,
      segment: client.segment ?? "",
      tone: client.tone ?? "",
      notes: client.notes ?? "",
      styleNotes: client.ai_style_notes ?? "",
      pillars,
      title: row.title,
      transcript: row.transcript,
      suggestedCaption: row.suggested_caption,
    });
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const ask = attempt === 0 ? prompt : `${prompt}\n\nSua resposta anterior foi recusada: ${lastError} Responda de novo com o JSON completo.`;
      const res = await generateEditorialJson(ask);
      if ("error" in res) return { row, error: res.error };
      let raw: unknown;
      try {
        raw = extractJsonPayload(res.text);
      } catch {
        lastError = "não era um JSON válido.";
        continue;
      }
      const parsed = parseReadyProfile(raw, pillars);
      if (parsed.ok) return { row, profile: parsed.profile };
      lastError = parsed.error;
    }
    return { row, error: lastError || "a IA não respondeu." };
  });
  let profiled = 0;
  for (const r of results) {
    if ("error" in r && r.error) {
      warnings.push(`${r.row.source_folder_name}: a IA não conseguiu interpretar (${r.error}).`);
      continue;
    }
    if (!("profile" in r) || !r.profile) continue;
    await applyProfile(r.row, r.profile, pillarRows.rows);
    profiled++;
  }
  return { profiled, pending: todo.length - profiled, warnings };
}

/**
 * Grava a ficha. Os campos visíveis (tema, gancho, resumo, legendas) só são trocados se estiverem vazios ou ainda
 * iguais à ficha anterior: o que a pessoa editou à mão nunca é sobrescrito.
 */
async function applyProfile(row: ProfileRow, p: ReadyProfile, pillars: { id: string; name: string }[]): Promise<void> {
  const prev = row.ai_profile;
  const keep = (current: string, previous: string | undefined, next: string) =>
    !current.trim() || (previous !== undefined && current === previous) ? next : current;
  // Antes da primeira ficha, o tema vinha da linha "Tema:" inteira: a ficha troca pelo tema curto.
  const topic = !prev ? p.theme : keep(row.topic_tag, prev.theme, p.theme);
  const pillarId = row.pillar_id ?? pillars.find((x) => x.name === p.pillar)?.id ?? null;
  const pool = await db();
  await pool.query(
    `update content_items set ai_profile = $2, ai_profile_hash = $3, topic_tag = $4, theme_key = $5, hook = $6, brief = $7,
            caption_instagram = $8, caption_linkedin = $9, pillar_id = $10, updated_at = now()
      where id = $1`,
    [
      row.id,
      JSON.stringify(p),
      profileHash(row.transcript, row.suggested_caption),
      topic,
      normalizeThemeKey(topic || row.title),
      keep(row.hook, prev?.hook, p.hook),
      keep(row.brief, prev?.summary, p.summary),
      keep(row.caption_instagram, prev?.caption_instagram, p.caption_instagram),
      keep(row.caption_linkedin, prev?.caption_linkedin, p.caption_linkedin),
      pillarId,
    ],
  );
}

/** Vídeos prontos que a IA pode usar: da "Reels Editados", ainda na pasta e sem post na fila. */
export async function listAvailableReady(clientId: string): Promise<ReadyVideo[]> {
  const pool = await db();
  const r = await pool.query<ReadyVideo>(
    `select i.id, i.title, i.topic_tag as topic, i.guest_name as guest, i.transcript, i.suggested_caption,
            coalesce(i.ai_profile->>'summary', '') as summary, coalesce(p.name, i.ai_profile->>'pillar', '') as pillar,
            coalesce(i.ai_profile->>'audience', '') as audience, i.quality_flags as flags, i.hook,
            i.caption_instagram, i.caption_linkedin, i.drive_url, i.source_folder_name as folder,
            (i.ai_profile is not null) as profiled
       from content_items i
       left join content_pillars p on p.id = i.pillar_id
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
            (length(i.transcript) > 0 or length(i.suggested_caption) > 0) as has_transcript, i.hook, i.brief
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
