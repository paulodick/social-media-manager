import type { MediaMeta } from "./checks.ts";
import { TZ } from "./dates.ts";
import { db } from "./db.ts";
import { isUuid } from "./editorial-rules.ts";
import type {
  AssetAspect,
  AssetKind,
  AssetStatus,
  ContentItem,
  ContentSourceKind,
  ContentStatus,
  ItemCard,
  Pillar,
  Slide,
  SlideInput,
  SlotView,
  VisualAsset,
} from "./editorial-types.ts";

// ---------- Pilares ----------

export async function listPillars(clientId: string, opts: { includeArchived?: boolean } = {}): Promise<Pillar[]> {
  if (!isUuid(clientId)) return [];
  const pool = await db();
  const where = opts.includeArchived ? "client_id = $1" : "client_id = $1 and archived_at is null";
  const r = await pool.query<Pillar>(
    `select id, client_id, name, description, color, weight_pct, weekly_target, position,
            archived_at::text as archived_at
       from content_pillars
      where ${where}
      order by position asc, name asc`,
    [clientId],
  );
  return r.rows;
}

export async function getPillar(id: string, clientId?: string): Promise<Pillar | null> {
  if (!isUuid(id) || (clientId !== undefined && !isUuid(clientId))) return null;
  const pool = await db();
  const sql = clientId
    ? `select id, client_id, name, description, color, weight_pct, weekly_target, position, archived_at::text as archived_at
         from content_pillars where id = $1 and client_id = $2`
    : `select id, client_id, name, description, color, weight_pct, weekly_target, position, archived_at::text as archived_at
         from content_pillars where id = $1`;
  const r = await pool.query<Pillar>(sql, clientId ? [id, clientId] : [id]);
  return r.rows[0] ?? null;
}

export async function createPillar(
  clientId: string,
  input: { name: string; description?: string; color?: string; weight_pct?: number; weekly_target?: number | null; position?: number },
): Promise<Pillar> {
  const pool = await db();
  const r = await pool.query<Pillar>(
    `insert into content_pillars (client_id, name, description, color, weight_pct, weekly_target, position)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, client_id, name, description, color, weight_pct, weekly_target, position, archived_at::text as archived_at`,
    [
      clientId,
      input.name.trim(),
      (input.description ?? "").trim(),
      input.color ?? "#596579",
      input.weight_pct ?? 0,
      input.weekly_target ?? null,
      input.position ?? 0,
    ],
  );
  return r.rows[0];
}

export async function upsertPillar(
  clientId: string,
  input: { name: string; description?: string; color?: string; weight_pct?: number; weekly_target?: number | null; position?: number },
): Promise<{ pillar: Pillar; action: "created" | "updated" }> {
  const pool = await db();
  const r = await pool.query<Pillar & { inserted: boolean }>(
    `insert into content_pillars (client_id, name, description, color, weight_pct, weekly_target, position)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (client_id, name) do update
       set description = excluded.description,
           color = excluded.color,
           weight_pct = excluded.weight_pct,
           weekly_target = coalesce(excluded.weekly_target, content_pillars.weekly_target),
           archived_at = null,
           updated_at = now()
     returning id, client_id, name, description, color, weight_pct, weekly_target, position,
               archived_at::text as archived_at, (xmax::text = '0') as inserted`,
    [
      clientId,
      input.name.trim(),
      (input.description ?? "").trim(),
      input.color ?? "#596579",
      input.weight_pct ?? 0,
      input.weekly_target ?? null,
      input.position ?? 0,
    ],
  );
  const { inserted, ...pillar } = r.rows[0];
  return { pillar, action: inserted ? "created" : "updated" };
}

export async function updatePillar(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    color: string;
    weight_pct: number;
    weekly_target: number | null;
    position: number;
    archived: boolean;
  }>,
): Promise<Pillar | null> {
  if (!isUuid(id)) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.description !== undefined) push("description", patch.description.trim());
  if (patch.color !== undefined) push("color", patch.color);
  if (patch.weight_pct !== undefined) push("weight_pct", patch.weight_pct);
  if (patch.weekly_target !== undefined) push("weekly_target", patch.weekly_target);
  if (patch.position !== undefined) push("position", patch.position);
  if (patch.archived !== undefined) {
    sets.push(patch.archived ? "archived_at = coalesce(archived_at, now())" : "archived_at = null");
  }
  if (!sets.length) return getPillar(id);
  sets.push("updated_at = now()");
  args.push(id);
  const pool = await db();
  const r = await pool.query<Pillar>(
    `update content_pillars set ${sets.join(", ")} where id = $${args.length}
     returning id, client_id, name, description, color, weight_pct, weekly_target, position, archived_at::text as archived_at`,
    args,
  );
  return r.rows[0] ?? null;
}

