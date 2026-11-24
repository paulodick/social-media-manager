import Link from "next/link";
import { NETWORKS, isNetwork } from "@/config/networks";
import type { Target } from "@/lib/queries";

function shortDay(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

function shortReason(t: Target): string {
  if (t.publish_state === "failed") {
    const err = t.publish_error.trim();
    if (!err) return "Falhou ao publicar";
    return err.length > 90 ? `Falhou: ${err.slice(0, 87)}…` : `Falhou: ${err}`;
  }
  if (t.auto_missed) return "Perdeu o horário";
  return "Precisa de atenção";
}

/** Faixa de alerta exibida no topo do Início e do Postar hoje quando há falhas ou horários perdidos. */
export default function ProblemsAlert({ items }: { items: Target[] }) {
  if (items.length === 0) return null;
  const heading =
    items.length === 1
      ? "1 publicação precisa de atenção"
      : `${items.length} publicações precisam de atenção`;

  return (
    <section className="alert err col" role="alert" aria-label={heading} style={{ gap: 8 }}>
      <strong>{heading}</strong>
      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((t) => {
          const netLabel = isNetwork(t.network) ? NETWORKS[t.network].label : t.network;
          const fmtLabel = isNetwork(t.network) ? NETWORKS[t.network].formats[t.format]?.label ?? t.format : t.format;
          return (
            <li key={t.id}>
              <Link href={`/clientes/${t.client_id}/dia/${t.day}#t-${t.id}`} style={{ textDecoration: "underline", fontWeight: 600 }}>
                {t.client_name} · {netLabel} ({fmtLabel}) · {shortDay(t.day)} às {t.time}
              </Link>
              {" — "}
              <span>{shortReason(t)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
