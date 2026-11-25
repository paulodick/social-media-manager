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
  {
    version: 13,
    sql: `
      -- Módulo Criação e Planejamento Editorial Inteligente (somente aditiva).
      create table content_pillars (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        name text not null check (length(btrim(name)) between 1 and 80),
        description text not null default '',
        color text not null default '#596579' check (color ~ '^#[0-9a-fA-F]{6}$'),
        weight_pct int not null default 0 check (weight_pct between 0 and 100),
        weekly_target int check (weekly_target is null or weekly_target between 0 and 21),
        position int not null default 0,
        archived_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (client_id, name)
      );
      create index content_pillars_client_idx
        on content_pillars (client_id, position)
        where archived_at is null;

      create table content_items (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        pillar_id uuid references content_pillars(id) on delete set null,
        source_kind text not null default 'needs_creation'
          check (source_kind in ('existing_ready', 'needs_creation')),
        title text not null check (length(btrim(title)) between 1 and 160),
        theme_key text not null default '',
        hook text not null default '',
        angle text not null default '',
        brief text not null default '',
        script text not null default '',
        transcript text not null default '',
        caption_draft text not null default '',
        tones text[] not null default '{}',
        status text not null default 'idea'
          check (status in ('idea', 'drafting', 'ready', 'archived')),
        drive_url text not null default '',
        drive_file_id text,
        drive_meta jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index content_items_client_idx
        on content_items (client_id, status, source_kind, created_at desc);
      create index content_items_pillar_idx
        on content_items (pillar_id);
      create unique index content_items_drive_file_uq
        on content_items (client_id, drive_file_id)
        where drive_file_id is not null;

      create table content_visual_assets (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        content_item_id uuid not null references content_items(id) on delete cascade,
        kind text not null check (kind in ('carousel', 'static')),
        title text not null default '',
        aspect text not null default '4:5' check (aspect in ('4:5', '1:1', '9:16', '16:9')),
        status text not null default 'draft' check (status in ('draft', 'ready', 'approved')),
        generation_prompt text not null default '',
        drive_folder_id text,
        position int not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index content_visual_assets_item_idx
        on content_visual_assets (content_item_id, position);
      create index content_visual_assets_client_idx
        on content_visual_assets (client_id);

      create table content_visual_asset_slides (
        id uuid primary key default gen_random_uuid(),
        asset_id uuid not null references content_visual_assets(id) on delete cascade,
        position int not null,
        headline text not null default '',
        body text not null default '',
        cta text not null default '',
        visual_notes text not null default '',
        extra jsonb not null default '{}'::jsonb,
        source text not null default 'manual' check (source in ('manual', 'ai')),
        drive_url text not null default '',
        drive_file_id text,
        drive_meta jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (asset_id, position) deferrable initially deferred
      );
      create index content_visual_asset_slides_file_idx
        on content_visual_asset_slides (drive_file_id)
        where drive_file_id is not null;

      create table editorial_schedule (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references clients(id) on delete cascade,
        content_item_id uuid not null references content_items(id) on delete cascade,
        asset_id uuid references content_visual_assets(id) on delete set null,
        planned_day date not null,
        planned_time time,
        position int not null default 0,
        network text not null,
        format text not null,
        status text not null default 'planned' check (status in ('planned', 'skipped')),
        post_target_id uuid references post_targets(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (content_item_id, network, format, planned_day)
      );
      create index editorial_schedule_day_idx
        on editorial_schedule (client_id, planned_day, position);
      create unique index editorial_schedule_target_uq
        on editorial_schedule (post_target_id)
        where post_target_id is not null;
    `,
  },
  {
    version: 14,
    sql: `
      -- 14: Memória contínua por cliente (workspace_ai_memory), diretrizes de tom IA, roteiros de vídeo estruturados e aprovação de cronograma.
      alter table clients add column if not exists ai_style_notes text not null default '';

      alter table content_items
        add column if not exists content_format text not null default 'video'
          check (content_format in ('video', 'carousel', 'static_image')),
        add column if not exists script_hook text not null default '',
        add column if not exists script_dev text not null default '',
        add column if not exists script_cta text not null default '';

      alter table editorial_schedule
        add column if not exists plan_status text not null default 'draft'
          check (plan_status in ('draft', 'approved')),
        add column if not exists approved_at timestamptz;

      create table if not exists workspace_ai_memory (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references clients(id) on delete cascade,
        event_type text not null check (event_type in (
          'topic_approved',
          'topic_rejected',
          'caption_generated',
          'caption_edited_on_publish',
          'post_scheduled',
          'schedule_reordered',
          'schedule_approved',
          'style_note'
        )),
        pillar_id uuid references content_pillars(id) on delete set null,
        format text not null default '',
        content_summary text not null default '',
        user_feedback_or_diff text not null default '',
        created_at timestamptz not null default now()
      );
      create index if not exists workspace_ai_memory_ws_idx
        on workspace_ai_memory (workspace_id, created_at desc);
    `,
  },
  {
    version: 15,
    sql: `
      -- 15: Adiciona eventos topic_recreated e draft_refined à memória contínua por cliente.
      alter table workspace_ai_memory drop constraint if exists workspace_ai_memory_event_type_check;
      alter table workspace_ai_memory add constraint workspace_ai_memory_event_type_check
        check (event_type in (
          'topic_approved',
          'topic_rejected',
          'topic_recreated',
          'draft_refined',
          'caption_generated',
          'caption_edited_on_publish',
          'post_scheduled',
          'schedule_reordered',
          'schedule_approved',
          'style_note'
        ));
    `,
  },
  {
    version: 16,
    sql: `
      -- 16: Proteção contra duplicata na criação de post (duplo clique no formulário).
      alter table posts add column if not exists submission_id uuid;
      create unique index if not exists posts_submission_id_uq
        on posts (submission_id)
        where submission_id is not null;
    `,
  },
  {
    version: 17,
    sql: `
      -- 17: Metadados de pastas de corte do Drive (convidado, assunto, capa, .doc e legendas por rede).
      alter table content_items
        add column if not exists guest_name text not null default '',
        add column if not exists topic_tag text not null default '',
        add column if not exists cover_idea text not null default '',
        add column if not exists cover_drive_file_id text,
        add column if not exists cover_drive_url text not null default '',
        add column if not exists doc_drive_file_id text,
        add column if not exists source_folder_id text,
        add column if not exists source_folder_name text not null default '',
        add column if not exists caption_instagram text not null default '',
        add column if not exists caption_linkedin text not null default '';

      create unique index if not exists content_items_source_folder_uq
        on content_items (client_id, source_folder_id)
        where source_folder_id is not null;
    `,
  },
  {
    version: 18,
    sql: `
      -- 18: Sequência de postagem montada pela IA (vídeos prontos de "Reels Editados" + ideias novas + dias sem post).
      -- Pasta "Vídeo N" original (para voltar) e para onde o app a moveu ao aprovar.
      alter table content_items
        add column if not exists ready_folder_parent_id text,
        add column if not exists ready_folder_moved_to text;
      -- Por que a IA pôs esse conteúdo nesse dia, e se era vídeo pronto ou pauta nova.
      alter table editorial_schedule
        add column if not exists ai_reason text not null default '',
        add column if not exists sequence_kind text not null default ''
          check (sequence_kind in ('', 'ready', 'new'));
      -- Dias em que a IA sugeriu NÃO postar (com o motivo).
      create table if not exists editorial_sequence_skips (
        client_id uuid not null references clients(id) on delete cascade,
        day date not null,
        reason text not null default '',
        created_at timestamptz not null default now(),
        primary key (client_id, day)
      );
    `,
  },
  {
    version: 19,
    sql: `
      -- 19: "Sincronizar conteúdos": ficha de cada vídeo pronto feita pela IA na sincronização (tema, resumo, pilar,
      -- público, gancho, legendas), impressão digital da transcrição (só refaz quando muda) e avisos de qualidade.
      alter table content_items
        add column if not exists ai_profile jsonb,
        add column if not exists ai_profile_hash text,
        add column if not exists quality_flags text[] not null default '{}';
      -- Última sincronização da pasta "Reels Editados" (o Editorial sincroniza sozinho se passou de um dia).
      alter table clients add column if not exists ready_synced_at timestamptz;
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
