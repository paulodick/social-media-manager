import Link from "next/link";
import { notFound } from "next/navigation";
import PlannedSlots from "@/components/PlannedSlots";
import { ClientAvatar, Flash, NetDot } from "@/components/ui";
import { NETWORKS, NETWORK_IDS, STATUS_LABEL, isNetwork } from "@/config/networks";
import { addMonths, dayLabel, isMonth, monthGrid, monthLabel, monthOf, todaySP } from "@/lib/dates";
import { listPlannedGroups } from "@/lib/editorial-queries";
import { getClient, listDayNotes, listTargets, type Target } from "@/lib/queries";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function ClientCalendar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; rede?: string; status?: string; aviso?: string; ok?: string }>;
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
  // Filtro de rede: só as redes cadastradas no cliente (mais a que estiver selecionada na URL, para poder limpar).
  const filterNets = NETWORK_IDS.filter((n) => networks.some((x) => x.network === n) || n === rede);
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
  // O que a sequência planejou e ainda não foi aprovado aparece no mesmo calendário, tracejado.
  // Com filtro de situação, só aparece no filtro "Rascunho" (é o que vira ao aprovar).
  const plannedAll = status && status !== "draft" ? [] : await listPlannedGroups(id, cells[0].day, cells[cells.length - 1].day);
  const planned = rede ? plannedAll.filter((g) => g.networks.some((n) => n.network === rede)) : plannedAll;
  const plannedByDay = new Map<string, typeof planned>();
  for (const g of planned) plannedByDay.set(g.day, [...(plannedByDay.get(g.day) ?? []), g]);

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
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="row between">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <ClientAvatar client={client} size="lg" />
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

      <Flash ok={sp.ok} aviso={sp.aviso} />

      <nav className="tabs" aria-label="Seções do cliente">
        <Link href={`/clientes/${id}`} className="on">Calendário</Link>
        <Link href={`/clientes/${id}/semana`}>Semana</Link>
        <Link href={`/clientes/${id}/editorial`}>Conteúdos</Link>
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
          {filterNets.map((n) => (
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
        <span className="row" style={{ gap: 8 }}><span className="mini planned" style={{ width: 22, height: 14, minHeight: 0, padding: 0 }} />Planejado (falta aprovar)</span>
        <span className="row" style={{ gap: 8 }}><span className="mini note" style={{ width: 22, height: 14, minHeight: 0, padding: 0 }} />Ideia do dia</span>
        <span>Clique em um dia para abrir os posts, a prévia e o que está planejado.</span>
      </div>

      <PlannedSlots clientId={id} groups={planned} mode="bar" />

      <div className="cal">
        <div className="cal-in">
          <div className="cal-head">{WEEK.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-body">
            {cells.map((c) => {
              const list = byDay.get(c.day) ?? [];
              const plan = plannedByDay.get(c.day) ?? [];
              const note = notes[c.day];
              // Dia só com ideia (sem posts nem planejado): abre direto o Novo post, com a ideia já preenchida.
              // Com posts ou planejado, abre o dia.
              const href =
                list.length === 0 && plan.length === 0 && note ? `/posts/novo?cliente=${id}&data=${c.day}` : `/clientes/${id}/dia/${c.day}`;
              return (
                <Link
                  key={c.day}
                  href={href}
                  className={`cell ${c.inMonth ? "" : "out"} ${c.day === today ? "today" : ""}`}
                  aria-label={`${dayLabel(c.day)}, ${list.length} ${list.length === 1 ? "post" : "posts"}${plan.length ? `, ${plan.length} planejado(s) sem aprovar` : ""}${note ? `, ideia: ${note}` : ""}`}
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
                  {plan.slice(0, Math.max(0, 4 - list.length)).map((g) => (
                    <span key={g.key} className="mini planned" title={`Planejado (falta aprovar): ${g.title}`}>
                      {g.networks.slice(0, 2).map((n) => <NetDot key={n.network + n.format} network={n.network} />)}
                      {g.time && <span style={{ fontVariantNumeric: "tabular-nums" }}>{g.time}</span>}
                      <span className="t">{g.title}</span>
                    </span>
                  ))}
                  {list.length < 4 && plan.length > 4 - list.length && <span className="muted small">+{plan.length - (4 - list.length)} planejado(s)</span>}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
