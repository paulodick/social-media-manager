"use client";

import { useState } from "react";
import { NETWORKS, type NetworkId } from "@/config/networks";
import { NetDot } from "./ui";

/** Uma rede no cadastro do cliente: os campos de conta e endereço só aparecem quando a rede está marcada. */
export default function ClientNetworkField({
  network,
  checked,
  account,
  url,
  placeholders,
}: {
  network: NetworkId;
  checked: boolean;
  account: string;
  url: string;
  placeholders: { acc: string; url: string };
}) {
  const cfg = NETWORKS[network];
  const [on, setOn] = useState(checked);
  return (
    <fieldset className={`netfield ${on ? "on" : ""}`}>
      <legend className="sr">{cfg.label}</legend>
      <label className="row" style={{ gap: 10, cursor: "pointer" }}>
        <input type="checkbox" name={`net_${network}`} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <NetDot network={network} />
        <b>{cfg.label}</b>
        <span className="muted small">Formatos: {Object.values(cfg.formats).map((f) => f.label).join(", ")}</span>
      </label>
      {/* Escondidos (não desativados): se a pessoa desmarcar sem querer e marcar de novo, o que digitou continua lá. */}
      <div className="grid2" hidden={!on} style={{ marginTop: 12 }}>
        <div className="col">
          <label className="f" htmlFor={`acc_${network}`}>Nome da conta</label>
          <input id={`acc_${network}`} name={`acc_${network}`} type="text" placeholder={placeholders.acc} defaultValue={account} />
        </div>
        <div className="col">
          <label className="f" htmlFor={`url_${network}`}>Endereço do perfil</label>
          <input id={`url_${network}`} name={`url_${network}`} type="text" placeholder={placeholders.url} defaultValue={url} />
        </div>
      </div>
    </fieldset>
  );
}
