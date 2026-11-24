import Link from "next/link";
import { NETWORK_IDS } from "@/config/networks";
import { saveClient } from "@/lib/actions";
import type { Client, ClientNetwork } from "@/lib/queries";
import { serviceAccountEmail } from "@/lib/drive";
import { getDriveRoot } from "@/lib/drive-root";
import AutoTextarea from "./AutoTextarea";
import ClientNetworkField from "./ClientNetworkField";
import DriveFolderField from "./DriveFolderField";
import SubmitButton from "./SubmitButton";
import { ClientAvatar } from "./ui";

const PH: Record<string, { acc: string; url: string }> = {
  instagram: { acc: "Nome do perfil", url: "https://www.instagram.com/…" },
  facebook: { acc: "Nome da página", url: "https://www.facebook.com/…" },
  linkedin: { acc: "Nome da página", url: "https://www.linkedin.com/company/…" },
  tiktok: { acc: "Nome do perfil", url: "https://www.tiktok.com/@…" },
  kwai: { acc: "Nome do perfil", url: "https://www.kwai.com/…" },
  youtube: { acc: "Nome do canal", url: "https://www.youtube.com/@…" },
};

export default async function ClientForm({ client, networks }: { client?: Client; networks?: ClientNetwork[] }) {
  const byNet = new Map((networks ?? []).map((n) => [n.network, n]));
  const email = serviceAccountEmail();
  const rootReady = !!(await getDriveRoot().catch(() => null));
  return (
    <form action={saveClient} className="col" style={{ gap: 20 }}>
      {client && <input type="hidden" name="id" value={client.id} />}

      <section className="card" aria-labelledby="dados">
        <h2 id="dados">Dados do cliente</h2>
        <div className="col">
          <label className="f" htmlFor="name">Nome</label>
          <DriveFolderField nameId="name" urlId="drive_folder_url" hasFolder={!!client?.drive_folder_url} rootReady={rootReady}>
            <input id="name" name="name" type="text" required defaultValue={client?.name ?? ""} style={{ flex: 1 }} />
          </DriveFolderField>
        </div>
        <div className="grid2">
          <div className="col">
            <label className="f" htmlFor="segment">Segmento</label>
            <input id="segment" name="segment" type="text" defaultValue={client?.segment ?? ""} />
          </div>
          <div className="col">
            <label className="f" htmlFor="site">Site</label>
            <input id="site" name="site" type="text" placeholder="https://" defaultValue={client?.site ?? ""} />
          </div>
        </div>
        <div className="col">
          <label className="f" htmlFor="tone">Tom de voz</label>
          <AutoTextarea id="tone" name="tone" rows={4} placeholder="Como o cliente fala com o público. Ex.: técnico, direto, sem exageros." defaultValue={client?.tone ?? ""} />
          <span className="muted small">Será usado na etapa de legendas com IA, junto com exemplos de posts aprovados.</span>
        </div>
        <div className="col">
          <label className="f" htmlFor="notes">Observações</label>
          <AutoTextarea id="notes" name="notes" rows={4} placeholder="Regras da marca, assuntos a evitar, contatos de aprovação." defaultValue={client?.notes ?? ""} />
        </div>
      </section>

      <section className="card" aria-labelledby="logo">
        <h2 id="logo">Logotipo</h2>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", gap: 16 }}>
          {client && <ClientAvatar client={client} size="lg" />}
          <div className="col" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <label className="f" htmlFor="logo_url">Link do arquivo do logotipo no Google Drive</label>
            <input
              id="logo_url"
              name="logo_url"
              type="text"
              placeholder="https://drive.google.com/file/d/…/view"
              defaultValue={client?.logo_file_id ? `https://drive.google.com/file/d/${client.logo_file_id}/view` : ""}
            />
            <span className="muted small" style={{ maxWidth: "70ch" }}>
              Use o arquivo da pasta <b>Logotipo</b> do cliente (PNG em alta definição, fundo transparente). O app guarda uma cópia
              reduzida só para mostrar na tela; o original continua no Drive e é o que você usa no Canva. Para trocar, cole outro link.
              Para tirar o logo, apague o link e salve.
            </span>
          </div>
          <aside
            className="col"
            aria-label="Tamanho recomendado do logotipo"
            style={{ flex: "0 1 280px", gap: 4, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }}
          >
            <b className="small">Tamanho recomendado</b>
            <span className="small">Quadrado, <b>1000 × 1000 px</b> (mínimo 512 × 512), PNG com fundo transparente.</span>
            <span className="muted small">
              Deixe uma margem de uns 15% ao redor do desenho: as redes cortam a foto do perfil em círculo e o texto das pontas some.
            </span>
          </aside>
        </div>
      </section>

      <section className="card" aria-labelledby="midia">
        <h2 id="midia">Mídia no Google Drive</h2>
        <div className="col">
          <label className="f" htmlFor="drive_folder_url">Link da pasta de mídia do cliente</label>
          <input id="drive_folder_url" name="drive_folder_url" type="text" placeholder="https://drive.google.com/drive/folders/…" defaultValue={client?.drive_folder_url ?? ""} />
        </div>
        <p className="muted small" style={{ maxWidth: "70ch" }}>
          Compartilhe a pasta, como Editor, com o e-mail de acesso do app (o app só lê arquivos e cria as pastas dos posts):{" "}
          <b style={{ color: "var(--ink)" }}>{email ?? "[configure a conta de serviço em Configurações]"}</b>.
        </p>
        <div className="col" style={{ padding: "14px 16px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }}>
          <b className="small">Organização das pastas dentro da pasta do cliente</b>
          <span className="small">Ano / Mês / Dia / Rede / Formato (criadas pelo app ao criar o post)</span>
          <span className="muted small">Exemplo: 2026 / 11 - Novembro / 20 / Instagram / Reels / 2026-11-20_1000_plantao-24h.mp4</span>
        </div>
      </section>

      <section className="card" aria-labelledby="redes">
        <div className="col">
          <h2 id="redes">Redes sociais</h2>
          <p className="muted small" style={{ maxWidth: "70ch" }}>
            Marque as redes do cliente e informe a conta e o endereço do perfil. Instagram e Facebook publicam pelo app depois de conectados (em "Editar cliente"); as demais redes seguem manuais.
          </p>
        </div>
        {NETWORK_IDS.map((n) => {
          const cur = byNet.get(n);
          return (
            <ClientNetworkField key={n} network={n} checked={!!cur} account={cur?.account_name ?? ""} url={cur?.profile_url ?? ""} placeholders={PH[n]} />
          );
        })}
      </section>

      <div className="savebar">
        <Link href={client ? `/clientes/${client.id}` : "/"} className="btn">Cancelar</Link>
        <SubmitButton className="btn primary" pendingLabel="Salvando…">Salvar cliente</SubmitButton>
      </div>
    </form>
  );
}
