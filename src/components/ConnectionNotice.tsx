import type { TokenHealth } from "@/lib/publish/meta-health";

/**
 * Aviso da conexão com uma rede (Meta ou LinkedIn). `quiet`: só aparece quando precisa de atenção (tela do dia).
 * `provider` escolhe o texto e o endereço de reconexão.
 */
export default function ConnectionNotice({
  health,
  clientId,
  quiet = false,
  provider = "meta",
}: {
  health: TokenHealth | null;
  clientId: string;
  quiet?: boolean;
  provider?: "meta" | "linkedin";
}) {
  if (!health) return null;
  if (health.state === "ok" && quiet) return null;
  // Meta é feminino ("a Meta ... conectada"); LinkedIn é masculino.
  const li = provider === "linkedin";
  const nome = li ? "LinkedIn" : "Meta";
  const art = li ? "o" : "a";
  const conectado = li ? "conectado" : "conectada";
  const href = li ? `/api/linkedin/conectar?cliente=${clientId}` : `/api/meta/conectar?cliente=${clientId}`;
  const cta = li ? "Reconectar LinkedIn" : "Reconectar Facebook e Instagram";
  const cls = health.state === "ok" ? "ok" : health.state === "unknown" ? "warn" : health.state === "attention" ? "warn" : "err";
  const title =
    health.state === "ok"
      ? `${nome} ${conectado}`
      : health.state === "unknown"
        ? `Não deu para conferir ${art} ${nome}`
        : health.state === "attention"
          ? `${nome} ${conectado}, com um aviso`
          : `${art === "o" ? "O" : "A"} ${nome} precisa ser ${conectado} de novo`;
  const needsLink = health.state === "reconnect" || health.state === "attention";
  return (
    <div className={`alert ${cls}`} role={health.state === "reconnect" ? "alert" : "status"}>
      <b>{title}.</b> {health.message}
      {needsLink && (
        <>
          {" "}
          {/* Link comum (não Link do Next): a rota redireciona para fora do app. */}
          <a href={href}>{cta}</a>
        </>
      )}
    </div>
  );
}
