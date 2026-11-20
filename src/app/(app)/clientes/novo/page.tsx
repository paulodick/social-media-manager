import ClientForm from "@/components/ClientForm";
import { BackLink, Flash } from "@/components/ui";

export default async function NewClient({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="main narrow">
      <header className="col">
        <BackLink href="/">← Voltar para o início</BackLink>
        <h1>Cadastrar novo cliente</h1>
        <p className="muted" style={{ maxWidth: "62ch" }}>
          Os dados do cliente e as redes dele ficam num lugar só. A conexão para publicar automaticamente fica para depois.
        </p>
      </header>
      <Flash erro={erro} />
      <ClientForm />
    </main>
  );
}
