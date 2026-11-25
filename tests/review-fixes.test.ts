// Testes das correções da revisão geral (2026-11-25): republicação, Instagram antigo, rede desmarcada e calendário da IA.
import assert from "node:assert/strict";
import test from "node:test";
import { checkCalendarFitsSlots } from "../src/lib/editorial-rules.ts";

process.env.TOKEN_ENC_KEY ??= "chave-de-teste-com-mais-de-16";

test("checkCalendarFitsSlots recusa dia, rede ou formato fora do pedido e item em dobro", () => {
  const slots = [
    { planned_day: "2026-12-01", network: "instagram", format: "reels" },
    { planned_day: "2026-12-01", network: "linkedin", format: "feed" },
    { planned_day: "2026-12-03", network: "instagram", format: "reels" },
  ];
  assert.equal(checkCalendarFitsSlots([slots[0], slots[2]], slots), null);
  assert.equal(checkCalendarFitsSlots([], slots), null);
  // Dia da semana não marcado (02/12)
  assert.match(
    checkCalendarFitsSlots([{ planned_day: "2026-12-02", network: "instagram", format: "reels" }], slots) ?? "",
    /fora do período/,
  );
  // Rede não escolhida
  assert.match(
    checkCalendarFitsSlots([{ planned_day: "2026-12-01", network: "tiktok", format: "video" }], slots) ?? "",
    /fora do período/,
  );
  // Fora do período
  assert.match(
    checkCalendarFitsSlots([{ planned_day: "2027-01-10", network: "instagram", format: "reels" }], slots) ?? "",
    /fora do período/,
  );
  // Dois conteúdos no mesmo dia + rede + formato
  assert.match(checkCalendarFitsSlots([slots[0], { ...slots[0] }], slots) ?? "", /mais de um conteúdo/);
});

test("saveMetaConnections apaga o Instagram antigo quando a Página nova não tem Instagram", { skip: !process.env.DATABASE_URL }, async () => {
  const { db } = await import("../src/lib/db.ts");
  const { saveMetaConnections } = await import("../src/lib/connections.ts");
  const pool = await db();
  const clientId = (
    await pool.query<{ id: string }>("insert into clients (name) values ($1) returning id", [`Teste Meta ${Date.now()}`])
  ).rows[0].id;
  try {
    const r1 = await saveMetaConnections(clientId, { id: "PAGINA_A", name: "Página A", token: "tokA", ig: { id: "IG_A", username: "conta_a" } });
    assert.equal(r1.instagram, "@conta_a");
    const before = await pool.query("select network from network_connections where client_id = $1 order by network", [clientId]);
    assert.deepEqual(before.rows.map((r) => r.network), ["facebook", "instagram"]);

    const r2 = await saveMetaConnections(clientId, { id: "PAGINA_B", name: "Página B", token: "tokB", ig: null });
    assert.equal(r2.instagram, null);
    const after = await pool.query<{ network: string; page_id: string }>(
      "select network, page_id from network_connections where client_id = $1 order by network",
      [clientId],
    );
    assert.deepEqual(after.rows, [{ network: "facebook", page_id: "PAGINA_B" }]);
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
  }
});
