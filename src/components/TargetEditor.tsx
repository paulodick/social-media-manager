"use client";

import { useState } from "react";
import { NETWORKS, STATUS_LABEL, captionLabel, hasTitle, type NetworkId } from "@/config/networks";
import { captionChecks, countHashtags, fmtNumber, mediaChecks, thumbChecks, titleChecks, type Check, type MediaMeta } from "@/lib/checks";
import { deleteTarget, ensureTargetFolder, saveTarget } from "@/lib/actions";
import type { PromptClient } from "@/lib/prompt";
import CaptionTools from "./CaptionTools";
import CopyButton from "./CopyButton";
import PostPreview from "./Previews";
import PublishPanel, { type PublishInfo } from "./PublishPanel";

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
  /** Miniatura (capa) do vídeo, nos formatos que têm. */
  thumbUrl: string;
  thumbFileId: string | null;
  thumbMeta: MediaMeta | null;
  /** Nome interno do post (só para achar o post; não vai para a rede). */
  name: string;
  /** Título deste destino na rede (YouTube, documento do LinkedIn). Vazio nos formatos sem título. */
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
  /** Publicação pelo app (só Instagram e Facebook, por enquanto). Ausente = a rede é manual. */
  publish?: PublishInfo;
  /** Dados do cliente e planejamento do dia, para montar o pedido de legenda para a IA. */
  ai: { client: PromptClient; plan: string; brief: string; clientId: string; enabled: boolean };
};

export default function TargetEditor(p: EditorProps) {
  const [caption, setCaption] = useState(p.caption);
  const [title, setTitle] = useState(p.title);
  const withTitle = hasTitle(p.network, p.format);
  const cfg = NETWORKS[p.network];
  const fmt = cfg.formats[p.format];
  const checks: Check[] = [
    ...mediaChecks(p.network, p.format, p.meta),
    ...thumbChecks(p.network, p.format, p.thumbMeta),
    ...(withTitle ? titleChecks(p.network, title) : []),
    ...captionChecks(p.network, caption),
  ];
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
      <p className="muted small">{p.name}</p>
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
            {fmt?.thumb && (
              <div className="col">
                <label className="f" htmlFor={`th-${p.id}`}>Link da miniatura no Google Drive</label>
                <input id={`th-${p.id}`} name="thumb_url" type="text" defaultValue={p.thumbUrl} placeholder="https://drive.google.com/file/d/…/view" />
                <span className="muted small">
                  {fmt.thumb.guide}
                  {p.thumbMeta?.name ? <> · Arquivo: {p.thumbMeta.name}</> : null}
                  {p.thumbMeta?.width && p.thumbMeta?.height ? <> · {fmtNumber(p.thumbMeta.width)}×{fmtNumber(p.thumbMeta.height)} px</> : null}
                </span>
              </div>
            )}
            {withTitle && (
              <div className="col">
                <label className="f" htmlFor={`ti-${p.id}`}>Título</label>
                <input
                  id={`ti-${p.id}`}
                  name="title"
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Título que aparece na rede"
                  style={{ fontWeight: 600 }}
                />
              </div>
            )}
            <div className="col">
              <label className="f" htmlFor={`c-${p.id}`}>{captionLabel(p.network, p.format)}</label>
              <textarea id={`c-${p.id}`} name="caption" rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
              <div className="row between small muted">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtNumber(caption.length)}{cfg.captionLimit ? ` de ${fmtNumber(cfg.captionLimit)}` : ""} caracteres
                </span>
                {cfg.hashtagLimit != null && <span>{tags} de {cfg.hashtagLimit} hashtags</span>}
              </div>
              <CaptionTools
                client={p.ai.client}
                clientId={p.ai.clientId}
                network={p.network}
                format={p.format}
                aiEnabled={p.ai.enabled}
                getPlan={() => p.ai.plan}
                getBrief={() => p.ai.brief}
                getCaption={() => caption}
                onResult={(r) => {
                  setCaption(r.caption);
                  if (r.title) setTitle(r.title);
                }}
              />
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
              <button className="btn primary" type="submit" name="status" value="scheduled" title="Só registra o status. A publicação automática por horário ainda não existe.">Marcar como agendado</button>
              {!posted && <button className="btn dark" type="submit" name="status" value="posted">Marcar como postado</button>}
              {posted && <button className="btn" type="submit" name="status" value="scheduled">Voltar para agendado</button>}
            </div>
          </form>
          {p.publish && (
            <PublishPanel
              id={p.id}
              networkLabel={cfg.label}
              volta={p.volta}
              info={p.publish}
              dirty={caption !== p.caption || title !== p.title}
              posted={posted}
            />
          )}
          <div className="row">
            <CopyButton text={caption} />
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
          <PostPreview
            network={p.network}
            format={p.format}
            day={p.day}
            time={p.time}
            fileId={p.fileId}
            meta={p.meta}
            thumbFileId={p.thumbFileId}
            thumbMeta={p.thumbMeta}
            title={title}
            profile={p.profile}
            caption={caption}
          />
          <p className="muted small" style={{ maxWidth: 300 }}>Pontos de corte e limites ficam em uma configuração editável e podem mudar quando a rede mudar.</p>
        </div>
      </div>
    </section>
  );
}
