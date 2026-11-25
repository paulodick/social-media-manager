"use client";

import { useState } from "react";
import type { ContentItem } from "@/lib/editorial-types";

type DriveFileEntry = {
  id: string;
  name: string;
  mimeType: string;
};

type DriveCutFolderEntry = {
  folder_id: string;
  folder_name: string;
  path?: string[];
  docs?: DriveFileEntry[];
  video: DriveFileEntry | null;
  cover: DriveFileEntry | null;
  doc: DriveFileEntry | null;
  extra_files: DriveFileEntry[];
  skip_video_transcription: boolean;
  detected_guest: string;
  detected_topic: string;
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
  const [cutFolders, setCutFolders] = useState<DriveCutFolderEntry[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<DriveFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [manualJson, setManualJson] = useState("");
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadDrive() {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/drive/files`);
      const j = (await res.json()) as {
        cut_folders?: DriveCutFolderEntry[];
        files?: DriveFileEntry[];
        next_page_token?: string | null;
        folders_truncated?: boolean;
        folders_limit?: number;
        error?: string;
      };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível listar a pasta do Drive.");
        return;
      }
      const nextCuts = j.cut_folders ?? [];
      const nextFiles = j.files ?? [];
      setCutFolders(nextCuts);
      setFiles(nextFiles);
      setNextPage(j.next_page_token ?? null);
      setSelectedFolders(new Set());
      setSelected(new Set());
      if (!nextCuts.length && !nextFiles.length) {
        setMsg("Nenhuma pasta de corte nem arquivo de mídia encontrado na pasta deste cliente.");
      } else if (nextCuts.length > 0) {
        setMsg(
          `${nextCuts.length} pasta(s) de corte agrupadas (cada subpasta vira 1 item editorial usando o .doc como referência principal, sem transcrição pesada de vídeo).`,
        );
      }
      if (j.folders_truncated) {
        setErr(
          `A pasta do cliente tem mais de ${j.folders_limit ?? 300} subpastas: só as primeiras, em ordem alfabética, foram lidas. Importe estas e organize as demais em outra pasta.`,
        );
      }
    } catch {
      setErr("Falha ao consultar o Google Drive.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreFiles() {
    if (!nextPage) return;
    setLoadingMore(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/editorial/clients/${clientId}/drive/files?page_token=${encodeURIComponent(nextPage)}`,
      );
      const j = (await res.json()) as { files?: DriveFileEntry[]; next_page_token?: string | null; error?: string };
      if (!res.ok) {
        setErr(j.error ?? "Não foi possível carregar mais arquivos.");
        return;
      }
      const more = j.files ?? [];
      setFiles((prev) => [...prev, ...more.filter((f) => !prev.some((p) => p.id === f.id))]);
      setNextPage(j.next_page_token ?? null);
    } catch {
      setErr("Falha ao consultar o Google Drive.");
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleFolder(id: string) {
    const next = new Set(selectedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFolders(next);
  }

  function selectAllFolders() {
    if (selectedFolders.size === cutFolders.length) {
      setSelectedFolders(new Set());
    } else {
      setSelectedFolders(new Set(cutFolders.map((c) => c.folder_id)));
    }
  }

  function toggleFile(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const totalSelected = selectedFolders.size + selected.size;

  async function importSelected() {
    if (!totalSelected) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/clients/${clientId}/items/import-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cut_folders: Array.from(selectedFolders).map((folderId) => {
            const cf = cutFolders.find((x) => x.folder_id === folderId);
            return { folder_id: folderId, folder_name: cf?.folder_name };
          }),
          files: Array.from(selected).map((id) => {
            const f = files.find((x) => x.id === id);
            return { drive_file_id: id, title: f?.name.replace(/\.[^.]+$/, "") };
          }),
        }),
      });
      const j = (await res.json()) as {
        created?: ContentItem[];
        skipped_duplicates?: string[];
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) {
        setErr(j.error ?? "Erro ao importar itens do Drive.");
        return;
      }
      const created = j.created ?? [];
      if (created.length) onImported(created);
      setSelectedFolders(new Set());
      setSelected(new Set());
      const warnText = j.warnings?.length ? ` Avisos: ${j.warnings.join(" ")}` : "";
      setMsg(
        `Importados: ${created.length}. Já cadastrados (ignorados): ${(j.skipped_duplicates ?? []).length}.${warnText}`,
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
        setMsg(`${j.applied ?? j.items.length} corte(s)/item(ns) classificados por pilar, convidado, assunto, capa e legenda base.`);
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
          <h2>2. Absorção de cortes e acervo (Google Drive)</h2>
          <span className="muted small">
            Subpastas com vídeo + capa + <code>.doc</code> são agrupadas em <strong>1 único corte editorial</strong>, usando o <code>.doc</code> como referência principal para economizar tempo e cota do Gemini.
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={loadDrive} disabled={!hasDriveFolder || loading}>
            {loading ? "Escaneando Drive..." : "Escanear pasta no Drive"}
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

      {cutFolders.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <div className="row between">
            <span className="small" style={{ fontWeight: 600 }}>
              Pastas de corte encontradas ({cutFolders.length})
            </span>
            <button type="button" className="btn" onClick={selectAllFolders} disabled={busy}>
              {selectedFolders.size === cutFolders.length ? "Desmarcar todos" : "Selecionar todos os cortes"}
            </button>
          </div>
          <div className="ed-drive-grid">
            {cutFolders.map((cf) => {
              const on = selectedFolders.has(cf.folder_id);
              return (
                <label key={cf.folder_id} className={`ed-drive-file ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleFolder(cf.folder_id)} />
                  <div className="col" style={{ gap: 4, minWidth: 0 }}>
                    {cf.path && cf.path.length > 0 && (
                      <span className="muted small" style={{ wordBreak: "break-word" }}>{cf.path.join(" / ")}</span>
                    )}
                    <span className="small" style={{ fontWeight: 600, wordBreak: "break-word" }}>
                      {cf.folder_name}
                    </span>
                    {(cf.detected_guest || cf.detected_topic) && (
                      <span className="muted small">
                        {cf.detected_guest ? `Convidado: ${cf.detected_guest}` : ""}
                        {cf.detected_guest && cf.detected_topic ? " · " : ""}
                        {cf.detected_topic ? `Assunto: ${cf.detected_topic}` : ""}
                      </span>
                    )}
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {(cf.docs?.length ? cf.docs : cf.doc ? [cf.doc] : []).map((d) => (
                        <span key={d.id} className="ed-badge-ready">Texto: {d.name}</span>
                      ))}
                      {cf.video && <span className="ed-badge-fmt">Vídeo: {cf.video.name}</span>}
                      {cf.cover && <span className="ed-badge-fmt">Capa: {cf.cover.name}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            Arquivos avulsos na raiz ({files.length})
          </span>
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
          {nextPage && (
            <div>
              <button type="button" className="btn" onClick={loadMoreFiles} disabled={loadingMore}>
                {loadingMore ? "Carregando…" : "Carregar mais arquivos"}
              </button>
            </div>
          )}
        </div>
      )}

      {totalSelected > 0 && (
        <div>
          <button type="button" className="btn primary" onClick={importSelected} disabled={busy}>
            {busy ? "Importando e lendo .doc..." : `Importar ${totalSelected} selecionado(s) como Pronto`}
          </button>
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
