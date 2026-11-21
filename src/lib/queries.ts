import { db } from "./db";
import type { MediaMeta } from "./checks";
import { TZ } from "./dates";

export type Client = {
  id: string;
  name: string;
  segment: string;
  site: string;
  tone: string;
  notes: string;
  drive_folder_url: string;
  drive_folder_id: string | null;
  /** Versão do logo guardado (segundos), ou null se o cliente não tem logo. Usada só para renovar o cache. */
  logo_v: number | null;
  /** Arquivo do logo no Drive (o app guarda só uma cópia reduzida). */
  logo_file_id: string | null;
};

export type ClientNetwork = { network: string; account_name: string; profile_url: string };

export type Target = {
  id: string;
  post_id: string;
  client_id: string;
  client_name: string;
  /** Pasta do cliente no Drive (raiz). */
  drive_folder_id: string | null;
  /** Pasta deste destino no Drive (dia / rede / formato), quando já foi criada ou encontrada. */
  post_folder_id: string | null;
  title: string;
  idea: string;
  network: string;
  format: string;
  day: string;
  time: string;
  caption: string;
  status: "draft" | "scheduled" | "posted";
  drive_url: string;
  drive_file_id: string | null;
  drive_meta: MediaMeta | null;
  thumb_url: string;
  thumb_file_id: string | null;
  thumb_meta: MediaMeta | null;
  late: boolean;
  publish_state: "idle" | "publishing" | "published" | "failed";
  external_id: string | null;
  external_url: string;
  publish_error: string;
};

const TARGET_SELECT = `
  select t.id, t.post_id, p.client_id, c.name as client_name, c.drive_folder_id, t.post_folder_id,
         p.title, p.idea, t.network, t.format,
         to_char(t.scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day,
         to_char(t.scheduled_at at time zone '${TZ}', 'HH24:MI') as time,
         t.caption, t.status, t.drive_url, t.drive_file_id, t.drive_meta,
         t.thumb_url, t.thumb_file_id, t.thumb_meta,
         (t.status <> 'posted' and t.scheduled_at < now()) as late,
         case when t.publish_state = 'publishing' and t.publish_started_at < now() - interval '15 minutes'
              then 'failed' else t.publish_state end as publish_state,
         t.external_id, t.external_url,
         case when t.publish_state = 'publishing' and t.publish_started_at < now() - interval '15 minutes'
              then 'A publicação não terminou (o app pode ter reiniciado). Confira na rede antes de tentar de novo.'
              else t.publish_error end as publish_error
  from post_targets t
  join posts p on p.id = t.post_id
  join clients c on c.id = p.client_id`;

export async function listClients(): Promise<(Client & { networks: string[]; upcoming: number })[]> {
  const pool = await db();
  const r = await pool.query(
    `select c.*,
        (select extract(epoch from l.updated_at)::int from client_logos l where l.client_id = c.id) as logo_v,
        coalesce((select array_agg(n.network order by n.network) from client_networks n where n.client_id = c.id), '{}') as networks,
        (select count(*)::int from post_targets t join posts p on p.id = t.post_id
          where p.client_id = c.id and t.status <> 'posted'
            and t.scheduled_at >= now() - interval '1 day' and t.scheduled_at < now() + interval '7 days') as upcoming
     from clients c order by c.name`,
  );
  return r.rows;
}

