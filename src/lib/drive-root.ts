import { db } from "./db";

const KEY = "drive_root_folder_id";

/** Pasta do Drive onde ficam as pastas de todos os clientes. Vem do banco (Configurações) ou, se não houver, de DRIVE_ROOT_FOLDER_ID. */
export async function getDriveRoot(): Promise<string | null> {
  const r = await (await db()).query<{ value: string }>("select value from app_settings where key = $1", [KEY]);
  return r.rows[0]?.value || process.env.DRIVE_ROOT_FOLDER_ID?.trim() || null;
}

export async function setDriveRoot(id: string | null): Promise<void> {
  const pool = await db();
  if (!id) {
    await pool.query("delete from app_settings where key = $1", [KEY]);
    return;
  }
  await pool.query(
    `insert into app_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [KEY, id],
  );
}
