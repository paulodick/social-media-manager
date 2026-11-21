import Link from "next/link";
import { redirect } from "next/navigation";
import TargetPicker, { type PickerOption } from "@/components/TargetPicker";
import { BackLink, ClientAvatar, Flash } from "@/components/ui";
import { NETWORKS, captionLabel, isNetwork } from "@/config/networks";
import { aiConfigured } from "@/lib/ai";
import { createPost } from "@/lib/actions";
import { isDay, todaySP } from "@/lib/dates";
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
  const options: PickerOption[] = networks
    .filter((n) => isNetwork(n.network))
    .flatMap((n) => {
      const cfg = NETWORKS[n.network as keyof typeof NETWORKS];
      return Object.entries(cfg.formats).map(([fid, f]) => ({
        key: `${n.network}:${fid}`,
        network: n.network,
        networkLabel: cfg.label,
        formatLabel: f.label,
        size: f.guide?.size,
        length: f.guide?.length,
        thumbGuide: f.thumb?.guide,
        hasTitle: !!f.title,
        titleLimit: f.title ? cfg.titleLimit : undefined,
        captionLabel: captionLabel(n.network, fid),
      }));
    });
  return (
    <main id="conteudo" tabIndex={-1} className="main narrow">
      <header className="col">
        <BackLink href={`/clientes/${client.id}`}>← {client.name}</BackLink>
        <h1>Novo post</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Anote a ideia do post, dê um nome para achá-lo depois e descreva o que quer na legenda. Quando já souber, escolha onde vai sair e gere ou cole a legenda e o link do vídeo de cada rede.
        </p>
      </header>
      <Flash erro={sp.erro} />
      <form action={createPost} className="col" style={{ gap: 20 }}>
        <input type="hidden" name="client_id" value={client.id} />

        <section className="card" aria-labelledby="s1">
          <h2 id="s1">1. Ideia do post e planejamento</h2>
          <div className="col">
            <label className="f" htmlFor="note">A ideia do post / o que está planejado para esta data</label>
            <textarea id="note" name="note" rows={4} defaultValue={savedNote} placeholder="Ex.: Reels sobre o plantão 24h. Pedir depoimento ao cliente." />
            <input type="hidden" name="note_from" value={savedNote ? date : ""} />
            <span className="muted small">
              Aparece no calendário. Se esta data já tinha uma ideia salva, ela vem preenchida aqui. Dá para salvar só o texto, sem escolher rede, e voltar depois para subir mídia e legendas.
            </span>
          </div>
          <div className="grid2">
            <div className="col">
              <label className="f" htmlFor="date">Data</label>
              <input id="date" name="date" type="date" defaultValue={date} required />
            </div>
            <div className="col">
              <label className="f" htmlFor="time">Horário dos posts</label>
              <input id="time" name="time" type="time" defaultValue="10:00" />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="s2">
          <h2 id="s2">2. Nome do post e descrição da legenda</h2>
          <div className="col">
            <label className="f" htmlFor="post_name">Nome do post (opcional)</label>
            <input id="post_name" name="post_name" type="text" maxLength={120} placeholder="Ex.: Reels do plantão técnico" />
            <span className="muted small">Só para você achar o post depois (calendário, semana, listas). Não vai para a rede.</span>
          </div>
          <div className="col">
            <label className="f" htmlFor="caption_brief">Descrição da legenda</label>
            <textarea
              id="caption_brief"
              name="caption_brief"
              rows={4}
              placeholder="Ex.: Falar do plantão 24h, dizer que atendemos clínicas e hospitais e fechar chamando para o WhatsApp."
            />
            <span className="muted small" style={{ maxWidth: "70ch" }}>
              Escreva o que quer na legenda, nem que seja um rascunho. Ao gerar a legenda de cada rede, o app usa este texto junto com a
              ideia do item 1, o tom de voz e as observações do cadastro do cliente.
            </span>
          </div>
        </section>

        <section className="card" aria-labelledby="s3">
          <h2 id="s3">3. Redes, legendas e vídeos (opcional agora)</h2>
          {networks.length === 0 ? (
            <p className="alert err">Este cliente ainda não tem redes. <Link href={`/clientes/${client.id}/editar`} style={{ textDecoration: "underline" }}>Cadastre as redes</Link>.</p>
          ) : (
            <>
              <p className="muted small" style={{ maxWidth: "70ch" }}>
                Marque cada rede e formato em que o post vai sair. Cada um ganha a sua legenda (e o seu título, nas redes que têm) e o seu link de vídeo.
                Em "Gerar legenda", o app usa os itens 1 e 2 e o cadastro do cliente. Em "Personalizar legenda" você pede ajustes e gera uma nova.
                A orientação ao lado é a medida ideal sugerida, não uma regra da rede.
              </p>
              <TargetPicker options={options} clientId={client.id} aiEnabled={aiConfigured()} client={{ name: client.name, segment: client.segment, site: client.site, tone: client.tone, notes: client.notes }} />
            </>
          )}
        </section>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Link href={`/clientes/${client.id}`} className="btn">Cancelar</Link>
          <button type="submit" className="btn primary">Salvar</button>
        </div>
      </form>
    </main>
  );
}
