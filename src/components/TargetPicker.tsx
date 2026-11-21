"use client";

import { useRef, useState } from "react";
import { NetDot } from "@/components/ui";
import type { PromptClient } from "@/lib/prompt";
import CaptionTools from "./CaptionTools";

export type PickerOption = {
  key: string; // "rede:formato"
  network: string;
  networkLabel: string;
  formatLabel: string;
  size?: string;
  length?: string;
  /** Formatos com miniatura própria: orientação de tamanho. Presente = mostra o campo do link da miniatura. */
  thumbGuide?: string;
  /** Formato com título separado da legenda (YouTube, documento do LinkedIn): mostra o campo Título. */
  hasTitle?: boolean;
  /** Limite de caracteres do título, quando a rede tem um conferido. */
  titleLimit?: number;
  /** "Legenda", ou "Descrição" no YouTube vídeo longo. */
  captionLabel: string;
};

/**
 * Uma linha por rede/formato. Ao marcar, aparecem o título (onde existe), a legenda e o link do vídeo daquele destino.
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
      {options.map((o, i) => (
        <TargetRow key={o.key} o={o} i={i} checked={on.has(o.key)} onToggle={() => toggle(o.key)} client={client} clientId={clientId} aiEnabled={aiEnabled} />
      ))}
    </div>
  );
}

const valueOf = (id: string) => (document.getElementById(id) as HTMLTextAreaElement | HTMLInputElement | null)?.value ?? "";

function TargetRow({
  o,
  i,
  checked,
  onToggle,
  client,
  clientId,
  aiEnabled,
}: {
  o: PickerOption;
  i: number;
  checked: boolean;
  onToggle: () => void;
  client: PromptClient;
  clientId: string;
  aiEnabled: boolean;
}) {
  const capRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [network, format] = o.key.split(":");

  return (
    <div className={`target ${checked ? "on" : ""}`}>
      <label>
        <input type="checkbox" name="target" value={o.key} checked={checked} onChange={onToggle} />
        <NetDot network={o.network} />
        <b>{o.networkLabel}</b>
        <span className="muted">{o.formatLabel}</span>
        {(o.size || o.length) && <span className="guide muted small">{[o.size, o.length].filter(Boolean).join(" · ")}</span>}
      </label>
      <div className="target-fields" hidden={!checked}>
        {o.hasTitle && (
          <div className="col">
            <label className="f" htmlFor={`ttl-${i}`}>Título — {o.networkLabel} {o.formatLabel}</label>
            <input
              id={`ttl-${i}`}
              ref={titleRef}
              name={`title__${o.key}`}
              type="text"
              maxLength={200}
              disabled={!checked}
              placeholder="Título que aparece na rede"
              style={{ fontWeight: 600 }}
            />
            <span className="muted small">
              Esta rede tem título separado da legenda{o.titleLimit ? ` (até ${o.titleLimit} caracteres)` : ""}.
            </span>
          </div>
        )}
        <div className="col">
          <label className="f" htmlFor={`cap-${i}`}>{o.captionLabel} — {o.networkLabel} {o.formatLabel}</label>
          <textarea id={`cap-${i}`} ref={capRef} name={`caption__${o.key}`} rows={4} disabled={!checked} />
          <CaptionTools
            client={client}
            clientId={clientId}
            network={network}
            format={format}
            aiEnabled={aiEnabled}
            getPlan={() => valueOf("note")}
            getBrief={() => valueOf("caption_brief")}
            getCaption={() => capRef.current?.value ?? ""}
            onResult={({ title, caption }) => {
              if (capRef.current) capRef.current.value = caption;
              if (title && titleRef.current) titleRef.current.value = title;
            }}
          />
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
}
