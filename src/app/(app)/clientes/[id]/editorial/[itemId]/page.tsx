import { notFound } from "next/navigation";
import EditorialItemForm from "@/components/editorial/EditorialItemForm";
import VisualAssetEditor from "@/components/editorial/VisualAssetEditor";
import { BackLink, ClientAvatar } from "@/components/ui";
import {
  getContentItem,
  listEditorialSlots,
  listPillars,
  listVisualAssets,
} from "@/lib/editorial-queries";
import { getClient } from "@/lib/queries";

export default async function EditorialItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const clientData = await getClient(id);
  if (!clientData) notFound();

  const item = await getContentItem(itemId, id);
  if (!item) notFound();

  const [pillars, assets, slots] = await Promise.all([
    listPillars(id),
    listVisualAssets(item.id),
    listEditorialSlots({ clientId: id, contentItemId: item.id }),
  ]);

  return (
    <main id="conteudo" tabIndex={-1} className="main">
      <div className="col" style={{ gap: 6 }}>
        <BackLink href={`/clientes/${id}/editorial`}>← Voltar para Conteúdos de {clientData.client.name}</BackLink>
        <header className="row" style={{ flexWrap: "nowrap" }}>
          <ClientAvatar client={clientData.client} size="md" />
          <div className="col" style={{ gap: 0 }}>
            <h1>{item.title}</h1>
            <span className="muted small">
              {item.source_kind === "existing_ready" ? "Vídeo pronto" : "Pauta para gravar"}
            </span>
          </div>
        </header>
      </div>

      <EditorialItemForm
        clientId={id}
        clientNetworks={clientData.networks.map((n) => n.network)}
        pillars={pillars}
        initialItem={item}
        initialSlots={slots}
      />

      {/* Slides e imagens só fazem sentido em carrossel e imagem única (ou se já houver algum cadastrado). */}
      {(item.content_format !== "video" || assets.length > 0) && <VisualAssetEditor itemId={item.id} initialAssets={assets} />}
    </main>
  );
}
