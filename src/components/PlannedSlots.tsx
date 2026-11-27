"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NETWORKS, isNetwork } from "@/config/networks";

/** Um conteúdo planejado pela sequência num dia (todas as redes juntas), ainda sem post no calendário. */
export type PlannedGroup = {
  key: string;
  day: string;
  itemId: string;
  title: string;
  kind: "ready" | "new" | "";
  reason: string;
  time: string | null;
  networks: { network: string; format: string }[];
  slotIds: string[];
};

function netLabel(n: { network: string; format: string }): string {
  if (!isNetwork(n.network)) return `${n.network} ${n.format}`;
  return `${NETWORKS[n.network].label} ${NETWORKS[n.network].formats[n.format]?.label ?? n.format}`;
}

function fmtDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

async function approve(clientId: string, slotIds: string[]): Promise<string | null> {
  const res = await fetch(`/api/editorial/clients/${clientId}/schedule/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot_ids: slotIds }),
  });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? "Não foi possível aprovar.";
}

/**
 * No calendário do cliente: faixa "N posts planejados esperando aprovação" com "Aprovar todos". Na tela do dia:
 * a lista do que está planejado para aquele dia, com Aprovar e Tirar do plano. Aprovar cria o post em rascunho
 * (nada publica sozinho); tirar do plano apaga só o horário planejado (o conteúdo continua na lista).
 */
export default function PlannedSlots({
  clientId,
  groups,
  mode,
}: {
  clientId: string;
  groups: PlannedGroup[];
  mode: "bar" | "day";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setErr("");
    try {
      const e = await fn();
      if (e) setErr(e);
      else router.refresh();
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy("");
    }
  }

  async function remove(slotIds: string[]): Promise<string | null> {
    for (const id of slotIds) {
      const res = await fetch(`/api/editorial/schedule/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        return j.error ?? "Não foi possível tirar do plano.";
      }
    }
    return null;
  }

  if (!groups.length) return null;

  if (mode === "bar") {
    const all = groups.flatMap((g) => g.slotIds);
    const first = groups[0].day;
    const last = groups[groups.length - 1].day;
    return (
      <div className="alert col" role="status" style={{ gap: 8 }}>
        <div className="row between" style={{ gap: 8 }}>
          <span>
            <b>{groups.length}</b> {groups.length === 1 ? "post planejado" : "posts planejados"} pela sequência esperando aprovação
            {first === last ? ` (${fmtDay(first)})` : ` (${fmtDay(first)} a ${fmtDay(last)})`}. Eles aparecem tracejados no calendário.
          </span>
          <span className="row" style={{ gap: 8 }}>
            <Link href={`/clientes/${clientId}/editorial`} className="btn">Ver a sequência</Link>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => run("all", () => approve(clientId, all))}>
              {busy === "all" ? "Aprovando…" : "Aprovar todos"}
            </button>
          </span>
        </div>
        <span className="muted small">Aprovar cria os posts como rascunho no calendário, com legenda e vídeo. Nada é publicado sem você confirmar.</span>
        {err && <span className="alert err" role="alert">{err}</span>}
      </div>
    );
  }

  return (
    <section className="card col" style={{ gap: 10, border: "1.5px dashed var(--line-strong)" }} aria-labelledby="planned-h">
      <h2 id="planned-h">Planejado para este dia (falta aprovar)</h2>
      {err && <p className="alert err" role="alert">{err}</p>}
      <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 10 }}>
        {groups.map((g) => (
          <li key={g.key} className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
            <div className="col" style={{ gap: 3, flex: "1 1 260px" }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="tag">{g.kind === "new" ? "Gravar" : "Vídeo pronto"}</span>
                <b>{g.title}</b>
              </span>
              <span className="muted small">
                {g.time ? `${g.time} · ` : ""}
                {g.networks.map(netLabel).join(", ")}
              </span>
              {g.reason && <span className="muted small">{g.reason}</span>}
            </div>
            <span className="row" style={{ gap: 8 }}>
              <Link href={`/clientes/${clientId}/editorial/${g.itemId}`} className="btn">Abrir conteúdo</Link>
              <button type="button" className="btn" disabled={!!busy} onClick={() => run(`rm-${g.key}`, () => remove(g.slotIds))}>
                {busy === `rm-${g.key}` ? "Tirando…" : "Tirar do plano"}
              </button>
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => run(g.key, () => approve(clientId, g.slotIds))}>
                {busy === g.key ? "Aprovando…" : "Aprovar"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
