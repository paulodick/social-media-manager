"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ToneSelector from "@/components/ToneSelector";
import { NETWORKS, isNetwork } from "@/config/networks";
import type { ContentFormat, ContentItem, ContentSourceKind, ContentStatus, Pillar, SlotView } from "@/lib/editorial-types";

export default function EditorialItemForm({
  clientId,
  clientNetworks,
  pillars,
  initialItem,
  initialSlots,
}: {
  clientId: string;
  clientNetworks: string[];
  pillars: Pillar[];
  initialItem: ContentItem;
  initialSlots: SlotView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialItem.title);
  const [pillarId, setPillarId] = useState(initialItem.pillar_id ?? "");
  const [sourceKind, setSourceKind] = useState<ContentSourceKind>(initialItem.source_kind);
  const [contentFormat, setContentFormat] = useState<ContentFormat>(initialItem.content_format ?? "video");
  const [status, setStatus] = useState<ContentStatus>(initialItem.status);
  const [themeKey, setThemeKey] = useState(initialItem.theme_key);
  const [hook, setHook] = useState(initialItem.hook);
  const [angle, setAngle] = useState(initialItem.angle);
  const [brief, setBrief] = useState(initialItem.brief);
  const [script, setScript] = useState(initialItem.script);
  const [scriptHook, setScriptHook] = useState(initialItem.script_hook ?? "");
  const [scriptDev, setScriptDev] = useState(initialItem.script_dev ?? "");
  const [scriptCta, setScriptCta] = useState(initialItem.script_cta ?? "");
  const [transcript, setTranscript] = useState(initialItem.transcript);
  const [captionDraft, setCaptionDraft] = useState(initialItem.caption_draft);
  const [tones, setTones] = useState<string[]>(initialItem.tones);
  const [driveUrl, setDriveUrl] = useState(initialItem.drive_url);

  const [slots, setSlots] = useState<SlotView[]>(initialSlots);
  const availableNets = clientNetworks.filter(isNetwork);
  const firstNet = availableNets[0] ?? "instagram";
  const [slotDay, setSlotDay] = useState("");
  const [slotTime, setSlotTime] = useState("09:30");
  const [slotNet, setSlotNet] = useState<string>(firstNet);
  const [slotFmt, setSlotFmt] = useState<string>(Object.keys(NETWORKS[firstNet].formats)[0] ?? "reels");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/items/${initialItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          pillar_id: pillarId || null,
          source_kind: sourceKind,
          content_format: contentFormat,
          status,
          theme_key: themeKey,
          hook,
          angle,
          brief,
          script,
          script_hook: scriptHook,
          script_dev: scriptDev,
          script_cta: scriptCta,
          transcript,
          caption_draft: captionDraft,
          tones,
          drive_url: driveUrl,
        }),
      });
      const j = (await res.json()) as { item?: ContentItem; error?: string };
      if (!res.ok || !j.item) {
        setErr(j.error ?? "Erro ao salvar item.");
        return;
      }
      setThemeKey(j.item.theme_key);
      setMsg("Item salvo com sucesso.");
    } catch {
      setErr("Falha de conexão ao salvar o item.");
    } finally {
      setBusy(false);
    }
  }

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!slotDay) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_item_id: initialItem.id,
          planned_day: slotDay,
          planned_time: slotTime || null,
          network: slotNet,
          format: slotFmt,
        }),
      });
      const j = (await res.json()) as { slot?: SlotView; error?: string };
      if (!res.ok || !j.slot) {
        setErr(j.error ?? "Não foi possível agendar.");
        return;
      }
      setSlots((prev) => [...prev, j.slot!]);
      setSlotDay("");
    } catch {
      setErr("Falha ao agendar horário.");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem() {
    if (!window.confirm("Excluir este item editorial? Destinos já enviados à fila não serão apagados.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/editorial/items/${initialItem.id}`, { method: "DELETE" });
      if (res.ok) router.push(`/clientes/${clientId}/editorial`);
    } finally {
      setBusy(false);
    }
  }

  const formats = isNetwork(slotNet) ? Object.entries(NETWORKS[slotNet].formats) : [];

  return (
    <div className="col" style={{ gap: 20 }}>
      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      <form onSubmit={saveItem} className="card col" style={{ gap: 14 }}>
        <div className="row between">
          <h2>Dados do conteúdo</h2>
          <button type="button" className="btn danger" onClick={removeItem} disabled={busy}>
            Excluir item
          </button>
        </div>

        <label className="f">
          <span>Título interno</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </label>

        <div className="grid2" style={{ gap: 12 }}>
          <label className="f">
            <span>Pilar</span>
            <select value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
              <option value="">Sem pilar</option>
              {pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            <span>Formato do conteúdo</span>
            <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value as ContentFormat)}>
              <option value="video">Vídeo (falando para a câmera)</option>
              <option value="carousel">Carrossel</option>
              <option value="static_image">Estático (imagem única)</option>
            </select>
          </label>
          <label className="f">
            <span>Origem</span>
            <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as ContentSourceKind)}>
              <option value="needs_creation">Criar / Gravar</option>
              <option value="existing_ready">Pronto (acervo)</option>
            </select>
          </label>
          <label className="f">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)}>
              <option value="idea">Ideia</option>
              <option value="drafting">Em produção</option>
              <option value="ready">Pronto</option>
              <option value="archived">Arquivado</option>
            </select>
          </label>
        </div>

        <div className="grid2" style={{ gap: 12 }}>
          <label className="f">
            <span>Chave do tema (anti-repetição)</span>
            <input type="text" value={themeKey} onChange={(e) => setThemeKey(e.target.value)} maxLength={80} />
          </label>
          <label className="f">
            <span>Link do arquivo no Google Drive</span>
            <input
              type="text"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
            />
          </label>
        </div>

        <div className="grid2" style={{ gap: 12 }}>
          <label className="f">
            <span>Gancho inicial (Hook)</span>
            <input type="text" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={240} />
          </label>
          <label className="f">
            <span>Ângulo editorial</span>
            <input type="text" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={300} />
          </label>
        </div>

        <label className="f">
          <span>Resumo / Brief (vira a descrição da legenda na fila)</span>
          <textarea className="auto-grow" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} />
        </label>

        <div className="col" style={{ gap: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }}>
          <strong className="small">Roteiro de vídeo estruturado</strong>
          <label className="f">
            <span>Gancho (0–3s)</span>
            <input type="text" value={scriptHook} onChange={(e) => setScriptHook(e.target.value)} placeholder="Primeira frase de impacto para prender atenção..." />
          </label>
          <label className="f">
            <span>Desenvolvimento (tópicos objetivos para falar)</span>
            <textarea className="auto-grow" value={scriptDev} onChange={(e) => setScriptDev(e.target.value)} rows={3} placeholder="- Tópico 1&#10;- Tópico 2" />
          </label>
          <label className="f">
            <span>Chamada para Ação (CTA)</span>
            <input type="text" value={scriptCta} onChange={(e) => setScriptCta(e.target.value)} placeholder="O que a pessoa deve fazer ao final?" />
          </label>
          <label className="f">
            <span>Roteiro completo / notas livres</span>
            <textarea className="auto-grow" value={script} onChange={(e) => setScript(e.target.value)} rows={3} />
          </label>
        </div>

        <label className="f">
          <span>Transcrição / notas do arquivo existente</span>
          <textarea className="auto-grow" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} />
        </label>

        <ToneSelector initial={tones} onChange={setTones} />

        <label className="f">
          <span>Rascunho de legenda</span>
          <textarea className="auto-grow" value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} rows={4} />
        </label>

        <div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </form>

      <section className="card col" style={{ gap: 12 }}>
        <h2>Datas planejadas na agenda</h2>
        <div className="ed-list">
          {slots.length === 0 && <span className="muted small">Ainda não agendado em nenhum dia.</span>}
          {slots.map((s) => (
            <div key={s.id} className="ed-item-card">
              <span>
                <strong>{s.day}</strong> {s.time ?? "--:--"} · {s.network} / {s.format}
              </span>
              <span className="muted small">{s.target ? `Na fila (${s.target.status})` : "Planejado"}</span>
            </div>
          ))}
        </div>

        <form onSubmit={addSlot} className="row" style={{ gap: 8 }}>
          <input type="date" value={slotDay} onChange={(e) => setSlotDay(e.target.value)} required />
          <input type="time" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} />
          <select
            value={slotNet}
            onChange={(e) => {
              const n = e.target.value;
              setSlotNet(n);
              if (isNetwork(n)) setSlotFmt(Object.keys(NETWORKS[n].formats)[0] ?? "");
            }}
          >
            {(availableNets.length ? availableNets : (Object.keys(NETWORKS) as (keyof typeof NETWORKS)[])).map((n) => (
              <option key={n} value={n}>
                {NETWORKS[n].label}
              </option>
            ))}
          </select>
          <select value={slotFmt} onChange={(e) => setSlotFmt(e.target.value)}>
            {formats.map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={busy}>
            Agendar dia
          </button>
        </form>
      </section>
    </div>
  );
}
