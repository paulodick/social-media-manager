import { NETWORKS, type NetworkId } from "@/config/networks";
import { cutCaption, type MediaMeta } from "@/lib/checks";

// Prévias aproximadas de cada rede. Os pontos de corte vêm de src/config/networks.ts.
// São só uma referência visual: a tela real de cada rede muda com frequência.

export type PreviewProps = {
  network: NetworkId;
  format: string;
  day: string;
  time: string;
  fileId: string | null;
  meta: MediaMeta | null;
  /** Miniatura (capa) do vídeo, nos formatos que têm. */
  thumbFileId?: string | null;
  thumbMeta?: MediaMeta | null;
  title: string;
  profile: { name: string; handle: string };
  caption: string;
};

const initials = (name: string) => name.slice(0, 2).toUpperCase();

function Media({ fileId, meta }: { fileId: string | null; meta: MediaMeta | null }) {
  if (!fileId || !meta || meta.error) return <span>Aqui aparece a mídia do Drive</span>;
  const src = `/api/media/${fileId}`;
  if (meta.mimeType?.startsWith("video/")) {
    return <video src={src} controls muted playsInline preload="metadata" />;
  }
  if (meta.mimeType?.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" />;
  }
  return <span>{meta.name ?? "Arquivo"} (sem prévia para este tipo)</span>;
}

// ---------- vídeo vertical (Reels, Stories, TikTok, Kwai, Shorts) ----------

type Skin = {
  /** Nome da prévia, para leitores de tela. */
  aria: string;
  topLeft?: string;
  topRight?: string;
  /** Abas "Seguindo | Para você" no topo (TikTok). */
  tabs?: boolean;
  /** Botões na lateral direita. */
  rail: { icon: string; text: string }[];
  /** Foto do perfil com "+" na lateral, em vez de ao lado do nome (TikTok). */
  avatarOnRail?: boolean;
  /** Texto do botão ao lado do nome do perfil. */
  follow?: string;
  /** Linha com o som, abaixo da legenda. */
  sound?: boolean;
  /** Mostra o título do post antes da legenda (Shorts). */
  showTitle?: boolean;
  /** Stories: caixa "Enviar mensagem" no rodapé, sem botões na lateral. */
  reply?: boolean;
};

const SKINS: Record<string, Skin> = {
  "instagram:reels": {
    aria: "Instagram Reels",
    topLeft: "Reels",
    topRight: "◎",
    rail: [{ icon: "♡", text: "Curtir" }, { icon: "💬", text: "Comentar" }, { icon: "➤", text: "Enviar" }],
    follow: "Seguir",
  },
  "instagram:stories": {
    aria: "Instagram Stories",
    topLeft: "Stories",
    topRight: "◎",
    rail: [{ icon: "♡", text: "Curtir" }, { icon: "💬", text: "Comentar" }, { icon: "➤", text: "Enviar" }],
    follow: "Seguir",
  },
  "facebook:reels": {
    aria: "Facebook Reels",
    topLeft: "Reels",
    rail: [{ icon: "👍", text: "Gostei" }, { icon: "💬", text: "Comentar" }, { icon: "➤", text: "Compartilhar" }],
    follow: "Seguir",
  },
  "facebook:stories": {
    aria: "Facebook Stories",
    topLeft: "Stories",
    rail: [],
    reply: true,
  },
  "tiktok:video": {
    aria: "TikTok",
    tabs: true,
    rail: [{ icon: "♡", text: "Curtir" }, { icon: "💬", text: "Comentar" }, { icon: "🔖", text: "Salvar" }, { icon: "➤", text: "Enviar" }],
    avatarOnRail: true,
    sound: true,
  },
  "tiktok:fotos": {
    aria: "TikTok Fotos",
    tabs: true,
    rail: [{ icon: "♡", text: "Curtir" }, { icon: "💬", text: "Comentar" }, { icon: "🔖", text: "Salvar" }, { icon: "➤", text: "Enviar" }],
    avatarOnRail: true,
    sound: true,
  },
  "kwai:video": {
    aria: "Kwai",
    topLeft: "Kwai",
    rail: [{ icon: "♡", text: "Curtir" }, { icon: "💬", text: "Comentar" }, { icon: "➤", text: "Enviar" }],
    follow: "Seguir",
    sound: true,
  },
  "youtube:shorts": {
    aria: "YouTube Shorts",
    topLeft: "Shorts",
    rail: [{ icon: "👍", text: "Gostei" }, { icon: "👎", text: "Não gostei" }, { icon: "💬", text: "Comentar" }, { icon: "➤", text: "Compartilhar" }],
    follow: "Inscrever-se",
    showTitle: true,
  },
};

const overlay = { position: "absolute", pointerEvents: "none", color: "#fff" } as const;

