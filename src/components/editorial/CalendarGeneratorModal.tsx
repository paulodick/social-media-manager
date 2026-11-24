"use client";

import { useState } from "react";
import { NETWORKS, isNetwork } from "@/config/networks";
import type { ContentItem, SlotView } from "@/lib/editorial-types";

const WEEKDAYS = [
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

export default function CalendarGeneratorModal({
  clientId,
  clientNetworks,
  defaultFrom,
  defaultTo,
  onClose,
  onGenerated,
}: {
  clientId: string;
  clientNetworks: string[];
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onGenerated: (createdItems: ContentItem[], createdSlots: SlotView[]) => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const availableNets = clientNetworks.filter(isNetwork);
  const firstNet = availableNets[0] ?? "instagram";
  const firstFmt = Object.keys(NETWORKS[firstNet].formats)[0] ?? "reels";

  const [network, setNetwork] = useState<string>(firstNet);
  const [format, setFormat] = useState<string>(firstFmt);
  const [defaultTime, setDefaultTime] = useState("09:30");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [manualJson, setManualJson] = useState("");

  const formats = isNetwork(network) ? Object.entries(NETWORKS[network].formats) : [];

  function toggleWeekday(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function generate(mode: "ai" | "prompt_only", useManual = false) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          weekdays,
          targets: [{ network, format, default_time: defaultTime || null }],
          mode,
          manual_json: useManual ? manualJson : undefined,
        }),
      });
      const j = (await res.json()) as {
        prompt?: string;
        created_items?: ContentItem[];
        created_slots?: SlotView[];
        error?: string;
      };
      if (j.prompt) setPrompt(j.prompt);
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível gerar o calendário.");
        return;
      }
      if (j.created_slots?.length) {
        onGenerated(j.created_items ?? [], j.created_slots);
        onClose();
      }
    } catch {
      setErr("Falha de conexão ao gerar o calendário.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-back" role="dialog" aria-modal="true" aria-label="Gerar calendário sem repetição">
      <div className="ed-modal">
        <div className="row between">
          <h2>Gerar calendário inteligente</h2>
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          Cruza os conteúdos já prontos (<code>existing_ready</code>) com temas inéditos (<code>needs_creation</code>) sem repetir assuntos recentes.
        </p>

        {err && <p className="alert err" role="alert">{err}</p>}

        <div className="grid2" style={{ gap: 12 }}>
          <label className="f">
            <span>De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="f">
            <span>Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="f">
            <span>Rede</span>
            <select
              value={network}
              onChange={(e) => {
                const n = e.target.value;
                setNetwork(n);
                if (isNetwork(n)) setFormat(Object.keys(NETWORKS[n].formats)[0] ?? "");
              }}
            >
              {(availableNets.length ? availableNets : (Object.keys(NETWORKS) as (keyof typeof NETWORKS)[])).map((n) => (
                <option key={n} value={n}>
                  {NETWORKS[n].label}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            <span>Formato</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {formats.map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            <span>Horário padrão</span>
            <input type="time" value={defaultTime} onChange={(e) => setDefaultTime(e.target.value)} />
          </label>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>Dias da semana</span>
          <div className="row" style={{ gap: 6 }}>
            {WEEKDAYS.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`filter ${weekdays.includes(w.id) ? "on" : ""}`}
                onClick={() => toggleWeekday(w.id)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => generate("ai")} disabled={busy}>
            {busy ? "Gerando..." : "Gerar com IA"}
          </button>
          <button type="button" className="btn" onClick={() => generate("prompt_only")} disabled={busy}>
            Copiar pedido para a IA
          </button>
        </div>

        {prompt && (
          <div className="col" style={{ gap: 8 }}>
            <label className="f">
              <span>Pedido estruturado</span>
              <textarea rows={5} readOnly value={prompt} />
            </label>
            <label className="f">
              <span>Colar JSON retornado pela IA</span>
              <textarea
                rows={5}
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                placeholder='{"entries":[...]}'
              />
            </label>
            <button
              type="button"
              className="btn dark"
              onClick={() => generate("prompt_only", true)}
              disabled={!manualJson.trim() || busy}
            >
              Aplicar calendário do JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
