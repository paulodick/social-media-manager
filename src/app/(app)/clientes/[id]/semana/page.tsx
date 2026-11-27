import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientAvatar, Flash, NetDot } from "@/components/ui";
import { NETWORKS, isNetwork } from "@/config/networks";
import { readiness } from "@/lib/checks";
import { addDays, isDay, todaySP, weekDays, weekLabel, weekStart, weekdayShort } from "@/lib/dates";
import { getClient, listDayNotes, listTargets, type Target } from "@/lib/queries";

export default async function ClientWeek({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ semana?: string; modo?: string; aviso?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await getClient(id);
  if (!data) notFound();
  const { client } = data;

  const today = todaySP();
  // Padrão: sete dias a partir de hoje. Com modo=calendario, de segunda a domingo.
  const calendar = sp.modo === "calendario";
  const ref = isDay(sp.semana) ? sp.semana : today;
  const start = calendar ? weekStart(ref) : ref;
  const days = weekDays(start);
  const end = days[6];
  const home = calendar ? weekStart(today) : today;

  const targets = await listTargets({ clientId: id, from: start, to: end });
  const notes = await listDayNotes(id, start, end);
  const byDay = new Map<string, Target[]>();
  for (const t of targets) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);

  const info = new Map(
    targets.map((t) => [
      t.id,
      isNetwork(t.network)
        ? readiness({
            network: t.network,
            format: t.format,
            status: t.status,
            caption: t.caption,
            title: t.target_title,
            drive_meta: t.drive_meta,
            thumb_meta: t.thumb_meta,
          })
        : { state: "ok" as const, warns: 0, label: "Pronto" },
    ]),
  );

  const open = targets.filter((t) => t.status !== "posted");
  const missing = open.filter((t) => info.get(t.id)?.state === "missing").length;
  const withWarn = open.filter((t) => info.get(t.id)?.state === "warn").length;
  const late = open.filter((t) => t.late).length;
  const emptyDays = days.filter((d) => d >= today && !byDay.has(d) && !notes[d]).length;

  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const summary = [
    // Cada rede de um post conta separado (um post em Instagram e LinkedIn = 2 publicações).
    plural(targets.length, "publicação", "publicações"),
    missing ? `${missing} sem mídia` : "",
    withWarn ? plural(withWarn, "com aviso", "com avisos") : "",
    late ? plural(late, "atrasado", "atrasados") : "",
    emptyDays ? plural(emptyDays, "dia sem nada planejado", "dias sem nada planejado") : "",
  ].filter(Boolean);

  const href = (s: string, cal: boolean = calendar) => {
    const q = new URLSearchParams();
    if (cal) q.set("modo", "calendario");
    if (s !== (cal ? weekStart(today) : today)) q.set("semana", s);
    const qs = q.toString();
    return `/clientes/${id}/semana${qs ? "?" + qs : ""}`;
  };
  // Ao trocar de modo, a janela continua mostrando o mesmo período:
  // de "a partir de hoje" para segunda a domingo, abre a semana que contém o primeiro dia;
  // no sentido contrário, começa em hoje se a semana tem hoje, senão na segunda.
  const toCalendar = href(weekStart(start), true);
  const toRolling = href(days.includes(today) ? today : start, false);

  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="row between">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <ClientAvatar client={client} size="lg" />
          <div className="col" style={{ gap: 0 }}>
            <h1>{client.name}</h1>
            <span className="muted small">{client.segment || "Sem segmento"}</span>
          </div>
        </div>
        <Link href={`/posts/novo?cliente=${id}`} className="btn primary">Novo post</Link>
      </header>

      <Flash aviso={sp.aviso} />

      <nav className="tabs" aria-label="Seções do cliente">
        <Link href={`/clientes/${id}`}>Calendário</Link>
        <Link href={`/clientes/${id}/semana`} className="on">Semana</Link>
        <Link href={`/clientes/${id}/editorial`}>Conteúdos</Link>
        <Link href={`/clientes/${id}/editar`}>Cadastro e redes</Link>
      </nav>

      <div className="row" style={{ gap: 8 }}>
        <Link href={href(addDays(start, -7))} className="btn" aria-label="Semana anterior" style={{ width: 44, padding: 0 }}>‹</Link>
        <h2 className="wk-title">{weekLabel(start)}</h2>
        <Link href={href(addDays(start, 7))} className="btn" aria-label="Próxima semana" style={{ width: 44, padding: 0 }}>›</Link>
        <Link href={href(home)} className="btn" style={{ marginLeft: 8 }}>Hoje</Link>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <span className="muted small" style={{ fontWeight: 600 }}>Mostrar</span>
        <Link href={toRolling} className={`filter ${calendar ? "" : "on"}`} aria-current={calendar ? undefined : "true"}>A partir de hoje</Link>
        <Link href={toCalendar} className={`filter ${calendar ? "on" : ""}`} aria-current={calendar ? "true" : undefined}>Segunda a domingo</Link>
      </div>

      <p className="small" style={{ margin: 0 }} aria-live="polite">{summary.join(" · ")}</p>

      <div className="week-wrap">
        <div className="week">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const note = notes[d];
            const empty = list.length === 0 && !note;
            return (
              <section
                key={d}
                className={`wday ${d === today ? "today" : ""} ${d < today ? "past" : ""}`}
                aria-label={`${weekdayShort(d)}, ${d.slice(8, 10)}/${d.slice(5, 7)}`}
              >
                <Link href={`/clientes/${id}/dia/${d}`} className="wd-head">
                  <span>{weekdayShort(d)}</span>
                  <span className="n">{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                  {d === today && <span className="wd-today">Hoje</span>}
                </Link>
                {note && (
                  <Link href={`/clientes/${id}/dia/${d}`} className="mini note" title={note}>
                    <span className="t">{note}</span>
                  </Link>
                )}
                {list.map((t) => {
                  const r = info.get(t.id)!;
                  const cfg = isNetwork(t.network) ? NETWORKS[t.network] : null;
                  const fmt = cfg?.formats[t.format]?.label ?? t.format;
                  const name = `${cfg?.label ?? t.network} ${fmt}`;
                  return (
                    <Link
                      key={t.id}
                      href={`/clientes/${id}/dia/${d}`}
                      className={`wcard ${r.state}`}
                      aria-label={`${name}, ${t.time}, ${t.title || "sem título"}, ${r.label}${t.late ? ", atrasado" : ""}`}
                    >
                      <span className="top">
                        <NetDot network={t.network} />
                        <b>{name}</b>
                        <span className="time">{t.time}</span>
                      </span>
                      {t.title && <span className="wt">{t.title}</span>}
                      <span className="tags">
                        <span className={`wtag ${r.state}`}>{r.label}</span>
                        {t.late && t.status !== "posted" && <span className="wtag late">Atrasado</span>}
                        {t.auto_confirmed && t.status !== "posted" && t.publish_state === "idle" && !t.auto_missed && <span className="wtag ok">Publica sozinho</span>}
                        {t.auto_missed && <span className="wtag late">Perdeu o horário</span>}
                        {t.publish_state === "publishing" && <span className="wtag warn">Publicando</span>}
                        {t.publish_state === "failed" && <span className="wtag late">Falhou ao publicar</span>}
                        {t.publish_state === "drafted" && t.status !== "posted" && <span className="wtag warn">Rascunho enviado</span>}
                        {t.status === "draft" && <span className="muted small">Rascunho</span>}
                      </span>
                    </Link>
                  );
                })}
                {empty && <span className="muted small wempty">{d >= today ? "Nada planejado" : "Sem posts"}</span>}
                <Link href={`/posts/novo?cliente=${id}&data=${d}`} className="wadd" aria-label={`Novo post em ${d.slice(8, 10)}/${d.slice(5, 7)}`}>
                  + Novo post
                </Link>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
