"use client";

import Link from "next/link";
import { useState } from "react";
import { NETWORKS, folderGroup, isNetwork } from "@/config/networks";
import { savePost } from "@/lib/actions";
import { fmtNumber } from "@/lib/checks";
import type { PickerOption } from "@/lib/picker-options";
import type { PromptClient } from "@/lib/prompt";
import NetworkRow, { type ExistingTarget, type Inherited } from "./NetworkRow";
import SubmitButton from "./SubmitButton";
import ToneSelector from "./ToneSelector";

export type EditorTarget = ExistingTarget & { network: string; format: string };

function makeSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Tela única do post, a mesma para criar (Novo post) e para editar (página do dia):
 *  1. ideia do post e planejamento do dia;  2. nome, tom de voz e descrição da legenda;  3. redes.
 * As redes que o post já tem vêm marcadas e abertas; as outras ficam desmarcadas e abrem ao marcar.
 * Um Salvar grava tudo (`savePost`). Os botões de situação, publicar, pasta e excluir de cada rede usam `formAction`
 * dentro deste mesmo formulário (não há formulários aninhados).
 */
export default function PostEditor({
  postId,
  client,
  canCreateFolder,
  options,
  aiEnabled,
  volta,
  day,
  defaultTime,
  note,
  postName,
  brief,
  tones,
  targets,
  profiles,
  saved,
}: {
  /** Sem id = post novo. */
  postId?: string;
  client: PromptClient & { id: string };
  canCreateFolder: boolean;
  options: PickerOption[];
  aiEnabled: boolean;
  /** Endereço da tela (sem parâmetros) para onde voltar depois de salvar. */
  volta: string;
  day: string;
  defaultTime: string;
  /** Ideia/planejamento já salvo para o dia. */
  note: string;
  postName: string;
  brief: string;
  tones: string[];
  targets: EditorTarget[];
  profiles: Record<string, { name: string; handle: string }>;
  saved?: boolean;
}) {
  const editing = !!postId;
  const px = postId ? `${postId}-` : "";
  const [submissionId] = useState(() => makeSubmissionId());
  const [planText, setPlanText] = useState(note);
  const [postNameText, setPostNameText] = useState(postName);
  const [briefText, setBriefText] = useState(brief);
  const [toneIds, setToneIds] = useState<string[]>(tones);
  const [date, setDate] = useState(day);
  const [time, setTime] = useState(defaultTime);
  const [on, setOn] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const byKey = new Map(targets.map((t) => [`${t.network}:${t.format}`, t]));
  // Link de vídeo que um destino novo herda: o de outro destino do post com o mesmo formato (mesmo grupo de pasta).
  const inheritFor = (key: string): Inherited | undefined => {
    const [n, f] = key.split(":");
    const g = folderGroup(n, f);
    if (!g) return undefined;
    const from = targets.find((t) => folderGroup(t.network, t.format)?.id === g.id && t.driveUrl);
    if (!from || !isNetwork(from.network)) return undefined;
    return {
      url: from.driveUrl,
      fileId: from.fileId,
      meta: from.meta,
      from: `${NETWORKS[from.network].label} ${NETWORKS[from.network].formats[from.format]?.label ?? from.format}`,
    };
  };

  const defaults = { date: editing ? targets[0]?.day ?? day : date, time: editing ? targets[0]?.time ?? defaultTime : time };
  const common = {
    client,
    clientId: client.id,
    clientName: client.name,
    aiEnabled,
    getPlan: () => planText,
    getBrief: () => briefText,
    getTones: () => toneIds,
    canCreateFolder,
    idPrefix: px,
  };

  return (
    <form action={savePost} className="col" style={{ gap: 20 }}>
      {/* Primeiro botão do formulário: é o que o Enter aciona. Salva sem mudar a situação de nenhuma rede. */}
      <SubmitButton className="sr" tabIndex={-1} aria-hidden={true}>Salvar</SubmitButton>
      <input type="hidden" name="client_id" value={client.id} />
      <input type="hidden" name="post_id" value={postId ?? ""} />
      <input type="hidden" name="volta" value={volta} />
      {editing ? (
        <>
          <input type="hidden" name="note_day" value={day} />
          <input type="hidden" name="note_orig" value={note} />
        </>
      ) : (
        <>
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="note_from" value={note ? day : ""} />
        </>
      )}
      {saved && <p className="alert ok" role="status">Salvo.</p>}

      <section className="card" aria-labelledby={`${px}s1`}>
        <h2 id={`${px}s1`}>1. Ideia do post e planejamento</h2>
        <div className="col">
          <label className="f" htmlFor={`${px}note`}>A ideia do post / o que está planejado para {editing ? "este dia" : "esta data"}</label>
          <textarea id={`${px}note`} name="note" rows={4} maxLength={4000} value={planText} onChange={(e) => setPlanText(e.target.value)}
            placeholder="Ex.: Reels sobre o plantão 24h. Pedir depoimento ao cliente." />
          <div className="row between small muted">
            <span>Aparece no calendário{editing ? " e vale para o dia inteiro" : ""}. Dá para salvar só o texto, sem escolher rede, e voltar depois para subir mídia e legendas.</span>
            <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtNumber(planText.length)} de {fmtNumber(4000)}</span>
          </div>
        </div>
        {!editing && (
          <div className="grid2">
            <div className="col">
              <label className="f" htmlFor="date">Data</label>
              <input id="date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="col">
              <label className="f" htmlFor="time">Horário dos posts</label>
              <input id="time" name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby={`${px}s2`}>
        <h2 id={`${px}s2`}>2. Nome do post, tom de voz e descrição da legenda</h2>
        <div className="col">
          <label className="f" htmlFor={`${px}post_name`}>Nome do post (opcional)</label>
          <input id={`${px}post_name`} name="post_name" type="text" maxLength={120} value={postNameText} onChange={(e) => setPostNameText(e.target.value)} placeholder="Ex.: Reels do plantão técnico" />
          <span className="muted small">Só para você achar o post depois (calendário, semana, listas). Não vai para a rede.</span>
        </div>
        <ToneSelector initial={tones} onChange={setToneIds} />
        <div className="col">
          <label className="f" htmlFor={`${px}caption_brief`}>Descrição da legenda</label>
          <textarea id={`${px}caption_brief`} name="caption_brief" rows={4} maxLength={4000} value={briefText} onChange={(e) => setBriefText(e.target.value)}
            placeholder="Ex.: Falar do plantão 24h, dizer que atendemos clínicas e hospitais e fechar chamando para o WhatsApp." />
          <div className="row between small muted">
            <span style={{ maxWidth: "70ch" }}>
              Escreva o que quer na legenda, nem que seja um rascunho. Ao gerar a legenda de cada rede, o app usa este texto junto com a
              ideia do item 1, os tons de voz, o tom de voz e as observações do cadastro do cliente.
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtNumber(briefText.length)} de {fmtNumber(4000)}</span>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby={`${px}s3`}>
        <h2 id={`${px}s3`}>3. Redes, legendas e vídeos</h2>
        <p className="muted small" style={{ maxWidth: "70ch" }}>
          Marque cada rede e formato em que o post vai sair. Cada um ganha a sua legenda (e o seu título, nas redes que têm), o seu link de vídeo e a prévia.
          As redes que já estão no post aparecem abertas; marque outra para abrir os campos dela. A orientação ao lado é a medida ideal sugerida, não uma regra da rede.
        </p>
        <div className="col" style={{ gap: 10 }}>
          {options.map((o) => {
            const ex = byKey.get(o.key);
            const profile = profiles[o.network] ?? { name: client.name, handle: client.name.toLowerCase().replace(/\s+/g, "") };
            return (
              <NetworkRow
                key={o.key}
                o={o}
                existing={ex}
                checked={on.has(o.key)}
                onToggle={() => toggle(o.key)}
                defaults={defaults}
                inherited={ex ? undefined : inheritFor(o.key)}
                isLastTarget={ex ? targets.length === 1 : false}
                profile={profile}
                {...common}
              />
            );
          })}
        </div>
      </section>

      <div className="savebar">
        {!editing && <Link href={`/clientes/${client.id}`} className="btn">Cancelar</Link>}
        <SubmitButton className="btn primary" pendingLabel="Salvando…" data-save>Salvar</SubmitButton>
      </div>
    </form>
  );
}
