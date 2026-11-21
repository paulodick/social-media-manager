"use client";

import { useState } from "react";
import { NetDot } from "@/components/ui";
import { buildCaptionPrompt, type PromptClient } from "@/lib/prompt";
import type { NetworkId } from "@/config/networks";

export type PickerOption = {
  key: string; // "rede:formato"
  network: string;
  networkLabel: string;
  formatLabel: string;
  size?: string;
  length?: string;
};

/**
 * Uma linha por rede/formato. Ao marcar, aparecem a legenda e o link do vídeo daquele destino.
 * Os campos desmarcados ficam desabilitados (guardam o texto digitado, mas não são enviados).
 */
export default function TargetPicker({ options, client }: { options: PickerOption[]; client: PromptClient }) {
  const [on, setOn] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="col" style={{ gap: 10 }}>
      {options.map((o, i) => {
        const checked = on.has(o.key);
        return (
          <div key={o.key} className={`target ${checked ? "on" : ""}`}>
            <label>
              <input type="checkbox" name="target" value={o.key} checked={checked} onChange={() => toggle(o.key)} />
              <NetDot network={o.network} />
              <b>{o.networkLabel}</b>
              <span className="muted">{o.formatLabel}</span>
              {(o.size || o.length) && (
                <span className="guide muted small">
                  {[o.size, o.length].filter(Boolean).join(" · ")}
                </span>
              )}
            </label>
            <div className="target-fields" hidden={!checked}>
              <div className="col">
                <label className="f" htmlFor={`cap-${i}`}>Legenda — {o.networkLabel} {o.formatLabel}</label>
                <textarea id={`cap-${i}`} name={`caption__${o.key}`} rows={4} disabled={!checked} />
                <div>
                  <PromptButton client={client} option={o} captionId={`cap-${i}`} />
                </div>
              </div>
              <div className="col">
                <label className="f" htmlFor={`drv-${i}`}>Link do vídeo no Google Drive — {o.networkLabel} {o.formatLabel} (opcional)</label>
                <input id={`drv-${i}`} name={`drive__${o.key}`} type="text" placeholder="https://drive.google.com/file/d/…/view" disabled={!checked} />
                <span className="muted small">Pode ficar em branco agora e ser preenchido depois, na tela do dia.</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Monta o pedido na hora do clique, com o planejamento e a legenda como estão digitados. */
function PromptButton({ client, option, captionId }: { client: PromptClient; option: PickerOption; captionId: string }) {
  const [done, setDone] = useState(false);
  const [network, format] = option.key.split(":");
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        const plan = (document.getElementById("note") as HTMLTextAreaElement | null)?.value ?? "";
        const draft = (document.getElementById(captionId) as HTMLTextAreaElement | null)?.value ?? "";
        const text = buildCaptionPrompt({ client, network: network as NetworkId, format, plan, captionDraft: draft });
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copie o pedido:", text);
        }
      }}
    >
      {done ? "Copiado" : "Copiar pedido para a IA"}
    </button>
  );
}
