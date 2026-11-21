import Link from "next/link";

export const metadata = { title: "Página não encontrada · Social Media Manager" };

export default function NotFound() {
  return (
    <main id="conteudo" className="login">
      <div className="card col" style={{ gap: 14, maxWidth: 440 }}>
        <b style={{ fontSize: 18 }}>Social Media Manager</b>
        <h1 style={{ fontSize: 24 }}>Página não encontrada</h1>
        <p className="muted">O endereço não existe ou o item foi removido. Volte para o início e siga por lá.</p>
        <div><Link href="/" className="btn primary">Voltar para o início</Link></div>
      </div>
    </main>
  );
}
