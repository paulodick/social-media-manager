import Link from "next/link";
import { BackLink, Flash, NetDot } from "@/components/ui";
import { NETWORKS, isNetwork } from "@/config/networks";
import { createPost } from "@/lib/actions";
import { isDay, todaySP } from "@/lib/dates";
import { getClient, listClients } from "@/lib/queries";

export default async function NewPost({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; data?: string; erro?: string }>;
}) {
  const sp = await searchParams;
  const found = sp.cliente ? await getClient(sp.cliente) : null;

  if (!found) {
    const clients = await listClients();
    return (
      <main className="main narrow">
        <header className="col">
          <BackLink href="/">← Voltar para o início</BackLink>
          <h1>Novo post</h1>
          <p className="muted">Para qual cliente?</p>
        </header>
        <div className="grid3">
          {clients.map((c) => (
            <Link key={c.id} href={`/posts/novo?cliente=${c.id}${sp.data ? `&data=${sp.data}` : ""}`} className="card" style={{ textDecoration: "none" }}>
              <h2>{c.name}</h2>
              <span className="muted small">{c.segment || "Sem segmento"}</span>
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
  return (
    <main className="main narrow">
      <header className="col">
        <BackLink href={`/clientes/${client.id}`}>← {client.name}</BackLink>
        <h1>Novo post</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Escreva a ideia e escolha onde vai sair. Cada rede começa com a ideia como legenda, e você ajusta na tela do dia.
        </p>
      </header>
      <Flash erro={sp.erro} />
      <form action={createPost} className="col" style={{ gap: 20 }}>
        <input type="hidden" name="client_id" value={client.id} />

        <section className="card" aria-labelledby="s1">
          <h2 id="s1">1. Redes e formatos</h2>
          {networks.length === 0 ? (
            <p className="alert err">Este cliente ainda não tem redes. <Link href={`/clientes/${client.id}/editar`} style={{ textDecoration: "underline" }}>Cadastre as redes</Link>.</p>
          ) : (
            <fieldset style={{ margin: 0, padding: 0, border: 0 }} className="col">
              <legend className="sr">Onde vai sair</legend>
              {networks.filter((n) => isNetwork(n.network)).flatMap((n) => {
                const cfg = NETWORKS[n.network as keyof typeof NETWORKS];
                return Object.entries(cfg.formats).map(([fid, f]) => (
                  <label className="opt" key={`${n.network}:${fid}`}>
                    <input type="checkbox" name="target" value={`${n.network}:${fid}`} />
                    <NetDot network={n.network} />
                    <b>{cfg.label}</b>
                    <span className="muted">{f.label}</span>
                  </label>
                ));
              })}
            </fieldset>
          )}
          <div className="grid2">
            <div className="col">
              <label className="f" htmlFor="date">Data</label>
              <input id="date" name="date" type="date" defaultValue={date} required />
            </div>
            <div className="col">
              <label className="f" htmlFor="time">Horário</label>
              <input id="time" name="time" type="time" defaultValue="10:00" required />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="s2">
          <h2 id="s2">2. A ideia</h2>
          <div className="col">
            <label className="f" htmlFor="title">Título interno (opcional)</label>
            <input id="title" name="title" type="text" maxLength={120} placeholder="Ex.: Reels do plantão técnico" />
          </div>
          <div className="col">
            <label className="f" htmlFor="idea">O que o post precisa dizer</label>
            <textarea id="idea" name="idea" rows={6} />
          </div>
          <p className="muted small">A geração de legendas com IA, no tom de voz do cliente, chega na próxima etapa.</p>
        </section>

        <section className="card" aria-labelledby="s3">
          <h2 id="s3">3. Mídia</h2>
          <div className="col">
            <label className="f" htmlFor="drive_url">Link do arquivo no Google Drive (opcional)</label>
            <input id="drive_url" name="drive_url" type="text" placeholder="https://drive.google.com/file/d/…/view" />
            <span className="muted small">Pode ser preenchido depois, na tela do dia.</span>
          </div>
        </section>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Link href={`/clientes/${client.id}`} className="btn">Cancelar</Link>
          <button type="submit" className="btn primary" disabled={networks.length === 0}>Criar post</button>
        </div>
      </form>
    </main>
  );
}
