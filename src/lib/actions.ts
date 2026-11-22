"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, createSession, destroySession, hasPassword, requireAuth } from "./auth";
import { hashPassword, passwordProblem } from "./password";
import { db } from "./db";
import { TZ, dayFolders, isDay, isTime, monthOf } from "./dates";
import { ensureClientFolders, ensureFolderPath, folderUrl, getFileMeta, getFolderName, parseDriveUrl } from "./drive";
import { getDriveRoot, setDriveRoot } from "./drive-root";
import { generateText, type AiResult } from "./ai";
import { buildCaptionPrompt } from "./prompt";
import { startPublish } from "./publisher";
import { removeMetaConnections, removeLinkedinConnection, removeTiktokConnection, saveMetaConnections } from "./connections";
import { revokeAccess, tiktokConfig } from "./publish/tiktok-oauth";
import { clearPending, readPending } from "./meta-pending";
import { listPages } from "./publish/meta-oauth";
import { fetchLogo } from "./logo";
import type { MediaMeta } from "./checks";
import { validateTones } from "@/config/tones";
import { NETWORKS, NETWORK_IDS, folderGroup, hasTitle, isFormat, isNetwork, targetFolders } from "@/config/networks";

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
  const ok = await checkPassword(text(formData, "senha", 200));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    redirect("/login?erro=1");
  }
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

/**
 * Nomes das pastas, a partir da pasta do cliente: AAAA / MM - Mês / DD / (pasta do grupo | Rede / Formato).
 * Reels, Shorts, TikTok e Kwai dividem uma pasta; Stories do Instagram e do Facebook dividem outra (ver FOLDER_GROUPS).
 */
function folderNames(day: string, network: string, format: string): string[] | null {
  const rest = targetFolders(network, format);
  return rest ? [...dayFolders(day), ...rest] : null;
}

async function resolveDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  const ref = parseDriveUrl(url);
  if (!url || !ref) return { fileId: null, meta: url ? { error: "o link não parece ser de um arquivo do Google Drive." } : null };
  if (ref.kind === "folder") return { fileId: null, meta: { error: "este link é de uma pasta. Cole o link de um arquivo." } };
  const meta = await getFileMeta(ref.id);
  return { fileId: ref.id, meta };
}

type PreparedTarget = {
  network: string; format: string; day: string; time: string; caption: string; title: string;
  driveUrl: string; fileId: string | null; meta: MediaMeta | null;
  thumbUrl: string; thumbFileId: string | null; thumbMeta: MediaMeta | null;
};

/** Confere um link do Drive (arquivo) e devolve o id e os dados da mídia. Usado pela tela do post para mostrar a prévia antes de salvar. */
export async function inspectDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  await requireAuth();
  return resolveDrive(String(url ?? "").trim().slice(0, 500));
}

/**
 * Pasta do Drive de cada destino (mesma ordem de `items`). `reuse` traz pastas já existentes por grupo e dia
 * (ex.: o post já tem a pasta do grupo "curto" no Reels): o destino do mesmo grupo e dia usa essa mesma pasta.
 */
async function ensureTargetFolders(
  root: string | null,
  items: { network: string; format: string; day: string }[],
  reuse: Map<string, string> = new Map(),
): Promise<{ ids: (string | null)[]; error: string | null }> {
  const cache = new Map<string, string>();
  const ids: (string | null)[] = [];
  let error: string | null = null;
  for (const { network, format, day } of items) {
    const group = folderGroup(network, format);
    const key = group ? `${group.id}|${day}` : "";
    const known = key ? reuse.get(key) : undefined;
    if (known) {
      ids.push(known);
      continue;
    }
    const names = folderNames(day, network, format);
    if (!root || !names || error) {
      ids.push(null);
      continue;
    }
    const res = await ensureFolderPath(root, names, cache);
    if ("error" in res) {
      error = res.error;
      ids.push(null);
    } else {
      ids.push(res.id);
      if (key) reuse.set(key, res.id);
    }
  }
  return { ids, error };
}

