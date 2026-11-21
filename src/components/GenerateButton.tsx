"use client";

import { useState } from "react";
import { hasTitle } from "@/config/networks";
import { generateCaption } from "@/lib/actions";
import { splitGenerated } from "@/lib/prompt";

/**
 * Pede a legenda à IA e entrega o resultado por `onResult` (título e legenda; o título só vem nos formatos que têm).
 * Com `confirmReplace`, pergunta antes de trocar uma legenda que já existe ("Gerar legenda"); "Nova legenda" não pergunta,
 * porque pedir outra versão já é pedir para trocar.
 */
export default function GenerateButton({
  clientId,
  network,
  format,
  label = "Gerar legenda",
  confirmReplace = true,
  primary = false,
  getPlan,
  getBrief,
  getDraft,
  getCustom,
  onResult,
}: {
  clientId: string;
  network: string;
  format: string;
  label?: string;
  confirmReplace?: boolean;
  primary?: boolean;
  getPlan: () => string;
  getBrief: () => string;
  getDraft: () => string;
  getCustom: () => string;
  onResult: (r: { title: string; caption: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function run() {
    const draft = getDraft();
    if (confirmReplace && draft.trim() && !window.confirm("Já existe uma legenda aqui. Gerar uma nova e substituir a atual?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await generateCaption({ clientId, network, format, plan: getPlan(), brief: getBrief(), draft, custom: getCustom() });
      if ("error" in r) setMsg({ kind: "err", text: `Não consegui gerar: ${r.error}` });
      else {
        onResult(splitGenerated(r.text, hasTitle(network, format)));
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
      <button type="button" className={`btn${primary ? " primary" : ""}`} onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Gerando…" : label}
      </button>
      {msg && (
        <span role={msg.kind === "err" ? "alert" : "status"} className={`small ${msg.kind === "err" ? "" : "muted"}`} style={msg.kind === "err" ? { color: "var(--bad-ink)" } : undefined}>
          {msg.text}
        </span>
      )}
    </>
  );
}
