"use client";

import { useState } from "react";
import type { AssetAspect, AssetKind, SlideInput, VisualAsset } from "@/lib/editorial-types";

export default function VisualAssetEditor({
  itemId,
  initialAssets,
}: {
  itemId: string;
  initialAssets: VisualAsset[];
}) {
  const [assets, setAssets] = useState<VisualAsset[]>(initialAssets);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function createAsset(kind: AssetKind) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/items/${itemId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: kind === "carousel" ? "Carrossel" : "Imagem estática",
          aspect: "4:5",
        }),
      });
      const j = (await res.json()) as { asset?: VisualAsset; error?: string };
      if (!res.ok || !j.asset) {
        setErr(j.error ?? "Não foi possível criar o ativo visual.");
        return;
      }
      setAssets((prev) => [...prev, j.asset!]);
    } catch {
      setErr("Falha ao criar ativo visual.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsset(asset: VisualAsset) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const slidesPayload: SlideInput[] = asset.slides.map((s) => ({
        id: s.id,
        headline: s.headline,
        body: s.body,
        cta: s.cta,
        visual_notes: s.visual_notes,
        extra: s.extra,
        source: s.source,
      }));
      const res = await fetch(`/api/editorial/assets/${asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: asset.title,
          aspect: asset.aspect,
          status: asset.status,
          slides: slidesPayload,
        }),
      });
      const j = (await res.json()) as { asset?: VisualAsset; error?: string };
      if (!res.ok || !j.asset) {
        setErr(j.error ?? "Não foi possível salvar os slides.");
        return;
      }
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? j.asset! : a)));
      setMsg("Ativo visual salvo.");
    } catch {
      setErr("Falha ao salvar ativo visual.");
    } finally {
      setBusy(false);
    }
  }

  async function linkSlideFile(assetId: string, slideId: string, driveUrl: string) {
    if (!driveUrl.trim()) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/editorial/assets/${assetId}/slides/${slideId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drive_url: driveUrl.trim() }),
      });
      const j = (await res.json()) as { slide?: VisualAsset["slides"][number]; warnings?: string[]; error?: string };
      if (!res.ok || !j.slide) {
        setErr(j.error ?? "Erro ao vincular arquivo do Drive ao slide.");
        return;
      }
      setAssets((prev) =>
        prev.map((a) =>
          a.id === assetId ? { ...a, slides: a.slides.map((s) => (s.id === slideId ? j.slide! : s)) } : a,
        ),
      );
      setMsg(j.warnings?.length ? `Arquivo vinculado. Aviso: ${j.warnings.join(" ")}` : "Arquivo vinculado ao slide.");
    } catch {
      setErr("Falha ao vincular arquivo ao slide.");
    } finally {
      setBusy(false);
    }
  }

  function updateSlideField(assetId: string, idx: number, field: "headline" | "body" | "cta" | "visual_notes", val: string) {
    setAssets((prev) =>
      prev.map((a) =>
        a.id === assetId
          ? { ...a, slides: a.slides.map((s, i) => (i === idx ? { ...s, [field]: val } : s)) }
          : a,
      ),
    );
  }

  function addSlide(assetId: string) {
    setAssets((prev) =>
      prev.map((a) =>
        a.id === assetId
          ? {
              ...a,
              slides: [
                ...a.slides,
                {
                  id: undefined as unknown as string,
                  position: a.slides.length,
                  headline: "",
                  body: "",
                  cta: "",
                  visual_notes: "",
                  extra: {},
                  source: "manual",
                  drive_url: "",
                  drive_file_id: null,
                  drive_meta: null,
                },
              ],
            }
          : a,
      ),
    );
  }

  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <h2>Ativos visuais (carrossel / imagem estática)</h2>
          <span className="muted small">Estruture os textos por slide e vincule o arquivo final no Google Drive.</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => createAsset("static")} disabled={busy}>
            + Imagem estática
          </button>
          <button type="button" className="btn primary" onClick={() => createAsset("carousel")} disabled={busy}>
            + Carrossel
          </button>
        </div>
      </div>

      {err && <p className="alert err" role="alert">{err}</p>}
      {msg && <p className="alert ok" role="status">{msg}</p>}

      {assets.length === 0 && <span className="muted small">Nenhum ativo visual criado para este conteúdo.</span>}

      {assets.map((asset) => (
        <div key={asset.id} className="col" style={{ gap: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div className="grid3" style={{ gap: 10 }}>
            <label className="f">
              <span>Título do ativo ({asset.kind === "carousel" ? "Carrossel" : "Estática"})</span>
              <input
                type="text"
                value={asset.title}
                onChange={(e) =>
                  setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, title: e.target.value } : a)))
                }
              />
            </label>
            <label className="f">
              <span>Proporção</span>
              <select
                value={asset.aspect}
                onChange={(e) =>
                  setAssets((prev) =>
                    prev.map((a) => (a.id === asset.id ? { ...a, aspect: e.target.value as AssetAspect } : a)),
                  )
                }
              >
                <option value="4:5">4:5 (Feed vertical)</option>
                <option value="1:1">1:1 (Quadrado)</option>
                <option value="9:16">9:16 (Stories/Reels)</option>
                <option value="16:9">16:9 (Horizontal)</option>
              </select>
            </label>
            <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
              {asset.kind === "carousel" && (
                <button type="button" className="btn" onClick={() => addSlide(asset.id)} disabled={busy}>
                  + Slide
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => saveAsset(asset)} disabled={busy}>
                Salvar slides
              </button>
            </div>
          </div>

          <div className="ed-slides">
            {asset.slides.map((s, idx) => (
              <div key={s.id ?? `new-${idx}`} className="ed-slide">
                <div className="row between">
                  <strong>{idx === 0 ? "Slide 1 (Capa)" : `Slide ${idx + 1}`}</strong>
                  {s.drive_file_id && (
                    <span className="ed-badge-ready">Arquivo vinculado: {s.drive_meta?.name ?? s.drive_file_id}</span>
                  )}
                </div>
                <div className="grid2" style={{ gap: 10 }}>
                  <label className="f">
                    <span>Título / Headline</span>
                    <input
                      type="text"
                      value={s.headline}
                      onChange={(e) => updateSlideField(asset.id, idx, "headline", e.target.value)}
                    />
                  </label>
                  <label className="f">
                    <span>CTA / Rodapé</span>
                    <input
                      type="text"
                      value={s.cta}
                      onChange={(e) => updateSlideField(asset.id, idx, "cta", e.target.value)}
                    />
                  </label>
                </div>
                <label className="f">
                  <span>Texto do slide</span>
                  <textarea
                    rows={2}
                    value={s.body}
                    onChange={(e) => updateSlideField(asset.id, idx, "body", e.target.value)}
                  />
                </label>
                <label className="f">
                  <span>Direção de arte / notas visuais</span>
                  <input
                    type="text"
                    value={s.visual_notes}
                    onChange={(e) => updateSlideField(asset.id, idx, "visual_notes", e.target.value)}
                  />
                </label>
                {s.id && (
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      type="text"
                      defaultValue={s.drive_url}
                      placeholder="Link do arquivo de imagem no Google Drive..."
                      id={`slide-url-${s.id}`}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        const el = document.getElementById(`slide-url-${s.id}`) as HTMLInputElement | null;
                        if (el) linkSlideFile(asset.id, s.id, el.value);
                      }}
                    >
                      Vincular Drive
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
