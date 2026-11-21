// Servidor Meta de mentira para testes: registra tudo o que recebe em /_seen e simula os fluxos de publicação.
import http from "node:http";
import { pathToFileURL } from "node:url";

export function startMockMeta(PORT = 4020) {
const seen = [];
let n = 100;
const state = { containers: {}, pages: [{ id: "1111", name: "Best Medical (teste)", access_token: "PAGE_TOKEN_BM", instagram_business_account: { id: "17841400", username: "best_teste" } }] };
const json = (res, status, body) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes < 4096) chunks.push(c); }
  const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (path === "/_seen") return json(res, 200, seen);
  if (path === "/_reset") { seen.length = 0; return json(res, 200, {}); }
  let body = {}; if (req.headers["content-type"]?.includes("json")) { try { body = JSON.parse(raw); } catch {} }
  const form = req.headers["content-type"]?.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : {};
  if (path === "/_pages" && req.method === "POST") { state.pages = body; return json(res, 200, {}); }
  seen.push({ method: req.method, path, auth: req.headers.authorization, offset: req.headers.offset, file_size: req.headers.file_size, bytes, body, form, query: Object.fromEntries(url.searchParams) });
  const token = (req.headers.authorization || "").replace(/^(Bearer|OAuth) /, "");
  if (token === "TOKEN_EXPIRADO") return json(res, 400, { error: { message: "Error validating access token: Session has expired", code: 190 } });
  if (token === "TOKEN_SEM_PERMISSAO") return json(res, 403, { error: { message: "(#200) Requires pages_manage_posts permission", code: 200 } });
  if (body.caption?.includes("FALHAR") || body.description?.includes("FALHAR")) return json(res, 400, { error: { message: "Invalid parameter", code: 100, error_user_msg: "A legenda tem um problema de teste." } });
  const parts = path.split("/").filter(Boolean).slice(1); // sem a versão
  const [id, edge] = parts;
  // login (OAuth): troca de code por token e lista de Páginas
  if (id === "oauth" && edge === "access_token") {
    if (form.code === "CODIGO_RUIM") return json(res, 400, { error: { message: "This authorization code has been used.", code: 100 } });
    if (form.grant_type === "fb_exchange_token") return json(res, 200, { access_token: form.fb_exchange_token === "USER_CURTO" ? "USER_LONGO" : "USER_INESPERADO", token_type: "bearer" });
    return json(res, 200, { access_token: "USER_CURTO", token_type: "bearer", expires_in: 3600 });
  }
  if (id === "me" && edge === "accounts") {
    if (token !== "USER_LONGO") return json(res, 400, { error: { message: "Invalid OAuth access token.", code: 190 } });
    return json(res, 200, { data: state.pages });
  }
  // uploads (rupload)
  if (path.startsWith("/upload/")) return json(res, 200, { success: true });
  // Instagram
  if (edge === "media" && req.method === "POST") {
    const cid = `C${++n}`;
    state.containers[cid] = { polls: 0, type: body.media_type, image: body.image_url };
    const out = { id: cid };
    if (body.upload_type === "resumable") out.uri = `http://localhost:${PORT}/upload/ig/${cid}`;
    return json(res, 200, out);
  }
  if (edge === "media_publish") return json(res, 200, { id: `M${++n}` });
  if (id?.startsWith("C") && !edge) { const c = state.containers[id]; c.polls++; return json(res, 200, { status_code: c.polls < 2 ? "IN_PROGRESS" : "FINISHED" }); }
  if (id?.startsWith("M") && !edge) return json(res, 200, { permalink: `https://www.instagram.com/reel/${id}/` });
  // Facebook
  if (edge === "video_reels" || edge === "video_stories") {
    if (body.upload_phase === "start") { const v = `V${++n}`; return json(res, 200, { video_id: v, upload_url: `http://localhost:${PORT}/upload/fb/${v}` }); }
    return json(res, 200, { success: true, post_id: `${id}_${++n}` });
  }
  if (id?.startsWith("V") && !edge) return json(res, 200, { status: { video_status: "ready" } });
  if (edge === "photos") return json(res, 200, body.published === false ? { id: `P${++n}` } : { id: `P${++n}`, post_id: `${id}_${++n}` });
  if (edge === "photo_stories") return json(res, 200, { success: true, post_id: `${id}_${++n}` });
  if (edge === "videos") return json(res, 200, { id: `V${++n}` });
  json(res, 404, { error: { message: `rota não simulada: ${req.method} ${path}`, code: 100 } });
});
return new Promise((resolve) => server.listen(PORT, () => resolve({ server, seen, port: PORT, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockMeta(Number(process.env.PORT || 4020)).then((m) => console.log("mock-meta em", m.port));
}
