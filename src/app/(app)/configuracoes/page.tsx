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

/** Linha de estado: quando está tudo certo mostra só uma palavra; quando falta algo, mostra o que fazer (com o nome da variável). */
function Row({ ok, label, good, problem }: { ok: boolean; label: string; good: string; problem: string }) {
  return (
    <div className="check">
      <span className={`tag ${ok ? "ok" : "warn"}`}>{ok ? "OK" : "Falta"}</span>
      <span>
        <b>{label}</b>
        <span className="muted"> {ok ? good : problem}</span>
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
    <main id="conteudo" tabIndex={-1} className="main narrow">
      <h1>Configurações</h1>
      <Flash erro={sp.erro} ok={sp.ok} />
      <section className="card">
        <h2>Estado do app</h2>
        <Row ok={database} label="Banco de dados" good="conectado." problem="não conectou. Confira a variável DATABASE_URL." />
        <Row
          ok={password}
          label="Senha de acesso"
          good="definida."
          problem="ainda não definida. Abra /configurar para criar a senha."
        />
        <Row
          ok={(process.env.SESSION_SECRET?.length ?? 0) >= 16}
          label="Segurança do login"
          good="configurada."
          problem="falta a variável SESSION_SECRET, com pelo menos 16 caracteres."
        />
        <Row
          ok={driveConfigured()}
          label="Google Drive"
          good="conectado."
          problem={
            driveStatus() === "invalid"
              ? "a variável GOOGLE_SERVICE_ACCOUNT_JSON existe, mas o conteúdo não é um JSON de conta de serviço completo (precisa de client_email e private_key). Cole o arquivo inteiro de novo."
              : "falta a variável GOOGLE_SERVICE_ACCOUNT_JSON."
          }
        />
        <Row
          ok={!!process.env.ANTHROPIC_API_KEY}
          label="Legendas com IA"
          good="ativas (botão Gerar legenda)."
          problem='desligadas. Para ligar, defina a variável ANTHROPIC_API_KEY. Enquanto isso, "Copiar pedido para a IA" funciona.'
        />
        <Row
          ok={!!process.env.GEMINI_API_KEY}
          label="Planejamento Editorial com IA (Gemini)"
          good="ativo (classificação e geração de calendário)."
          problem='desligado. Para ligar, defina a variável GEMINI_API_KEY. Enquanto isso, "Copiar pedido para a IA" funciona.'
        />
        {(() => {
          const missing: string[] = [];
          if (!process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
          if (!process.env.NOTIFY_EMAIL_TO?.trim()) missing.push("NOTIFY_EMAIL_TO");
          return (
            <Row
              ok={missing.length === 0}
              label="Aviso por e-mail"
              good="ativo (envia e-mail se uma publicação automática falhar ou perder o horário)."
              problem={`desligado. Para ligar, defina ${missing.join(" e ")}.`}
            />
          );
        })()}
        <details className="personalize">
          <summary>Detalhes técnicos</summary>
          <ul className="muted small" style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, paddingTop: 8 }}>
            <li>Senha: {process.env.APP_PASSWORD ? "definida pela variável APP_PASSWORD (tem prioridade)." : "guardada no banco, definida na primeira configuração."}</li>
            <li>Segurança do login: variável SESSION_SECRET.</li>
            <li>Google Drive: {driveConfigured() ? `conta de serviço ${serviceAccountEmail()}` : "variável GOOGLE_SERVICE_ACCOUNT_JSON."}</li>
            <li>Legendas com IA: variável ANTHROPIC_API_KEY.</li>
            <li>Planejamento Editorial com IA: variável GEMINI_API_KEY.</li>
            <li>Aviso por e-mail: variáveis RESEND_API_KEY e NOTIFY_EMAIL_TO.</li>
          </ul>
        </details>
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
