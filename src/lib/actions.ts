"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkPassword, createSession, destroySession, hasPassword, requireAuth } from "./auth";
import { checkLoginRateLimit, extractClientIp, recordLoginFailure, resetLoginRateLimit } from "./login-rate-limit";
import { hashPassword, passwordProblem } from "./password";
import { db } from "./db";
import { TZ, isDay, isTime, monthOf } from "./dates";
import { ensureClientFolders, ensureFolderPath, folderUrl, getFolderName, listSiblingImages, parseDriveUrl, runDriveMoveTest, type MoveTestResult } from "./drive";
import { MAX_COLLABS, MAX_USER_TAGS, formatHandles, parseHandles } from "./ig-people";
import { ensureTargetFolders, folderNames, resolveDrive } from "./post-folders";
import { formatMovedTargetsNotice, resolveEditRedirect } from "./post-redirect";
import { insertPostIdempotent, parseSubmissionId } from "./post-submission";
import { resolveDayNoteSave } from "./day-note";
import { getDriveRoot, setDriveRoot } from "./drive-root";
import { activeAiProvider, generateText, type AiResult } from "./ai";
import { buildMemoryBlock, listRecentAiMemory, recordAiMemory, summarizeCaptionDiff } from "./ai-memory";
import { generateGeminiText } from "./editorial-ai";
import { buildCaptionPrompt } from "./prompt";
import { autoBlocker, checkPublishable, startPublish } from "./publisher";
import { canAutoSchedule } from "./auto-publish";
import { returnReadyFolders, syncPostedFolders } from "./editorial-sequence-store";
import { listTargets } from "./queries";
import { removeMetaConnections, removeLinkedinConnection, removeTiktokConnection, saveMetaConnections } from "./connections";
import { revokeAccess, tiktokConfig } from "./publish/tiktok-oauth";
import { clearPending, readPending } from "./meta-pending";
import { listPages } from "./publish/meta-oauth";
import { fetchLogo } from "./logo";
import type { MediaMeta } from "./checks";
import { canMarkPosted, deleteTargetBlocker, isUndoableStatus, isValidUuid } from "./target-rules";
import { validateTones } from "@/config/tones";
import { NETWORKS, NETWORK_IDS, folderGroup, hasTitle, isFormat, isNetwork } from "@/config/networks";

const text = (f: FormData, k: string, max = 5000): string => String(f.get(k) ?? "").trim().slice(0, max);

function safePath(p: string, fallback: string): string {
  return p.startsWith("/") && !p.startsWith("//") ? p : fallback;
}

function withParam(path: string, key: string, value: string): string {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${key}=${encodeURIComponent(value)}${hash ? "#" + hash : ""}`;
}

// ---------- acesso ----------

export async function login(formData: FormData): Promise<void> {
  const ip = extractClientIp(await headers());
  const gate = checkLoginRateLimit(ip);
  if (!gate.allowed) {
    await new Promise((r) => setTimeout(r, 600));
    redirect("/login?erro=1");
  }
  const ok = await checkPassword(text(formData, "senha", 200));
  if (!ok) {
    const { delayMs } = recordLoginFailure(ip);
    await new Promise((r) => setTimeout(r, delayMs));
    redirect("/login?erro=1");
  }
  resetLoginRateLimit(ip);
  await createSession();
  redirect("/");
}

// Primeira configuração: só funciona enquanto ainda não existe senha. O insert com
// "on conflict do nothing" garante que, mesmo com dois envios ao mesmo tempo, só um vence.
export async function setupPassword(formData: FormData): Promise<void> {
  if (await hasPassword()) redirect("/login");
  const senha = String(formData.get("senha") ?? "");
  const confirma = String(formData.get("confirma") ?? "");
  const problem = passwordProblem(senha, confirma);
  if (problem) redirect(`/configurar?erro=${encodeURIComponent(problem)}`);
  const r = await (await db()).query(
    "insert into app_settings (key, value) values ('password_hash', $1) on conflict (key) do nothing",
    [hashPassword(senha)],
  );
  if (r.rowCount === 0) redirect("/login");
  await createSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// ---------- clientes ----------

/**
 * Mantém o logo do cliente de acordo com o link informado. Devolve um erro em português se não deu,
 * e nesse caso o logo anterior (se houver) continua valendo. Link vazio remove o logo.
 */
async function syncLogo(clientId: string, logoUrl: string): Promise<string | null> {
  const pool = await db();
  if (!logoUrl) {
    await pool.query("delete from client_logos where client_id = $1", [clientId]);
    return null;
  }
  const ref = parseDriveUrl(logoUrl);
  if (!ref || ref.kind === "folder") return "o link do logotipo precisa ser de um arquivo do Google Drive, não de uma pasta.";
  const res = await fetchLogo(ref.id);
  if ("error" in res) return res.error;
  await pool.query(
    `insert into client_logos (client_id, file_id, png) values ($1,$2,$3)
     on conflict (client_id) do update set file_id = excluded.file_id, png = excluded.png, updated_at = now()`,
    [clientId, ref.id, res.png],
  );
  return null;
}

export async function saveClient(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
  const name = text(formData, "name", 120);
  const back = id ? `/clientes/${id}/editar` : "/clientes/novo";
  if (!name) redirect(withParam(back, "erro", "Informe o nome do cliente."));

  const folderUrl = text(formData, "drive_folder_url", 500);
  const ref = parseDriveUrl(folderUrl);
  if (folderUrl && (!ref || ref.kind === "file")) {
    redirect(withParam(back, "erro", "O link da pasta do Drive não parece ser de uma pasta."));
  }

  const pool = await db();
  const c = await pool.connect();
  let clientId = id;
  try {
    await c.query("begin");
    const vals = [
      name,
      text(formData, "segment", 120),
      text(formData, "site", 300),
      text(formData, "tone", 4000),
      text(formData, "notes", 4000),
      folderUrl,
      ref?.id ?? null,
    ];
    if (id) {
      const r = await c.query(
        `update clients set name=$1, segment=$2, site=$3, tone=$4, notes=$5, drive_folder_url=$6, drive_folder_id=$7 where id=$8`,
        [...vals, id],
      );
      if (!r.rowCount) throw new Error("Cliente não encontrado.");
    } else {
      const r = await c.query<{ id: string }>(
        `insert into clients (name, segment, site, tone, notes, drive_folder_url, drive_folder_id)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        vals,
      );
      clientId = r.rows[0].id;
    }
    const selected: string[] = [];
    for (const n of NETWORK_IDS) {
      if (formData.get(`net_${n}`) !== "on") continue;
      selected.push(n);
      await c.query(
        `insert into client_networks (client_id, network, account_name, profile_url) values ($1,$2,$3,$4)
         on conflict (client_id, network) do update set account_name = excluded.account_name, profile_url = excluded.profile_url`,
        [clientId, n, text(formData, `acc_${n}`, 120), text(formData, `url_${n}`, 300)],
      );
    }
    await c.query("delete from client_networks where client_id = $1 and not (network = any($2::text[]))", [clientId, selected]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  const logoError = await syncLogo(clientId, text(formData, "logo_url", 500));
  revalidatePath("/", "layout");
  redirect(
    logoError
      ? withParam(`/clientes/${clientId}`, "aviso", `O cliente foi salvo, mas o logotipo não: ${logoError}`)
      : `/clientes/${clientId}`,
  );
}

