import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_WINDOW_MIN, canAutoSchedule, whenLabel } from "../src/lib/auto-publish.ts";
import { notifyConfigured, notifyProblem, problemMail } from "../src/lib/notify.ts";

test("só Instagram, Facebook e LinkedIn (menos Documento) publicam sozinhos", () => {
  assert.equal(canAutoSchedule("instagram", "reels"), true);
  assert.equal(canAutoSchedule("facebook", "stories"), true);
  assert.equal(canAutoSchedule("linkedin", "feed"), true);
  assert.equal(canAutoSchedule("linkedin", "documento"), false);
  assert.equal(canAutoSchedule("tiktok", "video"), false);
  assert.equal(canAutoSchedule("youtube", "shorts"), false);
  assert.equal(canAutoSchedule("kwai", "video"), false);
});

test("janela de tolerância é de 60 minutos", () => {
  assert.equal(AUTO_WINDOW_MIN, 60);
});

test("whenLabel mostra dia/mês e horário", () => {
  assert.equal(whenLabel("2026-11-25", "09:30"), "25/11 às 09:30");
});

test("e-mail do aviso diferencia falha de horário perdido e não vaza segredo", () => {
  const base = { client: "Best Medical", network: "instagram", format: "reels", day: "2026-11-25", time: "09:30", reason: "token vencido" };
  const f = problemMail({ ...base, kind: "falhou", link: "https://app.exemplo/clientes/1/dia/2026-11-25" });
  assert.match(f.subject, /falhou/);
  assert.match(f.text, /token vencido/);
  assert.match(f.text, /duplicar/);
  assert.match(f.text, /https:\/\/app\.exemplo/);
  const m = problemMail({ ...base, kind: "perdeu" });
  assert.match(m.subject, /perdeu o horário/);
  assert.match(m.text, /Nada foi publicado/);
});

test("sem variáveis o aviso não envia nem lança erro", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_EMAIL_TO;
  assert.equal(notifyConfigured(), false);
  const ok = await notifyProblem({ kind: "falhou", client: "X", network: "instagram", format: "reels", day: "2026-11-25", time: "09:30", reason: "teste" });
  assert.equal(ok, false);
});

test("com variáveis envia ao Resend e falha de rede não lança erro", async () => {
  const { createServer } = await import("node:http");
  let body = "";
  let auth = "";
  const srv = createServer((req, res) => {
    auth = String(req.headers.authorization);
    req.on("data", (c) => (body += c));
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"x"}'); });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  const port = (srv.address() as { port: number }).port;
  process.env.RESEND_API_KEY = "re_teste";
  process.env.NOTIFY_EMAIL_TO = "paulo@exemplo.com";
  process.env.RESEND_API_BASE = `http://127.0.0.1:${port}`;
  const p = { kind: "falhou" as const, client: "X", network: "instagram", format: "reels", day: "2026-11-25", time: "09:30", reason: "teste" };
  assert.equal(await notifyProblem(p), true);
  assert.equal(auth, "Bearer re_teste");
  assert.match(body, /paulo@exemplo\.com/);
  srv.close();
  assert.equal(await notifyProblem(p), false); // servidor fora do ar
  delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAIL_TO; delete process.env.RESEND_API_BASE;
});
