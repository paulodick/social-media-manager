import type { TokenHealth } from "@/lib/publish/meta-health";

/** Aviso da conexão com a Meta. `quiet`: só aparece quando precisa de atenção (tela do dia). */
export default function ConnectionNotice({ health, clientId, quiet = false }: { health: TokenHealth | null; clientId: string; quiet?: boolean }) {
  if (!health) return null;
  if (health.state === "ok" && quiet) return null;
  const cls = health.state === "ok" ? "ok" : health.state === "unknown" ? "warn" : health.state === "attention" ? "warn" : "err";
  const title =
    health.state === "ok" ? "Meta conectada" : health.state === "unknown" ? "Não deu para conferir a Meta" : health.state === "attention" ? "Meta conectada, com um aviso" : "A Meta precisa ser conectada de novo";
  const needsLink = health.state === "reconnect" || health.state === "attention";
  return (
    <div className={`alert ${cls}`} role={health.state === "reconnect" ? "alert" : "status"}>
      <b>{title}.</b> {health.message}
      {needsLink && (
        <>
          {" "}
          {/* Link comum (não Link do Next): a rota redireciona para fora do app. */}
          <a href={`/api/meta/conectar?cliente=${clientId}`}>Reconectar Facebook e Instagram</a>
        </>
      )}
    </div>
  );
}
