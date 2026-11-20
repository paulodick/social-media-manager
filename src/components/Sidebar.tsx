"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";

type C = { id: string; name: string };

export default function Sidebar({ clients, due }: { clients: C[]; due: number }) {
  const path = usePathname();
  const on = (p: string, exact = false) => (exact ? path === p : path === p || path.startsWith(p + "/"));
  return (
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
            {c.name}
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
  );
}
