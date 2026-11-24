"use client";

import { useState } from "react";
import type { Pillar } from "@/lib/editorial-types";

const COLORS = ["#3347D6", "#c2410c", "#1b4d2e", "#6b4a00", "#912018", "#596579"];

type SuggestedPillar = {
  name: string;
  description: string;
  color: string;
  weight_pct: number;
  weekly_target: number | null;
};

export default function PillarManager({
  clientId,
  initialPillars,
  onChange,
}: {
  clientId: string;
  initialPillars: Pillar[];
  onChange?: (pillars: Pillar[]) => void;
}) {
  const [pillars, setPillars] = useState<Pillar[]>(initialPillars);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [weightPct, setWeightPct] = useState(20);
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [showImport, setShowImport] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [promptText, setPromptText] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestedPillar[]>([]);

  const active = pillars.filter((p) => !p.archived_at);
  const totalWeight = active.reduce((acc, p) => acc + p.weight_pct, 0);

  async function addPillar(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/pillars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          color,
          weight_pct: Number(weightPct) || 0,
          position: active.length,
        }),
      });
      const j = (await res.json()) as { pillar?: Pillar; error?: string };
      if (!res.ok || !j.pillar) {
        setError(j.error ?? "Não foi possível salvar o pilar.");
        return;
      }
      const next = [...pillars, j.pillar];
      setPillars(next);
      onChange?.(next);
      setName("");
      setDescription("");
    } catch {
      setError("Falha de conexão ao salvar o pilar.");
    } finally {
      setBusy(false);
    }
  }

  async function archivePillar(id: string) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/pillars/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const j = (await res.json()) as { pillar?: Pillar; error?: string };
      if (!res.ok || !j.pillar) {
        setError(j.error ?? "Não foi possível arquivar o pilar.");
        return;
      }
      const next = pillars.filter((p) => p.id !== id);
      setPillars(next);
      onChange?.(next);
    } catch {
      setError("Falha de conexão ao arquivar o pilar.");
    } finally {
      setBusy(false);
    }
  }

  async function importBatch(payload: { json?: string; pillars?: SuggestedPillar[] }) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/pillars/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { created?: Pillar[]; skipped_duplicates?: string[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? "Não foi possível importar os pilares.");
        return;
      }
      const created = j.created ?? [];
      if (created.length) {
        const next = [...pillars, ...created];
        setPillars(next);
        onChange?.(next);
      }
      setJsonText("");
      setShowImport(false);
      setSuggestions([]);
      setMsg(
        `Pilares importados: ${created.length}.` +
          (j.skipped_duplicates?.length ? ` Ignorados (já existiam): ${j.skipped_duplicates.join(", ")}.` : ""),
      );
    } catch {
      setError("Falha de conexão ao importar pilares.");
    } finally {
      setBusy(false);
    }
  }

  async function suggestWithAi() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/pillars/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ai" }),
      });
      const j = (await res.json()) as { prompt?: string; pillars?: SuggestedPillar[]; error?: string };
      if (j.prompt) setPromptText(j.prompt);
      if (!res.ok) {
        setError(j.error ?? "Não foi possível sugerir pilares.");
        return;
      }
      if (j.pillars?.length) {
        setSuggestions(j.pillars);
        setMsg(`O Gemini sugeriu ${j.pillars.length} pilares. Revise abaixo e clique em Importar sugestões.`);
      } else {
        setShowImport(true);
        setMsg("Chave do Gemini não detectada. Copie o pedido gerado e cole o JSON abaixo.");
      }
    } catch {
      setError("Falha de conexão ao consultar o Gemini.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <h2>1. Pilares de conteúdo &amp; pesos</h2>
          <span className="muted small">
            Soma atual:{" "}
            <strong style={{ color: totalWeight === 100 ? "var(--ok-ink)" : "var(--warn-ink)" }}>
              {totalWeight}%
            </strong>{" "}
            {totalWeight === 100 ? "(equilibrado em 100%)" : "(recomendado somar 100%)"}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowImport((v) => !v)}
            disabled={busy}
          >
            {showImport ? "Fechar JSON" : "Importar JSON"}
          </button>
          <button type="button" className="btn primary" onClick={suggestWithAi} disabled={busy}>
            {busy ? "Consultando Gemini..." : "Sugerir Pilares com IA"}
          </button>
        </div>
      </div>

      {error && (
        <p className="alert err" role="alert">
          {error}
        </p>
      )}
      {msg && (
        <p className="alert ok" role="status">
          {msg}
        </p>
      )}

      <div className="ed-pillars">
        {active.length === 0 && <span className="muted small">Nenhum pilar cadastrado ainda.</span>}
        {active.map((p) => (
          <span key={p.id} className="ed-pillar-chip" title={p.description || p.name}>
            <span className="dot" style={{ background: p.color }} aria-hidden="true" />
            <span>
              {p.name} ({p.weight_pct}%)
            </span>
            <button
              type="button"
              onClick={() => archivePillar(p.id)}
              disabled={busy}
              aria-label={`Arquivar pilar ${p.name}`}
              style={{
                border: 0,
                background: "none",
                cursor: "pointer",
                color: "var(--muted)",
                padding: "0 4px",
                minHeight: 24,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="col" style={{ gap: 10, padding: 12, border: "1px solid var(--line-strong)", borderRadius: 10, background: "var(--soft)" }}>
          <div className="row between">
            <strong>Sugestões do Gemini ({suggestions.length})</strong>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => setSuggestions([])} disabled={busy}>
                Descartar
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => importBatch({ pillars: suggestions })}
                disabled={busy}
              >
                Importar sugestões
              </button>
            </div>
          </div>
          <div className="ed-list">
            {suggestions.map((s) => (
              <div key={s.name} className="ed-item-card">
                <div className="row" style={{ gap: 8 }}>
                  <span className="dot" style={{ background: s.color }} aria-hidden="true" />
                  <strong>{s.name}</strong>
                  <span className="chip">{s.weight_pct}%</span>
                </div>
                <span className="muted small">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showImport && (
        <div className="col" style={{ gap: 10, padding: 12, border: "1px solid var(--line-strong)", borderRadius: 10, background: "var(--soft)" }}>
          {promptText && (
            <label className="f">
              <span>Pedido para a IA (copiar e colar)</span>
              <textarea rows={4} readOnly value={promptText} />
            </label>
          )}
          <label className="f">
            <span>Colar array JSON de pilares</span>
            <textarea
              rows={5}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='[{"name":"Educativo","description":"Dicas práticas","color":"#3347D6","weight_pct":40,"weekly_target":2}]'
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => importBatch({ json: jsonText })}
              disabled={!jsonText.trim() || busy}
            >
              Importar pilares do JSON
            </button>
          </div>
        </div>
      )}

      <details>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
          + Adicionar pilar manualmente
        </summary>
        <form onSubmit={addPillar} className="grid2" style={{ marginTop: 12, gap: 12 }}>
          <label className="f">
            <span>Nome do pilar</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Educativo, Quebra de objeções..."
              maxLength={80}
              required
            />
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label className="f" style={{ flex: 1 }}>
              <span>Peso (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={weightPct}
                onChange={(e) => setWeightPct(Number(e.target.value))}
              />
            </label>
            <label className="f">
              <span>Cor</span>
              <select value={color} onChange={(e) => setColor(e.target.value)}>
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="f" style={{ gridColumn: "1 / -1" }}>
            <span>Descrição / objetivo do pilar</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que entra neste pilar?"
              maxLength={300}
            />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Salvando..." : "Salvar pilar"}
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}
