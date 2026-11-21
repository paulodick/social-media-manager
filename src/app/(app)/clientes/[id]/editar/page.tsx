import { notFound } from "next/navigation";
import ClientForm from "@/components/ClientForm";
import { BackLink, Flash } from "@/components/ui";
import { disconnectMeta } from "@/lib/actions";
import { getClient, listConnected } from "@/lib/queries";

export default async function EditClient({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string; aviso?: string }>;
}) {
  const { id } = await params;
  const { erro, ok, aviso } = await searchParams;
  const data = await getClient(id);
  if (!data) notFound();
  const connected = await listConnected(id);
  const fb = connected.facebook;
  const ig = connected.instagram;
  return (
    <main className="main narrow">
      <header className="col">
        <BackLink href={`/clientes/${id}`}>← Voltar para {data.client.name}</BackLink>
        <h1>Editar cliente</h1>
      </header>
      <Flash erro={erro} ok={ok} aviso={aviso} />
      <ClientForm client={data.client} networks={data.networks} />
      <section className="card" aria-labelledby="contas-meta">
        <h2 id="contas-meta">Contas conectadas (Facebook e Instagram)</h2>
        <p className="muted small">
          Conectando, o botão "Publicar agora" funciona para Instagram e Facebook deste cliente. O acesso fica guardado criptografado e só é usado quando você clica em publicar.
        </p>
        <ul className="col" style={{ listStyle: "none", padding: 0, gap: 4 }}>
          <li>Facebook: {fb ? <strong>{fb}</strong> : <span className="muted">não conectado</span>}</li>
          <li>Instagram: {ig ? <strong>{ig}</strong> : <span className="muted">não conectado</span>}</li>
        </ul>
        <div className="row">
          {/* Link comum (não Link do Next): a rota redireciona para fora do app. */}
          <a className="btn primary" href={`/api/meta/conectar?cliente=${id}`}>{fb || ig ? "Reconectar Facebook e Instagram" : "Conectar Facebook e Instagram"}</a>
          {(fb || ig) && (
            <form action={disconnectMeta}>
              <input type="hidden" name="clientId" value={id} />
              <button className="btn" type="submit">Desconectar</button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
