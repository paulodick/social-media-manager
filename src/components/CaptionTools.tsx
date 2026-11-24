"use client";

import { useId, useState } from "react";
import type { NetworkId } from "@/config/networks";
import { buildCaptionPromptAction } from "@/lib/actions";
import { buildCaptionPrompt, type PromptClient } from "@/lib/prompt";
import GenerateButton from "./GenerateButton";

/**
 * Ferramentas de legenda de um destino (rede/formato), usadas no novo post e na tela do dia:
 *  - "Gerar legenda": cria a legenda com a ideia do post (item 1), a descrição da legenda (item 2), o tom de voz e as
 *    observações do cliente e os tons de voz marcados para o post;
 *  - "Copiar pedido para a IA": o mesmo pedido (montado no servidor, com a memória aprendida), para colar no Claude ou no Gemini;
 *  - "Personalizar legenda" (recolhido): pedidos de ajuste. Vale antes da primeira legenda e depois, e o botão
 *    "Nova legenda" refaz a legenda levando o ajuste em conta.
 */
export default function CaptionTools({
  client,
  clientId,
  network,
  format,
  aiEnabled,
  getPlan,
  getBrief,
  getCaption,
  getTones,
  onResult,
}: {
  client: PromptClient;
  clientId: string;
  network: string;
  format: string;
  aiEnabled: boolean;
  getPlan: () => string;
  getBrief: () => string;
  getCaption: () => string;
  /** Tons de voz marcados para o post agora (mesmo que ainda não salvos). */
  getTones: () => string[];
  onResult: (r: { title: string; caption: string }) => void;
}) {
  const [custom, setCustom] = useState("");
  const [bilingual, setBilingual] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const customId = useId();

  async function copyPrompt() {
    setCopying(true);
    let text = "";
    try {
      const res = await buildCaptionPromptAction({
        clientId,
        network,
        format,
        plan: getPlan(),
        brief: getBrief(),
        draft: getCaption(),
        custom,
        tones: getTones(),
        bilingual,
      });
      text = "prompt" in res
        ? res.prompt
        : buildCaptionPrompt({
            client,
            network: network as NetworkId,
            format,
            plan: getPlan(),
            brief: getBrief(),
            captionDraft: getCaption(),
            custom,
            tones: getTones(),
            bilingual,
          });
    } catch {
      text = buildCaptionPrompt({
        client,
        network: network as NetworkId,
        format,
        plan: getPlan(),
        brief: getBrief(),
        captionDraft: getCaption(),
        custom,
        tones: getTones(),
        bilingual,
      });
    } finally {
      setCopying(false);
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o pedido:", text);
    }
  }

  const common = {
    clientId,
    network,
    format,
    getPlan,
    getBrief,
    getDraft: getCaption,
    getCustom: () => custom,
    getTones,
    getBilingual: () => bilingual,
    onResult,
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        {aiEnabled && <GenerateButton {...common} label="Gerar Legenda com IA" />}
        <button type="button" className="btn" disabled={copying} onClick={copyPrompt}>
          {copying ? "Montando pedido…" : copied ? "Copiado" : "Copiar pedido para a IA"}
        </button>
      </div>
      <span className="muted small">
        O app aprende com as edições feitas nas legendas geradas para adaptar os próximos pedidos deste cliente.
      </span>
      <label className="opt" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={bilingual} onChange={(e) => setBilingual(e.target.checked)} />
        <span>Versão bilíngue (Português + Inglês)</span>
      </label>
      <details className="personalize">
        <summary>Personalizar legenda</summary>
        <div className="col" style={{ gap: 8, paddingTop: 8 }}>
          <label className="f" htmlFor={customId}>Como você quer essa legenda</label>
          <textarea
            id={customId}
            rows={3}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Ex.: mais curta e direta; tirar o tom de propaganda; começar com uma pergunta; citar o plantão 24h."
          />
          <span className="muted small">
            Vale antes da primeira legenda e depois dela. Se a legenda gerada não ficou boa, descreva o que mudar e peça uma nova.
          </span>
          {aiEnabled && (
            <div className="row" style={{ gap: 8 }}>
              <GenerateButton {...common} label="Nova legenda" confirmReplace={false} primary />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
