import { notFound, redirect } from "next/navigation";
import { BackLink, Flash } from "@/components/ui";
import { connectMetaPage } from "@/lib/actions";
import { readPending } from "@/lib/meta-pending";
import { listPages } from "@/lib/publish/meta-oauth";
import { getClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Só aparece quando o login da Meta liberou mais de uma Página: a pessoa escolhe qual é deste cliente.
export default async function ConectarMeta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getClient(id);
  if (!data) notFound();
  const userToken = await readPending(id);
  if (!userToken) redirect(`/clientes/${id}/editar?erro=${encodeURIComponent("A escolha expirou. Clique em Conectar de novo.")}`);
  let erro: string | undefined;
  let pages: Awaited<ReturnType<typeof listPages>> = [];
  try {
    pages = await listPages(userToken);
  } catch (e) {
    erro = e instanceof Error ? e.message : "Não foi possível ler as Páginas.";
  }
  return (
    <main className="main narrow">
      <header className="col">
        <BackLink href={`/clientes/${id}/editar`}>← Voltar para editar {data.client.name}</BackLink>
        <h1>Qual Página é de {data.client.name}?</h1>
        <p className="muted">A Meta liberou mais de uma Página. Escolha a deste cliente; o Instagram profissional ligado a ela é conectado junto.</p>
      </header>
      <Flash erro={erro} />
      <ul className="col" style={{ listStyle: "none", padding: 0 }}>
        {pages.map((p) => (
          <li key={p.id}>
            <form action={connectMetaPage} className="card">
              <input type="hidden" name="clientId" value={id} />
              <input type="hidden" name="pageId" value={p.id} />
              <div className="row between">
              <div className="col" style={{ gap: 0 }}>
                <strong>{p.name}</strong>
                <span className="muted small">{p.ig ? `Instagram ${p.ig.username ? "@" + p.ig.username : "ligado"}` : "Sem Instagram profissional ligado"}</span>
              </div>
              <button className="btn primary" type="submit">Conectar esta Página</button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
