"use client";

import BrandLogo from "./BrandLogo";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";
import { ClientAvatar } from "@/components/ui";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

type C = { id: string; name: string; logo_v: number | null };

export default function Sidebar({ clients, due, problems = 0 }: { clients: C[]; due: number; problems?: number }) {
  const path = usePathname();
  const on = (p: string, exact = false) => (exact ? path === p : path === p || path.startsWith(p + "/"));
  const [menu, setMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  // No celular o menu completo (clientes, configurações, sair) abre numa folha; fecha ao trocar de página ou com Esc.
  useEffect(() => setMenu(false), [path]);
  useDialogFocusTrap({ open: menu, onClose: closeMenu, containerRef: sheetRef, returnFocusRef: menuBtnRef });
  const inClients = path.startsWith("/clientes") || on("/configuracoes");
  const problemLabel =
    problems === 1 ? "1 publicação precisa de atenção" : `${problems} publicações precisam de atenção`;
  return (
    <>
    <header className="topbar"><BrandLogo size={28} /><b>Social Media Manager</b></header>
    <aside className="side">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-horizontal.svg" alt="Social Media Manager" className="brand-lockup" />
        <span className="muted small">Painel de clientes</span>
      </div>
      <nav className="nav" aria-label="Principal">
        <Link href="/" className={on("/", true) ? "on" : ""}>Início</Link>
        <Link href="/postar-hoje" className={on("/postar-hoje") ? "on" : ""}>
          <span>Postar hoje</span>
          {(due > 0 || problems > 0) && (
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              {problems > 0 && (
                <span className="badge err" title={problemLabel} aria-label={problemLabel}>
                  {problems}
                </span>
              )}
              {due > 0 && <span className="badge" aria-label={`${due} para postar`}>{due}</span>}
            </span>
          )}
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
        <span className="ico" aria-hidden="true">
          {problems > 0 && <i className="dot err" />}
          ✓
          {due > 0 && <i className="dot" />}
        </span>
        Postar hoje
        {problems > 0 && <span className="sr"> ({problemLabel})</span>}
        {due > 0 && <span className="sr"> ({due} para postar)</span>}
      </Link>
      <Link href="/posts/novo" className={on("/posts/novo") ? "on" : ""} aria-current={on("/posts/novo") ? "page" : undefined}>
        <span className="ico" aria-hidden="true">＋</span>Novo post
      </Link>
      <button ref={menuBtnRef} type="button" className={menu || inClients ? "on" : ""} aria-expanded={menu} aria-controls="folha-menu" onClick={() => setMenu((v) => !v)}>
        <span className="ico" aria-hidden="true">☰</span>Menu
      </button>
    </nav>
    {menu && (
      <div className="sheet-back" onClick={closeMenu}>
        <div ref={sheetRef} id="folha-menu" className="sheet" role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
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
          <button type="button" className="btn" onClick={closeMenu}>Fechar</button>
        </div>
      </div>
    )}
    </>
  );
}
