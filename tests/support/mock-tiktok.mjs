// Servidor TikTok de mentira para testes: simula a janela de login, os tokens (com renovação que gira), /v2/user/info/,
// o envio de rascunho de vídeo (inbox) e de fotos, o envio das partes e a consulta de status.
// Registra tudo em `seen` (método, caminho, cabeçalhos relevantes, corpo JSON/formulário e quantidade de bytes).
import http from "node:http";
import { pathToFileURL } from "node:url";

export function startMockTiktok(PORT = 4050) {
const seen = [];
const send = (res, status, body) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
const ok = (data) => ({ data, error: { code: "ok", message: "", log_id: "LOG" } });
const fail = (code, message = "") => ({ data: {}, error: { code, message, log_id: "LOG" } });
let refreshCount = 0;
let nextCode = null; // /_code?v=... troca o "code" que a tela de login devolve (para simular permissão desmarcada)
const polls = {};
const server = http.createServer(async (req, res) => {
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes < 16384) chunks.push(c); }
  const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (path === "/_seen") return send(res, 200, seen);
  if (path === "/_code") { nextCode = url.searchParams.get("v") || null; return send(res, 200, {}); }
  let body = {}; if (req.headers["content-type"]?.includes("json")) { try { body = JSON.parse(raw); } catch {} }
  const form = req.headers["content-type"]?.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : {};
  seen.push({
    method: req.method, path, query: Object.fromEntries(url.searchParams), bytes, body, form,
    auth: req.headers.authorization, ctype: req.headers["content-type"], clen: req.headers["content-length"], crange: req.headers["content-range"],
  });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");

  // login: a tela de autorização "aprova" na hora e volta para o endereço de retorno
  if (path === "/v2/auth/authorize/") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", nextCode || process.env.MOCK_TT_CODE || "CODIGO_BOM");
    back.searchParams.set("state", url.searchParams.get("state") || "");
    res.statusCode = 302; res.setHeader("location", back.toString()); return res.end();
  }
  if (path === "/v2/oauth/token/") {
    if (form.grant_type === "authorization_code") {
      if (form.code === "CODIGO_RUIM") return send(res, 400, { error: "invalid_grant", error_description: "Authorization code is expired", log_id: "LOG" });
      const scope = form.code === "SEM_ESCOPO" ? "user.info.basic" : "user.info.basic,video.upload";
      return send(res, 200, { access_token: "TT_ACESSO", expires_in: Number(process.env.MOCK_TT_EXPIRES_IN || 7200), open_id: "open-123", refresh_token: "TT_RENOVA_1", refresh_expires_in: 15552000, scope, token_type: "Bearer" });
    }
    if (form.grant_type === "refresh_token") {
      const expected = `TT_RENOVA_${refreshCount + 1}`;
      if (form.refresh_token !== expected) return send(res, 400, { error: "invalid_grant", error_description: "Refresh token is invalid or has been used", log_id: "LOG" });
      refreshCount++;
      return send(res, 200, { access_token: `TT_ACESSO_${refreshCount + 1}`, expires_in: 7200, open_id: "open-123", refresh_token: `TT_RENOVA_${refreshCount + 1}`, refresh_expires_in: 15552000, scope: "user.info.basic,video.upload", token_type: "Bearer" });
    }
    return send(res, 400, { error: "unsupported_grant_type" });
  }
  if (path === "/v2/oauth/revoke/") return send(res, 200, {});
  if (path === "/v2/user/info/") {
    if (!token.startsWith("TT_ACESSO")) return send(res, 401, fail("access_token_invalid", "The access token is invalid or not found in the request."));
    return send(res, 200, ok({ user: { open_id: "open-123", display_name: "Best Medical Teste" } }));
  }
  if (path.startsWith("/upload/")) {
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers["content-range"] || "");
    res.statusCode = m && Number(m[2]) + 1 === Number(m[3]) ? 201 : 206; return res.end();
  }
  if (token === "TT_EXPIRADO") return send(res, 401, fail("access_token_invalid", "The access token is invalid or not found in the request."));
  if (token === "TT_SEM_ESCOPO") return send(res, 401, fail("scope_not_authorized", "The user did not authorize the scope required for completing this request."));
  if (token === "TT_LIMITE") return send(res, 429, fail("rate_limit_exceeded", "Too many requests"));
  if (token === "TT_SPAM") return send(res, 403, fail("spam_risk_too_many_posts", "daily limit"));

  if (path === "/v2/post/publish/inbox/video/init/") {
    const si = body.source_info || {};
    if (si.source !== "FILE_UPLOAD") return send(res, 400, fail("invalid_param", "só FILE_UPLOAD neste teste"));
    return send(res, 200, ok({ publish_id: process.env.MOCK_TT_PUBLISH_ID || "v_inbox_file~v2.123", upload_url: `http://localhost:${PORT}/upload/1` }));
  }
  if (path === "/v2/post/publish/content/init/") {
    const urls = body.source_info?.photo_images || [];
    if (urls.some((u) => u.includes("NAO_VERIFICADO"))) return send(res, 403, fail("url_ownership_unverified", "domain not verified"));
    return send(res, 200, ok({ publish_id: "p_inbox_url~v2.456" }));
  }
  if (path === "/v2/post/publish/status/fetch/") {
    const id = body.publish_id; polls[id] = (polls[id] || 0) + 1;
    if (String(id).includes("FALHA")) return send(res, 200, ok({ status: "FAILED", fail_reason: "file_format_check_failed" }));
    if (String(id).includes("TRAVADO")) return send(res, 200, ok({ status: "PROCESSING_UPLOAD" }));
    return send(res, 200, ok({ status: polls[id] < 2 ? "PROCESSING_UPLOAD" : "SEND_TO_USER_INBOX" }));
  }
  send(res, 404, fail("not_found", `rota não simulada: ${req.method} ${path}`));
});
return new Promise((resolve) => server.listen(PORT, () => resolve({ server, seen, port: PORT, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockTiktok(Number(process.env.PORT || 4050)).then((m) => console.log("mock-tiktok em", m.port));
}
