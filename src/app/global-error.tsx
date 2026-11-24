"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f3f5f7", color: "#101828" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #dce1e8", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
            <b style={{ fontSize: 16 }}>Social Media Manager</b>
            <h1 style={{ fontSize: 24, margin: 0 }}>Algo deu errado</h1>
            <p style={{ margin: 0, color: "#596579" }}>
              Ocorreu um erro inesperado ao carregar o app. Tente de novo ou volte para o início.
            </p>
            {error.digest && (
              <p style={{ margin: 0, fontSize: 13, color: "#596579" }}>
                Código do erro: <code>{error.digest}</code>
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ minHeight: 44, padding: "0 18px", borderRadius: 8, border: "1px solid #c2410c", background: "#c2410c", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                Tentar de novo
              </button>
              <a
                href="/"
                style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 18px", borderRadius: 8, border: "1px solid #b8c1cc", background: "#fff", color: "#101828", fontWeight: 600, textDecoration: "none" }}
              >
                Voltar para o início
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
