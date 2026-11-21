import Link from "next/link";
import { NETWORKS, STATUS_LABEL, isNetwork } from "@/config/networks";

export function NetDot({ network }: { network: string }) {
  const color = isNetwork(network) ? NETWORKS[network].color : "#8793a3";
  return <span className="dot" style={{ background: color }} aria-hidden="true" />;
}

export function NetChip({ network, format }: { network: string; format?: string }) {
  const cfg = isNetwork(network) ? NETWORKS[network] : null;
  const f = cfg && format ? cfg.formats[format]?.label : undefined;
  return (
    <span className="chip">
      <NetDot network={network} />
      {cfg?.label ?? network}
      {f ? ` · ${f}` : ""}
    </span>
  );
}

export function StatusPill({ status, late }: { status: string; late?: boolean }) {
  if (late) return <span className="pill late">Atrasado</span>;
  return <span className={`pill ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Initials({ name }: { name: string }) {
  const i = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <span className="avatar">{i || "?"}</span>;
}

export function Flash({ erro, ok, aviso }: { erro?: string; ok?: string; aviso?: string }) {
  if (erro) return <p className="alert err" role="alert">{erro}</p>;
  if (aviso) return <p className="alert warn" role="status">{aviso}</p>;
  if (ok) return <p className="alert ok" role="status">{ok}</p>;
  return null;
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="muted small">{children}</Link>;
}
