"use client";

import { useState } from "react";
import type { ContentItem } from "@/lib/editorial-types";

type DriveFileEntry = {
  id: string;
  name: string;
  mimeType: string;
  preview_url: string;
};

export default function DriveImportPanel({
  clientId,
  hasDriveFolder,
  unclassifiedItems,
  onImported,
  onClassified,
}: {
  clientId: string;
  hasDriveFolder: boolean;
  unclassifiedItems: ContentItem[];
  onImported: (items: ContentItem[]) => void;
  onClassified: (items: ContentItem[]) => void;
}) {
  const [files, setFiles] = useState<DriveFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [manualJson, setManualJson] = useState("");

  async function loadDrive() {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/drive/files`);
      const j = (await res.json()) as { files?: DriveFileEntry[]; error?: string };
      if (!res.ok || !j.files) {
        setErr(j.error ?? "Não foi possível listar a pasta do Drive.");
        return;
      }
      setFiles(j.files);
      if (!j.files.length) setMsg("Nenhuma imagem ou vídeo encontrado na pasta raiz deste cliente.");
    } catch {
      setErr("Falha ao consultar o Google Drive.");
    } finally {
      setLoading(false);
    }
  }

  function toggleFile(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function importSelected() {
    if (!selected.size) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/items/import-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: Array.from(selected).map((id) => {
            const f = files.find((x) => x.id === id);
            return { drive_file_id: id, title: f?.name.replace(/\.[^.]+$/, "") };
          }),
        }),
      });
      const j = (await res.json()) as { created?: ContentItem[]; skipped_duplicates?: string[]; error?: string };
      if (!res.ok) {
        setErr(j.error ?? "Erro ao importar arquivos.");
        return;
      }
      const created = j.created ?? [];
      if (created.length) onImported(created);
      setSelected(new Set());
      setMsg(
        `Importados: ${created.length}. Já cadastrados (ignorados): ${(j.skipped_duplicates ?? []).length}.`,
      );
    } catch {
      setErr("Falha de conexão ao importar arquivos.");
    } finally {
      setBusy(false);
    }
  }

  async function runClassify(mode: "ai" | "prompt_only", useManual = false) {
    if (!unclassifiedItems.length) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/items/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_ids: unclassifiedItems.slice(0, 30).map((i) => i.id),
          mode,
          manual_json: useManual ? manualJson : undefined,
        }),
      });
      const j = (await res.json()) as { prompt?: string; applied?: number; items?: ContentItem[]; error?: string };
      if (j.prompt) setPrompt(j.prompt);
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível classificar os itens.");
        return;
      }
      if (j.items?.length) {
        onClassified(j.items);
        setManualJson("");
        setMsg(`${j.applied ?? j.items.length} itens classificados por pilar e tema.`);
      } else {
        setMsg("Pedido para a IA gerado abaixo. Copie, cole no seu Claude/Gemini e depois cole o JSON de retorno.");
      }
    } catch {
      setErr("Falha de conexão ao classificar itens.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <h2>2. Absorção de conteúdo existente (Google Drive)</h2>
          <span className="muted small">
            Importe vídeos/artes já prontos como <strong>Pronto (acervo)</strong> e classifique por pilar para evitar repetição.
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={loadDrive} disabled={!hasDriveFolder || loading}>
            {loading ? "Lendo Drive..." : "Buscar arquivos no Drive"}
          </button>
          {unclassifiedItems.length > 0 && (
            <button type="button" className="btn primary" onClick={() => runClassify("ai")} disabled={busy}>
              Classificar {unclassifiedItems.length} sem pilar
            </button>
          )}
        </div>
      </div>

      {!hasDriveFolder && (
        <p className="alert warn">Configure a pasta do Google Drive do cliente em &ldquo;Cadastro e redes&rdquo; para importar arquivos.</p>
      )}
      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      {files.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <div className="ed-drive-grid">
            {files.map((f) => {
              const on = selected.has(f.id);
              return (
                <label key={f.id} className={`ed-drive-file ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleFile(f.id)} />
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small" style={{ fontWeight: 600, wordBreak: "break-word" }}>{f.name}</span>
                    <span className="muted small">{f.mimeType}</span>
                  </div>
                </label>
              );
            })}
          </div>
          <div>
            <button type="button" className="btn primary" onClick={importSelected} disabled={!selected.size || busy}>
              Importar {selected.size} selecionado(s) como Pronto
            </button>
          </div>
        </div>
      )}

      {prompt && (
        <div className="col" style={{ gap: 8 }}>
          <label className="f">
            <span>Pedido estruturado para a IA (copiar e colar)</span>
            <textarea rows={5} readOnly value={prompt} />
          </label>
          <label className="f">
            <span>Colar JSON retornado pela IA</span>
            <textarea
              rows={4}
              value={manualJson}
              onChange={(e) => setManualJson(e.target.value)}
              placeholder='{"classifications":[...]}'
            />
          </label>
          <div>
            <button
              type="button"
              className="btn dark"
              onClick={() => runClassify("prompt_only", true)}
              disabled={!manualJson.trim() || busy}
            >
              Aplicar classificação do JSON
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
