// Drive de mentira: ids começando com VIDEO viram vídeo 9:16 (5000 bytes); IMAGE viram foto 4:5 (3000 bytes).
import http from "node:http";
import { pathToFileURL } from "node:url";

export function startMockDrive(PORT = 4030, opts = {}) {
  const seen = [];
  const folders = new Map(); // key: `${parentId}|${name}` -> id
  const createdFolders = [];
  const customFiles = new Map(); // id -> { id, name, mimeType, parents, size?, content?, exportText?, failMediaStatus? }
  for (const item of opts.tree ?? []) {
    customFiles.set(item.id, item);
  }
  let seq = 1;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    seen.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, range: req.headers.range });

    // Busca de pastas/arquivos: GET /files?q=...
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

      // Busca ampla por pastas de outras contas ("not 'me' in owners"): itens com `foreign: true`,
      // menos os marcados `hiddenFromSearch` (o Drive real às vezes não lista uma pasta que deixa abrir).
      if (customFiles.size > 0 && !pm && q.includes("not 'me' in owners")) {
        const matched = [...customFiles.values()]
          .filter((f) => f.foreign && !f.hiddenFromSearch && f.mimeType === "application/vnd.google-apps.folder")
          .map((f) => ({ id: f.id, name: f.name, parents: f.parents }));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ files: matched }));
        return;
      }

      // Se há itens customizados cadastrados na árvore de teste, filtra por parent + mimeType + name
      if (customFiles.size > 0 && !nm) {
        const wantFolders = q.includes("mimeType = 'application/vnd.google-apps.folder'");
        const wantShortcuts = q.includes("mimeType = 'application/vnd.google-apps.shortcut'");
        const excludeFolders = q.includes("mimeType != 'application/vnd.google-apps.folder'");
        const wantImage = q.includes("mimeType contains 'image/'");
        const wantVideo = q.includes("mimeType contains 'video/'");
        const matched = [];
        for (const f of customFiles.values()) {
          if (!(f.parents ?? []).includes(parentId)) continue;
          if (f.hiddenFromSearch) continue;
          const isFolder = f.mimeType === "application/vnd.google-apps.folder";
          const isShortcut = f.mimeType === "application/vnd.google-apps.shortcut";
          if (wantFolders && !isFolder && !(wantShortcuts && isShortcut)) continue;
          if (excludeFolders && isFolder) continue;
          if ((wantImage || wantVideo) && !excludeFolders && !wantFolders) {
            const okImg = wantImage && f.mimeType.startsWith("image/");
            const okVid = wantVideo && f.mimeType.startsWith("video/");
            if (!okImg && !okVid) continue;
          }
          matched.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size !== undefined ? String(f.size) : undefined,
            parents: f.parents,
            shortcutDetails: f.shortcutDetails,
          });
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ files: matched }));
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

    // Exportação de Google Doc: GET /files/:id/export
    const exportMatch = url.pathname.match(/\/files\/([^/]+)\/export$/);
    if (req.method === "GET" && exportMatch) {
      const custom = customFiles.get(exportMatch[1]);
      if (!custom || custom.failMediaStatus) {
        res.statusCode = custom?.failMediaStatus ?? 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { code: res.statusCode, message: "Export failed" } }));
        return;
      }
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(custom.exportText ?? "");
      return;
    }

    // Mover: PATCH /files/:id?addParents=&removeParents=
    if (req.method === "PATCH") {
      const pid = url.pathname.split("/").filter(Boolean).pop() ?? "";
      const item = customFiles.get(pid);
      res.setHeader("content-type", "application/json");
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: { code: 404, message: "File not found" } })); return; }
      if (item.denyMove) { res.statusCode = 403; res.end(JSON.stringify({ error: { code: 403, message: "Insufficient permissions for this file" } })); return; }
      const add = url.searchParams.get("addParents");
      const rem = url.searchParams.get("removeParents");
      item.parents = [...(item.parents ?? []).filter((x) => x !== rem), ...(add ? [add] : [])];
      item.moves = (item.moves ?? 0) + 1;
      res.end(JSON.stringify({ id: item.id, parents: item.parents }));
      return;
    }

    const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const custom = customFiles.get(id);
    if (custom) {
      if (url.searchParams.get("alt") === "media") {
        if (custom.failMediaStatus) {
          res.statusCode = custom.failMediaStatus;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { code: custom.failMediaStatus, message: "Download failed" } }));
          return;
        }
        const buf = Buffer.isBuffer(custom.content)
          ? custom.content
          : Buffer.from(String(custom.content ?? ""), "utf8");
        res.setHeader("content-type", custom.mimeType);
        res.setHeader("content-length", String(buf.length));
        res.end(buf);
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: custom.id,
        name: custom.name,
        mimeType: custom.mimeType,
        size: custom.size !== undefined ? String(custom.size) : undefined,
        parents: custom.parents ?? [],
        owners: [{ emailAddress: custom.owner ?? "dono@example.com" }],
        capabilities: { canMoveItemWithinDrive: !custom.denyMove },
      }));
      return;
    }

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
