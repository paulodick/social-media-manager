import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db.ts";
import { countProblems, listProblemTargets } from "../src/lib/queries.ts";

test("listProblemTargets e countProblems retornam apenas destinos não postados com falha, travamento ou horário perdido", { skip: !process.env.DATABASE_URL }, async () => {
  const pool = await db();
  const cRes = await pool.query<{ id: string }>(
    "insert into clients (name) values ($1) returning id",
    [`Teste Problemas ${Date.now()}`],
  );
  const clientId = cRes.rows[0].id;
  try {
    const pRes = await pool.query<{ id: string }>(
      "insert into posts (client_id, title) values ($1, 'Post Problemas') returning id",
      [clientId],
    );
    const postId = pRes.rows[0].id;

    // 1) Falhou ao publicar (deve aparecer)
    const tFailed = (
      await pool.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, status, publish_state, publish_error)
         values ($1, 'instagram', 'reels', now() + interval '1 hour', 'scheduled', 'failed', 'Token inválido') returning id`,
        [postId],
      )
    ).rows[0].id;

    // 2) Perdeu o horário automático (deve aparecer)
    const tMissed = (
      await pool.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, status, publish_state, auto_confirmed_at)
         values ($1, 'facebook', 'reels', now() - interval '2 hours', 'scheduled', 'idle', now() - interval '3 hours') returning id`,
        [postId],
      )
    ).rows[0].id;

    // 3) Travado em publishing > 15 min (deve aparecer como failed)
    const tStuck = (
      await pool.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, status, publish_state, publish_started_at)
         values ($1, 'linkedin', 'feed', now(), 'scheduled', 'publishing', now() - interval '20 minutes') returning id`,
        [postId],
      )
    ).rows[0].id;

    // 4) Já postado com publish_state='failed' (NÃO deve aparecer)
    const tPosted = (
      await pool.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, status, publish_state, publish_error)
         values ($1, 'instagram', 'feed', now() - interval '1 hour', 'posted', 'failed', 'Erro antigo') returning id`,
        [postId],
      )
    ).rows[0].id;

    // 5) Confirmado no futuro (NÃO deve aparecer)
    const tOk = (
      await pool.query<{ id: string }>(
        `insert into post_targets (post_id, network, format, scheduled_at, status, publish_state, auto_confirmed_at)
         values ($1, 'instagram', 'stories', now() + interval '3 hours', 'scheduled', 'idle', now()) returning id`,
        [postId],
      )
    ).rows[0].id;

    const all = await listProblemTargets();
    const mine = all.filter((t) => t.client_id === clientId);
    const ids = new Set(mine.map((t) => t.id));

    assert.equal(ids.has(tFailed), true);
    assert.equal(ids.has(tMissed), true);
    assert.equal(ids.has(tStuck), true);
    assert.equal(ids.has(tPosted), false);
    assert.equal(ids.has(tOk), false);

    const stuckRow = mine.find((t) => t.id === tStuck);
    assert.equal(stuckRow?.publish_state, "failed");
    const missedRow = mine.find((t) => t.id === tMissed);
    assert.equal(missedRow?.auto_missed, true);

    const totalCount = await countProblems();
    assert.equal(totalCount, all.length);
    assert.ok(totalCount >= 3);
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
  }
});
