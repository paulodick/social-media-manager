"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NETWORKS, isNetwork } from "@/config/networks";
import { SEQUENCE_MAX_POSTS } from "@/lib/editorial-sequence-limits";
import type { SequenceRow } from "@/lib/editorial-sequence-store";
import { AUDIENCE_LABEL, FLAG_LABEL, type Audience, type QualityFlag } from "@/lib/ready-profile-labels";

type ReadyInfo = {
  id: string;
  title: string;
  folder: string;
  theme: string;
  summary: string;
  pillar: string;
  audience: string;
  hook: string;
  caption_instagram: string;
  caption_linkedin: string;
  drive_url: string;
  flags: string[];
  profiled: boolean;
  has_transcript: boolean;
};

type SyncReply = {
  folder: string | null;
  created: number;
  updated: number;
  removed?: number;
  warnings: string[];
  profiled?: number;
  profile_pending?: number;
  profiling?: boolean;
  error?: string;
};

type Profiling = {
  running: boolean;
  profiled: number;
  pending: number;
  warnings: string[];
  finished_at: string | null;
  reorganizing?: boolean;
  reorganize_note?: string;
} | null;

/** Passou disso desde a última leitura, o Editorial sincroniza sozinho ao abrir. */
const AUTO_SYNC_MS = 24 * 60 * 60 * 1000;

function syncSummary(j: SyncReply, auto: boolean): string {
  const parts = [`${j.created} vídeo(s) novo(s)`, `${j.updated} atualizado(s)`];
  if (j.removed) parts.push(`${j.removed} saíram da pasta (postados ou movidos)`);
  if (j.profiled !== undefined) parts.push(`${j.profiled} interpretado(s) pela IA`);
  const ai = j.profiling
    ? (j.created || j.removed)
      ? " A IA está lendo os vídeos novos e depois reorganiza os rascunhos da sequência; a lista atualiza sozinha."
      : " A IA está lendo os vídeos e montando as fichas; a lista atualiza sozinha."
    : "";
  return `${auto ? "Sincronizado automaticamente. " : ""}"${j.folder}": ${parts.join(", ")}.${ai}${j.warnings.length ? ` ${j.warnings.join(" ")}` : ""}`;
}

/**
 * Campo de número livre (digitar qualquer valor dentro do limite). Enquanto a pessoa digita, aceita o campo vazio;
 * ao sair, volta para o limite mais próximo.
 */