// ---------- Itens de conteúdo ----------

export type ItemListFilter = {
  clientId: string;
  status?: ContentStatus;
  sourceKind?: ContentSourceKind;
  pillarId?: string;
  q?: string;
  limit?: number;
  cursor?: string; // "<iso>|<uuid>"
};

export async function listContentItems(
  f: ItemListFilter,
): Promise<{ items: ItemCard[]; next_cursor: string | null }> {
  if (!isUuid(f.clientId)) return { items: [], next_cursor: null };
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 100);
  const where: string[] = ["i.client_id = $1"];
  const args: unknown[] = [f.clientId];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("$$", `$${args.length}`));
  };
  if (f.status) add("i.status = $$", f.status);
  if (f.sourceKind) add("i.source_kind = $$", f.sourceKind);
  if (f.pillarId && isUuid(f.pillarId)) add("i.pillar_id = $$", f.pillarId);
  if (f.q?.trim()) {
    const term = `%${f.q.trim()}%`;
    args.push(term);
    const idx = args.length;
    where.push(`(i.title ilike $${idx} or i.brief ilike $${idx} or i.theme_key ilike $${idx})`);
  }
  if (f.cursor) {
    const [ts, cid] = f.cursor.split("|");
    if (ts && isUuid(cid)) {
      args.push(ts, cid);
      const tIdx = args.length - 1;
      const cIdx = args.length;
      where.push(`(i.created_at, i.id) < ($${tIdx}::timestamptz, $${cIdx}::uuid)`);
    }
  }
  args.push(limit + 1);
  const limitIdx = args.length;

  const pool = await db();
  type Row = ContentItem & {
    pillar_name: string | null;
    pillar_color: string | null;
    assets_count: number;
    slots_count: number;
    in_queue_count: number;
  };
  const r = await pool.query<Row>(
    `select i.id, i.client_id, i.pillar_id, i.source_kind, i.title, i.theme_key,
            i.hook, i.angle, i.brief, i.script, i.transcript, i.caption_draft,
            i.tones, i.status, i.drive_url, i.drive_file_id, i.drive_meta,
            i.created_at::text as created_at, i.updated_at::text as updated_at,
            p.name as pillar_name, p.color as pillar_color,
            (select count(*)::int from content_visual_assets a where a.content_item_id = i.id) as assets_count,
            (select count(*)::int from editorial_schedule s where s.content_item_id = i.id and s.status = 'planned') as slots_count,
            (select count(*)::int from editorial_schedule s where s.content_item_id = i.id and s.post_target_id is not null) as in_queue_count
       from content_items i
       left join content_pillars p on p.id = i.pillar_id
      where ${where.join(" and ")}
      order by i.created_at desc, i.id desc
      limit $${limitIdx}`,
    args,
  );

  const hasMore = r.rows.length > limit;
  const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
  const items: ItemCard[] = rows.map((row) => ({
    id: row.id,
    client_id: row.client_id,
    pillar_id: row.pillar_id,
    source_kind: row.source_kind,
    title: row.title,
    theme_key: row.theme_key,
    hook: row.hook,
    angle: row.angle,
    brief: row.brief,
    script: row.script,
    transcript: row.transcript,
    caption_draft: row.caption_draft,
    tones: row.tones,
    status: row.status,
    drive_url: row.drive_url,
    drive_file_id: row.drive_file_id,
    drive_meta: row.drive_meta,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pillar:
      row.pillar_id && row.pillar_name
        ? { id: row.pillar_id, name: row.pillar_name, color: row.pillar_color ?? "#596579" }
        : null,
    assets_count: row.assets_count,
    slots_count: row.slots_count,
    in_queue_count: row.in_queue_count,
  }));
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}

