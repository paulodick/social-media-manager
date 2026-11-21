import Link from "next/link";
import { NETWORKS, NETWORK_IDS } from "@/config/networks";
import { saveClient } from "@/lib/actions";
import type { Client, ClientNetwork } from "@/lib/queries";
import { serviceAccountEmail } from "@/lib/drive";
import { ClientAvatar, NetDot } from "./ui";

const PH: Record<string, { acc: string; url: string }> = {
  instagram: { acc: "Nome do perfil", url: "https://www.instagram.com/…" },
  facebook: { acc: "Nome da página", url: "https://www.facebook.com/…" },
  linkedin: { acc: "Nome da página", url: "https://www.linkedin.com/company/…" },
  tiktok: { acc: "Nome do perfil", url: "https://www.tiktok.com/@…" },
  kwai: { acc: "Nome do perfil", url: "https://www.kwai.com/…" },
  youtube: { acc: "Nome do canal", url: "https://www.youtube.com/@…" },
};

export default function ClientForm({ client, networks }: { client?: Client; networks?: ClientNetwork[] }) {
  const byNet = new Map((networks ?? []).map((n) => [n.network, n]));
  const email = serviceAccountEmail();
  return (
    <form action={saveClient} className="col" style={{ gap: 20 }}>
      {client && <input type="hidden" name="id" value={client.id} />}

      <section className="card" aria-labelledby="dados">
        <h2 id="dados">Dados do cliente</h2>
        <div className="grid2">
          <div className="col">
            <label className="f" htmlFor="name">Nome</label>
            <input id="name" name="name" type="text" required defaultValue={client?.name ?? ""} />
          </div>
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
          <textarea id="tone" name="tone" rows={4} placeholder="Como o cliente fala com o público. Ex.: técnico, direto, sem exageros." defaultValue={client?.tone ?? ""} />
          <span className="muted small">Será usado na etapa de legendas com IA, junto com exemplos de posts aprovados.</span>
        </div>
        <div className="col">
          <label className="f" htmlFor="notes">Observações</label>
          <textarea id="notes" name="notes" rows={3} placeholder="Regras da marca, assuntos a evitar, contatos de aprovação." defaultValue={client?.notes ?? ""} />
        </div>
      </section>

      <section className="card" aria-labelledby="logo">
        <h2 id="logo">Logotipo</h2>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", gap: 16 }}>
          {client && <ClientAvatar client={client} size="lg" />}
          <div className="col" style={{ flex: 1 }}>
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
            Marque as redes do cliente e informe a conta e o endereço do perfil. A publicação é manual nesta versão.
          </p>
        </div>
        {NETWORK_IDS.map((n) => {
          const cfg = NETWORKS[n];
          const cur = byNet.get(n);
          return (
            <fieldset key={n} style={{ margin: 0, padding: 16, border: "1px solid var(--line)", borderRadius: 10, background: "var(--soft)" }}>
              <legend className="sr">{cfg.label}</legend>
              <label className="row" style={{ gap: 10, marginBottom: 12, cursor: "pointer" }}>
                <input type="checkbox" name={`net_${n}`} defaultChecked={!!cur} />
                <NetDot network={n} />
                <b>{cfg.label}</b>
                <span className="muted small">Formatos: {Object.values(cfg.formats).map((f) => f.label).join(", ")}</span>
              </label>
              <div className="grid2">
                <div className="col">
                  <label className="f" htmlFor={`acc_${n}`}>Nome da conta</label>
                  <input id={`acc_${n}`} name={`acc_${n}`} type="text" placeholder={PH[n].acc} defaultValue={cur?.account_name ?? ""} />
                </div>
                <div className="col">
                  <label className="f" htmlFor={`url_${n}`}>Endereço do perfil</label>
                  <input id={`url_${n}`} name={`url_${n}`} type="text" placeholder={PH[n].url} defaultValue={cur?.profile_url ?? ""} />
                </div>
              </div>
            </fieldset>
          );
        })}
      </section>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Link href={client ? `/clientes/${client.id}` : "/"} className="btn">Cancelar</Link>
        <button type="submit" className="btn primary">Salvar cliente</button>
      </div>
    </form>
  );
}
