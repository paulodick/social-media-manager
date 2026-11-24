import Link from "next/link";
import { notFound } from "next/navigation";
import EditorialBoard from "@/components/editorial/EditorialBoard";
import { ClientAvatar } from "@/components/ui";
import { NETWORKS } from "@/config/networks";
import { addMonths, isMonth, monthGrid, monthLabel, monthOf, todaySP } from "@/lib/dates";
import { db } from "@/lib/db";
import { listContentItems, listEditorialSlots, listPillars } from "@/lib/editorial-queries";
import { getClient } from "@/lib/queries";

export default async function ClientEditorialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await getClient(id);
  if (!data) notFound();
  const { client, networks } = data;

  const today = todaySP();
  const mes = isMonth(sp.mes) ? sp.mes : monthOf(today);
  const cells = monthGrid(mes);
  const pool = await db();

  const [pillars, itemsRes, slots, styleRow] = await Promise.all([
    listPillars(id),
    listContentItems({ clientId: id, limit: 100 }),
    listEditorialSlots({ clientId: id, from: cells[0].day, to: cells[cells.length - 1].day }),
    pool.query<{ ai_style_notes: string }>("select ai_style_notes from clients where id = $1", [id]),
  ]);

  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="row between">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <ClientAvatar client={client} size="lg" />
          <div className="col" style={{ gap: 0 }}>
            <h1>{client.name}</h1>
            <span className="muted small">
              {client.segment || "Sem segmento"}.{" "}
              {networks.length
                ? networks.map((n) => NETWORKS[n.network as keyof typeof NETWORKS]?.label ?? n.network).join(", ")
                : "Nenhuma rede cadastrada."}
            </span>
          </div>
        </div>
        <Link href={`/posts/novo?cliente=${id}`} className="btn primary">
          Novo post
        </Link>
      </header>

      <nav className="tabs" aria-label="Seções do cliente">
        <Link href={`/clientes/${id}`}>Calendário</Link>
        <Link href={`/clientes/${id}/semana`}>Semana</Link>
        <Link href={`/clientes/${id}/editorial`} className="on">
          Editorial
        </Link>
        <Link href={`/clientes/${id}/editar`}>Cadastro e redes</Link>
      </nav>

      <div className="row" style={{ gap: 8 }}>
        <Link
          href={`/clientes/${id}/editorial?mes=${addMonths(mes, -1)}`}
          className="btn"
          aria-label="Mês anterior"
          style={{ width: 44, padding: 0 }}
        >
          ‹
        </Link>
        <h2 style={{ minWidth: 190, textAlign: "center", fontSize: 22 }}>{monthLabel(mes)}</h2>
        <Link
          href={`/clientes/${id}/editorial?mes=${addMonths(mes, 1)}`}
          className="btn"
          aria-label="Próximo mês"
          style={{ width: 44, padding: 0 }}
        >
          ›
        </Link>
        <Link href={`/clientes/${id}/editorial?mes=${monthOf(today)}`} className="btn" style={{ marginLeft: 8 }}>
          Hoje
        </Link>
      </div>

      <EditorialBoard
        clientId={id}
        clientNetworks={networks.map((n) => n.network)}
        hasDriveFolder={!!client.drive_folder_id}
        initialMonth={mes}
        initialPillars={pillars}
        initialItems={itemsRes.items}
        initialSlots={slots}
        initialStyleNotes={styleRow.rows[0]?.ai_style_notes ?? ""}
      />
    </main>
  );
}
