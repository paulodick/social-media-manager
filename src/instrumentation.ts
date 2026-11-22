/** Roda uma vez quando o servidor do Next sobe. Liga o relógio da publicação automática por horário. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTO_PUBLISH_DISABLED === "1") return;
  if (!process.env.DATABASE_URL) return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
