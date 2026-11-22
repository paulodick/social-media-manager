"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { publishTarget } from "@/lib/actions";

export type PublishInfo = {
  /** Nome da conta conectada (ex.: @bestmedical), ou null se ainda não há conexão. */
  connected: string | null;
  state: "idle" | "publishing" | "published" | "failed" | "drafted";
  url: string;
  error: string;
};

export default function PublishPanel(p: {
  id: string;
  networkLabel: string;
  info: PublishInfo;
  /** A legenda na tela ainda não foi salva: o app publica o que está salvo. */
  dirty: boolean;
  posted: boolean;
  /** "draft" = a rede recebe o arquivo como rascunho e a pessoa publica no app dela (TikTok). Padrão: publica de verdade. */
  mode?: "direct" | "draft";
  /** Modo rascunho: a legenda vai junto (fotos) ou precisa ser colada no app da rede (vídeo). */
  captionSent?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { info } = p;

  // Quando o resultado chega (publicou ou falhou), a confirmação aberta se fecha.
  useEffect(() => {
    setConfirming(false);
  }, [info.state, info.error]);

  // Enquanto publica, atualiza a tela sozinho até o resultado chegar.
  useEffect(() => {
    if (info.state !== "publishing") return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [info.state, router]);

  const draft = p.mode === "draft";
  const drafted = info.state === "drafted";
  const showForm = !!info.connected && !p.posted && info.state !== "published" && info.state !== "publishing";

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
      {showForm && (
        <>
          {info.state === "failed" && info.error && (
            <p className="alert err" role="alert" style={{ margin: 0 }}>{draft ? "Não enviou" : "Não publicou"}: {info.error}</p>
          )}
          {p.dirty && <p className="muted small" style={{ margin: 0 }}>Salve a legenda antes de {draft ? "enviar" : "publicar"}: o app usa o texto que está salvo.</p>}
          {!confirming ? (
            <div className="row">
              <button className={drafted ? "btn" : "btn primary"} type="button" disabled={p.dirty} onClick={() => setConfirming(true)}>
                {info.state === "failed" ? "Tentar de novo" : drafted ? "Enviar de novo" : draft ? "Enviar como rascunho" : "Publicar agora"}
              </button>
              <span className="muted small">em {info.connected}</span>
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
                <button className="btn primary" type="submit" formAction={publishTarget.bind(null, p.id)} formNoValidate>
                  {draft ? "Confirmar e enviar" : "Confirmar e publicar"}
                </button>
                <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
