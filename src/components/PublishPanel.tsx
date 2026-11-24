"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelConfirmation, confirmPublication, publishTarget } from "@/lib/actions";
import type { AutoView } from "@/lib/auto-publish";

export type PublishInfo = {
  /** Nome da conta conectada (ex.: @bestmedical), ou null se ainda não há conexão. */
  connected: string | null;
  state: "idle" | "publishing" | "published" | "failed" | "drafted";
  url: string;
  error: string;
  /** Publicação automática por horário (só nas redes que o app publica sozinho). */
  auto?: AutoView;
};

export default function PublishPanel(p: {
  id: string;
  networkLabel: string;
  info: PublishInfo;
  /** Há mudanças na tela ainda não salvas: o app publica o que está salvo. */
  dirty: boolean;
  /** Resumo curto do que está salvo e será publicado (arquivo e data/horário). */
  savedSummary?: string;
  posted: boolean;
  /** "draft" = a rede recebe o arquivo como rascunho e a pessoa publica no app dela (TikTok). Padrão: publica de verdade. */
  mode?: "direct" | "draft";
  /** Modo rascunho: a legenda vai junto (fotos) ou precisa ser colada no app da rede (vídeo). */
  captionSent?: boolean;
}) {
  const router = useRouter();
  // "now" = confirmando "Publicar agora"; "auto" = confirmando a publicação automática no horário.
  const [confirming, setConfirming] = useState<null | "now" | "auto">(null);
  const { info } = p;

  // Quando o resultado chega (publicou ou falhou), a confirmação aberta se fecha.
  useEffect(() => {
    setConfirming(null);
  }, [info.state, info.error, info.auto?.confirmed, info.auto?.missed]);

  // Se houver edição não salva com a confirmação aberta, fecha para evitar publicar versão antiga.
  useEffect(() => {
    if (p.dirty) setConfirming(null);
  }, [p.dirty]);

  // Enquanto publica, atualiza a tela sozinho até o resultado chegar.
  useEffect(() => {
    if (info.state !== "publishing") return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [info.state, router]);

  const draft = p.mode === "draft";
  const drafted = info.state === "drafted";
  const showForm = !!info.connected && !p.posted && info.state !== "published" && info.state !== "publishing";
  const auto = info.auto?.eligible && !draft ? info.auto : undefined;
  // Confirmado e ainda por publicar: o app publica sozinho no horário; "Publicar agora" some para não haver duas ordens.
  const armed = !!auto && auto.confirmed && !auto.missed && info.state === "idle";

  return (
    <div className="col" style={{ gap: 8, padding: 12, border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }} aria-label={`${draft ? "Enviar para" : "Publicar no"} ${p.networkLabel}`}>
      <b className="small">{draft ? `Enviar para o ${p.networkLabel}` : "Publicar pelo app"}</b>
      {info.state === "published" ? (
        <p className="alert ok" role="status" style={{ margin: 0 }}>
          Publicado.{" "}
          {info.url && (
            <a href={info.url} target="_blank" rel="noopener noreferrer">Ver o post</a>
          )}
        </p>
      ) : info.state === "publishing" ? (
        <p className="alert warn" role="status" style={{ margin: 0 }}>
          {draft ? `Enviando para o ${p.networkLabel}…` : `Publicando no ${p.networkLabel}…`} isso pode levar alguns minutos. A tela atualiza sozinha.
        </p>
      ) : !info.connected ? (
        <p className="muted small" style={{ margin: 0 }}>A conta do {p.networkLabel} deste cliente ainda não está conectada.</p>
      ) : p.posted ? (
        <p className="muted small" style={{ margin: 0 }}>Este post está marcado como postado.</p>
      ) : null}
      {draft && drafted && !p.posted && (
        <div className="alert ok" role="status" style={{ margin: 0 }}>
          <b>Enviado como rascunho.</b> Abra o app do {p.networkLabel} em {info.connected}, toque na notificação, escolha a privacidade e publique.
          {!p.captionSent && " A legenda não vai junto com o vídeo: use \"Copiar legenda\" aqui embaixo e cole no app."}{" "}
          Depois de publicar, marque como postado aqui.
        </div>
      )}
      {showForm && armed && auto && (
        <div className="col" style={{ gap: 8 }}>
          <p className="alert ok" role="status" style={{ margin: 0 }}>
            <b>Publicação confirmada.</b> O app publica sozinho em <b>{auto.when}</b>, em {info.connected} ({p.networkLabel}). Fique tranquilo: se faltar algo na hora, ele não publica e avisa.
          </p>
          {p.dirty && <p className="muted small" style={{ margin: 0 }}>Se você salvar mudanças neste post, a confirmação é desfeita e precisa ser feita de novo.</p>}
          <div className="row">
            <button className="btn" type="submit" formAction={cancelConfirmation.bind(null, p.id)} formNoValidate>Cancelar confirmação</button>
          </div>
        </div>
      )}
      {showForm && !armed && (
        <>
          {auto?.missed && (
            <p className="alert err" role="alert" style={{ margin: 0 }}>
              <b>Perdeu o horário ({auto.when}).</b> O app não publicou, porque passou da tolerância. Ajuste o horário e confirme de novo, ou publique agora.
            </p>
          )}
          {info.state === "failed" && info.error && (
            <p className="alert err" role="alert" style={{ margin: 0 }}>{draft ? "Não enviou" : "Não publicou"}: {info.error}</p>
          )}
          {p.dirty && (
            <p className="alert warn" role="status" style={{ margin: 0 }}>
              Há mudanças não salvas (legenda, título, data, horário ou arquivo). Salve antes de publicar: o app usa o que está salvo.
            </p>
          )}
          {confirming === null ? (
            <div className="row">
              {auto && (
                <button className="btn primary" type="button" disabled={p.dirty} onClick={() => setConfirming("auto")}>
                  Confirmar publicação
                </button>
              )}
              <button className={drafted || auto ? "btn" : "btn primary"} type="button" disabled={p.dirty} onClick={() => setConfirming("now")}>
                {info.state === "failed" ? "Tentar de novo" : drafted ? "Enviar de novo" : draft ? "Enviar como rascunho" : "Publicar agora"}
              </button>
              <span className="muted small">
                em {info.connected}
                {p.savedSummary ? ` · ${p.savedSummary}` : ""}
              </span>
              {auto?.missed && (
                <button className="btn" type="submit" formAction={cancelConfirmation.bind(null, p.id)} formNoValidate>Remover confirmação</button>
              )}
            </div>
          ) : confirming === "auto" && auto ? (
            <div className="col" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}>
                Confirmar que este post está pronto? O app vai publicar <b>sozinho</b>, em <b>{auto.when}</b>, em <b>{info.connected}</b> ({p.networkLabel}), com a legenda e a mídia que estão salvas. Se você mudar horário, legenda, mídia ou título depois, a confirmação é desfeita. Dá para cancelar antes do horário.
              </p>
              <div className="row">
                <button className="btn primary" type="submit" formAction={confirmPublication.bind(null, p.id)} formNoValidate disabled={p.dirty}>
                  Confirmar publicação
                </button>
                <button className="btn" type="button" onClick={() => setConfirming(null)}>Voltar</button>
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}>
                {draft ? (
                  <>
                    Enviar para a caixa de entrada do {p.networkLabel} de <b>{info.connected}</b>? <b>Nada é publicado</b>: você finaliza no app do {p.networkLabel}.
                  </>
                ) : (
                  <>
                    Publicar <b>agora, de verdade</b>, em <b>{info.connected}</b> ({p.networkLabel})? Não dá para desfazer pelo app.
                  </>
                )}
              </p>
              <div className="row">
                <button className="btn primary" type="submit" formAction={publishTarget.bind(null, p.id)} formNoValidate disabled={p.dirty}>
                  {draft ? "Confirmar e enviar" : "Confirmar e publicar"}
                </button>
                <button className="btn" type="button" onClick={() => setConfirming(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
