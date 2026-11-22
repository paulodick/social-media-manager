import { Pool } from "pg";

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      create table clients (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        segment text not null default '',
        site text not null default '',
        tone text not null default '',
        notes text not null default '',
        drive_folder_url text not null default '',
        drive_folder_id text,
        created_at timestamptz not null default now()
      );
      create table client_networks (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        network text not null,
        account_name text not null default '',
        profile_url text not null default '',
        unique (client_id, network)
      );
      create table posts (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        title text not null default '',
        idea text not null default '',
        created_at timestamptz not null default now()
      );
      create table post_targets (
        id uuid primary key default gen_random_uuid(),
        post_id uuid not null references posts(id) on delete cascade,
        network text not null,
        format text not null,
        scheduled_at timestamptz not null,
        caption text not null default '',
        status text not null default 'draft' check (status in ('draft','scheduled','posted')),
        posted_at timestamptz,
        drive_url text not null default '',
        drive_file_id text,
        drive_meta jsonb,
        created_at timestamptz not null default now()
      );
      create index post_targets_scheduled_idx on post_targets (scheduled_at);
      create index post_targets_post_idx on post_targets (post_id);
    `,
  },
  {
    version: 2,
    sql: `
      create table app_settings (
        key text primary key,
        value text not null,
        updated_at timestamptz not null default now()
      );
    `,
  },
  {
    version: 3,
    sql: `
      alter table post_targets add column post_folder_id text;
    `,
  },
  {
    version: 4,
    sql: `
      create table day_notes (
        client_id uuid not null references clients(id) on delete cascade,
        day date not null,
        body text not null default '',
        updated_at timestamptz not null default now(),
        primary key (client_id, day)
      );
    `,
  },
  {
    version: 5,
    sql: `
      create table client_logos (
        client_id uuid primary key references clients(id) on delete cascade,
        file_id text not null,
        png bytea not null,
        updated_at timestamptz not null default now()
      );
    `,
  },
  {
    version: 6,
    sql: `
      alter table post_targets add column thumb_url text not null default '';
      alter table post_targets add column thumb_file_id text;
      alter table post_targets add column thumb_meta jsonb;
    `,
  },
  {
    version: 7,
    sql: `
      create table network_connections (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        network text not null,
        account_id text not null,
        account_name text not null default '',
        page_id text,
        token_enc text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (client_id, network)
      );
      alter table post_targets add column publish_state text not null default 'idle'
        check (publish_state in ('idle','publishing','published','failed'));
      alter table post_targets add column publish_started_at timestamptz;
      alter table post_targets add column external_id text;
      alter table post_targets add column external_url text not null default '';
      alter table post_targets add column publish_error text not null default '';
    `,
  },
  {
    version: 8,
    sql: `
      -- Título próprio de cada destino (YouTube, documento do LinkedIn...). posts.title passa a ser só o nome interno do post.
      alter table post_targets add column title text not null default '';
      update post_targets t set title = p.title from posts p where p.id = t.post_id and t.network = 'youtube';
    `,
  },
  {
    version: 9,
    sql: `
      -- Tons de voz escolhidos por post (ids de src/config/tones.ts, na ordem de prioridade). Só acrescenta a coluna.
      alter table posts add column tones text[] not null default '{}';
    `,
  },
  {
    version: 10,
    sql: `
      -- Vencimento do acesso guardado (LinkedIn: 60 dias, sem renovação automática). Null = não vence (token da Página da Meta).
      alter table network_connections add column expires_at timestamptz;
    `,
  },
  {
    version: 11,
    sql: `
      -- TikTok: o acesso dura poucas horas e é renovado com um token de renovação (que gira a cada uso).
      -- expires_at passa a guardar o vencimento da autorização (do token de renovação); access_expires_at, o do acesso.
      alter table network_connections add column refresh_token_enc text;
      alter table network_connections add column access_expires_at timestamptz;
      -- Novo estado de publicação: "drafted" = enviado como rascunho para a caixa de entrada da rede (TikTok).
      alter table post_targets drop constraint post_targets_publish_state_check;
      alter table post_targets add constraint post_targets_publish_state_check
        check (publish_state in ('idle','publishing','published','failed','drafted'));
    `,
  },
  {
    version: 12,
    sql: `
      -- Publicação automática por horário: só publica sozinho o destino que a pessoa CONFIRMOU (auto_confirmed_at).
      -- Nulo = não confirmado (o padrão, inclusive para tudo o que já existia). auto_notified_at evita avisar duas vezes.
      alter table post_targets add column auto_confirmed_at timestamptz;
      alter table post_targets add column auto_notified_at timestamptz;
      create index post_targets_auto_idx on post_targets (scheduled_at) where auto_confirmed_at is not null;
    `,
  },
];

type G = typeof globalThis & { _smmPool?: Pool; _smmReady?: Promise<void> };
const g = globalThis as G;

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não está definida.");
  return new Pool({
    connectionString: url,
    max: 5,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await client.query(
      "create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())",
    );
    const done = await client.query<{ version: number }>("select version from schema_migrations");
    const applied = new Set(done.rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migrations (version) values ($1)", [m.version]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}

/** Devolve o pool já com o banco migrado. */
export async function db(): Promise<Pool> {
  if (!g._smmPool) g._smmPool = makePool();
  if (!g._smmReady) {
    g._smmReady = migrate(g._smmPool).catch((e) => {
      g._smmReady = undefined;
      throw e;
    });
  }
  await g._smmReady;
  return g._smmPool;
}
