import { db } from "@/lib/db";
import { hasPassword } from "@/lib/auth";
import { driveConfigured, driveStatus, serviceAccountEmail } from "@/lib/drive";

async function dbOk(): Promise<boolean> {
  try {
    await (await db()).query("select 1");
    return true;
  } catch {
    return false;
  }
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="check">
      <span className={`tag ${ok ? "ok" : "warn"}`}>{ok ? "OK" : "Falta"}</span>
      <span>
        <b>{label}</b>
        {detail && <span className="muted"> {detail}</span>}
      </span>
    </div>
  );
}

export default async function Settings() {
  const database = await dbOk();
  const password = database && (await hasPassword());
  return (
    <main className="main narrow">
      <h1>Configurações</h1>
      <section className="card">
        <h2>Estado do app</h2>
        <Row ok={database} label="Banco de dados" detail={database ? "conectado." : "não conectou. Confira DATABASE_URL."} />
        <Row
          ok={password}
          label="Senha de acesso"
          detail={process.env.APP_PASSWORD ? "definida pela variável APP_PASSWORD." : "guardada no banco, definida na primeira configuração."}
        />
        <Row ok={(process.env.SESSION_SECRET?.length ?? 0) >= 16} label="Segredo da sessão" detail="variável SESSION_SECRET, com pelo menos 16 caracteres." />
        <Row
          ok={driveConfigured()}
          label="Google Drive"
          detail={
            driveConfigured()
              ? `conta de serviço: ${serviceAccountEmail()}`
              : driveStatus() === "invalid"
                ? "a variável GOOGLE_SERVICE_ACCOUNT_JSON existe, mas o conteúdo não é um JSON de conta de serviço completo (precisa de client_email e private_key). Cole o arquivo inteiro de novo."
                : "variável GOOGLE_SERVICE_ACCOUNT_JSON ainda não definida."
          }
        />
        <Row ok={!!process.env.ANTHROPIC_API_KEY} label="Legendas com IA" detail="variável ANTHROPIC_API_KEY (etapa 2)." />
      </section>
      <section className="card">
        <h2>Como liberar uma pasta do Drive</h2>
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>No Google Drive, clique com o botão direito na pasta do cliente e escolha Compartilhar.</li>
          <li>Adicione o e-mail da conta de serviço acima, com a permissão de Editor para o app criar as pastas do post (com Leitor ele só lê).</li>
          <li>Copie o link da pasta e cole no cadastro do cliente.</li>
        </ol>
      </section>
    </main>
  );
}
