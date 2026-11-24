// Drive de mentira: ids começando com VIDEO viram vídeo 9:16 (5000 bytes); IMAGE viram foto 4:5 (3000 bytes).
import http from "node:http";
import { pathToFileURL } from "node:url";

export function startMockDrive(PORT = 4030) {
  const seen = [];
  const folders = new Map(); // key: `${parentId}|${name}` -> id
  const createdFolders = [];
  let seq = 1;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    seen.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, range: req.headers.range });

    // Busca de pastas: GET /files?q='PARENT' in parents and name = 'NAME' ...
    if (req.method === "GET" && (url.pathname === "/files" || url.pathname === "/drive/v3/files")) {
      const q = url.searchParams.get("q") ?? "";
      const pm = q.match(/'([^']+)' in parents/);
      const nm = q.match(/name = '((?:\\'|[^'])+)'/);
      const parentId = pm?.[1] ?? "";
      const name = nm ? nm[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\") : "";
      if (parentId === "ROOT_FORBIDDEN") {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { code: 403, message: "Forbidden" } }));
        return;
      }
      const foundId = folders.get(`${parentId}|${name}`);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ files: foundId ? [{ id: foundId }] : [] }));
      return;
    }

    // Criação de pasta: POST /files
    if (req.method === "POST" && (url.pathname === "/files" || url.pathname === "/drive/v3/files")) {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const parentId = body.parents?.[0] ?? "";
        if (parentId === "ROOT_READONLY") {
          res.statusCode = 403;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { code: 403, message: "Read only" } }));
          return;
        }
        const id = `FOLDER_${String(seq++).padStart(8, "0")}`;
        folders.set(`${parentId}|${body.name}`, id);
        createdFolders.push({ id, parentId, name: body.name });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id }));
      });
      return;
    }

    const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const video = id.startsWith("VIDEO");
    const image = id.startsWith("IMAGE");
    if (!video && !image) { res.statusCode = 404; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { code: 404, message: "File not found" } })); return; }
    const size = video ? 5000 : 3000;
    if (url.searchParams.get("alt") === "media") {
      const body = Buffer.alloc(size, video ? 7 : 9);
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        const a = Number(range[1]); const b = range[2] ? Number(range[2]) : size - 1;
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${a}-${b}/${size}`);
        res.setHeader("content-type", video ? "video/mp4" : "image/jpeg");
        res.setHeader("content-length", String(b - a + 1));
        res.end(body.subarray(a, b + 1));
        return;
      }
      res.setHeader("content-type", video ? "video/mp4" : "image/jpeg");
      res.setHeader("content-length", String(size));
      res.end(body);
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id, name: video ? `${id}.mp4` : `${id}.jpg`, mimeType: video ? "video/mp4" : "image/jpeg", size: String(size), parents: ["PASTA"],
      ...(video ? { videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "20000" } } : { imageMediaMetadata: { width: 1080, height: 1350 } }),
    }));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve({ server, seen, createdFolders, port: PORT, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockDrive(Number(process.env.PORT || 4030)).then((m) => console.log("mock-drive em", m.port));
}
