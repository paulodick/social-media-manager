import { formatHandles } from "@/lib/ig-people";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import MarkPostedUndo from "@/components/MarkPostedUndo";
import ProblemsAlert from "@/components/ProblemsAlert";
import SubmitButton from "@/components/SubmitButton";
import { NetChip, StatusPill } from "@/components/ui";
import { markPosted } from "@/lib/actions";
import { dayLabel, todaySP } from "@/lib/dates";
import { listConnected, listProblemTargets, listTargets, type Target } from "@/lib/queries";
import { isUndoableStatus, isValidUuid } from "@/lib/target-rules";

function publishBadge(t: Target): { label: string; cls: string } | null {
  if (t.publish_state === "failed") return { label: "Falhou", cls: "late" };
  if (t.auto_missed) return { label: "Perdeu o horário", cls: "late" };
  if (t.publish_state === "publishing") return { label: "Publicando…", cls: "scheduled" };
  if (t.publish_state === "drafted") return { label: "Rascunho enviado", cls: "scheduled" };
  if (t.auto_confirmed && t.publish_state === "idle" && t.status !== "posted") return { label: "Publica sozinho", cls: "posted" };
  return null;
}

export default async function PostToday({ searchParams }: { searchParams: Promise<{ feito?: string; antes?: string; erro?: string }> }) {
  const sp = await searchParams;
  const today = todaySP();
  const [items, problems] = await Promise.all([listTargets({ dueUntil: today }), listProblemTargets()]);
  const clientIds = [...new Set(items.map((t) => t.client_id))];
  const connected = new Map<string, Record<string, string>>(await Promise.all(clientIds.map(async (id) => [id, await listConnected(id)] as const)));
  const showUndo = sp.feito && sp.antes && isValidUuid(sp.feito) && isUndoableStatus(sp.antes);
  return (
    <main id="conteudo" tabIndex={-1} className="main" style={{ maxWidth: 640 }}>
      <header className="col">
        <h1>Postar hoje</h1>
        <p className="muted">{dayLabel(today)}. {items.length} {items.length === 1 ? "destino" : "destinos"} para publicar.</p>
      </header>
      <ProblemsAlert items={problems} />
      {sp.erro && <p className="alert err" role="alert">{sp.erro}</p>}
      {showUndo && <MarkPostedUndo id={sp.feito!} antes={sp.antes!} />}
      {items.length === 0 && <div className="card"><p>Nada pendente. Bom trabalho.</p></div>}
      {items.map((t) => {
        const hasMedia = t.drive_file_id && t.drive_meta && !t.drive_meta.error;
        const pub = publishBadge(t);
        const isConnected = !!connected.get(t.client_id)?.[t.network];
        const manualSteps = (
          <div className="col" style={{ gap: 10 }}>
            <CopyButton text={t.caption} label="1. Copiar legenda" className="btn dark wide" />
            {hasMedia ? (
              <a className="btn wide" href={`/api/media/${t.drive_file_id}?download=1`}>2. Baixar mídia</a>
            ) : (
              <span className="muted small">Sem mídia ligada a este post.</span>
            )}
            {t.network === "instagram" && (t.thumb_file_id || t.user_tags?.length > 0 || t.collaborators?.length > 0) && (
              <div className="col muted small" style={{ gap: 4 }}>
                {t.thumb_file_id && (
                  <span>
                    Capa: <a href={`/api/media/${t.thumb_file_id}?download=1`} style={{ textDecoration: "underline" }}>baixar {t.thumb_meta?.name ?? "capa"}</a>
                  </span>
                )}
                {t.user_tags?.length > 0 && <span>Marcar: <b>{formatHandles(t.user_tags)}</b></span>}
                {t.collaborators?.length > 0 && <span>Convidar como collab: <b>{formatHandles(t.collaborators)}</b></span>}
              </div>
            )}
            <form action={markPosted}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="volta" value="/postar-hoje" />
              <SubmitButton className="btn primary wide" pendingLabel="Salvando…">3. Marcar como postado</SubmitButton>
            </form>
          </div>
        );
        return (
          <article className="card" key={t.id} id={`t-${t.id}`}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><NetChip network={t.network} format={t.format} /><span className="muted small">{t.client_name}</span></span>
              <span className="row" style={{ gap: 6 }}>
                {pub && <span className={`pill ${pub.cls}`}>{pub.label}</span>}
                <StatusPill status={t.status} late={t.late} />
              </span>
            </div>
            <div className="col" style={{ gap: 2 }}>
              <b>{t.title}</b>
              <span className="muted small">{t.day === today ? "Hoje" : dayLabel(t.day)} às {t.time}</span>
              <p className="muted small" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.caption || "(legenda vazia)"}</p>
            </div>
            {isConnected ? (
              <div className="col" style={{ gap: 10 }}>
                <Link className="btn primary wide" href={`/clientes/${t.client_id}/dia/${t.day}#t-${t.id}`}>Revisar e publicar</Link>
                <details className="personalize" open>
                  <summary>Ou postar manualmente</summary>
                  <div style={{ marginTop: 10 }}>{manualSteps}</div>
                </details>
              </div>
            ) : (
              <>
                {manualSteps}
                <Link href={`/clientes/${t.client_id}/dia/${t.day}#t-${t.id}`} style={{ textDecoration: "underline", fontWeight: 600 }} className="small">Ver prévia e editar</Link>
              </>
            )}
          </article>
        );
      })}
    </main>
  );
}
