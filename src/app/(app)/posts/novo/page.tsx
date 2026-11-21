import Link from "next/link";
import { redirect } from "next/navigation";
import PostEditor from "@/components/PostEditor";
import { BackLink, ClientAvatar, Flash } from "@/components/ui";
import { aiConfigured } from "@/lib/ai";
import { isDay, todaySP } from "@/lib/dates";
import { pickerOptions } from "@/lib/picker-options";
import { getClient, listClients, listDayNotes } from "@/lib/queries";

export default async function NewPost({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; data?: string; erro?: string }>;
}) {
  const sp = await searchParams;
  const found = sp.cliente ? await getClient(sp.cliente) : null;

  if (!found) {
    const clients = await listClients();
    // Com um cliente só, não há o que escolher: vai direto para o formulário.
    if (clients.length === 1) redirect(`/posts/novo?cliente=${clients[0].id}${isDay(sp.data) ? `&data=${sp.data}` : ""}`);
    return (
      <main id="conteudo" tabIndex={-1} className="main narrow">
        <header className="col">
          <BackLink href="/">← Voltar para o início</BackLink>
          <h1>Novo post</h1>
          <p className="muted">Para qual cliente?</p>
        </header>
        <div className="grid3">
          {clients.map((c) => (
            <Link key={c.id} href={`/posts/novo?cliente=${c.id}${sp.data ? `&data=${sp.data}` : ""}`} className="card" style={{ textDecoration: "none" }}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <ClientAvatar client={c} />
                <div className="col" style={{ gap: 0, minWidth: 0 }}>
                  <h2>{c.name}</h2>
                  <span className="muted small">{c.segment || "Sem segmento"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {clients.length === 0 && (
          <div className="card"><p>Cadastre um cliente primeiro.</p><div><Link className="btn primary" href="/clientes/novo">Cadastrar cliente</Link></div></div>
        )}
      </main>
    );
  }

  const { client, networks } = found;
  const date = isDay(sp.data) ? sp.data : todaySP();
  const savedNote = (await listDayNotes(client.id, date, date))[date] ?? "";
  const profiles = Object.fromEntries(
    networks.map((n) => [n.network, { name: n.account_name || client.name, handle: (n.account_name || client.name).toLowerCase().replace(/\s+/g, "") }]),
  );
  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="col">
        <BackLink href={`/clientes/${client.id}`}>← {client.name}</BackLink>
        <h1>Novo post</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Anote a ideia do post, dê um nome para achá-lo depois e descreva o que quer na legenda. Quando já souber, escolha onde vai sair e gere ou cole a legenda e o link do vídeo de cada rede. Esta é a mesma tela que você usa depois para editar o post.
        </p>
      </header>
      <Flash erro={sp.erro} />
      {networks.length === 0 ? (
        <div className="card">
          <p className="alert err">Este cliente ainda não tem redes. <Link href={`/clientes/${client.id}/editar`} style={{ textDecoration: "underline" }}>Cadastre as redes</Link>.</p>
        </div>
      ) : (
        <PostEditor
          client={{ id: client.id, name: client.name, segment: client.segment, site: client.site, tone: client.tone, notes: client.notes }}
          canCreateFolder={!!client.drive_folder_id}
          options={pickerOptions(networks)}
          aiEnabled={aiConfigured()}
          volta="/posts/novo"
          day={date}
          defaultTime="10:00"
          note={savedNote}
          postName=""
          brief=""
          tones={[]}
          targets={[]}
          profiles={profiles}
        />
      )}
    </main>
  );
}
