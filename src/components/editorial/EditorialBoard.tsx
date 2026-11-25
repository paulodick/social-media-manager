"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NetDot, StatusPill } from "@/components/ui";
import { useDialogFocusTrap } from "@/components/useDialogFocusTrap";
import { NETWORKS, isNetwork } from "@/config/networks";
import { DEFAULT_POST_TIME, addDays, isTime, monthGrid, todaySP } from "@/lib/dates";
import type {
  ContentFormat,
  ContentItem,
  ContentSourceKind,
  ContentStatus,
  ItemCard,
  Pillar,
  SlotView,
} from "@/lib/editorial-types";
import CalendarGeneratorModal from "./CalendarGeneratorModal";
import DriveImportPanel from "./DriveImportPanel";
import PillarManager from "./PillarManager";
import SequencePanel from "./SequencePanel";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const FORMAT_LABEL: Record<ContentFormat, string> = {
  video: "Vídeo",
  carousel: "Carrossel",
  static_image: "Estático",
};

const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  idea: "Ideia",
  drafting: "Em produção",
  ready: "Pronto",
  archived: "Arquivado",
};

export default function EditorialBoard({
  clientId,
  clientNetworks,
  hasDriveFolder,
  initialMonth,
  initialPillars,
  initialItems,
  initialSlots,
  initialStyleNotes = "",
  aiEnabled = false,
  today: todayProp = "",
}: {
  clientId: string;
  clientNetworks: string[];
  hasDriveFolder: boolean;
  initialMonth: string;
  initialPillars: Pillar[];
  initialItems: ItemCard[];
  initialSlots: SlotView[];
  initialStyleNotes?: string;
  aiEnabled?: boolean;
  today?: string;
}) {
  const [pillars, setPillars] = useState<Pillar[]>(initialPillars);
  const [items, setItems] = useState<ItemCard[]>(initialItems);
  const [slots, setSlots] = useState<SlotView[]>(initialSlots);
  // Depois de a sequência gravar ou aprovar (router.refresh), o calendário abaixo recebe os horários novos do servidor.
  useEffect(() => setSlots(initialSlots), [initialSlots]);
  useEffect(() => setItems(initialItems), [initialItems]);
  const [filterPillar, setFilterPillar] = useState<string>("");
  const [filterSource, setFilterSource] = useState<"" | ContentSourceKind>("");
  const [showGen, setShowGen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPillar, setNewPillar] = useState("");
  const [newFormat, setNewFormat] = useState<ContentFormat>("video");
  const [addingItem, setAddingItem] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [unapproving, setUnapproving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const approveModalRef = useRef<HTMLDivElement>(null);
  const closeApproveModal = useCallback(() => {
    if (!approving) setConfirmApprove(false);
  }, [approving]);
  useDialogFocusTrap({ open: confirmApprove, onClose: closeApproveModal, containerRef: approveModalRef });

  const [manualRecreate, setManualRecreate] = useState<{ slot: SlotView; prompt: string } | null>(null);
  const [manualRecreateJson, setManualRecreateJson] = useState("");
  const [recreateCopied, setRecreateCopied] = useState(false);
  const [recreateErr, setRecreateErr] = useState("");
  const [applyingRecreate, setApplyingRecreate] = useState(false);
  const recreateModalRef = useRef<HTMLDivElement>(null);
  const closeRecreateModal = useCallback(() => {
    if (!applyingRecreate) {
      setManualRecreate(null);
      setManualRecreateJson("");
      setRecreateErr("");
      setRecreateCopied(false);
    }
  }, [applyingRecreate]);
  useDialogFocusTrap({ open: !!manualRecreate, onClose: closeRecreateModal, containerRef: recreateModalRef });

  const [enqueueModalSlot, setEnqueueModalSlot] = useState<SlotView | null>(null);
  const [enqueueTime, setEnqueueTime] = useState(DEFAULT_POST_TIME);
  const [enqueueTimeErr, setEnqueueTimeErr] = useState("");
  const enqueueModalRef = useRef<HTMLDivElement>(null);
  const closeEnqueueModal = useCallback(() => {
    if (!busyId) {
      setEnqueueModalSlot(null);
      setEnqueueTimeErr("");
    }
  }, [busyId]);
  useDialogFocusTrap({ open: !!enqueueModalSlot, onClose: closeEnqueueModal, containerRef: enqueueModalRef });

  const [failedApprovals, setFailedApprovals] = useState<{ slot_ids: string[]; error: string }[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [styleNotes, setStyleNotes] = useState(initialStyleNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const today = todaySP();
  const cells = monthGrid(initialMonth);

  const filteredSlots = slots.filter((s) => {
    if (filterPillar && s.item.pillar_id !== filterPillar) return false;
    if (filterSource && s.item.source_kind !== filterSource) return false;
    return true;
  });

  const chronological = [...filteredSlots].sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (a.position !== b.position) return a.position - b.position;
    return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
  });

  const slotsByDay = new Map<string, SlotView[]>();
  for (const s of chronological) {
    slotsByDay.set(s.day, [...(slotsByDay.get(s.day) ?? []), s]);
  }

  const filteredItems = items.filter((it) => {
    if (it.status === "archived") return false;
    if (filterPillar && it.pillar_id !== filterPillar) return false;
    if (filterSource && it.source_kind !== filterSource) return false;
    return true;
  });

  const unclassified = items.filter((it) => !it.pillar_id && it.status !== "archived");
  const allApproved = chronological.length > 0 && chronological.every((s) => s.plan_status === "approved");
  const draftCount = chronological.filter((s) => s.plan_status !== "approved").length;
  const pendingToApprove = chronological.filter((s) => s.status === "planned" && !s.target);
  const approvedWithoutTarget = chronological.filter((s) => s.plan_status === "approved" && !s.target);

  const activeFilters: string[] = [];
  if (filterSource === "existing_ready") activeFilters.push("Origem: Pronto (acervo)");
  if (filterSource === "needs_creation") activeFilters.push("Origem: Criar / Gravar");
  if (filterPillar) {
    const pName = pillars.find((p) => p.id === filterPillar)?.name;
    activeFilters.push(`Pilar: ${pName ?? "selecionado"}`);
  }
  const activeFilterLabel = activeFilters.join(" · ");

  function fmtDayBr(day: string): string {
    const [y, m, d] = day.split("-");
    return y && m && d ? `${d}/${m}/${y}` : day;
  }

  const approvalPeriod = pendingToApprove.length
    ? pendingToApprove[0].day === pendingToApprove[pendingToApprove.length - 1].day
      ? fmtDayBr(pendingToApprove[0].day)
      : `${fmtDayBr(pendingToApprove[0].day)} a ${fmtDayBr(pendingToApprove[pendingToApprove.length - 1].day)}`
    : initialMonth;

  function toItemCard(it: ContentItem): ItemCard {
    const p = pillars.find((x) => x.id === it.pillar_id);
    return {
      ...it,
      pillar: p ? { id: p.id, name: p.name, color: p.color } : null,
      assets_count: 0,
      slots_count: 0,
      in_queue_count: 0,
    };
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
      setMsg("Diretrizes de estilo da IA salvas na memória do cliente.");
    } catch {
      setErr("Falha ao salvar diretrizes de estilo.");
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
        body: JSON.stringify({
          title: newTitle.trim(),
          pillar_id: newPillar || null,
          source_kind: "needs_creation",
          content_format: newFormat,
          status: "idea",
        }),
      });
      const j = (await res.json()) as { item?: ContentItem; error?: string };
      if (!res.ok || !j.item) {
        setErr(j.error ?? "Não foi possível criar o item.");
        return;
      }
      setItems((prev) => [toItemCard(j.item!), ...prev]);
      setNewTitle("");
      setMsg(`Pauta "${j.item.title}" adicionada ao banco de pautas.`);
    } catch {
      setErr("Falha ao criar o item.");
    } finally {
      setAddingItem(false);
    }
  }

  async function moveSlot(slot: SlotView, deltaDays: number) {
    setBusyId(slot.id);
    setErr("");
    setMsg("");
    const targetDay = addDays(slot.day, deltaDays);
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moves: [{ slot_id: slot.id, planned_day: targetDay, planned_time: slot.time, position: slot.position }],
        }),
      });
      const j = (await res.json()) as { slots?: SlotView[]; error?: string };
      if (!res.ok || !j.slots?.length) {
        setErr(j.error ?? "Não foi possível mover o horário.");
        return;
      }
      const updated = j.slots[0];
      setSlots((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      setErr("Falha ao reordenar o calendário.");
    } finally {
      setBusyId(null);
    }
  }

  /** Troca a data/posição entre dois slots na lista cronológica e persiste na API. */
  async function swapChronological(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromIdx = chronological.findIndex((s) => s.id === fromId);
    const toIdx = chronological.findIndex((s) => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const a = chronological[fromIdx];
    const b = chronological[toIdx];
    if (a.target || b.target) {
      setErr("Itens já enviados para a fila não podem ser reordenados por aqui.");
      return;
    }

    const moves = [
      { slot_id: a.id, planned_day: b.day, planned_time: b.time, position: b.position },
      { slot_id: b.id, planned_day: a.day, planned_time: a.time, position: a.position },
    ];

    setBusyId(a.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      const j = (await res.json()) as { slots?: SlotView[]; error?: string };
      if (!res.ok || !j.slots) {
        setErr(j.error ?? "Não foi possível reordenar os itens.");
        return;
      }
      const byId = new Map(j.slots.map((s) => [s.id, s]));
      setSlots((prev) => prev.map((x) => byId.get(x.id) ?? x));
    } catch {
      setErr("Falha de conexão ao reordenar a lista cronológica.");
    } finally {
      setBusyId(null);
      setDragId(null);
    }
  }

  async function recreateSlot(slot: SlotView) {
    setBusyId(slot.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/schedule/${slot.id}/recreate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ai" }),
      });
      const j = (await res.json()) as {
        prompt?: string;
        slot?: SlotView | null;
        item?: ContentItem | null;
        reason_why?: string;
        error?: string;
      };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível recriar este tópico.");
        return;
      }
      if (!j.slot || !j.item) {
        if (j.prompt) {
          setManualRecreate({ slot, prompt: j.prompt });
          setManualRecreateJson("");
          setRecreateErr("");
          setRecreateCopied(false);
        }
        return;
      }
      setSlots((prev) => prev.map((x) => (x.id === j.slot!.id ? j.slot! : x)));
      setItems((prev) => [toItemCard(j.item!), ...prev]);
      setMsg(
        `Tópico recriado: "${j.item.title}".${j.reason_why ? ` Motivo: ${j.reason_why}` : ""}`,
      );
    } catch {
      setErr("Falha de conexão ao recriar tópico.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyRecreatePrompt() {
    if (!manualRecreate) return;
    try {
      await navigator.clipboard.writeText(manualRecreate.prompt);
      setRecreateCopied(true);
      setTimeout(() => setRecreateCopied(false), 2000);
    } catch {
      setRecreateErr("Não foi possível copiar automaticamente. Selecione e copie o texto do pedido.");
    }
  }

  async function applyManualRecreate() {
    if (!manualRecreate || !manualRecreateJson.trim()) return;
    setApplyingRecreate(true);
    setRecreateErr("");
    try {
      const res = await fetch(`/api/editorial/schedule/${manualRecreate.slot.id}/recreate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "prompt_only", manual_json: manualRecreateJson }),
      });
      const j = (await res.json()) as {
        slot?: SlotView | null;
        item?: ContentItem | null;
        reason_why?: string;
        error?: string;
      };
      if (!res.ok || !j.slot || !j.item) {
        setRecreateErr(j.error ?? "Não foi possível aplicar o JSON retornado.");
        return;
      }
      setSlots((prev) => prev.map((x) => (x.id === j.slot!.id ? j.slot! : x)));
      setItems((prev) => [toItemCard(j.item!), ...prev]);
      setMsg(
        `Tópico recriado: "${j.item.title}".${j.reason_why ? ` Motivo: ${j.reason_why}` : ""}`,
      );
      setManualRecreate(null);
      setManualRecreateJson("");
    } catch {
      setRecreateErr("Falha de conexão ao aplicar o JSON.");
    } finally {
      setApplyingRecreate(false);
    }
  }

  async function approveSchedule() {
    if (!pendingToApprove.length) return;
    setConfirmApprove(false);
    setApproving(true);
    setErr("");
    setMsg("");
    setFailedApprovals([]);
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_ids: pendingToApprove.map((s) => s.id) }),
      });
      const j = (await res.json()) as {
        approved_count?: number;
        enqueued_targets?: number;
        warnings?: string[];
        failed?: { slot_ids: string[]; error: string }[];
        slots?: SlotView[];
        error?: string;
      };
      if (j.failed?.length) {
        setFailedApprovals(j.failed);
      }
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível aprovar o cronograma.");
        return;
      }
      if (j.slots?.length) {
        const byId = new Map(j.slots.map((s) => [s.id, s]));
        setSlots((prev) => prev.map((x) => byId.get(x.id) ?? x));
      }
      const warn = j.warnings?.length ? ` Avisos: ${j.warnings.join(" ")}` : "";
      const approvedCount = j.approved_count ?? 0;
      const enqueuedCount = j.enqueued_targets ?? 0;
      setMsg(
        `Cronograma aprovado: ${approvedCount} item(ns) oficializados e ${enqueuedCount} rascunho(s) criados na fila.${warn}`,
      );
    } catch {
      setErr("Falha de conexão ao aprovar cronograma.");
    } finally {
      setApproving(false);
    }
  }

  async function unapproveSchedule() {
    if (!approvedWithoutTarget.length) return;
    setUnapproving(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_ids: approvedWithoutTarget.map((s) => s.id) }),
      });
      const j = (await res.json()) as {
        unapproved_count?: number;
        slots?: SlotView[];
        error?: string;
      };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível desfazer a aprovação.");
        return;
      }
      if (j.slots?.length) {
        const byId = new Map(j.slots.map((s) => [s.id, s]));
        setSlots((prev) => prev.map((x) => byId.get(x.id) ?? x));
      }
      setMsg(`Aprovação desfeita para ${j.unapproved_count ?? approvedWithoutTarget.length} item(ns).`);
    } catch {
      setErr("Falha de conexão ao desfazer aprovação.");
    } finally {
      setUnapproving(false);
    }
  }

  async function removeSlot(slot: SlotView) {
    setBusyId(slot.id);
    setErr("");
    try {
      const res = await fetch(`/api/editorial/schedule/${slot.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "Não foi possível remover o horário.");
        return;
      }
      setSlots((prev) => prev.filter((x) => x.id !== slot.id));
    } catch {
      setErr("Falha ao remover o horário.");
    } finally {
      setBusyId(null);
    }
  }

  async function enqueueSlot(slot: SlotView) {
    if (!slot.time) {
      setEnqueueTime(DEFAULT_POST_TIME);
      setEnqueueTimeErr("");
      setEnqueueModalSlot(slot);
      return;
    }
    await submitEnqueueSlot(slot, slot.time);
  }

  async function submitEnqueueSlot(slot: SlotView, rawTime: string) {
    const time = rawTime.trim();
    if (!isTime(time)) {
      setEnqueueTimeErr("Informe um horário válido no formato HH:MM.");
      return;
    }
    setBusyId(slot.id);
    setErr("");
    setMsg("");
    setEnqueueTimeErr("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/schedule/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_ids: [slot.id], time }),
      });
      const j = (await res.json()) as {
        post_target_ids?: string[];
        day?: string;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok || !j.post_target_ids?.length) {
        const errorMsg = j.error ?? "Não foi possível enviar para a fila.";
        if (enqueueModalSlot?.id === slot.id) setEnqueueTimeErr(errorMsg);
        else setErr(errorMsg);
        return;
      }
      setSlots((prev) =>
        prev.map((x) =>
          x.id === slot.id
            ? {
                ...x,
                time,
                target: {
                  id: j.post_target_ids![0],
                  status: "draft",
                  publish_state: "idle",
                  auto_confirmed: false,
                },
              }
            : x,
        ),
      );
      setEnqueueModalSlot(null);
      const warnText = j.warnings?.length ? ` Avisos: ${j.warnings.join(" ")}` : "";
      setMsg(`Enviado como rascunho para a fila do dia ${j.day}.${warnText}`);
    } catch {
      const errorMsg = "Falha ao enviar para a fila.";
      if (enqueueModalSlot?.id === slot.id) setEnqueueTimeErr(errorMsg);
      else setErr(errorMsg);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <SequencePanel clientId={clientId} clientNetworks={clientNetworks} today={todayProp || today} aiEnabled={aiEnabled} />
      <PillarManager clientId={clientId} initialPillars={pillars} onChange={setPillars} />

      <details className="card">
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
          Diretrizes de estilo e memória contínua da IA (opcional)
        </summary>
        <form onSubmit={saveStyleNotes} className="col" style={{ gap: 10, marginTop: 12 }}>
          <label className="f">
            <span>Preferências de tom, termos proibidos ou estilo que o Gemini deve lembrar neste cliente</span>
            <textarea
              rows={3}
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="Ex.: Evitar jargões médicos muito difíceis; sempre abrir com pergunta prática; nunca usar promessas de resultado garantido."
            />
          </label>
          <div>
            <button type="submit" className="btn" disabled={savingNotes}>
              {savingNotes ? "Salvando..." : "Salvar diretrizes da IA"}
            </button>
          </div>
        </form>
      </details>

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

      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}
      {failedApprovals.length > 0 && (
        <div className="alert err col" role="alert" style={{ gap: 6 }}>
          <strong>Alguns itens não puderam ser enviados para a fila:</strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {failedApprovals.map((f, idx) => {
              const names = f.slot_ids
                .map((id) => {
                  const s = slots.find((x) => x.id === id);
                  return s ? `${fmtDayBr(s.day)} (${s.item.title})` : id;
                })
                .join(", ");
              return (
                <li key={idx}>
                  {names}: {f.error}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <section className="card col" style={{ gap: 14 }}>
        <div className="row between">
          <div className="col" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 8 }}>
              <h2>3. Calendário editorial visual</h2>
              {chronological.length > 0 && (
                <span className={allApproved ? "ed-approved-pill" : "ed-badge-create"}>
                  {allApproved ? "Cronograma oficial aprovado" : `Rascunho (${draftCount} pendente(s))`}
                </span>
              )}
            </div>
            <span className="muted small">
              Alterne vídeos com roteiro, carrosséis e estáticos. Reordene na lista abaixo e oficialize ao final.
            </span>
          </div>
          <button type="button" className="btn primary" onClick={() => setShowGen(true)}>
            Gerar calendário sem repetição
          </button>
        </div>

        <div className="row" style={{ gap: "10px 24px" }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted small" style={{ fontWeight: 600 }}>Origem:</span>
            <button type="button" className={`filter ${filterSource === "" ? "on" : ""}`} onClick={() => setFilterSource("")}>
              Todas
            </button>
            <button
              type="button"
              className={`filter ${filterSource === "existing_ready" ? "on" : ""}`}
              onClick={() => setFilterSource("existing_ready")}
            >
              Pronto (acervo)
            </button>
            <button
              type="button"
              className={`filter ${filterSource === "needs_creation" ? "on" : ""}`}
              onClick={() => setFilterSource("needs_creation")}
            >
              Criar / Gravar
            </button>
          </div>

          <div className="row" style={{ gap: 6 }}>
            <span className="muted small" style={{ fontWeight: 600 }}>Pilar:</span>
            <button type="button" className={`filter ${filterPillar === "" ? "on" : ""}`} onClick={() => setFilterPillar("")}>
              Todos
            </button>
            {pillars.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`filter ${filterPillar === p.id ? "on" : ""}`}
                onClick={() => setFilterPillar(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="cal">
          <div className="cal-in">
            <div className="cal-head">
              {WEEK.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="cal-body">
              {cells.map((c) => {
                const list = slotsByDay.get(c.day) ?? [];
                return (
                  <div
                    key={c.day}
                    className={`cell ${c.inMonth ? "" : "out"} ${c.day === today ? "today" : ""}`}
                    style={{ cursor: "default" }}
                  >
                    <span className="n">{c.inMonth ? c.n : `${c.n}/${c.day.slice(5, 7)}`}</span>
                    {list.map((s) => {
                      const netLabel = isNetwork(s.network) ? NETWORKS[s.network].label : s.network;
                      const slotCaption =
                        s.network === "instagram"
                          ? s.item.caption_instagram || s.item.caption_draft
                          : s.network === "linkedin"
                            ? s.item.caption_linkedin || s.item.caption_draft
                            : s.item.caption_draft || s.item.caption_instagram || s.item.caption_linkedin;
                      return (
                        <div key={s.id} className={`ed-slot ${s.target ? "queued" : ""}`}>
                          <div className="row between" style={{ gap: 4 }}>
                            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                              <NetDot network={s.network} />
                              <span className="small" style={{ fontWeight: 600 }}>
                                {s.time ?? "--:--"}
                              </span>
                            </span>
                            <span className="ed-badge-fmt">{FORMAT_LABEL[s.item.content_format] ?? "Vídeo"}</span>
                          </div>
                          <Link
                            href={`/clientes/${clientId}/editorial/${s.content_item_id}`}
                            style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none", lineHeight: 1.25 }}
                          >
                            {s.item.title}
                          </Link>
                          <span className="muted small">
                            {netLabel} · {s.format}
                            {s.item.pillar_name ? ` · ${s.item.pillar_name}` : ""}
                          </span>
                          {(s.item.guest_name || s.item.topic_tag) && (
                            <span className="small" style={{ lineHeight: 1.25 }}>
                              {s.item.guest_name && <strong>{s.item.guest_name}</strong>}
                              {s.item.guest_name && s.item.topic_tag ? " · " : ""}
                              {s.item.topic_tag && <span className="muted">{s.item.topic_tag}</span>}
                            </span>
                          )}
                          {s.item.cover_idea && (
                            <span className="muted small" style={{ lineHeight: 1.25 }}>
                              <strong>Capa:</strong> {s.item.cover_idea.slice(0, 70)}
                              {s.item.cover_idea.length > 70 ? "…" : ""}
                            </span>
                          )}
                          {slotCaption && (
                            <span className="muted small" style={{ lineHeight: 1.25 }}>
                              <strong>Legenda:</strong> {slotCaption.replace(/\s+/g, " ").slice(0, 75)}
                              {slotCaption.length > 75 ? "…" : ""}
                            </span>
                          )}
                          {s.target ? (
                            <div className="ed-slot-actions">
                              <StatusPill status={s.target.status} />
                              <Link href={`/clientes/${clientId}/dia/${s.day}`}>Ver na fila</Link>
                            </div>
                          ) : (
                            <div className="ed-slot-actions">
                              <button type="button" onClick={() => moveSlot(s, -1)} disabled={busyId === s.id} title="Mover 1 dia antes">
                                ‹
                              </button>
                              <button type="button" onClick={() => moveSlot(s, 1)} disabled={busyId === s.id} title="Mover 1 dia depois">
                                ›
                              </button>
                              <button type="button" onClick={() => enqueueSlot(s)} disabled={busyId === s.id}>
                                Enviar p/ fila
                              </button>
                              <button type="button" onClick={() => removeSlot(s)} disabled={busyId === s.id} title="Remover da agenda">
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Lista Cronológica Reordenável (Drag-and-Drop + Subir/Descer) + Aprovar Cronograma */}
        <div className="col" style={{ gap: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div className="row between">
            <div className="col" style={{ gap: 2 }}>
              <h3>Lista cronológica do planejamento ({chronological.length})</h3>
              <span className="muted small">
                Arraste pela alça ⋮⋮ ou use os botões ↑ / ↓ para remanejar a ordem dos dias.
              </span>
            </div>
          </div>

          {chronological.length === 0 && (
            <span className="muted small">Nenhum item planejado para este período.</span>
          )}

          <div className="ed-list">
            {chronological.map((s, idx) => {
              const netLabel = isNetwork(s.network) ? NETWORKS[s.network].label : s.network;
              const prev = idx > 0 ? chronological[idx - 1] : null;
              const next = idx < chronological.length - 1 ? chronological[idx + 1] : null;
              const hasScript = !!(s.item.script_hook || s.item.script_dev || s.item.script_cta);
              const hasCaptions = !!(s.item.caption_instagram || s.item.caption_linkedin || s.item.caption_draft);

              return (
                <div
                  key={s.id}
                  draggable={!s.target}
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId && dragId !== s.id) swapChronological(dragId, s.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={`ed-chrono-row ${dragId === s.id ? "dragging" : ""}`}
                >
                  <div className="row" style={{ gap: 10, flex: 1, minWidth: 260 }}>
                    {!s.target && (
                      <span className="ed-drag-handle" title="Arraste para reordenar" aria-hidden="true">
                        ⋮⋮
                      </span>
                    )}
                    <div className="col" style={{ gap: 4, flex: 1 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong>{s.day}</strong>
                        <span className="muted small">{s.time ?? "--:--"}</span>
                        <span className="ed-badge-fmt">{FORMAT_LABEL[s.item.content_format] ?? "Vídeo"}</span>
                        <span className={s.item.source_kind === "existing_ready" ? "ed-badge-ready" : "ed-badge-create"}>
                          {s.item.source_kind === "existing_ready" ? "Pronto" : "Criar"}
                        </span>
                        {s.item.pillar_name && (
                          <span className="chip">
                            <span className="dot" style={{ background: s.item.pillar_color ?? "#596579" }} aria-hidden="true" />
                            {s.item.pillar_name}
                          </span>
                        )}
                        {s.item.guest_name && <span className="ed-badge-fmt">Convidado: {s.item.guest_name}</span>}
                        {s.item.topic_tag && <span className="chip">{s.item.topic_tag}</span>}
                        {s.plan_status === "approved" && <span className="ed-approved-pill">Aprovado</span>}
                      </div>
                      <Link
                        href={`/clientes/${clientId}/editorial/${s.content_item_id}`}
                        style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}
                      >
                        {s.item.title}
                      </Link>
                      <span className="muted small">
                        <NetDot network={s.network} /> {netLabel} · {s.format}
                      </span>
                      {s.item.cover_idea && (
                        <span className="small">
                          <strong>Ideia de capa:</strong> {s.item.cover_idea}
                        </span>
                      )}
                      {hasCaptions && (
                        <details>
                          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
                            Ver base de legenda
                          </summary>
                          <div className="col small" style={{ gap: 6, marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--line-strong)" }}>
                            {s.item.caption_instagram && (
                              <span style={{ whiteSpace: "pre-line" }}>
                                <strong>Instagram:</strong> {s.item.caption_instagram}
                              </span>
                            )}
                            {s.item.caption_linkedin && (
                              <span style={{ whiteSpace: "pre-line" }}>
                                <strong>LinkedIn:</strong> {s.item.caption_linkedin}
                              </span>
                            )}
                            {!s.item.caption_instagram && !s.item.caption_linkedin && s.item.caption_draft && (
                              <span style={{ whiteSpace: "pre-line" }}>
                                <strong>Legenda base:</strong> {s.item.caption_draft}
                              </span>
                            )}
                          </div>
                        </details>
                      )}
                      {hasScript && (
                        <details>
                          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
                            Ver roteiro de gravação
                          </summary>
                          <div className="col small" style={{ gap: 4, marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--line-strong)" }}>
                            {s.item.script_hook && <span><strong>Gancho (0–3s):</strong> {s.item.script_hook}</span>}
                            {s.item.script_dev && <span style={{ whiteSpace: "pre-line" }}><strong>Desenvolvimento:</strong> {s.item.script_dev}</span>}
                            {s.item.script_cta && <span><strong>CTA:</strong> {s.item.script_cta}</span>}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>

                  <div className="row" style={{ gap: 6 }}>
                    {!s.target ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => prev && swapChronological(s.id, prev.id)}
                          disabled={!prev || !!prev.target || busyId === s.id}
                          aria-label={`Mover ${s.item.title} para cima`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => next && swapChronological(s.id, next.id)}
                          disabled={!next || !!next.target || busyId === s.id}
                          aria-label={`Mover ${s.item.title} para baixo`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => recreateSlot(s)}
                          disabled={busyId === s.id}
                        >
                          {busyId === s.id ? "Recriando..." : "Recriar"}
                        </button>
                      </>
                    ) : (
                      <Link href={`/clientes/${clientId}/dia/${s.day}`} className="btn">
                        Ver na fila
                      </Link>
                    )}
                    <Link href={`/clientes/${clientId}/editorial/${s.content_item_id}`} className="btn">
                      Editar
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {chronological.length > 0 && (
            <div className="row between" style={{ paddingTop: 8 }}>
              <span className="muted small">
                Ao aprovar, os itens pendentes viram rascunhos na fila de agendamento e mídias do cliente.
              </span>
              <div className="row" style={{ gap: 8 }}>
                {approvedWithoutTarget.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={unapproveSchedule}
                    disabled={unapproving || approving}
                  >
                    {unapproving
                      ? "Desfazendo…"
                      : `Desfazer aprovação (${approvedWithoutTarget.length})`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setConfirmApprove(true)}
                  disabled={approving || pendingToApprove.length === 0}
                >
                  {approving
                    ? "Aprovando cronograma…"
                    : allApproved
                      ? "Sincronizar cronograma aprovado"
                      : "Aprovar cronograma"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div className="row between">
          <h2>4. Fila de produção &amp; banco de pautas ({filteredItems.length})</h2>
        </div>

        <form onSubmit={createQuickItem} className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nova pauta rápida (ex.: 3 erros ao escolher...)"
            maxLength={160}
            style={{ flex: 2, minWidth: 220 }}
          />
          <select value={newFormat} onChange={(e) => setNewFormat(e.target.value as ContentFormat)} style={{ minWidth: 130 }}>
            <option value="video">Vídeo</option>
            <option value="carousel">Carrossel</option>
            <option value="static_image">Estático</option>
          </select>
          <select value={newPillar} onChange={(e) => setNewPillar(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            <option value="">Sem pilar</option>
            {pillars.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary" disabled={addingItem || !newTitle.trim()}>
            {addingItem ? "Adicionando…" : "Adicionar pauta"}
          </button>
        </form>

        <div className="ed-list">
          {filteredItems.length === 0 && <span className="muted small">Nenhum item encontrado para este filtro.</span>}
          {filteredItems.map((it) => (
            <div key={it.id} className="ed-item-card">
              <div className="col" style={{ gap: 4, flex: 1, minWidth: 240 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="ed-badge-fmt">{FORMAT_LABEL[it.content_format] ?? "Vídeo"}</span>
                  <span className={it.source_kind === "existing_ready" ? "ed-badge-ready" : "ed-badge-create"}>
                    {it.source_kind === "existing_ready" ? "Pronto (acervo)" : "Criar / Gravar"}
                  </span>
                  {it.pillar && (
                    <span className="chip">
                      <span className="dot" style={{ background: it.pillar.color }} aria-hidden="true" />
                      {it.pillar.name}
                    </span>
                  )}
                  {it.guest_name && <span className="ed-badge-fmt">Convidado: {it.guest_name}</span>}
                  {it.topic_tag && <span className="chip">{it.topic_tag}</span>}
                  <span className="muted small">Situação: {CONTENT_STATUS_LABEL[it.status] ?? it.status}</span>
                </div>
                <strong style={{ fontSize: 16 }}>{it.title}</strong>
                {it.cover_idea && <span className="muted small">Capa: {it.cover_idea}</span>}
                {it.hook && <span className="muted small">Gancho: {it.hook}</span>}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted small">
                  {it.assets_count} ativo(s) · {it.slots_count} dia(s) · {it.in_queue_count} na fila
                </span>
                <Link href={`/clientes/${clientId}/editorial/${it.id}`} className="btn">
                  Abrir editor
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {confirmApprove && (
        <div
          className="ed-modal-back"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar aprovação do cronograma"
          onClick={closeApproveModal}
        >
          <div ref={approveModalRef} className="ed-modal" style={{ maxWidth: 520 }} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar aprovação do cronograma</h2>
            <p>
              Você vai aprovar e enviar <strong>{pendingToApprove.length}</strong>{" "}
              {pendingToApprove.length === 1 ? "item" : "itens"} do período{" "}
              <strong>{approvalPeriod}</strong>.
            </p>
            {activeFilterLabel && (
              <p className="alert warn" role="status">
                Você está aprovando só os {pendingToApprove.length} itens do filtro {activeFilterLabel}.
              </p>
            )}
            <p className="muted small">
              Isso cria rascunhos na fila do cliente mantendo o horário planejado de cada item (itens sem horário usam {DEFAULT_POST_TIME}). Nada é publicado automaticamente.
            </p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setConfirmApprove(false)} disabled={approving}>
                Cancelar
              </button>
              <button type="button" className="btn primary" onClick={approveSchedule} disabled={approving}>
                {approving ? "Aprovando…" : "Confirmar e criar rascunhos"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualRecreate && (
        <div
          className="ed-modal-back"
          role="dialog"
          aria-modal="true"
          aria-label="Recriar tópico manualmente"
          onClick={closeRecreateModal}
        >
          <div ref={recreateModalRef} className="ed-modal" style={{ maxWidth: 640 }} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2>Recriar tópico manualmente</h2>
              <button type="button" className="btn" onClick={closeRecreateModal} disabled={applyingRecreate}>
                Fechar
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              A chave do Gemini não está configurada. Copie o pedido abaixo, cole na sua IA e depois cole o JSON retornado para substituir <strong>{manualRecreate.slot.item.title}</strong>.
            </p>
            {recreateErr && <p className="alert err" role="alert">{recreateErr}</p>}
            <div className="col" style={{ gap: 8 }}>
              <div className="row between" style={{ alignItems: "center" }}>
                <span className="small" style={{ fontWeight: 600 }}>Pedido estruturado</span>
                <button type="button" className="btn" onClick={copyRecreatePrompt}>
                  {recreateCopied ? "Copiado!" : "Copiar pedido"}
                </button>
              </div>
              <textarea rows={5} readOnly value={manualRecreate.prompt} aria-label="Pedido estruturado para recriar tópico" />
              <label className="f">
                <span>Colar JSON retornado pela IA</span>
                <textarea
                  rows={5}
                  value={manualRecreateJson}
                  onChange={(e) => setManualRecreateJson(e.target.value)}
                  placeholder='{"title":"...","theme_key":"...","hook":"..."}'
                />
              </label>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={closeRecreateModal} disabled={applyingRecreate}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={applyManualRecreate}
                disabled={!manualRecreateJson.trim() || applyingRecreate}
              >
                {applyingRecreate ? "Aplicando…" : "Aplicar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {enqueueModalSlot && (
        <div
          className="ed-modal-back"
          role="dialog"
          aria-modal="true"
          aria-label="Definir horário para enviar à fila"
          onClick={closeEnqueueModal}
        >
          <div ref={enqueueModalRef} className="ed-modal" style={{ maxWidth: 440 }} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <h2>Definir horário para enviar à fila</h2>
            <p className="muted small" style={{ margin: 0 }}>
              O item <strong>{enqueueModalSlot.item.title}</strong> ({enqueueModalSlot.day}) ainda está sem horário. Informe um horário no formato HH:MM.
            </p>
            {enqueueTimeErr && <p className="alert err" role="alert">{enqueueTimeErr}</p>}
            <form
              className="col"
              style={{ gap: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                submitEnqueueSlot(enqueueModalSlot, enqueueTime);
              }}
            >
              <label className="f">
                <span>Horário (HH:MM)</span>
                <input
                  type="time"
                  value={enqueueTime}
                  onChange={(e) => {
                    setEnqueueTime(e.target.value);
                    setEnqueueTimeErr("");
                  }}
                  required
                />
              </label>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={closeEnqueueModal} disabled={busyId === enqueueModalSlot.id}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={busyId === enqueueModalSlot.id}>
                  {busyId === enqueueModalSlot.id ? "Enviando…" : "Enviar para a fila"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGen && (
        <CalendarGeneratorModal
          clientId={clientId}
          clientNetworks={clientNetworks}
          defaultFrom={today}
          defaultTo={addDays(today, 14)}
          onClose={() => setShowGen(false)}
          onGenerated={(newItems, newSlots) => {
            if (newItems.length) setItems((prev) => [...newItems.map(toItemCard), ...prev]);
            if (newSlots.length) setSlots((prev) => [...prev, ...newSlots]);
            setMsg(`${newSlots.length} horário(s) adicionados ao calendário.`);
          }}
        />
      )}
    </div>
  );
}