export type ClientFolderResult = { url: string; logoUrl: string } | { error: string };

/**
 * Botão "Criar diretório" do cadastro: cria no Drive a pasta do cliente (com a subpasta Logotipo) dentro da pasta
 * raiz dos clientes e devolve os endereços. Se a pasta já existe, só a reencontra. Não grava nada no banco:
 * o link volta para o campo do formulário e vale quando a pessoa salva o cliente.
 */
export async function createClientFolder(input: { name: string }): Promise<ClientFolderResult> {
  await requireAuth();
  const root = await getDriveRoot();
  if (!root) {
    return { error: "a pasta raiz dos clientes ainda não foi definida. Cole o link dela em Configurações, em \"Pasta dos clientes no Drive\"." };
  }
  const r = await ensureClientFolders(root, String(input.name ?? ""));
  if ("error" in r) return { error: r.error };
  return { url: folderUrl(r.folderId), logoUrl: folderUrl(r.logoFolderId) };
}

/** Guarda a pasta raiz dos clientes (onde o botão "Criar diretório" cria as pastas). Link vazio remove. */
export async function saveDriveRoot(formData: FormData): Promise<void> {
  await requireAuth();
  const url = text(formData, "drive_root_url", 500);
  if (!url) {
    await setDriveRoot(null);
    revalidatePath("/configuracoes");
    redirect("/configuracoes?ok=" + encodeURIComponent("Pasta raiz removida."));
  }
  const ref = parseDriveUrl(url);
  if (!ref || ref.kind === "file") redirect("/configuracoes?erro=" + encodeURIComponent("O link precisa ser de uma pasta do Google Drive."));
  const f = await getFolderName(ref.id);
  if ("error" in f) redirect("/configuracoes?erro=" + encodeURIComponent(`Não foi possível usar essa pasta: ${f.error}`));
  await setDriveRoot(ref.id);
  revalidatePath("/configuracoes");
  redirect("/configuracoes?ok=" + encodeURIComponent(`Pasta raiz definida: ${f.name}.`));
}

// ---------- posts ----------

type PreparedTarget = {
  network: string; format: string; day: string; time: string; caption: string; title: string;
  driveUrl: string; fileId: string | null; meta: MediaMeta | null;
  thumbUrl: string; thumbFileId: string | null; thumbMeta: MediaMeta | null;
  userTags: string[]; collaborators: string[];
};

/** Confere um link do Drive (arquivo) e devolve o id e os dados da mídia. Usado pela tela do post para mostrar a prévia antes de salvar. */
export async function inspectDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  await requireAuth();
  return resolveDrive(String(url ?? "").trim().slice(0, 500));
}

/**
 * Capas candidatas para o vídeo: imagens na MESMA pasta do vídeo no Drive (é onde quem corta deixa a capa).
 * As que têm "capa", "cover" ou "thumb" no nome vêm primeiro. Só lê nomes e tamanhos.
 */
export async function findCoverCandidates(url: string): Promise<{ name: string; url: string }[]> {
  await requireAuth();
  const { fileId } = await resolveDrive(String(url ?? "").trim().slice(0, 500));
  if (!fileId) return [];
  return listSiblingImages(fileId);
}

type ExistingTarget = {
  id: string; network: string; format: string; day: string; post_folder_id: string | null;
  drive_url: string; drive_file_id: string | null; drive_meta: MediaMeta | null;
  thumb_url: string; thumb_file_id: string | null; thumb_meta: MediaMeta | null;
  user_tags: string[]; collaborators: string[];
  /** Estava confirmado para publicar sozinho antes desta gravação. */
  confirmed: boolean;
  publish_state: string;
  caption: string;
  title: string;
  time: string;
};

/**
 * Grava o post inteiro (tela única de Novo post e de edição): ideia/planejamento do dia, nome, tons e descrição da
 * legenda, os destinos que o post já tem (campos `*__<id do destino>`) e os destinos novos marcados (`target`, campos
 * `*__rede:formato`). Sem `post_id` cria o post; com `post_id` atualiza. Os botões de situação mandam
 * `status=<id do destino>:<draft|scheduled|posted>`; o Salvar comum não mexe na situação.
 */
