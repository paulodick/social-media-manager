"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, createSession, destroySession, requireAuth } from "./auth";
import { db } from "./db";
import { TZ, isDay, isTime } from "./dates";
import { getFileMeta, parseDriveUrl } from "./drive";
import type { MediaMeta } from "./checks";
import { NETWORK_IDS, isFormat, isNetwork } from "@/config/networks";

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
  const ok = checkPassword(text(formData, "senha", 200));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    redirect("/login?erro=1");
  }
  await createSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// ---------- clientes ----------

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
  revalidatePath("/", "layout");
  redirect(`/clientes/${clientId}`);
}

// ---------- posts ----------

async function resolveDrive(url: string): Promise<{ fileId: string | null; meta: MediaMeta | null }> {
  const ref = parseDriveUrl(url);
  if (!url || !ref) return { fileId: null, meta: url ? { error: "o link não parece ser de um arquivo do Google Drive." } : null };
  if (ref.kind === "folder") return { fileId: null, meta: { error: "este link é de uma pasta. Cole o link de um arquivo." } };
  const meta = await getFileMeta(ref.id);
  return { fileId: ref.id, meta };
}

export async function createPost(formData: FormData): Promise<void> {
  await requireAuth();
  const clientId = text(formData, "client_id", 40);
  const day = text(formData, "date", 10);
  const time = text(formData, "time", 5);
  const idea = text(formData, "idea", 4000);
  const driveUrl = text(formData, "drive_url", 500);
  const back = `/posts/novo?cliente=${encodeURIComponent(clientId)}`;
  if (!isDay(day) || !isTime(time)) redirect(withParam(back, "erro", "Informe uma data e um horário válidos."));

  const targets = formData
    .getAll("target")
    .map(String)
    .map((v) => v.split(":"))
    .filter(([n, f]) => isNetwork(n) && isFormat(n, f));
  if (!targets.length) redirect(withParam(back, "erro", "Escolha pelo menos uma rede e um formato."));

  const pool = await db();
  const exists = await pool.query("select 1 from clients where id = $1", [clientId]).catch(() => ({ rowCount: 0 }));
  if (!exists.rowCount) redirect("/");

  const title = text(formData, "title", 120) || idea.split("\n")[0].slice(0, 80) || "Post sem título";
  const { fileId, meta } = await resolveDrive(driveUrl);

  const c = await pool.connect();
  try {
    await c.query("begin");
    const p = await c.query<{ id: string }>(
      "insert into posts (client_id, title, idea) values ($1,$2,$3) returning id",
      [clientId, title, idea],
    );
    for (const [network, format] of targets) {
      await c.query(
        `insert into post_targets (post_id, network, format, scheduled_at, caption, drive_url, drive_file_id, drive_meta)
         values ($1,$2,$3,($4::date + $5::time) at time zone '${TZ}',$6,$7,$8,$9)`,
        [p.rows[0].id, network, format, day, time, idea, driveUrl, fileId, meta ? JSON.stringify(meta) : null],
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
  redirect(`/clientes/${clientId}/dia/${day}`);
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
  const cur = await pool.query<{ drive_url: string; drive_file_id: string | null; drive_meta: MediaMeta | null }>(
    "select drive_url, drive_file_id, drive_meta from post_targets where id = $1",
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
