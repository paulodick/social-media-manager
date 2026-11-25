"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NETWORKS, isNetwork } from "@/config/networks";
import type { SequenceRow } from "@/lib/editorial-sequence-store";

type ReadyInfo = { id: string; title: string; has_transcript: boolean };

/** Formatos de vídeo vertical que a sequência usa (o mesmo vídeo pronto sai em todos). */
const VIDEO_FORMATS = ["reels", "video", "shorts"];

function fmtDay(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function addDaysStr(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Próximos posts: a IA lê as transcrições dos vídeos prontos ("Reels Editados"), cria pautas novas com temas que
 * faltam e decide a ordem numa cadência fixa. Nada vira post até a pessoa aprovar.
 */
export default function SequencePanel({
  clientId,
  clientNetworks,
  today,
  aiEnabled,
}: {
  clientId: string;
  clientNetworks: string[];
  today: string;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const options = clientNetworks.flatMap((n) =>
    isNetwork(n)
      ? Object.entries(NETWORKS[n].formats)
          .filter(([f]) => VIDEO_FORMATS.includes(f))
          .map(([f, cfg]) => ({ key: `${n}:${f}`, label: `${NETWORKS[n].label} ${cfg.label}` }))
      : [],
  );
  const [rows, setRows] = useState<SequenceRow[]>([]);
  const [ready, setReady] = useState<ReadyInfo[]>([]);
  const [every, setEvery] = useState(2);
  const [count, setCount] = useState(8);
  const [lead, setLead] = useState(2);
  const [start, setStart] = useState(addDaysStr(today, 1));
  const [time, setTime] = useState("10:00");
  const [chosen, setChosen] = useState<Set<string>>(
    new Set(options.some((o) => o.key === "instagram:reels") ? ["instagram:reels"] : options.slice(0, 1).map((o) => o.key)),
  );
  const [busy, setBusy] = useState<"" | "sync" | "gen" | "approve">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [manual, setManual] = useState("");

  async function load() {
    const res = await fetch(`/api/editorial/clients/${clientId}/sequence`);
    if (!res.ok) return;
    const j = (await res.json()) as { rows: SequenceRow[]; ready: ReadyInfo[] };
    setRows(j.rows);
    setReady(j.ready);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function sync() {
    setBusy("sync");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/sequence/sync`, { method: "POST" });
      const j = (await res.json()) as { folder: string | null; created: number; updated: number; warnings: string[]; error?: string };
      if (!res.ok || !j.folder) {
        setErr(j.error ?? j.warnings?.join(" ") ?? "Não foi possível ler a pasta.");
        return;
      }
      setMsg(
        `"${j.folder}": ${j.created} vídeo(s) novo(s), ${j.updated} atualizado(s).${j.warnings.length ? ` ${j.warnings.join(" ")}` : ""}`,
      );
      await load();
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy("");
    }
  }

  async function generate(useManual = false) {
    if (!chosen.size) {
      setErr("Escolha pelo menos uma rede.");
      return;
    }
    setBusy("gen");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/sequence/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start,
          every_days: every,
          count,
          lead_days: lead,
          targets: [...chosen].map((k) => {
            const [network, format] = k.split(":");
            return { network, format, time };
          }),
          mode: aiEnabled ? "ai" : "prompt_only",
          manual_json: useManual ? manual : undefined,
        }),
      });
      const j = (await res.json()) as { rows?: SequenceRow[] | null; prompt?: string; error?: string };
      if (j.prompt) setPrompt(j.prompt);
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível montar a sequência.");
        return;
      }
      if (j.rows) {
        setRows(j.rows);
        setManual("");
        setMsg("Sequência montada. Revise e aprove o que estiver certo.");
        await load();
        router.refresh();
      } else {
        setMsg("Copie o pedido abaixo, cole na IA de sua preferência e cole a resposta (JSON) no campo de baixo.");
      }
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy("");
    }
  }

  async function approve(slotIds: string[]) {
    if (!slotIds.length) return;
    setBusy("approve");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_ids: slotIds, default_time: time }),
      });
      const j = (await res.json()) as { error?: string; warnings?: string[]; failed?: { error: string }[]; approved_count?: number };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível aprovar.");
        return;
      }
      const notes = [...(j.warnings ?? []), ...(j.failed ?? []).map((f) => f.error)];
      setMsg(`Aprovado: os posts entraram como rascunho no calendário.${notes.length ? ` ${notes.join(" ")}` : ""}`);
      await load();
      router.refresh();
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy("");
    }
  }

  const pending = rows.filter((r) => r.kind !== "skip" && !r.approved);
  const noTranscript = ready.filter((r) => !r.has_transcript).length;

  return (
    <section className="card col" style={{ gap: 14 }} aria-labelledby="seq-h">
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <h2 id="seq-h">Próximos posts</h2>
          <span className="muted small" style={{ maxWidth: "70ch" }}>
            A IA lê as transcrições dos vídeos prontos da pasta <b>Reels Editados</b>, cria pautas novas com temas que faltam e decide a
            ordem para não repetir. Nada vira post até você aprovar; ao aprovar, a pasta do vídeo vai para a pasta do dia.
          </span>
        </div>
        <button type="button" className="btn" onClick={sync} disabled={!!busy}>
          {busy === "sync" ? "Lendo a pasta…" : "Ler vídeos prontos"}
        </button>
      </div>

      <p className="small">
        <b>{ready.length}</b> vídeo(s) pronto(s) disponível(is) para a sequência
        {noTranscript ? <span className="muted"> · {noTranscript} sem transcrição (a IA só vê o nome)</span> : null}.
      </p>

      <div className="row" style={{ gap: "10px 16px", alignItems: "flex-end" }}>
        <div className="col">
          <label className="f" htmlFor="seq-every">Postar a cada</label>
          <select id="seq-every" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {[1, 2, 3, 4, 7].map((n) => (
              <option key={n} value={n}>{n === 1 ? "1 dia (todo dia)" : `${n} dias`}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-start">Começar em</label>
          <input id="seq-start" type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-count">Quantos posts</label>
          <select id="seq-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[4, 6, 8, 10, 12, 15, 20, 30].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-lead">Tempo para gravar e editar</label>
          <select id="seq-lead" value={lead} onChange={(e) => setLead(Number(e.target.value))}>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>{n === 1 ? "1 dia" : `${n} dias`}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-time">Horário</label>
          <input id="seq-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend className="f" style={{ marginBottom: 6 }}>Onde postar</legend>
        {options.length === 0 && <span className="muted small">Cadastre Instagram, Facebook, TikTok, YouTube ou LinkedIn no cliente.</span>}
        {options.map((o) => (
          <label key={o.key} className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={chosen.has(o.key)}
              onChange={() =>
                setChosen((prev) => {
                  const next = new Set(prev);
                  if (next.has(o.key)) next.delete(o.key);
                  else next.add(o.key);
                  return next;
                })
              }
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => generate()} disabled={!!busy}>
          {busy === "gen" ? "A IA está montando…" : aiEnabled ? "Montar sequência com IA" : "Gerar pedido para a IA"}
        </button>
        {pending.length > 0 && (
          <button type="button" className="btn" onClick={() => approve(pending.flatMap((r) => r.slot_ids))} disabled={!!busy}>
            {busy === "approve" ? "Aprovando…" : `Aprovar tudo (${pending.length})`}
          </button>
        )}
      </div>

      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      {prompt && !aiEnabled && (
        <div className="col" style={{ gap: 8 }}>
          <label className="f" htmlFor="seq-prompt">Pedido para a IA</label>
          <textarea id="seq-prompt" rows={5} readOnly value={prompt} />
          <label className="f" htmlFor="seq-json">Resposta da IA (JSON)</label>
          <textarea id="seq-json" rows={5} value={manual} onChange={(e) => setManual(e.target.value)} />
          <div>
            <button type="button" className="btn primary" onClick={() => generate(true)} disabled={!!busy || !manual.trim()}>
              Aplicar resposta
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <ol className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }} aria-label="Sequência">
          {rows.map((r) => {
            const tag = r.kind === "ready" ? "Gravado" : r.kind === "new" ? "Gravar" : "Sem post";
            const tagStyle =
              r.kind === "ready"
                ? { background: "var(--ink)", color: "#fff" }
                : r.kind === "new"
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "var(--line)", color: "var(--ink)" };
            const boxStyle =
              r.kind === "new"
                ? { border: "1.5px dashed var(--accent)", background: "#fffaf5" }
                : r.kind === "skip"
                  ? { border: "1px solid var(--line)", background: "var(--soft)" }
                  : { border: "1px solid var(--line)", background: "#fff" };
            return (
              <li key={`${r.day}-${r.item_id ?? "skip"}`} className="row" style={{ ...boxStyle, borderRadius: 10, padding: "10px 12px", gap: 12, alignItems: "flex-start" }}>
                <b style={{ minWidth: 86 }}>{fmtDay(r.day)}</b>
                <div className="col" style={{ gap: 3, flex: "1 1 280px", minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="small" style={{ ...tagStyle, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{tag}</span>
                    {r.theme && <span className="small muted">{r.theme}</span>}
                    {r.approved && <span className="tag ok">Aprovado</span>}
                  </div>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  {r.reason && <span className="small muted">{r.reason}</span>}
                  {r.kind === "new" && (
                    <span className="small" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
                      Gravar e editar até {fmtDay(addDaysStr(r.day, -lead))}
                      {r.hook ? ` · Gancho: ${r.hook}` : ""}
                    </span>
                  )}
                </div>
                {r.kind !== "skip" && !r.approved && (
                  <button type="button" className="btn" onClick={() => approve(r.slot_ids)} disabled={!!busy}>
                    Aprovar
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
