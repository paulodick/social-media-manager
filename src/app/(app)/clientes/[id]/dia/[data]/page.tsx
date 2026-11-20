import Link from "next/link";
import { notFound } from "next/navigation";
import TargetEditor from "@/components/TargetEditor";
import { BackLink, Flash } from "@/components/ui";
import { NETWORKS, isNetwork } from "@/config/networks";
import { addDays, dayFolders, dayLabel, isDay, monthOf } from "@/lib/dates";
import { folderPathFromRoot } from "@/lib/drive";
import { getClient, listTargets } from "@/lib/queries";

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; data: string }>;
  searchParams: Promise<{ salvo?: string; erro?: string }>;
}) {
  const { id, data: day } = await params;
  const sp = await searchParams;
  if (!isDay(day)) notFound();
  const found = await getClient(id);
  if (!found) notFound();
  const { client, networks } = found;
  const targets = await listTargets({ clientId: id, from: day, to: day });
  const volta = `/clientes/${id}/dia/${day}`;

  const editors = await Promise.all(
    targets.map(async (t) => {
      if (!isNetwork(t.network)) return null;
      const cfg = NETWORKS[t.network];
      const fmt = cfg.formats[t.format];
      const [y, m, d] = dayFolders(t.day);
      const expected = [y, m, d, cfg.folder, fmt?.folder ?? t.format];
      let pathNote: string | null = null;
      if (t.drive_file_id && client.drive_folder_id && t.drive_meta && !t.drive_meta.error) {
        const actual = await folderPathFromRoot(t.drive_file_id, client.drive_folder_id);
        if (actual === null) {
          pathNote = `O arquivo não está dentro da pasta do cliente. Deveria estar em ${expected.join(" / ")}.`;
        } else if (actual.join("/") !== expected.join("/")) {
          pathNote = `O arquivo está em ${actual.join(" / ") || "(raiz da pasta do cliente)"}, mas deveria estar em ${expected.join(" / ")}.`;
        }
      }
      const acc = networks.find((n) => n.network === t.network)?.account_name;
      return (
        <div key={t.id}>
          <TargetEditor
            id={t.id}
            network={t.network}
            format={t.format}
            day={t.day}
            time={t.time}
            caption={t.caption}
            status={t.status}
            late={t.late}
            driveUrl={t.drive_url}
            fileId={t.drive_file_id}
            meta={t.drive_meta}
            title={t.title}
            profile={{ name: acc || client.name, handle: (acc || client.name).toLowerCase().replace(/\s+/g, "") }}
            expectedPath={`${client.name} / ${expected.join(" / ")}`}
            pathNote={pathNote}
            volta={volta}
            saved={sp.salvo === t.id}
          />
        </div>
      );
    }),
  );

  return (
    <main className="main">
      <header className="row between">
        <div className="col">
          <nav className="row small muted" aria-label="Caminho" style={{ gap: 8 }}>
            <Link href="/">Início</Link>/<Link href={`/clientes/${id}`}>{client.name}</Link>/
            <Link href={`/clientes/${id}?mes=${monthOf(day)}`}>Calendário</Link>
          </nav>
          <h1>{dayLabel(day)}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/clientes/${id}/dia/${addDays(day, -1)}`} className="btn" aria-label="Dia anterior" style={{ width: 44, padding: 0 }}>‹</Link>
          <Link href={`/clientes/${id}?mes=${monthOf(day)}`} className="btn">Voltar ao calendário</Link>
          <Link href={`/clientes/${id}/dia/${addDays(day, 1)}`} className="btn" aria-label="Próximo dia" style={{ width: 44, padding: 0 }}>›</Link>
        </div>
      </header>
      <Flash erro={sp.erro} />
      {editors.length === 0 ? (
        <div className="card">
          <p>Nenhum post neste dia.</p>
          <div><Link href={`/posts/novo?cliente=${id}&data=${day}`} className="btn primary">Criar post para este dia</Link></div>
        </div>
      ) : (
        <>
          {editors}
          <div><Link href={`/posts/novo?cliente=${id}&data=${day}`} className="btn">Adicionar outro post neste dia</Link></div>
        </>
      )}
      <BackLink href={`/clientes/${id}`}>← {client.name}</BackLink>
    </main>
  );
}