function Vertical({ p, skin }: { p: PreviewProps; skin: Skin }) {
  const cfg = NETWORKS[p.network];
  const cut = cfg.formats[p.format]?.cutAt ?? cfg.cutAt;
  const long = p.caption.length > cut;
  // Rótulos longos na lateral ("Compartilhar", "Não gostei") pedem mais folga para não cobrir o texto.
  const railRight = Math.max(0, ...skin.rail.map((r) => r.text.length)) > 9 ? 86 : 62;
  const avatar = (size: number, fontSize: number) => (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "#fff", color: "#101828", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize, flex: "none", textShadow: "none" }}>
      {initials(p.profile.name)}
    </span>
  );
  return (
    <div className="phone" role="img" aria-label={`Prévia do ${skin.aria}`}>
      <div className="media-box"><Media fileId={p.fileId} meta={p.meta} /></div>

      {skin.tabs ? (
        <div style={{ ...overlay, top: 14, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16, fontSize: 14, textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
          <span style={{ opacity: 0.7 }}>Seguindo</span><b>Para você</b>
        </div>
      ) : (skin.topLeft || skin.topRight) ? (
        <div style={{ ...overlay, top: 14, left: 16, right: 16, display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 16 }}>
          <span>{skin.topLeft}</span><span aria-hidden="true">{skin.topRight}</span>
        </div>
      ) : null}

      {skin.rail.length > 0 && (
        <div style={{ ...overlay, right: 10, bottom: 120, display: "flex", flexDirection: "column", alignItems: "center", gap: skin.rail.length > 3 ? 14 : 18, fontSize: 11, fontWeight: 600 }}>
          {skin.avatarOnRail && (
            <span style={{ position: "relative", marginBottom: 6 }}>
              {avatar(38, 12)}
              <span style={{ position: "absolute", left: "50%", bottom: -8, transform: "translateX(-50%)", width: 18, height: 18, borderRadius: "50%", background: "#fe2c55", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, lineHeight: 1 }} aria-hidden="true">+</span>
            </span>
          )}
          {skin.rail.map((r) => (
            <span key={r.text} style={{ textAlign: "center" }}>
              <span style={{ display: "block", fontSize: 22 }} aria-hidden="true">{r.icon}</span>{r.text}
            </span>
          ))}
        </div>
      )}

      <div style={{ ...overlay, left: 14, right: skin.rail.length > 0 ? railRight : 14, bottom: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.35, textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
        {skin.reply ? (
          <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "center" }}>
            {avatar(30, 11)}
            <b>{p.profile.name}</b>
            <span style={{ opacity: 0.8, fontSize: 12 }}>{p.time}</span>
          </div>
        ) : !skin.avatarOnRail ? (
          <div className="row" style={{ gap: 8, flexWrap: (skin.follow?.length ?? 0) > 7 ? "wrap" : "nowrap" }}>
            {avatar(30, 11)}
            <b style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.profile.handle}</b>
            {skin.follow && <span style={{ border: "1px solid #fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>{skin.follow}</span>}
          </div>
        ) : (
          <b>{p.profile.handle}</b>
        )}
        {skin.showTitle && <b>{p.title || "Sem título"}</b>}
        {p.caption.trim() && (
          <span>{cutCaption(p.caption, cut)} {long && <b style={{ opacity: 0.85 }}>mais</b>}</span>
        )}
        {skin.sound && <span style={{ fontSize: 12, opacity: 0.9 }}>♪ som original · {p.profile.handle}</span>}
        {skin.reply && (
          <span style={{ border: "1px solid rgba(255,255,255,.7)", borderRadius: 20, padding: "7px 14px", fontSize: 12.5, textShadow: "none" }}>Enviar mensagem…</span>
        )}
      </div>
    </div>
  );
}

// ---------- feed (Instagram, Facebook, LinkedIn) ----------

function Feed({ p, kind }: { p: PreviewProps; kind: "linkedin" | "instagram" | "facebook" }) {
  const cut = NETWORKS[kind].cutAt + (kind === "instagram" ? 15 : 40);
  const more = kind === "linkedin" ? "…ver mais" : "… mais";
  return (
    <div className="phone light" role="img" aria-label={`Prévia do ${NETWORKS[kind].label}`}>
      <div style={{ background: "#fff", padding: "12px 14px", borderBottom: "1px solid var(--line)", fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ color: NETWORKS[kind].color, fontSize: 15 }}>{NETWORKS[kind].label}</b>
      </div>
      <div style={{ marginTop: 8, background: "#fff", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
        <div className="row" style={{ gap: 10, padding: "12px 14px 8px", flexWrap: "nowrap" }}>
          <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>
            {initials(p.profile.name)}
          </span>
          <div className="col" style={{ gap: 0, lineHeight: 1.25 }}>
            <b style={{ fontSize: 13 }}>{kind === "instagram" ? p.profile.handle : p.profile.name}</b>
            <span className="muted" style={{ fontSize: 11 }}>{p.day.split("-").reverse().join("/")} às {p.time}</span>
          </div>
        </div>
        {kind === "linkedin" && (
          <p style={{ padding: "0 14px 8px", fontSize: 12.5, lineHeight: 1.4 }}>
            {cutCaption(p.caption, cut)} {p.caption.length > cut && <span className="muted">{more}</span>}
          </p>
        )}
        <div className="li-media"><Media fileId={p.fileId} meta={p.meta} /></div>
        {kind !== "linkedin" && (
          <p style={{ padding: "8px 14px", fontSize: 12.5, lineHeight: 1.4 }}>
            <b>{p.profile.handle}</b> {cutCaption(p.caption, cut)} {p.caption.length > cut && <span className="muted">{more}</span>}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", fontSize: 11.5, fontWeight: 600, color: "#3b4757", borderTop: "1px solid var(--line)" }}>
          <span>Gostei</span><span>Comentar</span><span>Compartilhar</span><span>Enviar</span>
        </div>
      </div>
    </div>
  );
}

// ---------- YouTube vídeo longo ----------

function mmss(ms: number | undefined): string {
  if (!ms) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Cartão do vídeo na lista (início, busca, inscrições): é onde a miniatura e o título decidem o clique. */
function YouTubeCard({ p }: { p: PreviewProps }) {
  const hasThumb = p.thumbFileId && p.thumbMeta && !p.thumbMeta.error && p.thumbMeta.mimeType?.startsWith("image/");
  return (
    <div className="yt-card" role="img" aria-label="Prévia da miniatura do YouTube na lista de vídeos">
      <div className="yt-thumb">
        {hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${p.thumbFileId}`} alt="" />
        ) : (
          <span>Aqui aparece a miniatura do Drive</span>
        )}
        <span className="yt-time">{mmss(p.meta?.durationMs)}</span>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "nowrap", alignItems: "flex-start", padding: "10px 4px 0" }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flex: "none" }}>
          {initials(p.profile.name)}
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <b className="yt-title">{p.title || "Sem título"}</b>
          <span className="muted" style={{ fontSize: 11.5 }}>{p.profile.name} · 0 visualizações · {p.day.split("-").reverse().join("/")}</span>
        </div>
      </div>
    </div>
  );
}

function YouTubeLong({ p }: { p: PreviewProps }) {
  const cut = NETWORKS.youtube.cutAt;
  const long = p.caption.length > cut;
  const pill = { border: "1px solid var(--line)", borderRadius: 16, padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#f2f2f2", flex: "none" } as const;
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 6 }}>
        <span className="muted small">Na lista do YouTube</span>
        <YouTubeCard p={p} />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="muted small">Na página do vídeo</span>
        <div className="phone light" role="img" aria-label="Prévia do YouTube vídeo longo">
          <div style={{ background: "#fff", padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center" }}>
            <b style={{ color: NETWORKS.youtube.color, fontSize: 15 }}>YouTube</b>
          </div>
          <div className="yt-player"><Media fileId={p.fileId} meta={p.meta} /></div>
          <div style={{ background: "#fff", flex: "1 1 auto", minHeight: 0, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            <b style={{ fontSize: 13.5, lineHeight: 1.3 }}>{p.title || "Sem título"}</b>
            <span className="muted" style={{ fontSize: 11 }}>{p.day.split("-").reverse().join("/")} às {p.time}</span>
            <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "center" }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, flex: "none" }}>
                {initials(p.profile.name)}
              </span>
              <b style={{ fontSize: 12, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.profile.name}</b>
              <span style={{ background: "#0f0f0f", color: "#fff", borderRadius: 16, padding: "5px 10px", fontSize: 11, fontWeight: 600, flex: "none" }}>Inscrever-se</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <span style={pill}>👍 Gostei</span><span style={pill}>➤ Compartilhar</span><span style={pill}>Salvar</span>
            </div>
            {p.caption.trim() && (
              <p style={{ background: "#f2f2f2", borderRadius: 10, padding: "8px 10px", fontSize: 12, lineHeight: 1.4 }}>
                {cutCaption(p.caption, cut)} {long && <b>…mais</b>}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- escolha da prévia ----------

export default function PostPreview(p: PreviewProps) {
  const skin = SKINS[`${p.network}:${p.format}`];
  if (skin) return <Vertical p={p} skin={skin} />;
  if (p.network === "youtube" && p.format === "longo") return <YouTubeLong p={p} />;
  if (p.network === "instagram" || p.network === "linkedin" || p.network === "facebook") return <Feed p={p} kind={p.network} />;
  return (
    <div className="generic-prev">
      <b>Prévia ainda não disponível para {NETWORKS[p.network].label} {NETWORKS[p.network].formats[p.format]?.label}.</b>
      <p className="muted small" style={{ marginTop: 6 }}>Texto como será publicado:</p>
      <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{p.caption || "(legenda vazia)"}</p>
    </div>
  );
}