export async function savePost(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  const postId = text(formData, "post_id", 40);
  const editing = postId !== "";
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(clientId) || (editing && !uuid.test(postId))) redirect("/");
  const newPath = `/posts/novo?cliente=${encodeURIComponent(clientId)}`;
  const back = editing ? safePath(text(formData, "volta", 300), "/") : newPath;
  const fail = (msg: string): never => redirect(withParam(back, "erro", msg));

  const hasNoteField = formData.has("note");
  const note = hasNoteField ? text(formData, "note", 4000) : "";
  const noteDay = editing ? text(formData, "note_day", 10) : text(formData, "date", 10);
  if ((!editing || hasNoteField) && !isDay(noteDay)) fail("Informe uma data válida.");

  const keys = formData
    .getAll("target")
    .map(String)
    .map((v) => v.split(":"))
    .filter(([n, f]) => isNetwork(n) && isFormat(n, f))
    .map(([n, f]) => `${n}:${f}`);
  const newKeys = [...new Set(keys)];

  const pool = await db();
  const owner = await pool
    .query<{ drive_folder_id: string | null }>(
      editing
        ? "select c.drive_folder_id from posts p join clients c on c.id = p.client_id where p.id = $2 and c.id = $1"
        : "select drive_folder_id from clients where id = $1",
      editing ? [clientId, postId] : [clientId],
    )
    .catch(() => null);
  if (!owner?.rowCount) redirect("/");
  const root = owner.rows[0].drive_folder_id;

  // Nota do dia: só grava quando o texto foi realmente editado em relação ao original (note_orig).
  const noteFrom = text(formData, "note_from", 10);
  const noteOrig = text(formData, "note_orig", 4000);
  const noteDecision = resolveDayNoteSave({ editing, hasNoteField, note, noteOrig, noteFrom, noteDay });

  // Só planejamento: guarda o texto na data e volta para o dia. Não cria post nem pasta.
  if (!editing && !newKeys.length) {
    if (!note && !noteDecision.shouldSave) fail("Escreva o planejamento do dia ou escolha pelo menos uma rede e um formato.");
    if (noteDecision.shouldSave) await saveNote(pool, clientId, noteDay, note, noteDecision.replace);
    revalidatePath("/", "layout");
    redirect(`/clientes/${clientId}?mes=${monthOf(noteDay)}`);
  }

  const toneCheck = validateTones(formData.getAll("tones").map(String));
  if ("error" in toneCheck) fail(toneCheck.error);
  const tones = (toneCheck as { tones: string[] }).tones;

  const existing = editing
    ? (
        await pool.query<ExistingTarget>(
          `select id, network, format, post_folder_id, drive_url, drive_file_id, drive_meta, thumb_url, thumb_file_id, thumb_meta,
                  user_tags, collaborators,
                  (auto_confirmed_at is not null) as confirmed, publish_state, caption, title,
                  to_char(scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day,
                  to_char(scheduled_at at time zone '${TZ}', 'HH24:MI') as time
             from post_targets where post_id = $1`,
          [postId],
        )
      ).rows
    : [];
  const sentIds = new Set(formData.getAll("tid").map(String));
  // Destino que já saiu na rede pelo app (ou está saindo agora) não muda mais: legenda, data e mídia do banco têm de
  // continuar iguais ao que está publicado. Só a situação de um já publicado ainda pode ser trocada.
  const isLocked = (e: ExistingTarget) => e.publish_state === "published" || e.publish_state === "publishing";
  const lockedSent = existing.filter((e) => sentIds.has(e.id) && isLocked(e));
  const lockedChanged = lockedSent.filter((e) => {
    const changed = (field: string, now: string) => formData.has(field) && text(formData, field, 70000) !== (now ?? "").trim();
    return (
      changed(`caption__${e.id}`, e.caption) ||
      changed(`date__${e.id}`, e.day) ||
      changed(`time__${e.id}`, e.time) ||
      changed(`drive__${e.id}`, e.drive_url) ||
      changed(`title__${e.id}`, e.title) ||
      changed(`tags__${e.id}`, formatHandles(e.user_tags ?? [])) ||
      changed(`collabs__${e.id}`, formatHandles(e.collaborators ?? []))
    );
  }).length;
  const edits = existing.filter((e) => sentIds.has(e.id) && !isLocked(e));
  const have = new Set(existing.map((e) => `${e.network}:${e.format}`));
  const fresh = newKeys.filter((k) => !have.has(k));

  // Instagram: @ marcados e collabs (só nos formatos que aceitam; Stories não aceita collab).
  const people = (key: string, network: string, format: string, now?: { tags: string[]; collabs: string[] }) => {
    const cfg = isNetwork(network) ? NETWORKS[network].formats[format]?.people : undefined;
    if (!cfg) return { userTags: [] as string[], collaborators: [] as string[] };
    const read = (field: string, max: number, what: string, fallback: string[]) => {
      if (!formData.has(field)) return fallback;
      const r = parseHandles(text(formData, field, 2000), max, what);
      if ("error" in r) fail(r.error);
      return (r as { handles: string[] }).handles;
    };
    return {
      userTags: cfg.tags ? read(`tags__${key}`, MAX_USER_TAGS, "Marcar pessoas", now?.tags ?? []) : [],
      collaborators: cfg.collabs ? read(`collabs__${key}`, MAX_COLLABS, "Collabs", now?.collabs ?? []) : [],
    };
  };

  // Data e horário de cada destino (os que já existem e os novos).
  const when = (k: string): { day: string; time: string } => {
    const day = text(formData, `date__${k}`, 10);
    const time = text(formData, `time__${k}`, 5);
    if (!isDay(day) || !isTime(time)) fail("Informe uma data e um horário válidos para cada rede.");
    return { day, time };
  };

  // Destinos que já existiam: só confere o Drive de novo quando o link mudou (ou estava com erro).
  const updates = await Promise.all(
    edits.map(async (e) => {
      const { day, time } = when(e.id);
      const caption = text(formData, `caption__${e.id}`, 70000);
      const driveUrl = text(formData, `drive__${e.id}`, 500);
      let { drive_file_id: fileId, drive_meta: meta } = e;
      if (driveUrl !== e.drive_url || (meta && meta.error)) ({ fileId, meta } = await resolveDrive(driveUrl));
      const hasThumb = isNetwork(e.network) && !!NETWORKS[e.network].formats[e.format]?.thumb;
      const thumbUrl = hasThumb ? text(formData, `thumb__${e.id}`, 500) : e.thumb_url;
      let { thumb_file_id: thumbFileId, thumb_meta: thumbMeta } = e;
      if (thumbUrl !== e.thumb_url || (thumbMeta && thumbMeta.error)) {
        const t = await resolveDrive(thumbUrl);
        thumbFileId = t.fileId;
        thumbMeta = t.meta;
      }
      const title = hasTitle(e.network, e.format) ? text(formData, `title__${e.id}`, 200) : "";
      const { userTags, collaborators } = people(e.id, e.network, e.format, { tags: e.user_tags ?? [], collabs: e.collaborators ?? [] });
      return { e, day, time, caption, driveUrl, fileId, meta, thumbUrl, thumbFileId, thumbMeta, title, userTags, collaborators };
    }),
  );

  // Destinos novos: cada um com a sua data, horário, legenda, título e links.
  const created: PreparedTarget[] = await Promise.all(
    fresh.map(async (key) => {
      const [network, format] = key.split(":");
      const { day, time } = when(key);
      const caption = text(formData, `caption__${key}`, 70000);
      const driveUrl = text(formData, `drive__${key}`, 500);
      // Miniatura só existe nos formatos que a pedem (config `thumb`); título só nos que têm (config `title`).
      const thumbUrl = isNetwork(network) && NETWORKS[network].formats[format]?.thumb ? text(formData, `thumb__${key}`, 500) : "";
      const thumb = await resolveDrive(thumbUrl);
      const title = hasTitle(network, format) ? text(formData, `title__${key}`, 200) : "";
      const video = await resolveDrive(driveUrl);
      const { userTags, collaborators } = people(key, network, format);
      return { network, format, day, time, caption, title, driveUrl, fileId: video.fileId, meta: video.meta, thumbUrl, thumbFileId: thumb.fileId, thumbMeta: thumb.meta, userTags, collaborators };
    }),
  );

  // Pasta no Drive de destinos que mudaram de dia e de destinos novos.
  // Se falhar, o post é salvo mesmo assim e a tela avisa; dá para criar depois.
  const movedUpdates = updates.filter((u) => u.day !== u.e.day);
  const movedIds = new Set(movedUpdates.map((u) => u.e.id));
  const reuse = new Map<string, string>();
  for (const e of existing) {
    if (movedIds.has(e.id)) continue;
    const g = folderGroup(e.network, e.format);
    if (g && e.post_folder_id && !reuse.has(`${g.id}|${e.day}`)) reuse.set(`${g.id}|${e.day}`, e.post_folder_id);
  }
  const movedFolders = movedUpdates.length
    ? await ensureTargetFolders(
        root,
        movedUpdates.map((u) => ({ network: u.e.network, format: u.e.format, day: u.day })),
        reuse,
      )
    : { ids: [] as (string | null)[], error: null as string | null };
  const movedFolderById = new Map<string, string | null>();
  movedUpdates.forEach((u, i) => movedFolderById.set(u.e.id, movedFolders.ids[i] ?? null));

  const createdFolders = created.length
    ? await ensureTargetFolders(root, created, reuse)
    : { ids: [] as (string | null)[], error: null as string | null };
  const folderIds = createdFolders.ids;
  const folderError = movedFolders.error ?? createdFolders.error;

  // Nome interno do post: serve só para achar o post, não vai para nenhuma rede.
  const postName =
    text(formData, "post_name", 120) ||
    (created.find((p) => p.caption)?.caption.split("\n")[0].slice(0, 80) ?? "") ||
    note.split("\n")[0].slice(0, 80) ||
    "Post sem título";
  const brief = text(formData, "caption_brief", 4000);
  const statusAsk = text(formData, "status", 60).split(":");
  const statusId = statusAsk[0];
  const status = ["draft", "scheduled", "posted"].includes(statusAsk[1]) ? statusAsk[1] : "";

  const submissionId = editing ? null : parseSubmissionId(text(formData, "submission_id", 40));

  const c = await pool.connect();
  let savedPostId = postId;
  let droppedConfirm = 0;
  let duplicate = false;
  try {
    await c.query("begin");
    if (editing) {
      await c.query("update posts set title = $1, idea = $2, tones = $3 where id = $4", [postName, brief, tones, postId]);
    } else {
      const ins = await insertPostIdempotent(c, {
        clientId,
        title: postName,
        idea: brief,
        tones,
        submissionId,
      });
      if (!ins.created) {
        await c.query("rollback");
        duplicate = true;
      } else {
        savedPostId = ins.id;
      }
    }
    if (!duplicate) {
      for (const u of updates) {
        const nextFolderId = u.day !== u.e.day ? (movedFolderById.get(u.e.id) ?? null) : u.e.post_folder_id;
        // Mudou horário, legenda, mídia, miniatura ou título de um destino confirmado: a confirmação cai e a pessoa
        // confirma de novo. Assim o app nunca publica algo diferente do que ela viu quando confirmou.
        const upd = await c.query<{ still: boolean }>(
          `update post_targets set
              auto_confirmed_at = case when auto_confirmed_at is not null and (
                  caption is distinct from $1 or scheduled_at is distinct from (($2::date + $3::time) at time zone '${TZ}')
                  or drive_file_id is distinct from $5 or thumb_file_id is distinct from $8 or title is distinct from $10
                  or user_tags is distinct from $13 or collaborators is distinct from $14
                ) then null else auto_confirmed_at end,
              caption=$1, scheduled_at=($2::date + $3::time) at time zone '${TZ}',
              drive_url=$4, drive_file_id=$5, drive_meta=$6, thumb_url=$7, thumb_file_id=$8, thumb_meta=$9, title=$10,
              post_folder_id = $11, user_tags = $13, collaborators = $14
            where id=$12
          returning (auto_confirmed_at is not null) as still`,
          [u.caption, u.day, u.time, u.driveUrl, u.fileId, u.meta ? JSON.stringify(u.meta) : null, u.thumbUrl, u.thumbFileId, u.thumbMeta ? JSON.stringify(u.thumbMeta) : null, u.title, nextFolderId, u.e.id, u.userTags, u.collaborators],
        );
        if (u.e.confirmed && upd.rows[0] && !upd.rows[0].still) droppedConfirm++;
        if (status && u.e.id === statusId) {
          // Voltar para rascunho ou marcar como postado também desfaz a confirmação.
          await c.query(
            `update post_targets set status=$1, posted_at = case when $1='posted' then coalesce(posted_at, now()) else null end,
                    auto_confirmed_at = case when $1='scheduled' then auto_confirmed_at else null end where id=$2`,
            [status, u.e.id],
          );
        }
      }
      // Situação de um destino já publicado (ex.: voltar para agendado): o conteúdo fica como está.
      const lockedStatus = status ? lockedSent.find((e) => e.id === statusId && e.publish_state === "published") : undefined;
      if (lockedStatus) {
        await c.query(
          `update post_targets set status=$1, posted_at = case when $1='posted' then coalesce(posted_at, now()) else null end,
                  auto_confirmed_at = null where id=$2`,
          [status, lockedStatus.id],
        );
      }
      for (const [i, t] of created.entries()) {
        await c.query(
          `insert into post_targets (post_id, network, format, scheduled_at, caption, drive_url, drive_file_id, drive_meta, post_folder_id,
                                     thumb_url, thumb_file_id, thumb_meta, title, user_tags, collaborators)
           values ($1,$2,$3,($4::date + $5::time) at time zone '${TZ}',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            savedPostId, t.network, t.format, t.day, t.time, t.caption, t.driveUrl, t.fileId, t.meta ? JSON.stringify(t.meta) : null, folderIds[i],
            t.thumbUrl, t.thumbFileId, t.thumbMeta ? JSON.stringify(t.thumbMeta) : null, t.title, t.userTags, t.collaborators,
          ],
        );
      }
      await c.query("commit");
    }
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  if (duplicate) {
    redirect(`/clientes/${clientId}/dia/${created[0]?.day ?? noteDay}`);
  }
  if (noteDecision.shouldSave) await saveNote(pool, clientId, noteDay, note, noteDecision.replace);
  // Mudou a situação de um destino (ex.: "Postei manualmente" ou voltou de postado): a pasta do vídeo pronto
  // vai para "Reels Postados" ou volta para "Reels Editados".
  const folderMoveWarnings = status && statusId ? await syncPostedFolders([statusId]).catch(() => [] as string[]) : [];

  // Assimilação contínua: compara a última legenda gerada pela IA com a versão final salva.
  for (const u of updates) {
    const aiCap = text(formData, `ai_caption__${u.e.id}`, 70000);
    const diff = aiCap ? summarizeCaptionDiff(aiCap, u.caption) : null;
    if (diff) {
      await recordAiMemory({
        workspaceId: clientId,
        eventType: "caption_edited_on_publish",
        format: u.e.format,
        contentSummary: postName,
        userFeedbackOrDiff: diff,
      }).catch(() => {});
    }
    if (status === "scheduled" && u.e.id === statusId) {
      await recordAiMemory({
        workspaceId: clientId,
        eventType: "post_scheduled",
        format: u.e.format,
        contentSummary: `${postName} (${u.day} ${u.time})`,
      }).catch(() => {});
    }
  }
  for (const t of created) {
    const aiCap = text(formData, `ai_caption__${t.network}:${t.format}`, 70000);
    const diff = aiCap ? summarizeCaptionDiff(aiCap, t.caption) : null;
    if (diff) {
      await recordAiMemory({
        workspaceId: clientId,
        eventType: "caption_edited_on_publish",
        format: t.format,
        contentSummary: postName,
        userFeedbackOrDiff: diff,
      }).catch(() => {});
    }
  }

  revalidatePath("/", "layout");
  if (editing) {
    const remainingDays = (
      await pool.query<{ day: string }>(
        `select distinct to_char(scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day
           from post_targets
          where post_id = $1
          order by day`,
        [savedPostId],
      )
    ).rows.map((r) => r.day);
    const movedDays = movedUpdates.map((u) => u.day);
    const dest = resolveEditRedirect({ clientId, back, remainingDays, movedDays });
    const url = withParam(dest, "salvo", savedPostId);
    const notes: string[] = [];
    const movedNotice = formatMovedTargetsNotice(movedDays);
    if (movedNotice) notes.push(movedNotice);
    if (droppedConfirm) notes.push(droppedConfirm === 1 ? "Você mudou algo de um post confirmado: a confirmação da publicação automática foi desfeita. Confirme de novo." : `Você mudou algo de ${droppedConfirm} posts confirmados: as confirmações da publicação automática foram desfeitas. Confirme de novo.`);
    if (folderError) notes.push(`Salvo, mas a pasta no Drive não foi criada: ${folderError}`);
    notes.push(...folderMoveWarnings);
    if (lockedChanged) {
      notes.push(
        lockedChanged === 1
          ? "Um destino já foi publicado pelo app: a legenda, a data e a mídia dele ficaram como estavam."
          : `${lockedChanged} destinos já foram publicados pelo app: a legenda, a data e a mídia deles ficaram como estavam.`,
      );
    }
    redirect(notes.length ? withParam(url, "aviso", notes.join(" ")) : url);
  }
  const dayPath = `/clientes/${clientId}/dia/${created[0]?.day ?? noteDay}`;
  redirect(folderError ? withParam(dayPath, "aviso", `O post foi criado, mas a pasta no Drive não: ${folderError}`) : dayPath);
}

/** Grava a nota de planejamento do dia: substitui (apagando se vazia) ou acrescenta ao que já estava lá. */
async function saveNote(pool: Awaited<ReturnType<typeof db>>, clientId: string, day: string, body: string, replace: boolean): Promise<void> {
  if (replace && !body) {
    await pool.query("delete from day_notes where client_id = $1 and day = $2::date", [clientId, day]);
    return;
  }
  await pool.query(
    `insert into day_notes (client_id, day, body) values ($1, $2::date, $3)
     on conflict (client_id, day) do update set
       body = case when $4::boolean or day_notes.body = '' then excluded.body else day_notes.body || E'\n\n' || excluded.body end,
       updated_at = now()`,
    [clientId, day, body, replace],
  );
}

/** Lê a nota de planejamento de um dia específico (usado no Novo post ao trocar a data). */
export async function getDayNote(clientId: string, day: string): Promise<string> {
  await requireAuth();
  if (!isValidUuid(clientId) || !isDay(day)) return "";
  const pool = await db();
  const r = await pool.query<{ body: string }>(
    "select body from day_notes where client_id = $1 and day = $2::date",
    [clientId, day],
  );
  return r.rows[0]?.body ?? "";
}

/** Salva a nota de planejamento do dia diretamente a partir do cartão no topo da tela do dia. */
export async function saveDayNote(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  const day = text(formData, "day", 10);
  const volta = safePath(text(formData, "volta", 300), `/clientes/${clientId}/dia/${day}`);
  if (!isValidUuid(clientId) || !isDay(day)) redirect("/");
  const note = text(formData, "note", 4000);
  const pool = await db();
  await saveNote(pool, clientId, day, note, true);
  revalidatePath("/", "layout");
  redirect(withParam(volta, "nota", "1"));
}

/** Cria (ou encontra) no Drive a pasta de um destino que ainda não tem pasta. */
export async function ensureTargetFolder(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  // O id vem da ligação do botão (bind), não de campo do formulário: o React troca o `name` de botões com formAction.
  const id = String(targetId).slice(0, 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const back = safePath(text(formData, "volta", 300), "/");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const pool = await db();
  const r = await pool.query<{ day: string; network: string; format: string; root: string | null }>(
    `select to_char(t.scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day, t.network, t.format, c.drive_folder_id as root
       from post_targets t join posts p on p.id = t.post_id join clients c on c.id = p.client_id
      where t.id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) redirect("/");
  const names = folderNames(row.day, row.network, row.format);
  if (!row.root || !names) redirect(withParam(back, "erro", "Este cliente ainda não tem a pasta do Drive cadastrada."));
  const res = await ensureFolderPath(row.root, names);
  if ("error" in res) redirect(withParam(back, "erro", `Não foi possível criar a pasta: ${res.error}`));
  await pool.query("update post_targets set post_folder_id = $1 where id = $2", [res.id, id]);
  revalidatePath("/", "layout");
  redirect(withParam(back, "pasta", id) + `#t-${id}`);
}

export async function publishTarget(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  // O id vem da ligação do botão (bind), não de campo do formulário: o React troca o `name` de botões com formAction.
  const id = String(targetId).slice(0, 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const back = safePath(text(formData, "volta", 300), "/");
  const r = await startPublish(id);
  revalidatePath("/", "layout");
  if (!r.ok) redirect(withParam(back, "erro", r.error) + `#t-${id}`);
  redirect(back + `#t-${id}`);
}

/**
 * "Confirmar publicação": avisa o app que este destino está pronto e que ele deve publicar sozinho no dia e horário
 * marcados. Só vale para o que está salvo (a tela bloqueia o botão com edição não salva). Dá para cancelar antes do horário.
 */
export async function confirmPublication(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  // O id vem da ligação do botão (bind), não de campo do formulário: o React troca o `name` de botões com formAction.
  const id = String(targetId).slice(0, 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const back = safePath(text(formData, "volta", 300), "/");
  const fail = (msg: string): never => redirect(withParam(back, "erro", msg) + `#t-${id}`);
  const [t] = await listTargets({ targetId: id });
  if (!t) redirect("/");
  if (t.status === "posted") fail("Este post já está marcado como postado.");
  if (!canAutoSchedule(t.network, t.format)) fail("Esta rede e formato ainda não publicam sozinhos no horário.");
  const check = await checkPublishable(t);
  if (!check.ok) fail(check.error);
  const why = autoBlocker(t);
  if (why) fail(why);
  const pool = await db();
  const r = await pool.query(
    `update post_targets set auto_confirmed_at = now(), auto_notified_at = null, status = 'scheduled',
            publish_state = case when publish_state = 'failed' then 'idle' else publish_state end,
            publish_error = case when publish_state = 'failed' then '' else publish_error end
      where id = $1 and status <> 'posted' and publish_state in ('idle','failed') and scheduled_at > now()
      returning id`,
    [id],
  );
  if (!r.rows[0]) fail("O horário deste post já passou. Ajuste a data e o horário para o futuro e confirme de novo, ou use Publicar agora.");
  revalidatePath("/", "layout");
  redirect(withParam(back, "confirmado", id) + `#t-${id}`);
}

/** Tira a confirmação: o app deixa de publicar este destino sozinho. A situação (agendado) continua. */
export async function cancelConfirmation(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  const id = String(targetId).slice(0, 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const back = safePath(text(formData, "volta", 300), "/");
  const pool = await db();
  await pool.query("update post_targets set auto_confirmed_at = null where id = $1 and publish_state <> 'publishing'", [id]);
  revalidatePath("/", "layout");
  redirect(back + `#t-${id}`);
}

export async function markPosted(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
  const back = safePath(text(formData, "volta", 300), "/postar-hoje");
  if (!isValidUuid(id)) redirect(back);
  const pool = await db();
  const cur = await pool.query<{ status: string; publish_state: string }>(
    "select status, publish_state from post_targets where id=$1",
    [id],
  );
  const row = cur.rows[0];
  if (!row) redirect(back);
  const check = canMarkPosted(row.publish_state);
  if (!check.ok) redirect(withParam(back, "erro", check.error));
  const upd = await pool.query(
    "update post_targets set status='posted', posted_at=coalesce(posted_at, now()), auto_confirmed_at=null where id=$1 and publish_state <> 'publishing'",
    [id],
  );
  if (!upd.rowCount) redirect(withParam(back, "erro", "Este destino está sendo publicado agora. Aguarde concluir."));
  const folderWarn = await syncPostedFolders([id]).catch(() => [] as string[]);
  if (folderWarn.length) console.warn(`[reels-postados] ${folderWarn.join(" ")}`);
  revalidatePath("/", "layout");
  redirect(withParam(withParam(back, "feito", id), "antes", row.status));
}

export async function undoMarkPosted(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
  const antes = text(formData, "antes", 20);
  const back = safePath(text(formData, "volta", 300), "/postar-hoje");
  if (!isValidUuid(id) || !isUndoableStatus(antes)) redirect(back);
  const pool = await db();
  await pool.query(
    "update post_targets set status=$2, posted_at=null, auto_confirmed_at=null where id=$1 and publish_state <> 'publishing'",
    [id, antes],
  );
  const folderWarn = await syncPostedFolders([id]).catch(() => [] as string[]);
  if (folderWarn.length) console.warn(`[reels-postados] ${folderWarn.join(" ")}`);
  revalidatePath("/", "layout");
  redirect(back);
}

export async function deleteTarget(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  // O id vem da ligação do botão (bind), não de campo do formulário: o React troca o `name` de botões com formAction.
  const id = String(targetId).slice(0, 40);
  if (!isValidUuid(id)) redirect("/");
  let back = safePath(text(formData, "volta", 300), "/");
  const pool = await db();
  const cur = await pool.query<{
    post_id: string;
    client_id: string;
    day: string;
    publish_state: string;
    external_id: string | null;
  }>(
    `select t.post_id, p.client_id,
            to_char(t.scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day,
            t.publish_state, t.external_id
       from post_targets t
       join posts p on p.id = t.post_id
      where t.id = $1`,
    [id],
  );
  const row = cur.rows[0];
  if (!row) redirect(back);
  const blocker = deleteTargetBlocker(row);
  if (blocker) redirect(withParam(back, "erro", blocker) + `#t-${id}`);

  // Itens editoriais deste destino: se forem vídeos prontos que o app moveu para o dia, a pasta volta para "Reels Editados".
  const linkedItems = (
    await pool.query<{ content_item_id: string }>("select content_item_id from editorial_schedule where post_target_id = $1", [id])
  ).rows.map((x) => x.content_item_id);

  const r = await pool.query<{ post_id: string }>(
    `delete from post_targets
      where id = $1
        and publish_state not in ('publishing', 'published')
        and coalesce(external_id, '') = ''
      returning post_id`,
    [id],
  );
  if (!r.rowCount) {
    redirect(withParam(back, "erro", "Este destino não pode ser excluído.") + `#t-${id}`);
  }
  await pool.query("delete from posts p where p.id=$1 and not exists (select 1 from post_targets t where t.post_id=p.id)", [row.post_id]);
  const folderWarnings = await returnReadyFolders(linkedItems).catch(() => ["A pasta do vídeo não voltou para \"Reels Editados\": falha ao falar com o Google Drive."]);
  if (folderWarnings.length) back = withParam(back, "aviso", folderWarnings.join(" "));

  const left = await pool.query(
    `select 1
       from post_targets t
       join posts p on p.id = t.post_id
      where p.client_id = $1
        and to_char(t.scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') = $2
      limit 1`,
    [row.client_id, row.day],
  );
  revalidatePath("/", "layout");
  if (!left.rowCount) {
    const cal = withParam(`/clientes/${row.client_id}?mes=${monthOf(row.day)}`, "ok", "Destino excluído.");
    redirect(folderWarnings.length ? withParam(cal, "aviso", folderWarnings.join(" ")) : cal);
  }
  redirect(withParam(back, "ok", "Destino excluído."));
}

type CaptionPromptInput = {
  clientId: string;
  network: string;
  format: string;
  /** Planejamento do dia (item 1 do novo post). */
  plan: string;
  /** Descrição da legenda: o que a pessoa quer na legenda (item 2). */
  brief?: string;
  /** Legenda que já está no campo, para melhorar ou refazer. */
  draft: string;
  /** "Personalizar legenda": pedidos de ajuste (tom, tamanho, o que mudar). */
  custom?: string;
  /** Tons de voz marcados para o post no momento do clique (ids de src/config/tones.ts), mesmo que ainda não salvos. */
  tones?: string[];
  /** Opcional: gerar versão bilíngue (Português + Inglês). */
  bilingual?: boolean;
  /** Opcional: contexto editorial (pilar/formato/roteiro). */
  editorialContext?: string;
};

async function prepareCaptionPrompt(input: CaptionPromptInput): Promise<{ prompt: string; format: string; network: string } | { error: string }> {
  const network = String(input.network);
  const format = String(input.format);
  if (!isNetwork(network) || !isFormat(network, format)) return { error: "rede ou formato inválido." };
  if (!isValidUuid(String(input.clientId))) return { error: "cliente inválido." };
  const toneCheck = validateTones(Array.isArray(input.tones) ? input.tones.map(String) : []);
  if ("error" in toneCheck) return { error: toneCheck.error };
  const pool = await db();
  const [r, memories] = await Promise.all([
    pool.query<{ name: string; segment: string; site: string; tone: string; notes: string; ai_style_notes: string }>(
      "select name, segment, site, tone, notes, ai_style_notes from clients where id = $1",
      [input.clientId],
    ),
    listRecentAiMemory(input.clientId, 12),
  ]);
  if (!r.rows[0]) return { error: "cliente não encontrado." };
  const memoryBlock = buildMemoryBlock(memories, r.rows[0].ai_style_notes ?? "");
  const prompt = buildCaptionPrompt({
    client: r.rows[0],
    network,
    format,
    plan: String(input.plan ?? "").slice(0, 4000),
    brief: String(input.brief ?? "").slice(0, 4000),
    captionDraft: String(input.draft ?? "").slice(0, 70000),
    custom: String(input.custom ?? "").slice(0, 2000),
    tones: toneCheck.tones,
    bilingual: !!input.bilingual,
    editorialContext: input.editorialContext,
    memoryBlock,
  });
  return { prompt, format, network };
}

/**
 * Monta no servidor o mesmo pedido enviado à IA (incluindo o bloco de memória aprendida)
 * para o botão "Copiar pedido para a IA".
 */
export async function buildCaptionPromptAction(input: CaptionPromptInput): Promise<{ prompt: string } | { error: string }> {
  await requireAuth();
  const prep = await prepareCaptionPrompt(input);
  if ("error" in prep) return prep;
  return { prompt: prep.prompt };
}

/**
 * Gera a legenda de um destino pela API. Chamada direto do navegador (botão "Gerar legenda").
 * O tom de voz e as observações do cliente vêm do banco; o planejamento, o rascunho e os tons marcados vêm da tela.
 */
export async function generateCaption(input: CaptionPromptInput): Promise<AiResult> {
  await requireAuth();
  const prep = await prepareCaptionPrompt(input);
  if ("error" in prep) return prep;
  const provider = activeAiProvider();
  if (!provider) return { error: "a chave da IA ainda não foi cadastrada (GEMINI_API_KEY ou ANTHROPIC_API_KEY no Render)." };
  const res = provider === "gemini" ? await generateGeminiText(prep.prompt) : await generateText(prep.prompt);
  if ("text" in res) {
    await recordAiMemory({
      workspaceId: input.clientId,
      eventType: "caption_generated",
      format: prep.format,
      contentSummary: String(input.brief || input.plan || `${prep.network}/${prep.format}`).slice(0, 300),
    }).catch(() => {});
  }
  return res;
}

// ---------- contas conectadas (Meta) ----------

/** Escolha da Página quando o login da Meta liberou mais de uma. O token do usuário vem do cookie, nunca do formulário. */
export async function connectMetaPage(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "clientId", 40);
  const pageId = text(formData, "pageId", 40);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) redirect("/");
  const back = `/clientes/${clientId}/editar`;
  const userToken = await readPending(clientId);
  if (!userToken) redirect(withParam(back, "erro", "A escolha expirou. Clique em Conectar de novo."));
  let msg: { k: "ok" | "aviso" | "erro"; v: string };
  try {
    const page = (await listPages(userToken)).find((p) => p.id === pageId);
    if (!page) {
      msg = { k: "erro", v: "Essa Página não está entre as liberadas no login da Meta. Conecte de novo." };
    } else {
      const r = await saveMetaConnections(clientId, page);
      msg = r.instagram
        ? { k: "ok", v: `Conectado: Página ${page.name} e Instagram ${r.instagram}.` }
        : { k: "aviso", v: `Página ${page.name} conectada, mas ela não tem Instagram profissional ligado. Ligue o Instagram à Página e conecte de novo.` };
    }
  } catch (e) {
    msg = { k: "erro", v: e instanceof Error ? e.message : "Não foi possível conectar. Tente de novo." };
  }
  await clearPending();
  revalidatePath(back);
  redirect(withParam(back, msg.k, msg.v));
}

export async function disconnectLinkedin(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "clientId", 40);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) redirect("/");
  await removeLinkedinConnection(clientId);
  revalidatePath(`/clientes/${clientId}/editar`);
  redirect(withParam(`/clientes/${clientId}/editar`, "ok", "LinkedIn desconectado."));
}

export async function disconnectTiktok(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "clientId", 40);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) redirect("/");
  const token = await removeTiktokConnection(clientId);
  // Avisa o TikTok para o app sumir da lista de apps autorizados da pessoa (melhor esforço).
  const cfg = tiktokConfig();
  if (token && !("error" in cfg)) await revokeAccess(cfg, token);
  revalidatePath(`/clientes/${clientId}/editar`);
  redirect(withParam(`/clientes/${clientId}/editar`, "ok", "TikTok desconectado."));
}

export async function disconnectMeta(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "clientId", 40);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) redirect("/");
  await removeMetaConnections(clientId);
  revalidatePath(`/clientes/${clientId}/editar`);
  redirect(withParam(`/clientes/${clientId}/editar`, "ok", "Contas do Facebook e do Instagram desconectadas."));
}

