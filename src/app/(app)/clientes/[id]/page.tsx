import Link from "next/link";
import { notFound } from "next/navigation";
import { Initials, NetDot } from "@/components/ui";
import { NETWORKS, NETWORK_IDS, STATUS_LABEL, isNetwork } from "@/config/networks";
import { addMonths, isMonth, monthGrid, monthLabel, monthOf, todaySP } from "@/lib/dates";
import { getClient, listDayNotes, listTargets, type Target } from "@/lib/queries";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function ClientCalendar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; rede?: string; status?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await getClient(id);
  if (!data) notFound();
  const { client, networks } = data;

  const today = todaySP();
  const mes = isMonth(sp.mes) ? sp.mes : monthOf(today);
  const rede = sp.rede && isNetwork(sp.rede) ? sp.rede : "";
  const status = sp.status && sp.status in STATUS_LABEL ? sp.status : "";
  const cells = monthGrid(mes);
  const targets = await listTargets({
    clientId: id,
    from: cells[0].day,
    to: cells[cells.length - 1].day,
    network: rede || undefined,
    status: status || undefined,
  });
  const notes = await listDayNotes(id, cells[0].day, cells[cells.length - 1].day);
  const byDay = new Map<string, Target[]>();
  for (const t of targets) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);

  const href = (over: { mes?: string; rede?: string; status?: string }) => {
    const q = new URLSearchParams();
    const m = over.mes ?? mes;
    const r = over.rede ?? rede;
    const s = over.status ?? status;
    if (m !== monthOf(today)) q.set("mes", m);
    if (r) q.set("rede", r);
    if (s) q.set("status", s);
    const qs = q.toString();
    return `/clientes/${id}${qs ? "?" + qs : ""}`;
  };

  return (
    <main className="main">
      <header className="row between">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <Initials name={client.name} />
          <div className="col" style={{ gap: 0 }}>
            <h1>{client.name}</h1>
            <span className="muted small">
              {client.segment || "Sem segmento"}.{" "}
              {networks.length ? networks.map((n) => NETWORKS[n.network as keyof typeof NETWORKS]?.label ?? n.network).join(", ") : "Nenhuma rede cadastrada."}
            </span>
          </div>
        </div>
        <Link href={`/posts/novo?cliente=${id}`} className="btn primary">Novo post</Link>
      </header>

      <nav className="tabs" aria-label="Seções do cliente">
        <Link href={`/clientes/${id}`} className="on">Calendário</Link>
        <Link href={`/clientes/${id}/editar`}>Cadastro e redes</Link>
      </nav>

      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <Link href={href({ mes: addMonths(mes, -1) })} className="btn" aria-label="Mês anterior" style={{ width: 44, padding: 0 }}>‹</Link>
          <h2 style={{ minWidth: 190, textAlign: "center", fontSize: 22 }}>{monthLabel(mes)}</h2>
          <Link href={href({ mes: addMonths(mes, 1) })} className="btn" aria-label="Próximo mês" style={{ width: 44, padding: 0 }}>›</Link>
          <Link href={href({ mes: monthOf(today) })} className="btn" style={{ marginLeft: 8 }}>Hoje</Link>
        </div>
      </div>

      <div className="row" style={{ gap: "10px 28px" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted small" style={{ fontWeight: 600 }}>Rede</span>
          <Link href={href({ rede: "" })} className={`filter ${rede === "" ? "on" : ""}`}>Todas</Link>
          {NETWORK_IDS.map((n) => (
            <Link key={n} href={href({ rede: n })} className={`filter ${rede === n ? "on" : ""}`}>{NETWORKS[n].label}</Link>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted small" style={{ fontWeight: 600 }}>Status</span>
          <Link href={href({ status: "" })} className={`filter ${status === "" ? "on" : ""}`}>Todos</Link>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <Link key={k} href={href({ status: k })} className={`filter ${status === k ? "on" : ""}`}>{v}</Link>
          ))}
        </div>
      </div>

      <div className="row small muted" style={{ gap: "8px 20px" }}>
        <span className="row" style={{ gap: 8 }}><span className="mini draft" style={{ width: 22, height: 14, padding: 0 }} />Rascunho</span>
        <span className="row" style={{ gap: 8 }}><span className="mini scheduled" style={{ width: 22, height: 14, padding: 0 }} />Agendado</span>
        <span className="row" style={{ gap: 8 }}><span className="mini posted" style={{ width: 22, height: 14, padding: 0 }} />Postado</span>
        <span className="row" style={{ gap: 8 }}><span className="mini late" style={{ width: 22, height: 14, padding: 0 }} />Atrasado</span>
        <span className="row" style={{ gap: 8 }}><span className="mini note" style={{ width: 22, height: 14, minHeight: 0, padding: 0 }} />Planejamento</span>
        <span>Clique em um dia para abrir os posts e a prévia.</span>
      </div>

      <div className="cal">
        <div className="cal-in">
          <div className="cal-head">{WEEK.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-body">
            {cells.map((c) => {
              const list = byDay.get(c.day) ?? [];
              const note = notes[c.day];
              return (
                <Link
                  key={c.day}
                  href={`/clientes/${id}/dia/${c.day}`}
                  className={`cell ${c.inMonth ? "" : "out"} ${c.day === today ? "today" : ""}`}
                  aria-label={`${c.day}, ${list.length} ${list.length === 1 ? "post" : "posts"}${note ? `, planejamento: ${note}` : ""}`}
                >
                  <span className="n">{c.inMonth ? c.n : `${c.n}/${c.day.slice(5, 7)}`}</span>
                  {note && (
                    <span className="mini note" title={note}>
                      <span className="t">{note}</span>
                    </span>
                  )}
                  {list.slice(0, 4).map((t) => (
                    <span key={t.id} className={`mini ${t.late ? "late" : t.status}`} title={`${t.time} ${t.title}`}>
                      <NetDot network={t.network} />
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{t.time}</span>
                      <span className="t">{t.title}</span>
                    </span>
                  ))}
                  {list.length > 4 && <span className="muted small">+{list.length - 4} mais</span>}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
