import { notFound } from "next/navigation";
import ClientForm from "@/components/ClientForm";
import { BackLink, Flash } from "@/components/ui";
import { getClient } from "@/lib/queries";

export default async function EditClient({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  const { erro } = await searchParams;
  const data = await getClient(id);
  if (!data) notFound();
  return (
    <main className="main narrow">
      <header className="col">
        <BackLink href={`/clientes/${id}`}>← Voltar para {data.client.name}</BackLink>
        <h1>Editar cliente</h1>
      </header>
      <Flash erro={erro} />
      <ClientForm client={data.client} networks={data.networks} />
    </main>
  );
}