export async function getClient(id: string): Promise<{ client: Client; networks: ClientNetwork[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const pool = await db();
  const c = await pool.query<Client>(
    `select c.*, extract(epoch from l.updated_at)::int as logo_v, l.file_id as logo_file_id
       from clients c left join client_logos l on l.client_id = c.id where c.id = $1`,
    [id],
  );
  if (!c.rows[0]) return null;
  const n = await pool.query<ClientNetwork>(
    "select network, account_name, profile_url from client_networks where client_id = $1 order by network",
    [id],
  );
  return { client: c.rows[0], networks: n.rows };
}

export type TargetFilter = {
  clientId?: string;
  from?: string; // dia local, inclusive
  to?: string; // dia local, inclusive
  network?: string;
  status?: string;
  /** só o que ainda não foi postado e vence até este dia (inclusive) */
  dueUntil?: string;
  targetId?: string;
};

export async function listTargets(f: TargetFilter): Promise<Target[]> {
  const pool = await db();
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("$$", `$${args.length}`));
  };
  if (f.targetId) add("t.id = $$", f.targetId);
  if (f.clientId) add("p.client_id = $$", f.clientId);
  if (f.from) add(`t.scheduled_at >= ($$::date)::timestamp at time zone '${TZ}'`, f.from);
  if (f.to) add(`t.scheduled_at < (($$::date + 1)::timestamp) at time zone '${TZ}'`, f.to);
  if (f.network) add("t.network = $$", f.network);
  if (f.status) add("t.status = $$", f.status);
  if (f.dueUntil) {
    where.push("t.status <> 'posted'");
    add(`t.scheduled_at < (($$::date + 1)::timestamp) at time zone '${TZ}'`, f.dueUntil);
  }
  const sql = `${TARGET_SELECT} ${where.length ? "where " + where.join(" and ") : ""} order by t.scheduled_at, t.network, t.format`;
  const r = await pool.query<Target>(sql, args);
  return r.rows;
}

export async function countDue(today: string): Promise<number> {
  const pool = await db();
  const r = await pool.query<{ n: number }>(
    `select count(*)::int as n from post_targets
      where status <> 'posted' and scheduled_at < (($1::date + 1)::timestamp) at time zone '${TZ}'`,
    [today],
  );
  return r.rows[0]?.n ?? 0;
}

/** O arquivo está ligado a algum post? Usado para não servir arquivos quaisquer do Drive. */
export async function fileIsLinked(fileId: string): Promise<{ name?: string } | null> {
  const pool = await db();
  const r = await pool.query<{ meta: MediaMeta | null }>(
    `select drive_meta as meta from post_targets where drive_file_id = $1
     union all
     select thumb_meta as meta from post_targets where thumb_file_id = $1
     limit 1`,
    [fileId],
  );
  if (!r.rows[0]) return null;
  return { name: r.rows[0].meta?.name };
}

/** Notas de planejamento por dia (texto livre, sem rede nem mídia), de `from` a `to` inclusive. */
export async function listDayNotes(clientId: string, from: string, to: string): Promise<Record<string, string>> {
  const pool = await db();
  const r = await pool.query<{ day: string; body: string }>(
    `select to_char(day, 'YYYY-MM-DD') as day, body from day_notes
      where client_id = $1 and day between $2::date and $3::date and body <> ''`,
    [clientId, from, to],
  );
  return Object.fromEntries(r.rows.map((x) => [x.day, x.body]));
}

export async function getClientLogo(id: string): Promise<{ png: Buffer; v: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const pool = await db();
  const r = await pool.query<{ png: Buffer; v: number }>(
    "select png, extract(epoch from updated_at)::int as v from client_logos where client_id = $1",
    [id],
  );
  return r.rows[0] ?? null;
}

export type Connection = { account_id: string; account_name: string; page_id: string | null; token_enc: string };

/** Conta conectada do cliente numa rede (ou null). O token vem criptografado: use decryptToken. */
export async function getConnection(clientId: string, network: string): Promise<Connection | null> {
  const pool = await db();
  const r = await pool.query<Connection>(
    "select account_id, account_name, page_id, token_enc from network_connections where client_id = $1 and network = $2",
    [clientId, network],
  );
  return r.rows[0] ?? null;
}

/** Quais redes do cliente têm conta conectada (sem trazer o token). */
export async function listConnected(clientId: string): Promise<Record<string, string>> {
  const pool = await db();
  const r = await pool.query<{ network: string; account_name: string }>(
    "select network, account_name from network_connections where client_id = $1",
    [clientId],
  );
  return Object.fromEntries(r.rows.map((x) => [x.network, x.account_name]));
}
