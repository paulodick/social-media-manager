import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import { NetChip, StatusPill } from "@/components/ui";
import { markPosted } from "@/lib/actions";
import { dayLabel, todaySP } from "@/lib/dates";
import { listConnected, listTargets } from "@/lib/queries";

export default async function PostToday() {
  const today = todaySP();
  const items = await listTargets({ dueUntil: today });
  const clientIds = [...new Set(items.map((t) => t.client_id))];
  const connected = new Map<string, Record<string, string>>(await Promise.all(clientIds.map(async (id) => [id, await listConnected(id)] as const)));
  return (
    <main id="conteudo" tabIndex={-1} className="main" style={{ maxWidth: 640 }}>
      <header className="col">
        <h1>Postar hoje</h1>
        <p className="muted">{dayLabel(today)}. {items.length} {items.length === 1 ? "destino" : "destinos"} para publicar.</p>
      </header>
      {items.length === 0 && <div className="card"><p>Nada pendente. Bom trabalho.</p></div>}
      {items.map((t) => {
        const hasMedia = t.drive_file_id && t.drive_meta && !t.drive_meta.error;
        return (
          <article className="card" key={t.id} id={`t-${t.id}`}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><NetChip network={t.network} format={t.format} /><span className="muted small">{t.client_name}</span></span>
              <StatusPill status={t.status} late={t.late} />
            </div>
            <div className="col" style={{ gap: 2 }}>
              <b>{t.title}</b>
              <span className="muted small">{t.day === today ? "Hoje" : dayLabel(t.day)} às {t.time}</span>
              <p className="muted small" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.caption || "(legenda vazia)"}</p>
            </div>
            <div className="col" style={{ gap: 10 }}>
              <CopyButton text={t.caption} label="1. Copiar legenda" className="btn dark wide" />
              {hasMedia ? (
                <a className="btn wide" href={`/api/media/${t.drive_file_id}?download=1`}>2. Baixar mídia</a>
              ) : (
                <span className="muted small">Sem mídia ligada a este post.</span>
              )}
              <form action={markPosted}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="volta" value="/postar-hoje" />
                <button className="btn primary wide" type="submit">3. Marcar como postado</button>
              </form>
            </div>
            <Link href={`/clientes/${t.client_id}/dia/${t.day}#t-${t.id}`} style={{ textDecoration: "underline", fontWeight: 600 }} className="small">{connected.get(t.client_id)?.[t.network] ? "Revisar e publicar" : "Ver prévia e editar"}</Link>
          </article>
        );
      })}
    </main>
  );
}
