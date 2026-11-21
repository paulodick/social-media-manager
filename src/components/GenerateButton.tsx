"use client";

import { useState } from "react";
import { generateCaption } from "@/lib/actions";

/**
 * "Gerar legenda": pede a legenda à IA e entrega o texto por `onText`.
 * Se já houver legenda escrita, ela vai como rascunho e só é trocada se a pessoa confirmar.
 */
export default function GenerateButton({
  clientId,
  network,
  format,
  getPlan,
  getDraft,
  onText,
}: {
  clientId: string;
  network: string;
  format: string;
  getPlan: () => string;
  getDraft: () => string;
  onText: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function run() {
    const draft = getDraft();
    if (draft.trim() && !window.confirm("Já existe uma legenda aqui. Gerar uma nova e substituir a atual?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await generateCaption({ clientId, network, format, plan: getPlan(), draft });
      if ("error" in r) setMsg({ kind: "err", text: `Não consegui gerar: ${r.error}` });
      else {
        onText(r.text);
        setMsg({ kind: "ok", text: "Legenda gerada. Revise antes de usar." });
      }
    } catch {
      setMsg({ kind: "err", text: "Não consegui gerar agora. Tente de novo ou use \"Copiar pedido para a IA\"." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Gerando…" : "Gerar legenda"}
      </button>
      {msg && (
        <span role={msg.kind === "err" ? "alert" : "status"} className={`small ${msg.kind === "err" ? "" : "muted"}`} style={msg.kind === "err" ? { color: "var(--bad-ink)" } : undefined}>
          {msg.text}
        </span>
      )}
    </>
  );
}
