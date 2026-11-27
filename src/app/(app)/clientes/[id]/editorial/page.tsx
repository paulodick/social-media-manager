import { editorialAiConfigured } from "@/lib/editorial-ai";
import Link from "next/link";
import { notFound } from "next/navigation";
import EditorialBoard from "@/components/editorial/EditorialBoard";
import { ClientAvatar } from "@/components/ui";
import { NETWORKS } from "@/config/networks";
import { todaySP } from "@/lib/dates";
import { db } from "@/lib/db";
import { listContentItems, listPillars } from "@/lib/editorial-queries";
import { getClient } from "@/lib/queries";

export default async function ClientEditorialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getClient(id);
  if (!data) notFound();
  const { client, networks } = data;

  const today = todaySP();
  const pool = await db();

  const [pillars, itemsRes, styleRow] = await Promise.all([
    listPillars(id),
    listContentItems({ clientId: id, limit: 200 }),
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
          Conteúdos
        </Link>
        <Link href={`/clientes/${id}/editar`}>Cadastro e redes</Link>
      </nav>

      <EditorialBoard
        clientId={id}
        clientNetworks={networks.map((n) => n.network)}
        hasDriveFolder={!!client.drive_folder_id}
        initialPillars={pillars}
        initialItems={itemsRes.items}
        initialStyleNotes={styleRow.rows[0]?.ai_style_notes ?? ""}
        aiEnabled={editorialAiConfigured()}
        today={today}
      />
    </main>
  );
}
