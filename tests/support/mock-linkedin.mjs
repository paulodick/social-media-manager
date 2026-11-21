// Servidor LinkedIn de mentira para testes: simula o login OAuth, /v2/userinfo, a Posts API e o envio de imagem e vídeo.
// Registra tudo em `seen` (método, caminho, cabeçalhos relevantes, corpo JSON e quantidade de bytes).
import http from "node:http";
import { pathToFileURL } from "node:url";

export function startMockLinkedin(PORT = 4040) {
const seen = [];
const json = (res, status, body, headers = {}) => { res.statusCode = status; res.setHeader("content-type", "application/json"); for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.end(JSON.stringify(body)); };
let videoPolls = 0;
const PART = 4194304;
const server = http.createServer(async (req, res) => {
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes < 8192) chunks.push(c); }
  const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (path === "/_seen") return json(res, 200, seen);
  let body = {}; if (req.headers["content-type"]?.includes("json")) { try { body = JSON.parse(raw); } catch {} }
  const form = req.headers["content-type"]?.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : {};
  seen.push({
    method: req.method, path, action: url.searchParams.get("action"), bytes, body, form,
    auth: req.headers.authorization, version: req.headers["linkedin-version"], restli: req.headers["x-restli-protocol-version"], ctype: req.headers["content-type"],
  });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");

  // login: a tela de autorização "aprova" na hora e volta para o endereço de retorno
  if (path === "/oauth/v2/authorization") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", process.env.MOCK_LI_CODE || "CODIGO_BOM");
    back.searchParams.set("state", url.searchParams.get("state") || "");
    res.statusCode = 302; res.setHeader("location", back.toString()); return res.end();
  }
  if (path === "/oauth/v2/accessToken") {
    if (form.code === "CODIGO_RUIM") return json(res, 400, { error: "invalid_request", error_description: "Unable to retrieve access token: authorization code not found" });
    return json(res, 200, { access_token: "LI_TOKEN", expires_in: 5184000, scope: "openid,profile,w_member_social" });
  }
  if (path === "/v2/userinfo") {
    if (token !== "LI_TOKEN") return json(res, 401, { status: 401, code: "REVOKED_ACCESS_TOKEN", message: "The token used in the request has been revoked by the user" });
    return json(res, 200, { sub: "abc123XYZ", name: "Paulo Teste", given_name: "Paulo", family_name: "Teste" });
  }
  if (token === "LI_EXPIRADO") return json(res, 401, { status: 401, code: "EXPIRED_ACCESS_TOKEN", message: "The token used in the request has expired" });
  if (token === "LI_SEM_PERMISSAO") return json(res, 403, { status: 403, code: "ACCESS_DENIED", message: "Not enough permissions to access: partnerApiPostsExternal.CREATE.20261100" });

  // imagem
  if (path === "/rest/images" && url.searchParams.get("action") === "initializeUpload") {
    return json(res, 200, { value: { uploadUrlExpiresAt: Date.now() + 3600_000, uploadUrl: `http://localhost:${PORT}/dms/img/1`, image: "urn:li:image:IMG1" } });
  }
  // vídeo
  if (path === "/rest/videos" && url.searchParams.get("action") === "initializeUpload") {
    const size = body.initializeUploadRequest?.fileSizeBytes ?? 0;
    const parts = []; for (let first = 0, i = 1; first < size; first += PART, i++) parts.push({ uploadUrl: `http://localhost:${PORT}/dms/vid/${i}`, firstByte: first, lastByte: Math.min(first + PART, size) - 1 });
    return json(res, 200, { value: { uploadUrlsExpireAt: Date.now() + 3600_000, video: "urn:li:video:VID1", uploadInstructions: parts, uploadToken: "TOK1" } });
  }
  if (path.startsWith("/dms/vid/")) { res.statusCode = 200; res.setHeader("etag", `"etag-${path.split("/").pop()}"`); return res.end(); }
  if (path.startsWith("/dms/img/")) { res.statusCode = 201; return res.end(); }
  if (path === "/rest/videos" && url.searchParams.get("action") === "finalizeUpload") return json(res, 200, {});
  if (path.startsWith("/rest/videos/")) {
    videoPolls++;
    if (decodeURIComponent(path).includes("urn:li:video:FALHA")) return json(res, 200, { status: "PROCESSING_FAILED", processingFailureReason: "FORMATO_INVALIDO" });
    return json(res, 200, { status: videoPolls < 2 ? "PROCESSING" : "AVAILABLE" });
  }
  // post
  if (path === "/rest/posts" && req.method === "POST") {
    if (String(body.commentary || "").includes("FALHAR")) return json(res, 422, { status: 422, message: "Invalid commentary for test" });
    return json(res, 201, {}, { "x-restli-id": "urn:li:share:7000000000000000001" });
  }
  json(res, 404, { status: 404, message: `rota não simulada: ${req.method} ${path}` });
});
return new Promise((resolve) => server.listen(PORT, () => resolve({ server, seen, port: PORT, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockLinkedin(Number(process.env.PORT || 4040)).then((m) => console.log("mock-linkedin em", m.port));
}
