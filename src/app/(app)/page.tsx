import Link from "next/link";
import { NetChip, ClientAvatar, Flash, StatusPill } from "@/components/ui";
import { isNetwork } from "@/config/networks";
import { dayLabel, todaySP } from "@/lib/dates";
import { listClients, listTargets } from "@/lib/queries";

export default async function Home({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; aviso?: string }> }) {
  const { erro, ok, aviso } = await searchParams;
  const today = todaySP();
  const [clients, due] = await Promise.all([listClients(), listTargets({ dueUntil: today })]);
  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="row between">
        <h1>Início</h1>
        <div className="row">
          <Link href="/clientes/novo" className="btn">Cadastrar novo cliente</Link>
          <Link href="/posts/novo" className="btn primary">Novo post</Link>
        </div>
      </header>
      <Flash erro={erro} ok={ok} aviso={aviso} />

      <section className="card" aria-labelledby="hoje">
        <div className="row between">
          <div className="col">
            <h2 id="hoje">Para postar hoje</h2>
            <span className="muted small">
              {dayLabel(today)}. {due.length} {due.length === 1 ? "destino" : "destinos"} pendente{due.length === 1 ? "" : "s"}.
            </span>
          </div>
          <Link href="/postar-hoje" style={{ fontWeight: 600, textDecoration: "underline" }}>Abrir lista de hoje</Link>
        </div>
        {due.length === 0 ? (
          <p className="muted">Nada pendente para hoje.</p>
        ) : (
          <div>
            {due.map((t) => (
              <div className="today-row" key={t.id}>
                <b style={{ flex: "0 0 130px" }}>{t.client_name}</b>
                <NetChip network={t.network} format={t.format} />
                <span className="muted" style={{ flex: "0 0 52px", fontVariantNumeric: "tabular-nums" }}>{t.time}</span>
                <Link href={`/clientes/${t.client_id}/dia/${t.day}#t-${t.id}`} style={{ flex: "1 1 240px", minWidth: 0 }}>{t.title}</Link>
                <StatusPill status={t.status} late={t.late} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="clientes" className="col" style={{ gap: 16 }}>
        <h2 id="clientes">Clientes</h2>
        {clients.length === 0 ? (
          <div className="card">
            <p>Nenhum cliente cadastrado ainda.</p>
            <div><Link href="/clientes/novo" className="btn primary">Cadastrar o primeiro cliente</Link></div>
          </div>
        ) : (
          <div className="grid3">
            {clients.map((c) => (
              <Link key={c.id} href={`/clientes/${c.id}`} className="card" style={{ textDecoration: "none" }}>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <ClientAvatar client={c} />
                  <div className="col" style={{ gap: 0, minWidth: 0 }}>
                    <h2 style={{ fontSize: 19 }}>{c.name}</h2>
                    <span className="muted small">{c.segment || "Sem segmento"}</span>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {c.networks.filter(isNetwork).map((n) => (
                    <NetChip key={n} network={n} />
                  ))}
                  {c.networks.length === 0 && <span className="muted small">Nenhuma rede cadastrada</span>}
                </div>
                <div className="row between" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <span className="muted small">Próximos 7 dias</span>
                  <b>{c.upcoming} {c.upcoming === 1 ? "post" : "posts"}</b>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