type ExistingTarget = {
  id: string; network: string; format: string; day: string; post_folder_id: string | null;
  drive_url: string; drive_file_id: string | null; drive_meta: MediaMeta | null;
  thumb_url: string; thumb_file_id: string | null; thumb_meta: MediaMeta | null;
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

  const note = text(formData, "note", 4000);
  const noteDay = editing ? text(formData, "note_day", 10) : text(formData, "date", 10);
  if (!isDay(noteDay)) fail("Informe uma data válida.");

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

  // Nota do dia. Novo post: a ideia já salva para a data vem preenchida (note_from); se a data é a mesma, o texto
  // enviado é a ideia inteira (substitui); em outra data, acrescenta. Edição: substitui quando a pessoa mudou o texto.
  const noteFrom = text(formData, "note_from", 10);
  const noteOrig = text(formData, "note_orig", 4000);
  const noteChanged = editing ? note !== noteOrig : note !== "";
  const noteReplace = editing || noteFrom === noteDay;

  // Só planejamento: guarda o texto na data e volta para o dia. Não cria post nem pasta.
  if (!editing && !newKeys.length) {
    if (!note) fail("Escreva o planejamento do dia ou escolha pelo menos uma rede e um formato.");
    await saveNote(pool, clientId, noteDay, note, noteReplace);
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
                  to_char(scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day
             from post_targets where post_id = $1`,
          [postId],
        )
      ).rows
    : [];
  const sentIds = new Set(formData.getAll("tid").map(String));
  const edits = existing.filter((e) => sentIds.has(e.id));
  const have = new Set(existing.map((e) => `${e.network}:${e.format}`));
  const fresh = newKeys.filter((k) => !have.has(k));

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
      return { e, day, time, caption, driveUrl, fileId, meta, thumbUrl, thumbFileId, thumbMeta, title };
    }),
  );

  // Destinos novos: cada um com a sua data, horário, legenda, título e links.
  const created: PreparedTarget[] = await Promise.all(
    fresh.map(async (key) => {
      const [network, format] = key.split(":");
      const { day, time } = when(key);
      const caption = text(formData, `caption__${key}`, 4000);
      const driveUrl = text(formData, `drive__${key}`, 500);
      // Miniatura só existe nos formatos que a pedem (config `thumb`); título só nos que têm (config `title`).
      const thumbUrl = isNetwork(network) && NETWORKS[network].formats[format]?.thumb ? text(formData, `thumb__${key}`, 500) : "";
      const thumb = await resolveDrive(thumbUrl);
      const title = hasTitle(network, format) ? text(formData, `title__${key}`, 200) : "";
      const video = await resolveDrive(driveUrl);
      return { network, format, day, time, caption, title, driveUrl, fileId: video.fileId, meta: video.meta, thumbUrl, thumbFileId: thumb.fileId, thumbMeta: thumb.meta };
    }),
  );

  // Pasta no Drive de cada destino novo. Se falhar, o post é salvo mesmo assim e a tela avisa; dá para criar depois.
  const reuse = new Map<string, string>();
  for (const e of existing) {
    const g = folderGroup(e.network, e.format);
    if (g && e.post_folder_id && !reuse.has(`${g.id}|${e.day}`)) reuse.set(`${g.id}|${e.day}`, e.post_folder_id);
  }
  const { ids: folderIds, error: folderError } = await ensureTargetFolders(root, created, reuse);

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

  const c = await pool.connect();
  let savedPostId = postId;
  try {
    await c.query("begin");
    if (editing) {
      await c.query("update posts set title = $1, idea = $2, tones = $3 where id = $4", [postName, brief, tones, postId]);
    } else {
      const p = await c.query<{ id: string }>("insert into posts (client_id, title, idea, tones) values ($1,$2,$3,$4) returning id", [clientId, postName, brief, tones]);
      savedPostId = p.rows[0].id;
    }
    for (const u of updates) {
      await c.query(
        `update post_targets set caption=$1, scheduled_at=($2::date + $3::time) at time zone '${TZ}',
            drive_url=$4, drive_file_id=$5, drive_meta=$6, thumb_url=$7, thumb_file_id=$8, thumb_meta=$9, title=$10,
            post_folder_id = case when $11::boolean then null else post_folder_id end
          where id=$12`,
        [u.caption, u.day, u.time, u.driveUrl, u.fileId, u.meta ? JSON.stringify(u.meta) : null, u.thumbUrl, u.thumbFileId, u.thumbMeta ? JSON.stringify(u.thumbMeta) : null, u.title, u.day !== u.e.day, u.e.id],
      );
      if (status && u.e.id === statusId) {
        await c.query("update post_targets set status=$1, posted_at = case when $1='posted' then coalesce(posted_at, now()) else null end where id=$2", [status, u.e.id]);
      }
    }
    for (const [i, t] of created.entries()) {
      await c.query(
        `insert into post_targets (post_id, network, format, scheduled_at, caption, drive_url, drive_file_id, drive_meta, post_folder_id,
                                   thumb_url, thumb_file_id, thumb_meta, title)
         values ($1,$2,$3,($4::date + $5::time) at time zone '${TZ}',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          savedPostId, t.network, t.format, t.day, t.time, t.caption, t.driveUrl, t.fileId, t.meta ? JSON.stringify(t.meta) : null, folderIds[i],
          t.thumbUrl, t.thumbFileId, t.thumbMeta ? JSON.stringify(t.thumbMeta) : null, t.title,
        ],
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  if (noteChanged) await saveNote(pool, clientId, noteDay, note, noteReplace);
  revalidatePath("/", "layout");
  if (editing) {
    const url = withParam(back, "salvo", savedPostId);
    redirect(folderError ? withParam(url, "aviso", `Salvo, mas a pasta no Drive não foi criada: ${folderError}`) : url);
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

export async function markPosted(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
  const back = safePath(text(formData, "volta", 300), "/postar-hoje");
  const pool = await db();
  await pool.query("update post_targets set status='posted', posted_at=coalesce(posted_at, now()) where id=$1", [id]);
  revalidatePath("/", "layout");
  redirect(back);
}

export async function deleteTarget(targetId: string, formData: FormData): Promise<void> {
  await requireAuth();
  // O id vem da ligação do botão (bind), não de campo do formulário: o React troca o `name` de botões com formAction.
  const id = String(targetId).slice(0, 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/");
  const back = safePath(text(formData, "volta", 300), "/");
  const pool = await db();
  const r = await pool.query<{ post_id: string }>("delete from post_targets where id=$1 returning post_id", [id]);
  const postId = r.rows[0]?.post_id;
  if (postId) {
    await pool.query("delete from posts p where p.id=$1 and not exists (select 1 from post_targets t where t.post_id=p.id)", [postId]);
  }
  revalidatePath("/", "layout");
  redirect(back);
}

/**
 * Gera a legenda de um destino pela API. Chamada direto do navegador (botão "Gerar legenda").
 * O tom de voz vem do banco, não do navegador. Só o planejamento e o rascunho vêm da tela.
 */
export async function generateCaption(input: {
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
}): Promise<AiResult> {
  await requireAuth();
  const network = String(input.network);
  const format = String(input.format);
  if (!isNetwork(network) || !isFormat(network, format)) return { error: "rede ou formato inválido." };
  if (!/^[0-9a-f-]{36}$/i.test(String(input.clientId))) return { error: "cliente inválido." };
  const toneCheck = validateTones(Array.isArray(input.tones) ? input.tones.map(String) : []);
  if ("error" in toneCheck) return { error: toneCheck.error };
  const pool = await db();
  const r = await pool.query<{ name: string; segment: string; site: string; tone: string; notes: string }>(
    "select name, segment, site, tone, notes from clients where id = $1",
    [input.clientId],
  );
  if (!r.rows[0]) return { error: "cliente não encontrado." };
  const prompt = buildCaptionPrompt({
    client: r.rows[0],
    network,
    format,
    plan: String(input.plan ?? "").slice(0, 4000),
    brief: String(input.brief ?? "").slice(0, 4000),
    captionDraft: String(input.draft ?? "").slice(0, 4000),
    custom: String(input.custom ?? "").slice(0, 2000),
    tones: toneCheck.tones,
  });
  return generateText(prompt);
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
