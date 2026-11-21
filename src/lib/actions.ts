"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, createSession, destroySession, hasPassword, requireAuth } from "./auth";
import { hashPassword, passwordProblem } from "./password";
import { db } from "./db";
import { TZ, dayFolders, isDay, isTime } from "./dates";
import { ensureFolderPath, getFileMeta, parseDriveUrl } from "./drive";
import { generateText, type AiResult } from "./ai";
import { buildCaptionPrompt } from "./prompt";
import { fetchLogo } from "./logo";
import type { MediaMeta } from "./checks";
import { NETWORKS, NETWORK_IDS, isFormat, isNetwork } from "@/config/networks";

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

// ---------- posts ----------

/** Nomes das pastas, a partir da pasta do cliente: AAAA / MM - Mês / DD / Rede / Formato. */
function folderNames(day: string, network: string, format: string): string[] | null {
  if (!isNetwork(network)) return null;
  const cfg = NETWORKS[network];
  return [...dayFolders(day), cfg.folder, cfg.formats[format]?.folder ?? format];
}

async function resolveDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  const ref = parseDriveUrl(url);
  if (!url || !ref) return { fileId: null, meta: url ? { error: "o link não parece ser de um arquivo do Google Drive." } : null };
  if (ref.kind === "folder") return { fileId: null, meta: { error: "este link é de uma pasta. Cole o link de um arquivo." } };
  const meta = await getFileMeta(ref.id);
  return { fileId: ref.id, meta };
}

/** Acrescenta texto à nota do dia (sem apagar o que já estava lá). */
async function appendDayNote(clientId: string, day: string, body: string): Promise<void> {
  const pool = await db();
  await pool.query(
    `insert into day_notes (client_id, day, body) values ($1, $2::date, $3)
     on conflict (client_id, day) do update set
       body = case when day_notes.body = '' then excluded.body else day_notes.body || E'\n\n' || excluded.body end,
       updated_at = now()`,
    [clientId, day, body],
  );
}

/** Troca a nota do dia pelo texto enviado. Texto vazio apaga a nota. */
export async function saveDayNote(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  const day = text(formData, "day", 10);
  const body = text(formData, "body", 4000);
  if (!isDay(day) || !/^[0-9a-f-]{36}$/i.test(clientId)) redirect("/");
  const pool = await db();
  if (body) {
    await pool.query(
      `insert into day_notes (client_id, day, body) values ($1, $2::date, $3)
       on conflict (client_id, day) do update set body = excluded.body, updated_at = now()`,
      [clientId, day, body],
    );
  } else {
    await pool.query("delete from day_notes where client_id = $1 and day = $2::date", [clientId, day]);
  }
  revalidatePath("/", "layout");
  redirect(withParam(`/clientes/${clientId}/dia/${day}`, "nota", "1"));
}

