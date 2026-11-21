"use client";

import { useState } from "react";
import { NETWORKS, STATUS_LABEL, type NetworkId } from "@/config/networks";
import { captionChecks, countHashtags, cutCaption, fmtNumber, mediaChecks, type Check, type MediaMeta } from "@/lib/checks";
import { deleteTarget, ensureTargetFolder, saveTarget } from "@/lib/actions";
import { buildCaptionPrompt, type PromptClient } from "@/lib/prompt";
import CopyButton from "./CopyButton";
import GenerateButton from "./GenerateButton";

export type EditorProps = {
  id: string;
  network: NetworkId;
  format: string;
  day: string;
  time: string;
  caption: string;
  status: "draft" | "scheduled" | "posted";
  late: boolean;
  driveUrl: string;
  fileId: string | null;
  meta: MediaMeta | null;
  title: string;
  profile: { name: string; handle: string };
  expectedPath: string;
  pathNote: string | null;
  /** Pasta deste destino no Drive, se já existe. */
  folderId: string | null;
  /** O cliente tem pasta no Drive, então dá para criar a deste destino. */
  canCreateFolder: boolean;
  volta: string;
  saved: boolean;
  /** Dados do cliente e planejamento do dia, para montar o pedido de legenda para a IA. */
  ai: { client: PromptClient; plan: string; clientId: string; enabled: boolean };
};

function Media({ fileId, meta, fit }: { fileId: string | null; meta: MediaMeta | null; fit?: "cover" }) {
  if (!fileId || !meta || meta.error) return <span>Aqui aparece a mídia do Drive</span>;
  const src = `/api/media/${fileId}`;
  if (meta.mimeType?.startsWith("video/")) {
    return <video src={src} controls muted playsInline preload="metadata" style={fit ? { objectFit: fit } : undefined} />;
  }
  if (meta.mimeType?.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" />;
  }
  return <span>{meta.name ?? "Arquivo"} (sem prévia para este tipo)</span>;
}

