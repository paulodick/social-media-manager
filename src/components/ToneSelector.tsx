"use client";

import { useId, useState } from "react";
import { MAX_TONES, TONES, toneBlockedReason, type ToneId } from "@/config/tones";

/**
 * Tom de voz deste post (opcional): até 3 tons. A ordem em que são marcados é a prioridade, e o número aparece ao lado.
 * Tons que não combinam com um já marcado (ou além do limite de 3) ficam desativados, com o motivo escrito.
 * Os tons marcados vão para o formulário como `tones` (um campo escondido por tom, na ordem de prioridade),
 * junto com `tones_present`, que avisa o servidor de que este formulário traz a escolha (inclusive vazia).
 */
export default function ToneSelector({
  initial = [],
  onChange,
}: {
  initial?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const hintId = useId();

  function toggle(id: ToneId) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onChange?.(next);
  }

  return (
    <fieldset className="tones" aria-describedby={hintId}>
      <legend>Tom de voz deste post (opcional)</legend>
      <p id={hintId} className="muted small tones-hint">
        Escolha até {MAX_TONES}. O primeiro marcado pesa mais.{" "}
        <b aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>{selected.length} de {MAX_TONES}</b>
      </p>
      <div className="tone-grid">
        {TONES.map((t) => {
          const order = selected.indexOf(t.id) + 1;
          const reason = toneBlockedReason(t.id, selected);
          const blocked = !!reason;
          return (
            <label key={t.id} className={`tone${order ? " on" : ""}${blocked ? " off" : ""}`} title={t.instruction}>
              <input type="checkbox" checked={order > 0} disabled={blocked} onChange={() => toggle(t.id)} />
              <span className="tone-text">
                <span className="tone-name">{t.label}</span>
                {reason && <span className="small muted">{reason}</span>}
              </span>
              {order > 0 && <span className="tone-order" aria-label={`prioridade ${order}`}>{order}</span>}
            </label>
          );
        })}
      </div>
      <input type="hidden" name="tones_present" value="1" />
      {selected.map((id) => (
        <input key={id} type="hidden" name="tones" value={id} />
      ))}
    </fieldset>
  );
}
