"use client";
import { useActionState } from "react";
import { testDriveMove } from "@/lib/actions";
import type { MoveTestResult } from "@/lib/drive";
import SubmitButton from "./SubmitButton";

const VERDICT: Record<MoveTestResult["verdict"], { cls: string; text: string }> = {
  move: { cls: "ok", text: "O app consegue mover as pastas. O editorial pode mover a pasta do vídeo para o dia da postagem." },
  shortcut: { cls: "warn", text: "O Drive não deixa o app mover essas pastas. O editorial vai criar um atalho na pasta do dia e deixar o original no lugar." },
  setup: { cls: "warn", text: "Falta preparar a pasta antes do teste." },
};

/** Botão "Testar mover no Drive" (Configurações). */
export default function DriveMoveTest({ clients }: { clients: { id: string; name: string }[] }) {
  const [result, action] = useActionState<MoveTestResult | null, FormData>(testDriveMove, null);
  return (
    <form action={action} className="col" style={{ gap: 12 }}>
      <div className="col">
        <label className="f" htmlFor="move-client">Cliente</label>
        <select id="move-client" name="client_id" required defaultValue={clients[0]?.id ?? ""}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton className="btn" pendingLabel="Testando…">Testar mover no Drive</SubmitButton>
      </div>
      {result && (
        <div className={`alert ${VERDICT[result.verdict].cls}`} role="status">
          <p><b>{VERDICT[result.verdict].text}</b></p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {result.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
