import { db } from "@/lib/db";
import { hasPassword } from "@/lib/auth";
import { driveConfigured, driveStatus, folderUrl, getFolderName, serviceAccountEmail } from "@/lib/drive";
import { getDriveRoot } from "@/lib/drive-root";
import { saveDriveRoot } from "@/lib/actions";
import { Flash } from "@/components/ui";

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

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const database = await dbOk();
  const password = database && (await hasPassword());
  const rootId = database ? await getDriveRoot().catch(() => null) : null;
  const root = rootId && driveConfigured() ? await getFolderName(rootId) : null;
  return (
    <main className="main narrow">
      <h1>Configurações</h1>
      <Flash erro={sp.erro} ok={sp.ok} />
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
        <Row ok={!!process.env.ANTHROPIC_API_KEY} label="Legendas com IA" detail="variável ANTHROPIC_API_KEY (liga o botão Gerar legenda)." />
      </section>
      <section className="card" aria-labelledby="raiz">
        <h2 id="raiz">Pasta dos clientes no Drive</h2>
        <p className="muted small" style={{ maxWidth: "70ch" }}>
          É a pasta que guarda as pastas de todos os clientes. O botão <b>Criar diretório</b>, no cadastro do cliente, cria a pasta
          do cliente (com a subpasta Logotipo) aqui dentro. Compartilhe esta pasta, como Editor, com o e-mail de acesso do app:{" "}
          <b style={{ color: "var(--ink)" }}>{serviceAccountEmail() ?? "[configure a conta de serviço]"}</b>.
        </p>
        <form action={saveDriveRoot} className="col" style={{ gap: 10 }}>
          <label className="f" htmlFor="drive_root_url">Link da pasta</label>
          <input id="drive_root_url" name="drive_root_url" type="text" placeholder="https://drive.google.com/drive/folders/…" defaultValue={rootId ? folderUrl(rootId) : ""} />
          {root && ("name" in root ? (
            <span className="small"><span className="tag ok">OK</span> O app enxerga a pasta <b>{root.name}</b>.</span>
          ) : (
            <span className="small"><span className="tag warn">Falta</span> {root.error}</span>
          ))}
          <div><button type="submit" className="btn primary">Salvar pasta</button></div>
        </form>
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
