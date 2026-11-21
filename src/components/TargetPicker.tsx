"use client";

import { useState } from "react";
import { NetDot } from "@/components/ui";
import { buildCaptionPrompt, type PromptClient } from "@/lib/prompt";
import GenerateButton from "./GenerateButton";
import type { NetworkId } from "@/config/networks";

export type PickerOption = {
  key: string; // "rede:formato"
  network: string;
  networkLabel: string;
  formatLabel: string;
  size?: string;
  length?: string;
  /** Formatos com miniatura própria: orientação de tamanho. Presente = mostra o campo do link da miniatura. */
  thumbGuide?: string;
};

/**
 * Uma linha por rede/formato. Ao marcar, aparecem a legenda e o link do vídeo daquele destino.
 * Os campos desmarcados ficam desabilitados (guardam o texto digitado, mas não são enviados).
 */
export default function TargetPicker({
  options,
  client,
  clientId,
  aiEnabled,
}: {
  options: PickerOption[];
  client: PromptClient;
  clientId: string;
  aiEnabled: boolean;
}) {
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
                <label className="f" htmlFor={`cap-${i}`}>{o.key === "youtube:longo" ? "Descrição" : "Legenda"} — {o.networkLabel} {o.formatLabel}</label>
                <textarea id={`cap-${i}`} name={`caption__${o.key}`} rows={4} disabled={!checked} />
                <div className="row" style={{ gap: 8 }}>
                  <PromptButton client={client} option={o} captionId={`cap-${i}`} />
                  {aiEnabled && (
                    <GenerateButton
                      clientId={clientId}
                      network={o.key.split(":")[0]}
                      format={o.key.split(":")[1]}
                      getPlan={() => (document.getElementById("note") as HTMLTextAreaElement | null)?.value ?? ""}
                      getDraft={() => (document.getElementById(`cap-${i}`) as HTMLTextAreaElement | null)?.value ?? ""}
                      onText={(t) => {
                        const el = document.getElementById(`cap-${i}`) as HTMLTextAreaElement | null;
                        if (el) el.value = t;
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="col">
                <label className="f" htmlFor={`drv-${i}`}>Link do vídeo no Google Drive — {o.networkLabel} {o.formatLabel} (opcional)</label>
                <input id={`drv-${i}`} name={`drive__${o.key}`} type="text" placeholder="https://drive.google.com/file/d/…/view" disabled={!checked} />
                <span className="muted small">Pode ficar em branco agora e ser preenchido depois, na tela do dia.</span>
              </div>
              {o.thumbGuide && (
                <div className="col">
                  <label className="f" htmlFor={`thb-${i}`}>Link da miniatura no Google Drive — {o.networkLabel} {o.formatLabel} (opcional)</label>
                  <input id={`thb-${i}`} name={`thumb__${o.key}`} type="text" placeholder="https://drive.google.com/file/d/…/view" disabled={!checked} />
                  <span className="muted small">{o.thumbGuide}. Na tela do dia você vê como a miniatura aparece na lista do YouTube.</span>
                </div>
              )}
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