function NumberField({
  id, value, min, max, onChange, suffix,
}: { id: string; value: number; min: number; max: number; onChange: (n: number) => void; suffix: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    const v = Number.isFinite(n) && raw.trim() !== "" ? Math.min(max, Math.max(min, n)) : value;
    setText(String(v));
    onChange(v);
  };
  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        style={{ width: 80 }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => commit(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <span className="small muted" id={`${id}-hint`}>{suffix} (de {min} a {max})</span>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copiado" : label}
    </button>
  );
}

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

  const [profiling, setProfiling] = useState<Profiling>(null);

  async function load(): Promise<{ synced_at: string | null; ready: ReadyInfo[]; profiling: Profiling } | null> {
    const res = await fetch(`/api/editorial/clients/${clientId}/sequence`);
    if (!res.ok) return null;
    const j = (await res.json()) as { rows: SequenceRow[]; ready: ReadyInfo[]; synced_at: string | null; profiling: Profiling };
    setRows(j.rows);
    setReady(j.ready);
    setProfiling(j.profiling);
    return j;
  }

  // Enquanto a IA faz as fichas (e reorganiza) em segundo plano, atualiza a lista a cada 5 s. Quando termina,
  // atualiza o calendário também (os rascunhos podem ter mudado de dia).
  useEffect(() => {
    if (!profiling?.running) return;
    const t = setInterval(async () => {
      const j = await load();
      if (j && !j.profiling?.running) router.refresh();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiling?.running, clientId]);

  async function markPosted(v: ReadyInfo) {
    setBusy("approve");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/sequence/posted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: v.id }),
      });
      const j = (await res.json()) as { error?: string; warning?: string | null; reorganizing?: boolean };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível marcar.");
        return;
      }
      setMsg(
        `"${v.theme || v.title}" saiu da lista${j.warning ? `, mas ${j.warning}` : ' e a pasta foi para "Reels Postados"'}.` +
          (j.reorganizing ? " Os rascunhos da sequência estão sendo reorganizados." : ""),
      );
      const after = await load();
      if (j.reorganizing && after && !after.profiling?.running) {
        setProfiling({ running: true, profiled: 0, pending: 0, warnings: [], finished_at: null, reorganizing: true });
      }
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void (async () => {
      const j = await load();
      if (!j) return;
      // Sincroniza sozinho se a última leitura passou de um dia (ou se há vídeos que nunca passaram pela sincronização nova).
      const stale = j.synced_at ? Date.now() - new Date(j.synced_at).getTime() > AUTO_SYNC_MS : j.ready.length > 0;
      if (stale) await sync(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function sync(auto = false) {
    setBusy("sync");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/sequence/sync`, { method: "POST" });
      const j = (await res.json()) as SyncReply;
      if (!res.ok || !j.folder) {
        if (!auto) setErr(j.error ?? j.warnings?.join(" ") ?? "Não foi possível ler a pasta.");
        return;
      }
      setMsg(syncSummary(j, auto));
      const after = await load();
      if (j.profiling && after && !after.profiling) setProfiling({ running: true, profiled: 0, pending: 0, warnings: [], finished_at: null });
    } catch {
      if (!auto) setErr("Falha ao falar com o servidor.");
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
  const flagged = ready.filter((r) => r.flags.some((f) => f === "uncertain" || f === "commercial_music")).length;

  return (
    <section className="card col" style={{ gap: 14 }} aria-labelledby="seq-h">
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <h2 id="seq-h">Próximos posts</h2>
          <span className="muted small" style={{ maxWidth: "70ch" }}>
            <b>Sincronizar conteúdos</b> lê a pasta <b>Reels Editados</b> (vídeo + transcrição e/ou legenda sugerida em .txt, Google Doc ou .docx) e a IA faz a
            ficha de cada vídeo: tema, resumo, pilar, gancho e legendas. Depois ela cria pautas novas com temas que faltam e decide a
            ordem para não repetir. Ao sincronizar de novo, vídeos novos entram e os rascunhos são reorganizados (o que já foi
            aprovado não muda de dia). Nada vira post até você aprovar. Quando o vídeo é publicado, a pasta dele vai para{" "}
            <b>Reels Postados</b> e sai da lista.
          </span>
        </div>
        <button type="button" className="btn" onClick={() => sync()} disabled={!!busy}>
          {busy === "sync" ? "Sincronizando…" : "Sincronizar conteúdos"}
        </button>
      </div>

      {profiling?.running && (
        <p className="alert" role="status">
          {profiling.reorganizing
            ? "A IA está reorganizando os rascunhos da sequência com os vídeos de agora. Pode continuar usando o app."
            : `A IA está lendo os vídeos e montando as fichas (${profiling.profiled} pronta(s) até agora). Pode continuar usando o app.`}
        </p>
      )}
      {profiling && !profiling.running && profiling.reorganize_note && (
        <p className="alert ok" role="status">{profiling.reorganize_note}</p>
      )}
      {profiling && !profiling.running && profiling.warnings.length > 0 && (
        <p className="alert warn">{profiling.warnings.join(" ")}</p>
      )}

      <details className="col" style={{ gap: 8 }}>
        <summary className="small" style={{ cursor: "pointer" }}>
          <b>{ready.length}</b> vídeo(s) pronto(s) disponível(is) para a sequência
          {noTranscript ? <span className="muted"> · {noTranscript} sem transcrição nem legenda (a IA só vê o nome)</span> : null}
          {flagged ? <span style={{ color: "var(--accent-ink)" }}> · {flagged} pedem conferência</span> : null}
        </summary>
        <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }} aria-label="Vídeos prontos">
          {ready.map((v) => (
            <li key={v.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
              <details>
                <summary style={{ cursor: "pointer" }}>
                  <span className="muted small">{v.folder} · </span>
                  <b>{v.theme || v.title}</b>
                  {v.pillar && <span className="small muted"> · {v.pillar}</span>}
                  {v.audience && <span className="small muted"> · {AUDIENCE_LABEL[v.audience as Audience] ?? v.audience}</span>}
                  {!v.profiled && v.has_transcript && <span className="small muted"> · ainda sem ficha da IA</span>}
                  {v.flags.map((f) => (
                    <span key={f} className="tag" style={{ marginLeft: 6 }}>{FLAG_LABEL[f as QualityFlag] ?? f}</span>
                  ))}
                </summary>
                <div className="col" style={{ gap: 8, marginTop: 8 }}>
                  {v.summary && <p className="small" style={{ margin: 0 }}>{v.summary}</p>}
                  {v.hook && <p className="small" style={{ margin: 0 }}><b>Gancho:</b> {v.hook}</p>}
                  {v.caption_instagram && (
                    <div className="col" style={{ gap: 4 }}>
                      <span className="f">Legenda do Instagram</span>
                      <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{v.caption_instagram}</p>
                    </div>
                  )}
                  {v.caption_linkedin && (
                    <div className="col" style={{ gap: 4 }}>
                      <span className="f">Legenda do LinkedIn</span>
                      <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{v.caption_linkedin}</p>
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    <CopyButton text={v.caption_instagram} label="Copiar legenda do Instagram" />
                    <CopyButton text={v.caption_linkedin} label="Copiar legenda do LinkedIn" />
                    {v.drive_url && (
                      <a className="btn" href={v.drive_url} target="_blank" rel="noreferrer">Ver vídeo no Drive</a>
                    )}
                    <button type="button" className="btn" onClick={() => markPosted(v)} disabled={!!busy}>
                      Já foi postado
                    </button>
                  </div>
                  <span className="muted small">
                    Ao aprovar este vídeo na sequência, o post já sai com essas legendas (Instagram e LinkedIn), e você pode editar antes de publicar.
                    Se ele já foi postado fora do app, use "Já foi postado": a pasta vai para Reels Postados e ele sai da lista.
                  </span>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </details>

      <div className="row" style={{ gap: "10px 16px", alignItems: "flex-end" }}>
        <div className="col">
          <label className="f" htmlFor="seq-every">Postar a cada</label>
          <NumberField id="seq-every" value={every} min={1} max={14} onChange={setEvery} suffix={every === 1 ? "dia" : "dias"} />
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-start">Começar em</label>
          <input id="seq-start" type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-count">Quantos posts</label>
          <NumberField id="seq-count" value={count} min={1} max={SEQUENCE_MAX_POSTS} onChange={setCount} suffix="posts" />
        </div>
        <div className="col">
          <label className="f" htmlFor="seq-lead">Tempo para gravar e editar</label>
          <NumberField id="seq-lead" value={lead} min={0} max={30} onChange={setLead} suffix={lead === 1 ? "dia" : "dias"} />
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
