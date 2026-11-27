"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ContentFormat, ContentItem, ContentSourceKind, ContentStatus, ItemCard, Pillar } from "@/lib/editorial-types";
import DriveImportPanel from "./DriveImportPanel";
import PillarManager from "./PillarManager";
import SequencePanel from "./SequencePanel";

const FORMAT_LABEL: Record<ContentFormat, string> = {
  video: "Vídeo",
  carousel: "Carrossel",
  static_image: "Imagem única",
};

const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  idea: "Ideia",
  drafting: "Em produção",
  ready: "Pronto",
  archived: "Arquivado",
};

/**
 * Aba "Conteúdos" do cliente: a sequência de posts (sincronizar a pasta, montar com IA, aprovar), a lista de
 * conteúdos (vídeos prontos e pautas para gravar) e, recolhidos, pilares, diretrizes da IA e importação avulsa do
 * Drive. O calendário é um só, o do cliente: o que a sequência planeja aparece lá como "Planejado".
 */
export default function EditorialBoard({
  clientId,
  clientNetworks,
  hasDriveFolder,
  initialPillars,
  initialItems,
  initialStyleNotes = "",
  aiEnabled = false,
  today,
}: {
  clientId: string;
  clientNetworks: string[];
  hasDriveFolder: boolean;
  initialPillars: Pillar[];
  initialItems: ItemCard[];
  initialStyleNotes?: string;
  aiEnabled?: boolean;
  today: string;
}) {
  const [pillars, setPillars] = useState<Pillar[]>(initialPillars);
  const [items, setItems] = useState<ItemCard[]>(initialItems);
  useEffect(() => setItems(initialItems), [initialItems]);
  const [filterSource, setFilterSource] = useState<"" | ContentSourceKind>("");
  const [newTitle, setNewTitle] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [styleNotes, setStyleNotes] = useState(initialStyleNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const visible = items.filter((it) => it.status !== "archived" && (!filterSource || it.source_kind === filterSource));
  const unclassified = items.filter((it) => !it.pillar_id && it.status !== "archived");

  function toItemCard(it: ContentItem): ItemCard {
    const p = pillars.find((x) => x.id === it.pillar_id);
    return { ...it, pillar: p ? { id: p.id, name: p.name, color: p.color } : null, assets_count: 0, slots_count: 0, in_queue_count: 0 };
  }

  async function saveStyleNotes(e: React.FormEvent) {
    e.preventDefault();
    setSavingNotes(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_style_notes: styleNotes }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "Não foi possível salvar as diretrizes.");
        return;
      }
      setMsg("Diretrizes da IA salvas.");
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function createQuickItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || addingItem) return;
    setAddingItem(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), pillar_id: null, source_kind: "needs_creation", content_format: "video", status: "idea" }),
      });
      const j = (await res.json()) as { item?: ContentItem; error?: string };
      if (!res.ok || !j.item) {
        setErr(j.error ?? "Não foi possível criar a pauta.");
        return;
      }
      setItems((prev) => [toItemCard(j.item!), ...prev]);
      setNewTitle("");
      setMsg(`Pauta "${j.item.title}" criada.`);
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setAddingItem(false);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <SequencePanel clientId={clientId} clientNetworks={clientNetworks} today={today} aiEnabled={aiEnabled} />

      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      <section className="card col" style={{ gap: 14 }} aria-labelledby="ed-items-h">
        <div className="row between">
          <h2 id="ed-items-h">Conteúdos ({visible.length})</h2>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={`filter ${filterSource === "" ? "on" : ""}`} onClick={() => setFilterSource("")}>Todos</button>
            <button type="button" className={`filter ${filterSource === "existing_ready" ? "on" : ""}`} onClick={() => setFilterSource("existing_ready")}>Vídeos prontos</button>
            <button type="button" className={`filter ${filterSource === "needs_creation" ? "on" : ""}`} onClick={() => setFilterSource("needs_creation")}>Para gravar</button>
          </div>
        </div>

        <form onSubmit={createQuickItem} className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nova pauta para gravar (ex.: 3 erros na manutenção do tomógrafo)"
            maxLength={160}
            aria-label="Título da nova pauta"
            style={{ flex: "1 1 280px" }}
          />
          <button type="submit" className="btn" disabled={addingItem || !newTitle.trim()}>
            {addingItem ? "Criando…" : "Criar pauta"}
          </button>
        </form>

        <div className="ed-list">
          {visible.length === 0 && <span className="muted small">Nenhum conteúdo aqui ainda. Use "Sincronizar conteúdos" acima para ler a pasta Reels Editados.</span>}
          {visible.map((it) => (
            <Link key={it.id} href={`/clientes/${clientId}/editorial/${it.id}`} className="ed-item-card" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="col" style={{ gap: 4, flex: 1, minWidth: 240 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className={it.source_kind === "existing_ready" ? "ed-badge-ready" : "ed-badge-create"}>
                    {it.source_kind === "existing_ready" ? "Vídeo pronto" : "Para gravar"}
                  </span>
                  {it.content_format !== "video" && <span className="ed-badge-fmt">{FORMAT_LABEL[it.content_format]}</span>}
                  {it.topic_tag && <span className="chip">{it.topic_tag}</span>}
                  {it.guest_name && <span className="chip">{it.guest_name}</span>}
                  {it.source_kind === "needs_creation" && <span className="muted small">{CONTENT_STATUS_LABEL[it.status] ?? it.status}</span>}
                </div>
                <strong style={{ fontSize: 16 }}>{it.title}</strong>
              </div>
              <span className="muted small">
                {it.in_queue_count ? `${it.in_queue_count} no calendário` : it.slots_count ? "Planejado" : "Fora da sequência"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ajustes do planejamento (pilares, diretrizes da IA, importar outras pastas)</summary>
        <div className="col" style={{ gap: 16, marginTop: 14 }}>
          <PillarManager clientId={clientId} initialPillars={pillars} onChange={setPillars} />
          <form onSubmit={saveStyleNotes} className="card col" style={{ gap: 10 }}>
            <label className="f">
              <span>Diretrizes da IA para este cliente (tom, termos proibidos, estilo)</span>
              <textarea
                rows={3}
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="Ex.: evitar jargão muito técnico; nunca prometer resultado garantido."
              />
            </label>
            <div>
              <button type="submit" className="btn" disabled={savingNotes}>{savingNotes ? "Salvando…" : "Salvar diretrizes"}</button>
            </div>
          </form>
          <DriveImportPanel
            clientId={clientId}
            hasDriveFolder={hasDriveFolder}
            unclassifiedItems={unclassified}
            onImported={(created) => setItems((prev) => [...created.map(toItemCard), ...prev])}
            onClassified={(updated) => {
              const map = new Map(updated.map((u) => [u.id, toItemCard(u)]));
              setItems((prev) => prev.map((it) => map.get(it.id) ?? it));
            }}
          />
        </div>
      </details>
    </div>
  );
}
