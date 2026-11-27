"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import ToneSelector from "@/components/ToneSelector";
import { NETWORKS, STATUS_LABEL, isNetwork } from "@/config/networks";
import type { ContentFormat, ContentItem, ContentStatus, Pillar, SlotView } from "@/lib/editorial-types";

const FORMAT_LABEL: Record<ContentFormat, string> = {
  video: "Vídeo",
  carousel: "Carrossel",
  static_image: "Imagem única",
};

const STATUS_TEXT: Record<ContentStatus, string> = {
  idea: "Ideia",
  drafting: "Em produção",
  ready: "Pronto",
  archived: "Arquivado",
};

function fmtDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Tela de um conteúdo do editorial, enxuta. Vídeo pronto (da Reels Editados): resumo para conferir, gancho e as
 * duas legendas. Pauta nova (a gravar): tema, convidado, ideia de capa, roteiro (gancho, desenvolvimento,
 * chamada) e as legendas. O resto (tom, ângulo, brief, formato, situação, link) fica recolhido em "Mais detalhes".
 */
export default function EditorialItemForm({
  clientId,
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
  const ready = initialItem.source_kind === "existing_ready";
  const [title, setTitle] = useState(initialItem.title);
  const [pillarId, setPillarId] = useState(initialItem.pillar_id ?? "");
  const [contentFormat, setContentFormat] = useState<ContentFormat>(initialItem.content_format ?? "video");
  const [status, setStatus] = useState<ContentStatus>(initialItem.status);
  const [guestName, setGuestName] = useState(initialItem.guest_name ?? "");
  const [topicTag, setTopicTag] = useState(initialItem.topic_tag ?? "");
  const [coverIdea, setCoverIdea] = useState(initialItem.cover_idea ?? "");
  // Um gancho só: o "Gancho (0–3s)" do roteiro era o mesmo campo com outro nome.
  const [hook, setHook] = useState(initialItem.hook || initialItem.script_hook || "");
  const [angle, setAngle] = useState(initialItem.angle);
  const [brief, setBrief] = useState(initialItem.brief);
  const [scriptDev, setScriptDev] = useState(initialItem.script_dev ?? "");
  const [scriptCta, setScriptCta] = useState(initialItem.script_cta ?? "");
  // A antiga "Legenda base" (rascunho único) aparece no Instagram quando nenhuma das duas legendas foi escrita.
  const [captionInstagram, setCaptionInstagram] = useState(
    initialItem.caption_instagram || (!initialItem.caption_linkedin ? initialItem.caption_draft : "") || "",
  );
  const [captionLinkedin, setCaptionLinkedin] = useState(initialItem.caption_linkedin ?? "");
  const [tones, setTones] = useState<string[]>(initialItem.tones);
  const [driveUrl, setDriveUrl] = useState(initialItem.drive_url);
  const [editingData, setEditingData] = useState(false);

  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [refinePrompt, setRefinePrompt] = useState("");
  const [manualRefineJson, setManualRefineJson] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const pillarName = pillars.find((p) => p.id === pillarId)?.name ?? "";

  async function refineWithAi(mode: "ai" | "prompt_only" = "ai", useManual = false) {
    setRefining(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/items/${initialItem.id}/refine-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestion,
          current_brief: brief,
          current_caption: captionInstagram,
          current_script: initialItem.script,
          mode,
          manual_json: useManual ? manualRefineJson : undefined,
        }),
      });
      const j = (await res.json()) as {
        prompt?: string;
        draft?: {
          title?: string;
          hook: string;
          angle: string;
          brief: string;
          script_hook: string;
          script_dev: string;
          script_cta: string;
          caption_draft: string;
        } | null;
        error?: string;
      };
      if (j.prompt) setRefinePrompt(j.prompt);
      if (!res.ok) {
        setErr(j.error ?? "A IA não conseguiu refazer agora. Tente de novo.");
        return;
      }
      if (!j.draft) {
        setMsg("Copie o pedido abaixo, cole na IA de sua preferência e cole a resposta no campo de baixo.");
        return;
      }
      if (j.draft.title) setTitle(j.draft.title);
      if (j.draft.script_hook || j.draft.hook) setHook(j.draft.script_hook || j.draft.hook);
      if (j.draft.angle) setAngle(j.draft.angle);
      if (j.draft.brief) setBrief(j.draft.brief);
      if (j.draft.script_dev) setScriptDev(j.draft.script_dev);
      if (j.draft.script_cta) setScriptCta(j.draft.script_cta);
      if (j.draft.caption_draft && !captionInstagram.trim()) setCaptionInstagram(j.draft.caption_draft);
      setManualRefineJson("");
      setRefinePrompt("");
      setMsg("Roteiro refeito pela IA. Revise e clique em Salvar.");
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setRefining(false);
    }
  }

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
          content_format: contentFormat,
          status,
          // Chave anti-repetição sai do assunto (ou do título): a pessoa não precisa preencher.
          theme_key: topicTag.trim() || title,
          guest_name: guestName,
          topic_tag: topicTag,
          cover_idea: coverIdea,
          hook,
          script_hook: hook,
          angle,
          brief,
          script_dev: scriptDev,
          script_cta: scriptCta,
          caption_instagram: captionInstagram,
          caption_linkedin: captionLinkedin,
          tones,
          drive_url: driveUrl,
        }),
      });
      const j = (await res.json()) as { item?: ContentItem; error?: string };
      if (!res.ok || !j.item) {
        setErr(j.error ?? "Não foi possível salvar.");
        return;
      }
      setEditingData(false);
      setMsg("Salvo.");
      router.refresh();
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem() {
    if (!window.confirm("Excluir este conteúdo? Posts que já estão no calendário não serão apagados.")) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/items/${initialItem.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "Não foi possível excluir.");
        return;
      }
      router.push(`/clientes/${clientId}/editorial`);
    } catch {
      setErr("Falha ao falar com o servidor.");
    } finally {
      setBusy(false);
    }
  }

  const captions = (
    <div className="grid2" style={{ gap: 12 }}>
      <div className="col" style={{ gap: 6 }}>
        <label className="f" htmlFor="it-cap-ig">Legenda do Instagram</label>
        <textarea id="it-cap-ig" className="auto-grow" value={captionInstagram} onChange={(e) => setCaptionInstagram(e.target.value)} rows={6} />
        {captionInstagram.trim() && <div><CopyButton text={captionInstagram} label="Copiar" /></div>}
      </div>
      <div className="col" style={{ gap: 6 }}>
        <label className="f" htmlFor="it-cap-li">Legenda do LinkedIn</label>
        <textarea id="it-cap-li" className="auto-grow" value={captionLinkedin} onChange={(e) => setCaptionLinkedin(e.target.value)} rows={6} />
        {captionLinkedin.trim() && <div><CopyButton text={captionLinkedin} label="Copiar" /></div>}
      </div>
    </div>
  );

  const hookField = (
    <label className="f">
      <span>Gancho (a primeira frase, para prender nos 3 primeiros segundos)</span>
      <input type="text" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={240} />
    </label>
  );

  const identity = (
    <>
      <label className="f">
        <span>Título (só para você se achar)</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
      </label>
      <div className="grid2" style={{ gap: 12 }}>
        <label className="f">
          <span>Assunto</span>
          <input type="text" value={topicTag} onChange={(e) => setTopicTag(e.target.value)} maxLength={120} placeholder="Ex.: manutenção preventiva de tomógrafo" />
        </label>
        <label className="f">
          <span>Convidado</span>
          <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={120} placeholder="Deixe vazio se não houver" />
        </label>
        <label className="f">
          <span>Pilar</span>
          <select value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
            <option value="">Sem pilar</option>
            {pillars.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );

  return (
    <div className="col" style={{ gap: 20 }}>
      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      <form onSubmit={saveItem} className="card col" style={{ gap: 16 }}>
        {ready ? (
          <>
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="tag">Vídeo pronto</span>
                {topicTag && <span className="chip">{topicTag}</span>}
                {guestName && <span className="chip">Convidado: {guestName}</span>}
                {pillarName && <span className="chip">{pillarName}</span>}
                {status === "archived" && <span className="tag">Arquivado</span>}
              </div>
              {initialItem.source_folder_name && <span className="muted small">Pasta: {initialItem.source_folder_name}</span>}
              <div className="row" style={{ gap: 8 }}>
                {initialItem.drive_url && (
                  <a className="btn" href={initialItem.drive_url} target="_blank" rel="noreferrer">Ver vídeo no Drive</a>
                )}
                {initialItem.cover_drive_file_id && (
                  <a className="btn" href={`https://drive.google.com/file/d/${initialItem.cover_drive_file_id}/view`} target="_blank" rel="noreferrer">
                    Ver capa no Drive
                  </a>
                )}
                <button type="button" className="btn" onClick={() => setEditingData((v) => !v)} aria-expanded={editingData}>
                  {editingData ? "Fechar dados" : "Corrigir título, assunto ou convidado"}
                </button>
              </div>
            </div>
            {editingData && <div className="col" style={{ gap: 12 }}>{identity}</div>}
            {hookField}
            {captions}
            {initialItem.transcript.trim() && (
              <details>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Ver transcrição do vídeo</summary>
                <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{initialItem.transcript}</p>
              </details>
            )}
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 8 }}>
              <span className="tag" style={{ background: "var(--accent)", color: "#fff" }}>Pauta para gravar</span>
            </div>
            {identity}
            <label className="f">
              <span>Ideia de capa</span>
              <input type="text" value={coverIdea} onChange={(e) => setCoverIdea(e.target.value)} maxLength={300} placeholder="Ex.: pergunta grande sobre a foto do convidado" />
            </label>
            <fieldset className="col" style={{ gap: 10, border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: 0 }}>
              <legend className="f" style={{ padding: "0 4px" }}>Roteiro</legend>
              {hookField}
              <label className="f">
                <span>O que falar (tópicos)</span>
                <textarea className="auto-grow" value={scriptDev} onChange={(e) => setScriptDev(e.target.value)} rows={3} placeholder={"- Tópico 1\n- Tópico 2"} />
              </label>
              <label className="f">
                <span>Chamada no final</span>
                <input type="text" value={scriptCta} onChange={(e) => setScriptCta(e.target.value)} placeholder="Ex.: chame no WhatsApp do plantão 24h" />
              </label>
              <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                <label className="f" style={{ flex: "1 1 260px" }}>
                  <span>Pedir para a IA refazer o roteiro (opcional: diga o que mudar)</span>
                  <input type="text" value={suggestion} onChange={(e) => setSuggestion(e.target.value)} maxLength={500} placeholder="Ex.: abrir com uma pergunta, dar um exemplo de hospital" />
                </label>
                <button type="button" className="btn" onClick={() => refineWithAi("ai")} disabled={refining || busy}>
                  {refining ? "A IA está escrevendo…" : "Refazer com IA"}
                </button>
              </div>
              {refinePrompt && (
                <div className="col" style={{ gap: 8 }}>
                  <label className="f">
                    <span>Pedido para a IA (copie e cole)</span>
                    <textarea rows={4} readOnly value={refinePrompt} />
                  </label>
                  <label className="f">
                    <span>Resposta da IA (JSON)</span>
                    <textarea rows={3} value={manualRefineJson} onChange={(e) => setManualRefineJson(e.target.value)} />
                  </label>
                  <div>
                    <button type="button" className="btn" onClick={() => refineWithAi("prompt_only", true)} disabled={!manualRefineJson.trim() || refining}>
                      Aplicar resposta
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
            {captions}
          </>
        )}

        <details>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Mais detalhes (opcional)</summary>
          <div className="col" style={{ gap: 12, marginTop: 12 }}>
            <ToneSelector initial={tones} onChange={setTones} />
            <label className="f">
              <span>Ângulo editorial</span>
              <input type="text" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={300} />
            </label>
            <label className="f">
              <span>Resumo / brief (vira a descrição da legenda no post)</span>
              <textarea className="auto-grow" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} />
            </label>
            <div className="grid2" style={{ gap: 12 }}>
              <label className="f">
                <span>Formato</span>
                <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value as ContentFormat)}>
                  {(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((k) => (
                    <option key={k} value={k}>{FORMAT_LABEL[k]}</option>
                  ))}
                </select>
              </label>
              <label className="f">
                <span>Situação</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)}>
                  {(Object.keys(STATUS_TEXT) as ContentStatus[]).map((k) => (
                    <option key={k} value={k}>{STATUS_TEXT[k]}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="f">
              <span>Link do arquivo no Google Drive</span>
              <input type="text" value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)} placeholder="https://drive.google.com/file/d/..." />
            </label>
            <div>
              <button type="button" className="btn danger" onClick={removeItem} disabled={busy}>Excluir conteúdo</button>
            </div>
          </div>
        </details>

        <div className="savebar">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>

      {initialSlots.length > 0 && (
        <section className="card col" style={{ gap: 10 }} aria-labelledby="it-when">
          <h2 id="it-when">No calendário</h2>
          <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 6 }}>
            {initialSlots.map((s) => {
              const netLabel = isNetwork(s.network) ? NETWORKS[s.network].label : s.network;
              const fmtLabel = isNetwork(s.network) ? (NETWORKS[s.network].formats[s.format]?.label ?? s.format) : s.format;
              const state = s.target
                ? (STATUS_LABEL[s.target.status as keyof typeof STATUS_LABEL] ?? s.target.status)
                : s.plan_status === "approved"
                  ? "Aprovado"
                  : "Planejado (falta aprovar)";
              return (
                <li key={s.id} className="row between" style={{ gap: 8 }}>
                  <span>
                    <strong>{fmtDay(s.day)}</strong> {s.time ?? ""} · {netLabel} {fmtLabel}
                  </span>
                  <span className="row small" style={{ gap: 8 }}>
                    <span className="muted">{state}</span>
                    <Link href={`/clientes/${clientId}/dia/${s.day}?nav=1`}>Abrir o dia</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
