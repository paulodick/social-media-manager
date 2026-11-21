"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { createClientFolder } from "@/lib/actions";

/**
 * Campo do nome do cliente com o botão "Criar diretório" à direita (o campo entra como `children`).
 * O botão cria no Drive a pasta do cliente (com a subpasta Logotipo), abre a pasta em outra aba para a pessoa
 * colar o logotipo e preenche o campo "Link da pasta de mídia" do formulário. Se o cliente já tem pasta, só abre.
 */
export default function DriveFolderField({
  children,
  nameId,
  urlId,
  hasFolder,
  rootReady,
}: {
  children: ReactNode;
  nameId: string;
  urlId: string;
  hasFolder: boolean;
  rootReady: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(hasFolder);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; href?: string } | null>(null);

  async function run() {
    const name = (document.getElementById(nameId) as HTMLInputElement | null)?.value.trim() ?? "";
    const urlEl = document.getElementById(urlId) as HTMLInputElement | null;
    const existing = urlEl?.value.trim() ?? "";
    // Já tem pasta no formulário: só abre, sem criar outra.
    if (existing) {
      window.open(existing, "_blank", "noopener,noreferrer");
      return;
    }
    if (!name) {
      setMsg({ kind: "err", text: "Digite o nome do cliente antes de criar o diretório." });
      return;
    }
    // A aba é aberta já no clique (senão o navegador bloqueia) e recebe o endereço quando a pasta ficar pronta.
    const win = window.open("about:blank", "_blank");
    setBusy(true);
    setMsg(null);
    try {
      const r = await createClientFolder({ name });
      if ("error" in r) {
        win?.close();
        setMsg({ kind: "err", text: `Não consegui criar o diretório: ${r.error}` });
        return;
      }
      if (urlEl) urlEl.value = r.url;
      setCreated(true);
      if (win) win.location.href = r.url;
      setMsg({
        kind: "ok",
        text: "Diretório criado no Drive. Cole o logotipo na pasta Logotipo e depois volte aqui para colar o link do arquivo.",
        href: r.url,
      });
    } catch {
      win?.close();
      setMsg({ kind: "err", text: "Não consegui falar com o Google Drive agora. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "stretch", gap: 10 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex" }}>{children}</div>
        <button type="button" className="btn" onClick={run} disabled={busy} aria-busy={busy} style={{ flex: "none" }}>
          {busy ? "Criando…" : created ? "Abrir diretório" : "Criar diretório"}
        </button>
      </div>
      {!rootReady && !created && (
        <span className="muted small">
          Para o botão funcionar, defina antes a pasta dos clientes em <Link href="/configuracoes" style={{ textDecoration: "underline" }}>Configurações</Link>.
        </span>
      )}
      {msg && (
        <span role={msg.kind === "err" ? "alert" : "status"} className="small" style={msg.kind === "err" ? { color: "var(--bad-ink)" } : { color: "var(--ink)" }}>
          {msg.text}{" "}
          {msg.href && (
            <a href={msg.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Abrir no Drive</a>
          )}
        </span>
      )}
    </>
  );
}
