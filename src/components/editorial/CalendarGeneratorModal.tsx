"use client";

import { useRef, useState } from "react";
import { useDialogFocusTrap } from "@/components/useDialogFocusTrap";
import { NETWORKS, isNetwork } from "@/config/networks";
import { DEFAULT_POST_TIME } from "@/lib/dates";
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
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap({ open: true, onClose, containerRef: modalRef });

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const availableNets = clientNetworks.filter(isNetwork);
  const netsToShow = availableNets.length
    ? availableNets
    : (Object.keys(NETWORKS) as (keyof typeof NETWORKS)[]);

  const targetOptions = netsToShow.flatMap((n) =>
    Object.entries(NETWORKS[n].formats).map(([fKey, fmt]) => ({
      key: `${n}:${fKey}`,
      network: n,
      format: fKey,
      label: `${NETWORKS[n].label} · ${fmt.label}`,
    })),
  );

  const [selectedTargets, setSelectedTargets] = useState<string[]>(() =>
    targetOptions[0] ? [targetOptions[0].key] : [],
  );
  const [defaultTime, setDefaultTime] = useState(DEFAULT_POST_TIME);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [manualJson, setManualJson] = useState("");

  function toggleWeekday(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function toggleTarget(key: string) {
    setSelectedTargets((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Não foi possível copiar automaticamente. Selecione e copie o texto do pedido.");
    }
  }

  async function generate(mode: "ai" | "prompt_only", useManual = false) {
    if (weekdays.length === 0) {
      setErr("Selecione ao menos um dia da semana.");
      return;
    }
    if (selectedTargets.length === 0) {
      setErr("Selecione ao menos uma rede e formato.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const targets = selectedTargets.map((key) => {
        const [network, format] = key.split(":");
        return { network, format, default_time: defaultTime || null };
      });
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          weekdays,
          targets,
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
    <div
      className="ed-modal-back"
      role="dialog"
      aria-modal="true"
      aria-label="Gerar calendário sem repetição"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="ed-modal"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <h2>Gerar calendário inteligente</h2>
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          Cruza os conteúdos prontos do acervo com temas inéditos (a criar/gravar) sem repetir assuntos recentes.
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
            <span>Horário padrão</span>
            <input type="time" value={defaultTime} onChange={(e) => setDefaultTime(e.target.value)} />
          </label>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            Redes e formatos ({selectedTargets.length} selecionado{selectedTargets.length === 1 ? "" : "s"})
          </span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {targetOptions.map((opt) => {
              const active = selectedTargets.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`filter ${active ? "on" : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleTarget(opt.key)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>Dias da semana</span>
          <div className="row" style={{ gap: 6 }}>
            {WEEKDAYS.map((w) => {
              const active = weekdays.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`filter ${active ? "on" : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleWeekday(w.id)}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => generate("ai")} disabled={busy}>
            {busy ? "Gerando…" : "Gerar com IA"}
          </button>
          <button type="button" className="btn" onClick={() => generate("prompt_only")} disabled={busy}>
            Copiar pedido para a IA
          </button>
        </div>

        {prompt && (
          <div className="col" style={{ gap: 8 }}>
            <div className="row between" style={{ alignItems: "center" }}>
              <span className="small" style={{ fontWeight: 600 }}>Pedido estruturado</span>
              <button type="button" className="btn" onClick={copyPrompt}>
                {copied ? "Copiado!" : "Copiar pedido"}
              </button>
            </div>
            <textarea rows={5} readOnly value={prompt} aria-label="Pedido estruturado" />
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
