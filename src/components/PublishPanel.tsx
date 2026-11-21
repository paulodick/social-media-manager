"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { publishTarget } from "@/lib/actions";

export type PublishInfo = {
  /** Nome da conta conectada (ex.: @bestmedical), ou null se ainda não há conexão. */
  connected: string | null;
  state: "idle" | "publishing" | "published" | "failed";
  url: string;
  error: string;
};

export default function PublishPanel(p: {
  id: string;
  networkLabel: string;
  volta: string;
  info: PublishInfo;
  /** A legenda na tela ainda não foi salva: o app publica o que está salvo. */
  dirty: boolean;
  posted: boolean;
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

  const back = p.volta.split("#")[0];
  return (
    <div className="col" style={{ gap: 8, padding: 12, border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }} aria-label={`Publicar no ${p.networkLabel}`}>
      <b className="small">Publicar pelo app</b>
      {info.state === "published" ? (
        <p className="alert ok" role="status" style={{ margin: 0 }}>
          Publicado.{" "}
          {info.url && (
            <a href={info.url} target="_blank" rel="noopener noreferrer">Ver o post</a>
          )}
        </p>
      ) : info.state === "publishing" ? (
        <p className="alert warn" role="status" style={{ margin: 0 }}>Publicando no {p.networkLabel}… isso pode levar alguns minutos. A tela atualiza sozinha.</p>
      ) : !info.connected ? (
        <p className="muted small" style={{ margin: 0 }}>A conta do {p.networkLabel} deste cliente ainda não está conectada.</p>
      ) : p.posted ? (
        <p className="muted small" style={{ margin: 0 }}>Este post está marcado como postado.</p>
      ) : (
        <>
          {info.state === "failed" && info.error && (
            <p className="alert err" role="alert" style={{ margin: 0 }}>Não publicou: {info.error}</p>
          )}
          {p.dirty && <p className="muted small" style={{ margin: 0 }}>Salve a legenda antes de publicar: o app publica o texto que está salvo.</p>}
          {!confirming ? (
            <div className="row">
              <button className="btn primary" type="button" disabled={p.dirty} onClick={() => setConfirming(true)}>
                {info.state === "failed" ? "Tentar de novo" : "Publicar agora"}
              </button>
              <span className="muted small">em {info.connected}</span>
            </div>
          ) : (
            <form action={publishTarget} className="col" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="volta" value={back} />
              <p style={{ margin: 0 }}>
                Publicar <b>agora, de verdade</b>, em <b>{info.connected}</b> ({p.networkLabel})? Não dá para desfazer pelo app.
              </p>
              <div className="row">
                <button className="btn primary" type="submit">Confirmar e publicar</button>
                <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancelar</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
