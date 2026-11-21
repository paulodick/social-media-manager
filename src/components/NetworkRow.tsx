"use client";

import { useEffect, useRef, useState } from "react";
import { NETWORKS, STATUS_LABEL, targetFolders, type NetworkId } from "@/config/networks";
import { captionChecks, countHashtags, fmtNumber, mediaChecks, thumbChecks, titleChecks, type Check, type MediaMeta } from "@/lib/checks";
import { dayFolders, isDay } from "@/lib/dates";
import { deleteTarget, ensureTargetFolder, inspectDrive } from "@/lib/actions";
import type { PickerOption } from "@/lib/picker-options";
import type { PromptClient } from "@/lib/prompt";
import CaptionTools from "./CaptionTools";
import CopyButton from "./CopyButton";
import PostPreview from "./Previews";
import PublishPanel, { type PublishInfo } from "./PublishPanel";
import { NetDot } from "./ui";

/** Destino que o post já tem (vem do banco). */
export type ExistingTarget = {
  id: string;
  day: string;
  time: string;
  caption: string;
  title: string;
  status: "draft" | "scheduled" | "posted";
  late: boolean;
  driveUrl: string;
  fileId: string | null;
  meta: MediaMeta | null;
  thumbUrl: string;
  thumbFileId: string | null;
  thumbMeta: MediaMeta | null;
  pathNote: string | null;
  folderId: string | null;
  publish?: PublishInfo;
};

/** Link de vídeo que já vem preenchido num destino novo (formato igual ao de outro destino do post). */
export type Inherited = { url: string; fileId: string | null; meta: MediaMeta | null; from: string };

type Saved = { url: string; fileId: string | null; meta: MediaMeta | null };

/**
 * Confere o link do Drive enquanto a pessoa digita (com uma pausa) e devolve os dados da mídia para a prévia e as checagens.
 * Link igual ao já salvo: usa o que está salvo, sem consultar de novo.
 */