function Reels({ p, caption }: { p: EditorProps; caption: string }) {
  return (
    <div className="phone" role="img" aria-label="Prévia do Instagram Reels">
      <div className="media-box"><Media fileId={p.fileId} meta={p.meta} /></div>
      <div style={{ position: "absolute", top: 14, left: 16, right: 16, display: "flex", justifyContent: "space-between", color: "#fff", fontWeight: 600, fontSize: 16, pointerEvents: "none" }}>
        <span>{p.format === "stories" ? "Stories" : "Reels"}</span><span aria-hidden="true">◎</span>
      </div>
      <div style={{ position: "absolute", right: 10, bottom: 120, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, color: "#fff", fontSize: 11, fontWeight: 600, pointerEvents: "none" }}>
        <span style={{ textAlign: "center" }}><span style={{ display: "block", fontSize: 22 }} aria-hidden="true">♡</span>Curtir</span>
        <span style={{ textAlign: "center" }}><span style={{ display: "block", fontSize: 22 }} aria-hidden="true">💬</span>Comentar</span>
        <span style={{ textAlign: "center" }}><span style={{ display: "block", fontSize: 22 }} aria-hidden="true">➤</span>Enviar</span>
      </div>
      <div style={{ position: "absolute", left: 14, right: 62, bottom: 16, display: "flex", flexDirection: "column", gap: 8, color: "#fff", fontSize: 13, lineHeight: 1.35, pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#fff", color: "#101828", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, textShadow: "none" }}>
            {p.profile.name.slice(0, 2).toUpperCase()}
          </span>
          <b>{p.profile.handle}</b>
          <span style={{ border: "1px solid #fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>Seguir</span>
        </div>
        <span>{cutCaption(caption, NETWORKS.instagram.cutAt)} {caption.length > NETWORKS.instagram.cutAt && <b style={{ opacity: 0.85 }}>mais</b>}</span>
      </div>
    </div>
  );
}

function Feed({ p, caption, kind }: { p: EditorProps; caption: string; kind: "linkedin" | "instagram" | "facebook" }) {
  const cut = NETWORKS[kind].cutAt + (kind === "instagram" ? 15 : 40);
  const more = kind === "linkedin" ? "…ver mais" : "… mais";
  return (
    <div className="phone light" role="img" aria-label={`Prévia do ${NETWORKS[kind].label}`}>
      <div style={{ background: "#fff", padding: "12px 14px", borderBottom: "1px solid var(--line)", fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ color: NETWORKS[kind].color, fontSize: 15 }}>{NETWORKS[kind].label}</b>
      </div>
      <div style={{ marginTop: 8, background: "#fff", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
        <div className="row" style={{ gap: 10, padding: "12px 14px 8px", flexWrap: "nowrap" }}>
          <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>
            {p.profile.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="col" style={{ gap: 0, lineHeight: 1.25 }}>
            <b style={{ fontSize: 13 }}>{kind === "instagram" ? p.profile.handle : p.profile.name}</b>
            <span className="muted" style={{ fontSize: 11 }}>{p.day.split("-").reverse().join("/")} às {p.time}</span>
          </div>
        </div>
        {kind === "linkedin" && (
          <p style={{ padding: "0 14px 8px", fontSize: 12.5, lineHeight: 1.4 }}>
            {cutCaption(caption, cut)} {caption.length > cut && <span className="muted">{more}</span>}
          </p>
        )}
        <div className="li-media"><Media fileId={p.fileId} meta={p.meta} /></div>
        {kind !== "linkedin" && (
          <p style={{ padding: "8px 14px", fontSize: 12.5, lineHeight: 1.4 }}>
            <b>{p.profile.handle}</b> {cutCaption(caption, cut)} {caption.length > cut && <span className="muted">{more}</span>}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", fontSize: 11.5, fontWeight: 600, color: "#3b4757", borderTop: "1px solid var(--line)" }}>
          <span>Gostei</span><span>Comentar</span><span>Compartilhar</span><span>Enviar</span>
        </div>
      </div>
    </div>
  );
}

function Preview({ p, caption }: { p: EditorProps; caption: string }) {
  if (p.network === "instagram" && (p.format === "reels" || p.format === "stories")) return <Reels p={p} caption={caption} />;
  if (p.network === "instagram") return <Feed p={p} caption={caption} kind="instagram" />;
  if (p.network === "linkedin") return <Feed p={p} caption={caption} kind="linkedin" />;
  if (p.network === "facebook" && p.format === "feed") return <Feed p={p} caption={caption} kind="facebook" />;
  return (
    <div className="generic-prev">
      <b>Prévia ainda não disponível para {NETWORKS[p.network].label} {NETWORKS[p.network].formats[p.format]?.label}.</b>
      <p className="muted small" style={{ marginTop: 6 }}>Texto como será publicado:</p>
      <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{caption || "(legenda vazia)"}</p>
    </div>
  );
}

export default function TargetEditor(p: EditorProps) {
  const [caption, setCaption] = useState(p.caption);
  const cfg = NETWORKS[p.network];
  const fmt = cfg.formats[p.format];
  const checks: Check[] = [...mediaChecks(p.network, p.format, p.meta), ...captionChecks(p.network, caption)];
  if (p.pathNote) checks.push({ level: "warn", text: p.pathNote });
  const tags = countHashtags(caption);
  const downloadable = p.fileId && p.meta && !p.meta.error;
  const posted = p.status === "posted";

  return (
    <section id={`t-${p.id}`} className="card" aria-labelledby={`h-${p.id}`} style={{ scrollMarginTop: 16 }}>
      <div className="row between">
        <h2 id={`h-${p.id}`} className="row" style={{ gap: 10 }}>
          <span className="dot" style={{ background: cfg.color, width: 12, height: 12 }} aria-hidden="true" />
          {cfg.label} · {fmt?.label}
        </h2>
        <span className={`pill ${p.late ? "late" : p.status}`}>{p.late ? "Atrasado" : STATUS_LABEL[p.status]} · {p.time}</span>
      </div>
      <p className="muted small">{p.title}</p>
      {p.saved && <p className="alert ok" role="status">Salvo.</p>}

      <div className="row" style={{ alignItems: "flex-start", gap: 28 }}>
        <div style={{ flex: "1 1 420px", maxWidth: 560, minWidth: 0 }} className="col">
          <form action={saveTarget} className="col" style={{ gap: 14 }}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="volta" value={p.volta} />
            <div className="grid2">
              <div className="col">
                <label className="f" htmlFor={`d-${p.id}`}>Data</label>
                <input id={`d-${p.id}`} name="date" type="date" defaultValue={p.day} required />
              </div>
              <div className="col">
                <label className="f" htmlFor={`h2-${p.id}`}>Horário</label>
                <input id={`h2-${p.id}`} name="time" type="time" defaultValue={p.time} required />
              </div>
            </div>
            <div className="col">
              <label className="f" htmlFor={`u-${p.id}`}>Link do arquivo no Google Drive</label>
              <input id={`u-${p.id}`} name="drive_url" type="text" defaultValue={p.driveUrl} placeholder="https://drive.google.com/file/d/…/view" />
              <span className="muted small">
                Pasta esperada: <b style={{ color: "var(--ink)" }}>{p.expectedPath}</b>
                {p.meta?.name ? <> · Arquivo: {p.meta.name}</> : null}
                {p.meta?.durationMs ? <> · {Math.round(p.meta.durationMs / 1000)} s</> : null}
              </span>
            </div>
            <div className="col">
              <label className="f" htmlFor={`c-${p.id}`}>Legenda</label>
              <textarea id={`c-${p.id}`} name="caption" rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
              <div className="row between small muted">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtNumber(caption.length)}{cfg.captionLimit ? ` de ${fmtNumber(cfg.captionLimit)}` : ""} caracteres
                </span>
                {cfg.hashtagLimit != null && <span>{tags} de {cfg.hashtagLimit} hashtags</span>}
              </div>
            </div>

            <div className="col">
              <b className="small">Checagens</b>
              {checks.map((c, i) => (
                <div className="check" key={i}>
                  <span className={`tag ${c.level}`}>{c.level === "ok" ? "OK" : "Atenção"}</span>
                  <span style={{ paddingTop: 1 }}>{c.text}</span>
                </div>
              ))}
            </div>

            <div className="row">
              <button className="btn" type="submit" name="status" value="draft">Salvar rascunho</button>
              <button className="btn primary" type="submit" name="status" value="scheduled">Agendar</button>
              {!posted && <button className="btn dark" type="submit" name="status" value="posted">Marcar como postado</button>}
              {posted && <button className="btn" type="submit" name="status" value="scheduled">Voltar para agendado</button>}
            </div>
          </form>
          <div className="row">
            <CopyButton text={caption} />
            <CopyButton
              text={buildCaptionPrompt({ client: p.ai.client, network: p.network, format: p.format, plan: p.ai.plan, captionDraft: caption })}
              label="Copiar pedido para a IA"
            />
            {p.ai.enabled && (
              <GenerateButton
                clientId={p.ai.clientId}
                network={p.network}
                format={p.format}
                getPlan={() => p.ai.plan}
                getDraft={() => caption}
                onText={setCaption}
              />
            )}
            {downloadable && <a className="btn" href={`/api/media/${p.fileId}?download=1`}>Baixar mídia</a>}
            {p.folderId ? (
              <a className="btn" href={`https://drive.google.com/drive/folders/${p.folderId}`} target="_blank" rel="noopener noreferrer">Abrir pasta no Drive</a>
            ) : p.canCreateFolder ? (
              <form action={ensureTargetFolder}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="volta" value={p.volta.split("#")[0].split("?")[0]} />
                <button className="btn" type="submit">Criar pasta no Drive</button>
              </form>
            ) : null}
          </div>
          <form action={deleteTarget}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="volta" value={p.volta.split("#")[0].split("?")[0]} />
            <button className="btn danger" type="submit">Excluir este destino</button>
          </form>
        </div>

        <div style={{ flex: "1 1 300px" }} className="col">
          <b className="small">Prévia (aproximada)</b>
          <Preview p={p} caption={caption} />
          <p className="muted small" style={{ maxWidth: 300 }}>Pontos de corte e limites ficam em uma configuração editável e podem mudar quando a rede mudar.</p>
        </div>
      </div>
    </section>
  );
}