export async function getContentItem(id: string, clientId?: string): Promise<ContentItem | null> {
  if (!isUuid(id) || (clientId !== undefined && !isUuid(clientId))) return null;
  const pool = await db();
  const sql = clientId
    ? `select id, client_id, pillar_id, source_kind, title, theme_key, hook, angle, brief, script, transcript,
              caption_draft, tones, status, drive_url, drive_file_id, drive_meta,
              created_at::text as created_at, updated_at::text as updated_at
         from content_items where id = $1 and client_id = $2`
    : `select id, client_id, pillar_id, source_kind, title, theme_key, hook, angle, brief, script, transcript,
              caption_draft, tones, status, drive_url, drive_file_id, drive_meta,
              created_at::text as created_at, updated_at::text as updated_at
         from content_items where id = $1`;
  const r = await pool.query<ContentItem>(sql, clientId ? [id, clientId] : [id]);
  return r.rows[0] ?? null;
}

export type ContentItemInput = {
  pillar_id?: string | null;
  source_kind?: ContentSourceKind;
  title: string;
  theme_key?: string;
  hook?: string;
  angle?: string;
  brief?: string;
  script?: string;
  transcript?: string;
  caption_draft?: string;
  tones?: string[];
  status?: ContentStatus;
  drive_url?: string;
  drive_file_id?: string | null;
  drive_meta?: MediaMeta | null;
};

export async function createContentItem(clientId: string, input: ContentItemInput): Promise<ContentItem> {
  const pool = await db();
  const r = await pool.query<ContentItem>(
    `insert into content_items (
       client_id, pillar_id, source_kind, title, theme_key, hook, angle, brief, script, transcript,
       caption_draft, tones, status, drive_url, drive_file_id, drive_meta
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning id, client_id, pillar_id, source_kind, title, theme_key, hook, angle, brief, script, transcript,
               caption_draft, tones, status, drive_url, drive_file_id, drive_meta,
               created_at::text as created_at, updated_at::text as updated_at`,
    [
      clientId,
      input.pillar_id ?? null,
      input.source_kind ?? "needs_creation",
      input.title.trim(),
      (input.theme_key ?? "").trim(),
      (input.hook ?? "").trim(),
      (input.angle ?? "").trim(),
      (input.brief ?? "").trim(),
      (input.script ?? "").trim(),
      (input.transcript ?? "").trim(),
      (input.caption_draft ?? "").trim(),
      input.tones ?? [],
      input.status ?? "idea",
      input.drive_url ?? "",
      input.drive_file_id ?? null,
      input.drive_meta ? JSON.stringify(input.drive_meta) : null,
    ],
  );
  return r.rows[0];
}

export async function updateContentItem(id: string, patch: Partial<ContentItemInput>): Promise<ContentItem | null> {
  if (!isUuid(id)) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.pillar_id !== undefined) push("pillar_id", patch.pillar_id);
  if (patch.source_kind !== undefined) push("source_kind", patch.source_kind);
  if (patch.title !== undefined) push("title", patch.title.trim());
  if (patch.theme_key !== undefined) push("theme_key", patch.theme_key.trim());
  if (patch.hook !== undefined) push("hook", patch.hook.trim());
  if (patch.angle !== undefined) push("angle", patch.angle.trim());
  if (patch.brief !== undefined) push("brief", patch.brief.trim());
  if (patch.script !== undefined) push("script", patch.script.trim());
  if (patch.transcript !== undefined) push("transcript", patch.transcript.trim());
  if (patch.caption_draft !== undefined) push("caption_draft", patch.caption_draft.trim());
  if (patch.tones !== undefined) push("tones", patch.tones);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.drive_url !== undefined) push("drive_url", patch.drive_url);
  if (patch.drive_file_id !== undefined) push("drive_file_id", patch.drive_file_id);
  if (patch.drive_meta !== undefined) push("drive_meta", patch.drive_meta ? JSON.stringify(patch.drive_meta) : null);
  if (!sets.length) return getContentItem(id);
  sets.push("updated_at = now()");
  args.push(id);
  const pool = await db();
  const r = await pool.query<ContentItem>(
    `update content_items set ${sets.join(", ")} where id = $${args.length}
     returning id, client_id, pillar_id, source_kind, title, theme_key, hook, angle, brief, script, transcript,
               caption_draft, tones, status, drive_url, drive_file_id, drive_meta,
               created_at::text as created_at, updated_at::text as updated_at`,
    args,
  );
  return r.rows[0] ?? null;
}

