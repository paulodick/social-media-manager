import Sidebar from "@/components/Sidebar";
import { requireAuth } from "@/lib/auth";
import { todaySP } from "@/lib/dates";
import { countDue, listClients } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const [clients, due] = await Promise.all([listClients(), countDue(todaySP())]);
  return (
    <div className="shell">
      <Sidebar clients={clients.map((c) => ({ id: c.id, name: c.name }))} due={due} />
      {children}
    </div>
  );
}
