"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";
import { ClientAvatar } from "@/components/ui";

type C = { id: string; name: string; logo_v: number | null };

export default function Sidebar({ clients, due }: { clients: C[]; due: number }) {
  const path = usePathname();
  const on = (p: string, exact = false) => (exact ? path === p : path === p || path.startsWith(p + "/"));
  const [menu, setMenu] = useState(false);
  // No celular o menu completo (clientes, configurações, sair) abre numa folha; fecha ao trocar de página ou com Esc.
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  const inClients = path.startsWith("/clientes") || on("/configuracoes");
  return (
    <>
    <header className="topbar"><b>Social Media Manager</b></header>
    <aside className="side">
      <div className="brand">
        <b>Social Media Manager</b>
        <span className="muted small">Painel de clientes</span>
      </div>
      <nav className="nav" aria-label="Principal">
        <Link href="/" className={on("/", true) ? "on" : ""}>Início</Link>
        <Link href="/postar-hoje" className={on("/postar-hoje") ? "on" : ""}>
          Postar hoje {due > 0 && <span className="badge" aria-label={`${due} para postar`}>{due}</span>}
        </Link>
        <Link href="/posts/novo" className={on("/posts/novo") ? "on" : ""}>Novo post</Link>
      </nav>
      <nav className="nav" aria-label="Clientes">
        <span className="label">Clientes</span>
        {clients.map((c) => (
          <Link key={c.id} href={`/clientes/${c.id}`} className={on(`/clientes/${c.id}`) ? "on" : ""}>
            <span className="who">
              <ClientAvatar client={c} size="sm" />
              {c.name}
            </span>
          </Link>
        ))}
        <Link href="/clientes/novo" className={on("/clientes/novo") ? "on" : ""}>+ Cadastrar cliente</Link>
      </nav>
      <nav className="nav" style={{ marginTop: "auto" }} aria-label="Conta">
        <Link href="/configuracoes" className={on("/configuracoes") ? "on" : ""}>Configurações</Link>
        <form action={logout}>
          <button type="submit">Sair</button>
        </form>
      </nav>
    </aside>

    <nav className="tabbar" aria-label="Menu do celular">
      <Link href="/" className={on("/", true) ? "on" : ""} aria-current={on("/", true) ? "page" : undefined}>
        <span className="ico" aria-hidden="true">⌂</span>Início
      </Link>
      <Link href="/postar-hoje" className={on("/postar-hoje") ? "on" : ""} aria-current={on("/postar-hoje") ? "page" : undefined}>
        <span className="ico" aria-hidden="true">✓{due > 0 && <i className="dot" />}</span>
        Postar hoje{due > 0 && <span className="sr"> ({due} para postar)</span>}
      </Link>
      <Link href="/posts/novo" className={on("/posts/novo") ? "on" : ""} aria-current={on("/posts/novo") ? "page" : undefined}>
        <span className="ico" aria-hidden="true">＋</span>Novo post
      </Link>
      <button type="button" className={menu || inClients ? "on" : ""} aria-expanded={menu} aria-controls="folha-menu" onClick={() => setMenu((v) => !v)}>
        <span className="ico" aria-hidden="true">☰</span>Menu
      </button>
    </nav>
    {menu && (
      <div className="sheet-back" onClick={() => setMenu(false)}>
        <div id="folha-menu" className="sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
          <nav className="nav" aria-label="Clientes (celular)">
            <span className="label">Clientes</span>
            {clients.map((c) => (
              <Link key={c.id} href={`/clientes/${c.id}`} className={on(`/clientes/${c.id}`) ? "on" : ""}>
                <span className="who"><ClientAvatar client={c} size="sm" />{c.name}</span>
              </Link>
            ))}
            <Link href="/clientes/novo" className={on("/clientes/novo") ? "on" : ""}>+ Cadastrar cliente</Link>
          </nav>
          <nav className="nav" aria-label="Conta (celular)">
            <Link href="/configuracoes" className={on("/configuracoes") ? "on" : ""}>Configurações</Link>
            <form action={logout}><button type="submit">Sair</button></form>
          </nav>
          <button type="button" className="btn" onClick={() => setMenu(false)}>Fechar</button>
        </div>
      </div>
    )}
    </>
  );
}