export async function deleteContentItem(id: string, clientId?: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const pool = await db();
  const r = clientId
    ? await pool.query("delete from content_items where id = $1 and client_id = $2", [id, clientId])
    : await pool.query("delete from content_items where id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Lista theme_keys recentes do cliente para bloqueio de repetição. */
export async function listRecentThemeKeys(clientId: string, limit = 200): Promise<string[]> {
  if (!isUuid(clientId)) return [];
  const pool = await db();
  const r = await pool.query<{ theme_key: string }>(
    `select theme_key from content_items
      where client_id = $1 and theme_key <> '' and status <> 'archived'
      order by created_at desc
      limit $2`,
    [clientId, limit],
  );
  return r.rows.map((x) => x.theme_key);
}

// ---------- Ativos Visuais e Slides ----------

export async function listVisualAssets(contentItemId: string): Promise<VisualAsset[]> {
  if (!isUuid(contentItemId)) return [];
  const pool = await db();
  const assets = await pool.query<Omit<VisualAsset, "slides">>(
    `select id, client_id, content_item_id, kind, title, aspect, status, generation_prompt, drive_folder_id, position
       from content_visual_assets
      where content_item_id = $1
      order by position asc, created_at asc`,
    [contentItemId],
  );
  if (!assets.rows.length) return [];
  const assetIds = assets.rows.map((a) => a.id);
  const slides = await pool.query<Slide & { asset_id: string }>(
    `select id, asset_id, position, headline, body, cta, visual_notes, extra, source,
            drive_url, drive_file_id, drive_meta
       from content_visual_asset_slides
      where asset_id = any($1::uuid[])
      order by asset_id, position asc`,
    [assetIds],
  );
  const byAsset = new Map<string, Slide[]>();
  for (const s of slides.rows) {
    const { asset_id, ...slide } = s;
    byAsset.set(asset_id, [...(byAsset.get(asset_id) ?? []), slide]);
  }
  return assets.rows.map((a) => ({ ...a, slides: byAsset.get(a.id) ?? [] }));
}

export async function getVisualAsset(id: string, clientId?: string): Promise<VisualAsset | null> {
  if (!isUuid(id) || (clientId !== undefined && !isUuid(clientId))) return null;
  const pool = await db();
  const sql = clientId
    ? `select id, client_id, content_item_id, kind, title, aspect, status, generation_prompt, drive_folder_id, position
         from content_visual_assets where id = $1 and client_id = $2`
    : `select id, client_id, content_item_id, kind, title, aspect, status, generation_prompt, drive_folder_id, position
         from content_visual_assets where id = $1`;
  const r = await pool.query<Omit<VisualAsset, "slides">>(sql, clientId ? [id, clientId] : [id]);
  const a = r.rows[0];
  if (!a) return null;
  const slides = await pool.query<Slide>(
    `select id, position, headline, body, cta, visual_notes, extra, source, drive_url, drive_file_id, drive_meta
       from content_visual_asset_slides
      where asset_id = $1
      order by position asc`,
    [a.id],
  );
  return { ...a, slides: slides.rows };
}

export async function createVisualAsset(
  clientId: string,
  contentItemId: string,
  input: {
    kind: AssetKind;
    title?: string;
    aspect?: AssetAspect;
    generation_prompt?: string;
    drive_folder_id?: string | null;
    slides: SlideInput[];
  },
): Promise<VisualAsset> {
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("begin");
    const posR = await c.query<{ next_pos: number }>(
      "select coalesce(max(position) + 1, 0)::int as next_pos from content_visual_assets where content_item_id = $1",
      [contentItemId],
    );
    const aR = await c.query<Omit<VisualAsset, "slides">>(
      `insert into content_visual_assets (client_id, content_item_id, kind, title, aspect, generation_prompt, drive_folder_id, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, client_id, content_item_id, kind, title, aspect, status, generation_prompt, drive_folder_id, position`,
      [
        clientId,
        contentItemId,
        input.kind,
        (input.title ?? "").trim(),
        input.aspect ?? "4:5",
        (input.generation_prompt ?? "").trim(),
        input.drive_folder_id ?? null,
        posR.rows[0]?.next_pos ?? 0,
      ],
    );
    const asset = aR.rows[0];
    const insertedSlides: Slide[] = [];
    for (const [i, s] of input.slides.entries()) {
      const sR = await c.query<Slide>(
        `insert into content_visual_asset_slides (asset_id, position, headline, body, cta, visual_notes, extra, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, position, headline, body, cta, visual_notes, extra, source, drive_url, drive_file_id, drive_meta`,
        [asset.id, i, s.headline, s.body, s.cta, s.visual_notes, JSON.stringify(s.extra ?? {}), s.source ?? "manual"],
      );
      insertedSlides.push(sR.rows[0]);
    }
    await c.query("commit");
    return { ...asset, slides: insertedSlides };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function updateVisualAsset(
  id: string,
  patch: {
    title?: string;
    aspect?: AssetAspect;
    status?: AssetStatus;
    drive_folder_id?: string | null;
    slides?: SlideInput[];
  },
): Promise<VisualAsset | null> {
  if (!isUuid(id)) return null;
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("begin");
    const sets: string[] = [];
    const args: unknown[] = [];
    const push = (col: string, val: unknown) => {
      args.push(val);
      sets.push(`${col} = $${args.length}`);
    };
    if (patch.title !== undefined) push("title", patch.title.trim());
    if (patch.aspect !== undefined) push("aspect", patch.aspect);
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.drive_folder_id !== undefined) push("drive_folder_id", patch.drive_folder_id);
    if (sets.length) {
      sets.push("updated_at = now()");
      args.push(id);
      const upd = await c.query(`update content_visual_assets set ${sets.join(", ")} where id = $${args.length} returning id`, args);
      if (!upd.rowCount) {
        await c.query("rollback");
        return null;
      }
    }

    if (patch.slides) {
      const keepIds = patch.slides.map((s) => s.id).filter((x): x is string => isUuid(x));
      if (keepIds.length) {
        await c.query(
          "delete from content_visual_asset_slides where asset_id = $1 and not (id = any($2::uuid[]))",
          [id, keepIds],
        );
      } else {
        await c.query("delete from content_visual_asset_slides where asset_id = $1", [id]);
      }

      for (const [i, s] of patch.slides.entries()) {
        if (s.id) {
          await c.query(
            `update content_visual_asset_slides
                set position = $1, headline = $2, body = $3, cta = $4, visual_notes = $5,
                    extra = $6, source = $7, updated_at = now()
              where id = $8 and asset_id = $9`,
            [i, s.headline, s.body, s.cta, s.visual_notes, JSON.stringify(s.extra ?? {}), s.source ?? "manual", s.id, id],
          );
        } else {
          await c.query(
            `insert into content_visual_asset_slides (asset_id, position, headline, body, cta, visual_notes, extra, source)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, i, s.headline, s.body, s.cta, s.visual_notes, JSON.stringify(s.extra ?? {}), s.source ?? "manual"],
          );
        }
      }
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return getVisualAsset(id);
}

export async function deleteVisualAsset(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const pool = await db();
  const r = await pool.query("delete from content_visual_assets where id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function setSlideFile(
  assetId: string,
  slideId: string,
  file: { drive_url: string; drive_file_id: string | null; drive_meta: MediaMeta | null },
): Promise<Slide | null> {
  if (!isUuid(assetId) || !isUuid(slideId)) return null;
  const pool = await db();
  const r = await pool.query<Slide>(
    `update content_visual_asset_slides
        set drive_url = $1, drive_file_id = $2, drive_meta = $3, updated_at = now()
      where id = $4 and asset_id = $5
      returning id, position, headline, body, cta, visual_notes, extra, source, drive_url, drive_file_id, drive_meta`,
    [file.drive_url, file.drive_file_id, file.drive_meta ? JSON.stringify(file.drive_meta) : null, slideId, assetId],
  );
  return r.rows[0] ?? null;
}

// ---------- Agenda Editorial ----------

const SLOT_SELECT = `
  select s.id, s.client_id, s.content_item_id, s.asset_id,
         to_char(s.planned_day, 'YYYY-MM-DD') as day,
         to_char(s.planned_time, 'HH24:MI') as time,
         s.position, s.network, s.format, s.status,
         i.title as item_title, i.source_kind as item_source_kind, i.status as item_status,
         i.pillar_id as item_pillar_id, p.name as item_pillar_name, p.color as item_pillar_color,
         a.kind as asset_kind, a.title as asset_title,
         t.id as target_id, t.status as target_status, t.publish_state as target_publish_state,
         (t.auto_confirmed_at is not null) as target_auto_confirmed,
         (s.post_target_id is null and s.status = 'planned' and s.planned_day < (now() at time zone '${TZ}')::date) as late
    from editorial_schedule s
    join content_items i on i.id = s.content_item_id
    left join content_pillars p on p.id = i.pillar_id
    left join content_visual_assets a on a.id = s.asset_id
    left join post_targets t on t.id = s.post_target_id`;

type SlotSqlRow = {
  id: string;
  client_id: string;
  content_item_id: string;
  asset_id: string | null;
  day: string;
  time: string | null;
  position: number;
  network: string;
  format: string;
  status: "planned" | "skipped";
  item_title: string;
  item_source_kind: ContentSourceKind;
  item_status: ContentStatus;
  item_pillar_id: string | null;
  item_pillar_name: string | null;
  item_pillar_color: string | null;
  asset_kind: AssetKind | null;
  asset_title: string | null;
  target_id: string | null;
  target_status: "draft" | "scheduled" | "posted" | null;
  target_publish_state: string | null;
  target_auto_confirmed: boolean | null;
  late: boolean;
};

function mapSlotRow(r: SlotSqlRow): SlotView {
  return {
    id: r.id,
    client_id: r.client_id,
    content_item_id: r.content_item_id,
    asset_id: r.asset_id,
    day: r.day,
    time: r.time,
    position: r.position,
    network: r.network,
    format: r.format,
    status: r.status,
    item: {
      title: r.item_title,
      source_kind: r.item_source_kind,
      status: r.item_status,
      pillar_id: r.item_pillar_id,
      pillar_name: r.item_pillar_name,
      pillar_color: r.item_pillar_color,
    },
    asset: r.asset_id && r.asset_kind ? { id: r.asset_id, kind: r.asset_kind, title: r.asset_title ?? "" } : null,
    target:
      r.target_id && r.target_status
        ? {
            id: r.target_id,
            status: r.target_status,
            publish_state: r.target_publish_state ?? "idle",
            auto_confirmed: !!r.target_auto_confirmed,
          }
        : null,
    late: r.late,
  };
}

export async function listEditorialSlots(opts: {
  clientId: string;
  from?: string;
  to?: string;
  contentItemId?: string;
}): Promise<SlotView[]> {
  if (!isUuid(opts.clientId)) return [];
  const where: string[] = ["s.client_id = $1"];
  const args: unknown[] = [opts.clientId];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("$$", `$${args.length}`));
  };
  if (opts.from) add("s.planned_day >= $$::date", opts.from);
  if (opts.to) add("s.planned_day <= $$::date", opts.to);
  if (opts.contentItemId && isUuid(opts.contentItemId)) add("s.content_item_id = $$", opts.contentItemId);
  const pool = await db();
  const r = await pool.query<SlotSqlRow>(
    `${SLOT_SELECT} where ${where.join(" and ")} order by s.planned_day asc, s.position asc, s.planned_time asc nulls last, s.created_at asc`,
    args,
  );
  return r.rows.map(mapSlotRow);
}

export async function getEditorialSlot(id: string, clientId?: string): Promise<SlotView | null> {
  if (!isUuid(id) || (clientId !== undefined && !isUuid(clientId))) return null;
  const pool = await db();
  const sql = clientId
    ? `${SLOT_SELECT} where s.id = $1 and s.client_id = $2`
    : `${SLOT_SELECT} where s.id = $1`;
  const r = await pool.query<SlotSqlRow>(sql, clientId ? [id, clientId] : [id]);
  return r.rows[0] ? mapSlotRow(r.rows[0]) : null;
}

export async function createEditorialSlot(
  clientId: string,
  input: {
    content_item_id: string;
    asset_id?: string | null;
    planned_day: string;
    planned_time?: string | null;
    position?: number;
    network: string;
    format: string;
  },
): Promise<SlotView> {
  const pool = await db();
  const r = await pool.query<{ id: string }>(
    `insert into editorial_schedule (client_id, content_item_id, asset_id, planned_day, planned_time, position, network, format)
     values ($1, $2, $3, $4::date, $5::time, $6, $7, $8)
     returning id`,
    [
      clientId,
      input.content_item_id,
      input.asset_id ?? null,
      input.planned_day,
      input.planned_time ?? null,
      input.position ?? 0,
      input.network,
      input.format,
    ],
  );
  const slot = await getEditorialSlot(r.rows[0].id, clientId);
  if (!slot) throw new Error("Falha ao carregar o horário criado.");
  return slot;
}

export async function updateEditorialSlot(
  id: string,
  patch: Partial<{
    planned_day: string;
    planned_time: string | null;
    position: number;
    network: string;
    format: string;
    asset_id: string | null;
    status: "planned" | "skipped";
  }>,
): Promise<SlotView | null> {
  if (!isUuid(id)) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown, cast = "") => {
    args.push(val);
    sets.push(`${col} = $${args.length}${cast}`);
  };
  if (patch.planned_day !== undefined) push("planned_day", patch.planned_day, "::date");
  if (patch.planned_time !== undefined) push("planned_time", patch.planned_time, "::time");
  if (patch.position !== undefined) push("position", patch.position);
  if (patch.network !== undefined) push("network", patch.network);
  if (patch.format !== undefined) push("format", patch.format);
  if (patch.asset_id !== undefined) push("asset_id", patch.asset_id);
  if (patch.status !== undefined) push("status", patch.status);
  if (!sets.length) return getEditorialSlot(id);
  sets.push("updated_at = now()");
  args.push(id);
  const pool = await db();
  const r = await pool.query<{ id: string }>(
    `update editorial_schedule set ${sets.join(", ")} where id = $${args.length} and post_target_id is null returning id`,
    args,
  );
  if (!r.rowCount) return null;
  return getEditorialSlot(id);
}

export async function deleteEditorialSlot(id: string): Promise<"deleted" | "not_found" | "in_queue"> {
  if (!isUuid(id)) return "not_found";
  const pool = await db();
  const existing = await pool.query<{ post_target_id: string | null }>(
    "select post_target_id from editorial_schedule where id = $1",
    [id],
  );
  if (!existing.rows[0]) return "not_found";
  if (existing.rows[0].post_target_id) return "in_queue";
  await pool.query("delete from editorial_schedule where id = $1 and post_target_id is null", [id]);
  return "deleted";
}

/** Reordena dia/horário/posição de múltiplos slots do cliente numa única transação (bloqueia slots já na fila). */
export async function reorderEditorialSlots(
  clientId: string,
  moves: { slot_id: string; planned_day: string; planned_time?: string | null; position: number }[],
): Promise<{ ok: true; slots: SlotView[] } | { ok: false; status: 404 | 409; error: string }> {
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const m of moves) {
      const check = await c.query<{ post_target_id: string | null }>(
        "select post_target_id from editorial_schedule where id = $1 and client_id = $2 for update",
        [m.slot_id, clientId],
      );
      if (!check.rows[0]) {
        await c.query("rollback");
        return { ok: false, status: 404, error: "Horário planejado não encontrado." };
      }
      if (check.rows[0].post_target_id) {
        await c.query("rollback");
        return { ok: false, status: 409, error: "Um dos horários já foi enviado para a fila e não pode ser movido." };
      }
      if (m.planned_time !== undefined) {
        await c.query(
          `update editorial_schedule
              set planned_day = $1::date, planned_time = $2::time, position = $3, updated_at = now()
            where id = $4 and client_id = $5`,
          [m.planned_day, m.planned_time, m.position, m.slot_id, clientId],
        );
      } else {
        await c.query(
          `update editorial_schedule
              set planned_day = $1::date, position = $2, updated_at = now()
            where id = $3 and client_id = $4`,
          [m.planned_day, m.position, m.slot_id, clientId],
        );
      }
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  const updated: SlotView[] = [];
  for (const m of moves) {
    const s = await getEditorialSlot(m.slot_id, clientId);
    if (s) updated.push(s);
  }
  return { ok: true, slots: updated };
}