/** Consulta apenas o estado de publicação de um destino (usado pelo polling leve enquanto está em "publishing"). */
export async function getTargetPublishState(
  targetId: string,
): Promise<"idle" | "publishing" | "published" | "failed" | "drafted" | null> {
  await requireAuth();
  const id = String(targetId ?? "").slice(0, 40);
  if (!isValidUuid(id)) return null;
  const pool = await db();
  const r = await pool.query<{ publish_state: "idle" | "publishing" | "published" | "failed" | "drafted" }>(
    "select publish_state from post_targets where id = $1",
    [id],
  );
  return r.rows[0]?.publish_state ?? null;
}

// ---------- teste de mover pastas no Drive ----------

/**
 * Configurações › "Testar mover no Drive": confere se a conta do app consegue mover as pastas de "Reels Editados"
 * do cliente (base do editorial que move a pasta do vídeo para o dia). Só mexe numa subpasta VAZIA e a devolve.
 */
export async function testDriveMove(_prev: MoveTestResult | null, formData: FormData): Promise<MoveTestResult> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  if (!isValidUuid(clientId)) return { verdict: "setup", lines: ["Escolha um cliente."] };
  const pool = await db();
  const r = await pool.query<{ drive_folder_id: string | null }>("select drive_folder_id from clients where id = $1", [clientId]);
  const folder = r.rows[0]?.drive_folder_id;
  if (!folder) return { verdict: "setup", lines: ["Este cliente ainda não tem pasta do Drive no cadastro."] };
  return runDriveMoveTest(folder);
}
