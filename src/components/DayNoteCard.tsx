"use client";

import { useState } from "react";
import { saveDayNote } from "@/lib/actions";
import { fmtNumber } from "@/lib/checks";
import SubmitButton from "./SubmitButton";

/**
 * Cartão único da nota de planejamento do dia, exibido no topo da tela do dia (fora de cada post).
 */
export default function DayNoteCard({
  clientId,
  day,
  volta,
  initialNote,
}: {
  clientId: string;
  day: string;
  volta: string;
  initialNote: string;
}) {
  const [text, setText] = useState(initialNote);
  const changed = text.trim() !== initialNote.trim();

  return (
    <form action={saveDayNote} className="card col" style={{ gap: 10 }} aria-labelledby="day-note-heading">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="volta" value={volta} />
      <div className="row between" style={{ alignItems: "baseline" }}>
        <h2 id="day-note-heading">Planejamento do dia</h2>
        <span className="muted small">Vale para o dia inteiro e aparece no calendário</span>
      </div>
      <div className="col">
        <label className="f sr" htmlFor="day-note-body">A ideia do post / o que está planejado para este dia</label>
        <textarea
          id="day-note-body"
          name="note"
          rows={3}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Reels sobre o plantão 24h. Pedir depoimento ao cliente."
        />
        <div className="row between small muted" style={{ alignItems: "center" }}>
          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {fmtNumber(text.length)} de {fmtNumber(4000)}
          </span>
          <SubmitButton className="btn" pendingLabel="Salvando…" disabled={!changed}>
            Salvar planejamento
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
