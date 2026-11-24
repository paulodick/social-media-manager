export default function Loading() {
  return (
    <main id="conteudo" tabIndex={-1} className="main" role="status" aria-live="polite">
      <div className="card">
        <p className="muted">Carregando…</p>
      </div>
    </main>
  );
}