export async function createPost(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  const day = text(formData, "date", 10);
  const time = text(formData, "time", 5);
  const note = text(formData, "note", 4000);
  const back = `/posts/novo?cliente=${encodeURIComponent(clientId)}`;
  if (!isDay(day)) redirect(withParam(back, "erro", "Informe uma data válida."));

  const targets = formData
    .getAll("target")
    .map(String)
    .map((v) => v.split(":"))
    .filter(([n, f]) => isNetwork(n) && isFormat(n, f));
  if (!targets.length && !note) {
    redirect(withParam(back, "erro", "Escreva o planejamento do dia ou escolha pelo menos uma rede e um formato."));
  }

  const pool = await db();
  const client = await pool
    .query<{ drive_folder_id: string | null }>("select drive_folder_id from clients where id = $1", [clientId])
    .catch(() => null);
  if (!client?.rowCount) redirect("/");
  const root = client.rows[0].drive_folder_id;

  // Só planejamento: guarda o texto na data e volta para o dia. Não cria post nem pasta.
  if (!targets.length) {
    await appendDayNote(clientId, day, note);
    revalidatePath("/", "layout");
    redirect(withParam(`/clientes/${clientId}/dia/${day}`, "nota", "1"));
  }
  if (!isTime(time)) redirect(withParam(back, "erro", "Informe um horário válido."));

  // Cada destino tem a sua legenda e o seu link de vídeo.
  const per = await Promise.all(
    targets.map(async ([network, format]) => {
      const key = `${network}:${format}`;
      const caption = text(formData, `caption__${key}`, 4000);
      const driveUrl = text(formData, `drive__${key}`, 500);
      return { network, format, caption, driveUrl, ...(await resolveDrive(driveUrl)) };
    }),
  );
  const title =
    text(formData, "title", 120) ||
    (per.find((p) => p.caption)?.caption.split("\n")[0].slice(0, 80) ?? "") ||
    note.split("\n")[0].slice(0, 80) ||
    "Post sem título";

  // Garante no Drive a pasta de cada destino (dia / rede / formato). Se falhar, o post é criado
  // mesmo assim e a tela do dia avisa; a pasta pode ser criada depois com o botão do destino.
  const folderCache = new Map<string, string>();
  const folderIds: (string | null)[] = [];
  let folderError: string | null = null;
  for (const [network, format] of targets) {
    const names = folderNames(day, network, format);
    if (!root || !names || folderError) {
      folderIds.push(null);
      continue;
    }
    const res = await ensureFolderPath(root, names, folderCache);
    if ("error" in res) {
      folderError = res.error;
      folderIds.push(null);
    } else {
      folderIds.push(res.id);
    }
  }

  const c = await pool.connect();
  try {
    await c.query("begin");
    const p = await c.query<{ id: string }>(
      "insert into posts (client_id, title, idea) values ($1,$2,'') returning id",
      [clientId, title],
    );
    for (const [i, t] of per.entries()) {
      await c.query(
        `insert into post_targets (post_id, network, format, scheduled_at, caption, drive_url, drive_file_id, drive_meta, post_folder_id)
         values ($1,$2,$3,($4::date + $5::time) at time zone '${TZ}',$6,$7,$8,$9,$10)`,
        [p.rows[0].id, t.network, t.format, day, time, t.caption, t.driveUrl, t.fileId, t.meta ? JSON.stringify(t.meta) : null, folderIds[i]],
      );
    }
    if (note) {
      await c.query(
        `insert into day_notes (client_id, day, body) values ($1, $2::date, $3)
         on conflict (client_id, day) do update set
           body = case when day_notes.body = '' then excluded.body else day_notes.body || E'\n\n' || excluded.body end,
           updated_at = now()`,
        [clientId, day, note],
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  revalidatePath("/", "layout");
  const dayPath = `/clientes/${clientId}/dia/${day}`;
  redirect(folderError ? withParam(dayPath, "aviso", `O post foi criado, mas a pasta no Drive não: ${folderError}`) : dayPath);
}

/** Cria (ou encontra) no Drive a pasta de um destino que ainda não tem pasta. */
export async function ensureTargetFolder(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
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

export async function saveTarget(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
  const back = safePath(text(formData, "volta", 300), "/");
  const caption = text(formData, "caption", 70000);
  const time = text(formData, "time", 5);
  const day = text(formData, "date", 10);
  const driveUrl = text(formData, "drive_url", 500);
  const status = text(formData, "status", 12);
  if (!["draft", "scheduled", "posted"].includes(status)) redirect(back);
  if (!isTime(time) || !isDay(day)) redirect(withParam(back, "erro", "Informe uma data e um horário válidos."));

  const pool = await db();
  const cur = await pool.query<{ drive_url: string; drive_file_id: string | null; drive_meta: MediaMeta | null; day: string }>(
    `select drive_url, drive_file_id, drive_meta, to_char(scheduled_at at time zone '${TZ}', 'YYYY-MM-DD') as day
       from post_targets where id = $1`,
    [id],
  );
  if (!cur.rows[0]) redirect("/");
  let { drive_file_id: fileId, drive_meta: meta } = cur.rows[0];
  if (driveUrl !== cur.rows[0].drive_url || (meta && meta.error)) {
    ({ fileId, meta } = await resolveDrive(driveUrl));
  }
  await pool.query(
    `update post_targets set caption=$1, scheduled_at=($2::date + $3::time) at time zone '${TZ}',
        status=$4, posted_at = case when $4='posted' then coalesce(posted_at, now()) else null end,
        drive_url=$5, drive_file_id=$6, drive_meta=$7 where id=$8`,
    [caption, day, time, status, driveUrl, fileId, meta ? JSON.stringify(meta) : null, id],
  );
  // Mudou o dia: a pasta guardada era a do dia antigo. Limpa para criar a do dia novo com o botão.
  if (cur.rows[0].day !== day) await pool.query("update post_targets set post_folder_id = null where id = $1", [id]);
  revalidatePath("/", "layout");
  redirect(withParam(back, "salvo", id) + `#t-${id}`);
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

export async function deleteTarget(formData: FormData): Promise<void> {
  await requireAuth();
  const id = text(formData, "id", 40);
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
  plan: string;
  draft: string;
}): Promise<AiResult> {
  await requireAuth();
  const network = String(input.network);
  const format = String(input.format);
  if (!isNetwork(network) || !isFormat(network, format)) return { error: "rede ou formato inválido." };
  if (!/^[0-9a-f-]{36}$/i.test(String(input.clientId))) return { error: "cliente inválido." };
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
    captionDraft: String(input.draft ?? "").slice(0, 4000),
  });
  return generateText(prompt);
}
