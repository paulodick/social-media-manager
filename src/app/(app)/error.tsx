"use client";

import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="conteudo" tabIndex={-1} className="main" style={{ maxWidth: 560 }}>
      <div className="card col" style={{ gap: 14 }}>
        <h1 style={{ fontSize: 24 }}>Algo deu errado</h1>
        <p className="muted">
          Não foi possível concluir esta ação agora. Tente de novo ou volte para o início.
        </p>
        {error.digest && (
          <p className="muted small">
            Código do erro: <code>{error.digest}</code>
          </p>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn primary" onClick={() => reset()}>
            Tentar de novo
          </button>
          <Link href="/" className="btn">
            Voltar para o início
          </Link>
        </div>
      </div>
    </main>
  );
}
