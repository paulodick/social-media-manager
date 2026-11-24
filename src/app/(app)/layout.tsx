import Sidebar from "@/components/Sidebar";
import { requireAuth } from "@/lib/auth";
import { todaySP } from "@/lib/dates";
import { countDue, countProblems, listClients } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const [clients, due, problems] = await Promise.all([listClients(), countDue(todaySP()), countProblems()]);
  return (
    <div className="shell">
      <a href="#conteudo" className="skip">Pular para o conteúdo</a>
      <Sidebar clients={clients.map((c) => ({ id: c.id, name: c.name, logo_v: c.logo_v }))} due={due} problems={problems} />
      {children}
    </div>
  );
}
