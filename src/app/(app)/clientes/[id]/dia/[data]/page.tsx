import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PostEditor, { type EditorTarget } from "@/components/PostEditor";
import { BackLink, Flash } from "@/components/ui";
import { acceptedFolders, isNetwork, targetFolders } from "@/config/networks";
import { addDays, dayFolders, dayLabel, isDay, monthOf, weekStart } from "@/lib/dates";
import { folderPathFromRoot } from "@/lib/drive";
import { aiConfigured } from "@/lib/ai";
import ConnectionNotice from "@/components/ConnectionNotice";
import { clientLinkedinHealth, clientMetaHealth, clientTiktokHealth } from "@/lib/connection-health";
import { getClient, listConnected, listDayNotes, listTargets } from "@/lib/queries";
import { canAutoPublish } from "@/lib/publisher";
import { pickerOptions } from "@/lib/picker-options";

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; data: string }>;
  searchParams: Promise<{ salvo?: string; erro?: string; aviso?: string; pasta?: string; nota?: string }>;
}) {
  const { id, data: day } = await params;
  const sp = await searchParams;
  if (!isDay(day)) notFound();
  const found = await getClient(id);
  if (!found) notFound();
  const { client, networks } = found;
  const onDay = await listTargets({ clientId: id, from: day, to: day });
  // Dia sem post: a tela para criar é a mesma tela do post, já com a ideia do dia preenchida.
  if (onDay.length === 0) redirect(`/posts/novo?cliente=${id}&data=${day}`);
  const note = (await listDayNotes(id, day, day))[day] ?? "";
  const volta = `/clientes/${id}/dia/${day}`;
  const connected = await listConnected(id);
  // Só consulta a Meta quando algum post do dia pode ser publicado pelo app.
  const health = onDay.some((t) => (t.network === "instagram" || t.network === "facebook") && connected[t.network]) ? await clientMetaHealth(id) : null;
  const liHealth = onDay.some((t) => t.network === "linkedin" && connected.linkedin) ? await clientLinkedinHealth(id) : null;
  const ttHealth = onDay.some((t) => t.network === "tiktok" && connected.tiktok) ? await clientTiktokHealth(id) : null;

  // Cada post do dia aparece inteiro (todas as redes dele, mesmo as de outros dias).
  const postIds = [...new Set(onDay.map((t) => t.post_id))];
  const posts = await Promise.all(
    postIds.map(async (postId) => {
      const all = await listTargets({ clientId: id, postId });
      const targets: EditorTarget[] = await Promise.all(
        all.map(async (t) => {
          const [y, m, d] = dayFolders(t.day);
          const expected = [y, m, d, ...(targetFolders(t.network, t.format) ?? [])];
          const accepted = acceptedFolders(t.network, t.format).map((p) => [y, m, d, ...p].join("/"));
          let pathNote: string | null = null;
          if (t.drive_file_id && client.drive_folder_id && t.drive_meta && !t.drive_meta.error) {
            const actual = await folderPathFromRoot(t.drive_file_id, client.drive_folder_id);
            if (actual === null) {
              pathNote = `O arquivo não está dentro da pasta do cliente. Deveria estar em ${expected.join(" / ")}.`;
            } else if (!accepted.includes(actual.join("/"))) {
              pathNote = `O arquivo está em ${actual.join(" / ") || "(raiz da pasta do cliente)"}, mas deveria estar em ${expected.join(" / ")}.`;
            }
          }
          return {
            id: t.id,
            network: t.network,
            format: t.format,
            day: t.day,
            time: t.time,
            caption: t.caption,
            title: t.target_title,
            status: t.status,
            late: t.late,
            driveUrl: t.drive_url,
            fileId: t.drive_file_id,
            meta: t.drive_meta,
            thumbUrl: t.thumb_url,
            thumbFileId: t.thumb_file_id,
            thumbMeta: t.thumb_meta,
            pathNote,
            folderId: t.post_folder_id,
            publish: canAutoPublish(t.network, t.format)
              ? { connected: connected[t.network] ?? null, state: t.publish_state, url: t.external_url, error: t.publish_error }
              : undefined,
          };
        }),
      );
      return { postId, first: all[0], targets };
    }),
  );

  // Redes do cliente + as que algum destino do post usa (se o cliente tirou a rede depois).
  const netList = [...networks];
  for (const p of posts) for (const t of p.targets) if (isNetwork(t.network) && !netList.some((n) => n.network === t.network)) netList.push({ network: t.network, account_name: "", profile_url: "" });
  const options = pickerOptions(netList);
  const profiles = Object.fromEntries(
    networks.map((n) => [n.network, { name: n.account_name || client.name, handle: (n.account_name || client.name).toLowerCase().replace(/\s+/g, "") }]),
  );
  const promptClient = { id, name: client.name, segment: client.segment, site: client.site, tone: client.tone, notes: client.notes };

  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <header className="row between">
        <div className="col">
          <nav className="row small muted" aria-label="Caminho" style={{ gap: 8 }}>
            <Link href="/">Início</Link>/<Link href={`/clientes/${id}`}>{client.name}</Link>/
            <Link href={`/clientes/${id}?mes=${monthOf(day)}`}>Calendário</Link>/
            <Link href={`/clientes/${id}/semana?modo=calendario&semana=${weekStart(day)}`}>Semana</Link>
          </nav>
          <h1>{dayLabel(day)}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/clientes/${id}/dia/${addDays(day, -1)}`} className="btn" aria-label="Dia anterior" style={{ width: 44, padding: 0 }}>‹</Link>
          <Link href={`/clientes/${id}?mes=${monthOf(day)}`} className="btn">Voltar ao calendário</Link>
          <Link href={`/clientes/${id}/dia/${addDays(day, 1)}`} className="btn" aria-label="Próximo dia" style={{ width: 44, padding: 0 }}>›</Link>
        </div>
      </header>
      <Flash erro={sp.erro} aviso={sp.aviso} ok={sp.pasta ? "Pasta do Drive pronta." : sp.nota ? "Planejamento do dia salvo." : undefined} />
      <ConnectionNotice health={health} clientId={id} quiet />
      <ConnectionNotice health={liHealth} clientId={id} quiet provider="linkedin" />
      <ConnectionNotice health={ttHealth} clientId={id} quiet provider="tiktok" />
      {posts.map((p) => (
        <PostEditor
          key={p.postId}
          postId={p.postId}
          client={promptClient}
          canCreateFolder={!!client.drive_folder_id}
          options={options}
          aiEnabled={aiConfigured()}
          volta={volta}
          day={day}
          defaultTime={p.targets[0]?.time ?? "10:00"}
          note={note}
          postName={p.first?.title ?? ""}
          brief={p.first?.idea ?? ""}
          tones={p.first?.tones ?? []}
          targets={p.targets}
          profiles={profiles}
          saved={sp.salvo === p.postId}
        />
      ))}
      <div><Link href={`/posts/novo?cliente=${id}&data=${day}`} className="btn">Novo post neste dia</Link></div>
      <BackLink href={`/clientes/${id}`}>← {client.name}</BackLink>
    </main>
  );
}