function useDriveInfo(url: string, saved: Saved) {
  const [info, setInfo] = useState<{ fileId: string | null; meta: MediaMeta | null; busy: boolean }>({ fileId: saved.fileId, meta: saved.meta, busy: false });
  useEffect(() => {
    const u = url.trim();
    if (u === saved.url) {
      setInfo({ fileId: saved.fileId, meta: saved.meta, busy: false });
      return;
    }
    if (!u) {
      setInfo({ fileId: null, meta: null, busy: false });
      return;
    }
    let live = true;
    setInfo((s) => ({ ...s, busy: true }));
    const t = setTimeout(async () => {
      try {
        const r = await inspectDrive(u);
        if (live) setInfo({ fileId: r.fileId, meta: r.meta, busy: false });
      } catch {
        if (live) setInfo({ fileId: null, meta: { error: "não foi possível conferir o link agora." }, busy: false });
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, saved.url, saved.fileId, saved.meta]);
  return info;
}

/**
 * Uma rede/formato do post (item 3 da tela do post). Destino novo: linha com caixa de marcar; ao marcar abre os campos.
 * Destino que já existe: já vem aberto, com a situação, a prévia, as checagens e os botões (publicar, pasta, excluir).
 * A prévia aparece ao lado (embaixo no celular) e se atualiza com o que a pessoa digita e cola.
 */
export default function NetworkRow({
  o,
  existing,
  checked = false,
  onToggle,
  defaults,
  inherited,
  client,
  clientId,
  clientName,
  aiEnabled,
  getPlan,
  getBrief,
  getTones,
  profile,
  canCreateFolder,
  idPrefix,
}: {
  o: PickerOption;
  existing?: ExistingTarget;
  checked?: boolean;
  onToggle?: () => void;
  /** Data e horário que um destino novo usa até a pessoa mudar. */
  defaults: { date: string; time: string };
  inherited?: Inherited;
  client: PromptClient;
  clientId: string;
  clientName: string;
  aiEnabled: boolean;
  getPlan: () => string;
  getBrief: () => string;
  getTones: () => string[];
  profile: { name: string; handle: string };
  canCreateFolder: boolean;
  idPrefix: string;
}) {
  const isNew = !existing;
  const k = existing ? existing.id : o.key; // chave dos campos do formulário
  const open = isNew ? checked : true;
  const network = o.network as NetworkId;
  const [, format] = o.key.split(":");
  const cfg = NETWORKS[network];
  const fmt = cfg.formats[format];

  const [date, setDate] = useState(existing?.day ?? defaults.date);
  const [time, setTime] = useState(existing?.time ?? defaults.time);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (isNew && !touched) {
      setDate(defaults.date);
      setTime(defaults.time);
    }
  }, [isNew, touched, defaults.date, defaults.time]);

  const [caption, setCaption] = useState(existing?.caption ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [driveUrl, setDriveUrl] = useState(existing?.driveUrl ?? inherited?.url ?? "");
  const [thumbUrl, setThumbUrl] = useState(existing?.thumbUrl ?? "");

  const savedVideo: Saved = existing
    ? { url: existing.driveUrl, fileId: existing.fileId, meta: existing.meta }
    : inherited
      ? { url: inherited.url, fileId: inherited.fileId, meta: inherited.meta }
      : { url: "", fileId: null, meta: null };
  const video = useDriveInfo(driveUrl, savedVideo);
  const thumb = useDriveInfo(thumbUrl, { url: existing?.thumbUrl ?? "", fileId: existing?.thumbFileId ?? null, meta: existing?.thumbMeta ?? null });
  // O vídeo só toca na prévia quando o arquivo já está ligado a um post (salvo): o app só serve arquivos assim.
  const playable = driveUrl.trim() === savedVideo.url && !!savedVideo.url ? video.fileId : null;
  const thumbPlayable = existing && thumbUrl.trim() === existing.thumbUrl && existing.thumbUrl ? thumb.fileId : null;

  const capRef = useRef<HTMLTextAreaElement>(null);
  // A caixa da legenda cresce com o texto (até 60% da altura da tela; depois rola por dentro).
  useEffect(() => {
    const el = capRef.current;
    if (!el || !open) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.6))}px`;
  }, [caption, open]);
  const withTitle = !!fmt?.title;
  const checks: Check[] = [
    ...mediaChecks(network, format, video.meta),
    ...thumbChecks(network, format, thumb.meta),
    ...(withTitle ? titleChecks(network, title) : []),
    ...captionChecks(network, caption),
  ];
  if (existing?.pathNote) checks.push({ level: "warn", text: existing.pathNote });
  const tags = countHashtags(caption);
  const expected = [clientName, ...(isDay(date) ? dayFolders(date) : []), ...(targetFolders(network, format) ?? [])].join(" / ");
  const downloadable = video.fileId && video.meta && !video.meta.error && driveUrl.trim() === savedVideo.url;
  const posted = existing?.status === "posted";
  const id = `${idPrefix}${k.replace(":", "-")}`;
  const off = !open;

  const fields = (
    <div className="target-split">
      <div className="col" style={{ gap: 14, minWidth: 0 }}>
        <div className="grid2">
          <div className="col">
            <label className="f" htmlFor={`${id}-d`}>Data</label>
            <input id={`${id}-d`} name={`date__${k}`} type="date" value={date} required disabled={off}
              onChange={(e) => { setDate(e.target.value); setTouched(true); }} />
          </div>
          <div className="col">
            <label className="f" htmlFor={`${id}-h`}>Horário</label>
            <input id={`${id}-h`} name={`time__${k}`} type="time" value={time} required disabled={off}
              onChange={(e) => { setTime(e.target.value); setTouched(true); }} />
          </div>
        </div>

        <div className="col">
          <label className="f" htmlFor={`${id}-u`}>Link do vídeo/arquivo no Google Drive{isNew ? " (opcional)" : ""}</label>
          <input id={`${id}-u`} name={`drive__${k}`} type="text" value={driveUrl} disabled={off}
            onChange={(e) => setDriveUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />
          <span className="muted small">
            {inherited && isNew && driveUrl.trim() === inherited.url ? <>Mesmo vídeo do {inherited.from} (formato igual, mesma pasta no Drive). Troque o link se for outro vídeo. </> : null}
            {video.busy ? "Conferindo o link… " : null}
            Pasta esperada: <b style={{ color: "var(--ink)" }}>{expected}</b>
            {video.meta?.name ? <> · Arquivo: {video.meta.name}</> : null}
            {video.meta?.durationMs ? <> · {Math.round(video.meta.durationMs / 1000)} s</> : null}
          </span>
        </div>

        {fmt?.thumb && (
          <div className="col">
            <label className="f" htmlFor={`${id}-t`}>Link da miniatura no Google Drive{isNew ? " (opcional)" : ""}</label>
            <input id={`${id}-t`} name={`thumb__${k}`} type="text" value={thumbUrl} disabled={off}
              onChange={(e) => setThumbUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />
            <span className="muted small">
              {fmt.thumb.guide}
              {thumb.meta?.name ? <> · Arquivo: {thumb.meta.name}</> : null}
              {thumb.meta?.width && thumb.meta?.height ? <> · {fmtNumber(thumb.meta.width)}×{fmtNumber(thumb.meta.height)} px</> : null}
            </span>
          </div>
        )}

        {withTitle && (
          <div className="col">
            <label className="f" htmlFor={`${id}-ti`}>Título — {o.networkLabel} {o.formatLabel}</label>
            <input id={`${id}-ti`} name={`title__${k}`} type="text" maxLength={200} value={title} disabled={off}
              onChange={(e) => setTitle(e.target.value)} placeholder="Título que aparece na rede" style={{ fontWeight: 600 }} />
            <span className="muted small">Esta rede tem título separado da legenda{o.titleLimit ? ` (até ${o.titleLimit} caracteres)` : ""}.</span>
          </div>
        )}

        <div className="col">
          <label className="f" htmlFor={`${id}-c`}>{o.captionLabel} — {o.networkLabel} {o.formatLabel}</label>
          <textarea id={`${id}-c`} ref={capRef} name={`caption__${k}`} rows={isNew ? 4 : 7} className="auto-grow" value={caption} disabled={off}
            onChange={(e) => setCaption(e.target.value)} />
          <div className="row between small muted">
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtNumber(caption.length)}{cfg.captionLimit ? ` de ${fmtNumber(cfg.captionLimit)}` : ""} caracteres
            </span>
            {cfg.hashtagLimit != null && <span>{tags} de {cfg.hashtagLimit} hashtags</span>}
          </div>
          <CaptionTools
            client={client}
            clientId={clientId}
            network={network}
            format={format}
            aiEnabled={aiEnabled}
            getPlan={getPlan}
            getBrief={getBrief}
            getCaption={() => caption}
            getTones={getTones}
            onResult={(r) => {
              setCaption(r.caption);
              if (r.title) setTitle(r.title);
            }}
          />
        </div>

        {(existing || driveUrl.trim() !== "" || caption !== "") && (
          <div className="col">
            <b className="small">Checagens</b>
            {checks.map((c, i) => (
              <div className="check" key={i}>
                <span className={`tag ${c.level}`}>{c.level === "ok" ? "OK" : "Atenção"}</span>
                <span style={{ paddingTop: 1 }}>{c.text}</span>
              </div>
            ))}
          </div>
        )}

        {existing && (() => {
          // Um botão principal por situação. Com a conta conectada, "Publicar agora" é a ação principal
          // e as marcações de situação ficam no menu "Mais ações".
          const publishMain = !!existing.publish?.connected && !posted && existing.publish.state !== "published";
          const primary = publishMain ? null : existing.status === "draft" ? "scheduled" : existing.status === "scheduled" ? "posted" : null;
          const LABEL: Record<string, string> = {
            draft: "Voltar para rascunho",
            scheduled: posted ? "Voltar para agendado" : "Marcar como agendado",
            posted: "Marcar como postado",
          };
          const inMenu = (["scheduled", "posted", "draft"] as const).filter((st) => st !== existing.status && st !== primary);
          return (
            <>
              {existing.publish && (
                <PublishPanel
                  id={existing.id}
                  networkLabel={cfg.label}
                  info={existing.publish}
                  dirty={caption !== existing.caption || title !== existing.title}
                  posted={posted}
                />
              )}
              <div className="row actions">
                {primary && (
                  <button className="btn primary" type="submit" name="status" value={`${existing.id}:${primary}`}
                    title={primary === "scheduled" ? "Só registra a situação. A publicação automática por horário ainda não existe." : undefined}>
                    {LABEL[primary]}
                  </button>
                )}
                <CopyButton text={caption} />
                {downloadable && <a className="btn" href={`/api/media/${video.fileId}?download=1`}>Baixar mídia</a>}
                <details className="more">
                  <summary className="btn">Mais ações</summary>
                  <div className="menu">
                    {inMenu.map((st) => (
                      <button key={st} type="submit" name="status" value={`${existing.id}:${st}`}>{LABEL[st]}</button>
                    ))}
                    {existing.folderId ? (
                      <a href={`https://drive.google.com/drive/folders/${existing.folderId}`} target="_blank" rel="noopener noreferrer">Abrir pasta no Drive</a>
                    ) : canCreateFolder ? (
                      <button type="submit" formAction={ensureTargetFolder.bind(null, existing.id)} formNoValidate>Criar pasta no Drive</button>
                    ) : null}
                    <button
                      className="danger"
                      type="submit"
                      formAction={deleteTarget.bind(null, existing.id)}
                      formNoValidate
                      onClick={(e) => {
                        if (!window.confirm(`Excluir o destino ${o.networkLabel} ${o.formatLabel} deste post? Não dá para desfazer.`)) e.preventDefault();
                      }}
                    >
                      Excluir este destino
                    </button>
                  </div>
                </details>
              </div>
            </>
          );
        })()}
      </div>

      <div className="col" style={{ minWidth: 0 }}>
        <b className="small">Prévia (aproximada)</b>
        <PostPreview
          network={network}
          format={format}
          day={isDay(date) ? date : defaults.date}
          time={time}
          fileId={playable}
          meta={video.meta}
          thumbFileId={thumbPlayable}
          thumbMeta={thumb.meta}
          title={title}
          profile={profile}
          caption={caption}
        />
        {video.meta && !video.meta.error && !playable && (
          <p className="muted small" style={{ maxWidth: 300 }}>O vídeo passa a tocar na prévia depois de salvar o post.</p>
        )}
        <p className="muted small" style={{ maxWidth: 300 }}>Pontos de corte e limites ficam em uma configuração editável e podem mudar quando a rede mudar.</p>
      </div>
    </div>
  );

  if (existing) {
    return (
      <div id={`t-${existing.id}`} className="target on existing" style={{ scrollMarginTop: 16 }}>
        <input type="hidden" name="tid" value={existing.id} />
        <div className="target-head row between">
          <h3 className="row" style={{ gap: 10, margin: 0 }}>
            <NetDot network={o.network} />
            {o.networkLabel} · {o.formatLabel}
          </h3>
          <span className={`pill ${existing.late ? "late" : existing.status}`}>{existing.late ? "Atrasado" : STATUS_LABEL[existing.status]} · {existing.time}</span>
        </div>
        <div className="target-fields">{fields}</div>
      </div>
    );
  }
  return (
    <div className={`target ${checked ? "on" : ""}`}>
      <label>
        <input type="checkbox" name="target" value={o.key} checked={checked} onChange={onToggle} />
        <NetDot network={o.network} />
        <b>{o.networkLabel}</b>
        <span className="muted">{o.formatLabel}</span>
        {(o.size || o.length) && <span className="guide muted small">{[o.size, o.length].filter(Boolean).join(" · ")}</span>}
      </label>
      <div className="target-fields" hidden={!checked}>{fields}</div>
    </div>
  );
}
