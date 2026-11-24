import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db.ts";
import { insertPostIdempotent, parseSubmissionId } from "../src/lib/post-submission.ts";

test("parseSubmissionId aceita apenas UUID válido", () => {
  const id = randomUUID();
  assert.equal(parseSubmissionId(id), id);
  assert.equal(parseSubmissionId(`  ${id}  `), id);
  assert.equal(parseSubmissionId(""), null);
  assert.equal(parseSubmissionId("nao-e-uuid"), null);
  assert.equal(parseSubmissionId(null), null);
  assert.equal(parseSubmissionId(undefined), null);
});

test("insertPostIdempotent impede duplicação com o mesmo submission_id e permite vários nulos", { skip: !process.env.DATABASE_URL }, async () => {
  const pool = await db();
  const cRes = await pool.query<{ id: string }>(
    `insert into clients (name) values ($1) returning id`,
    [`Teste Idempotência ${Date.now()}`],
  );
  const clientId = cRes.rows[0].id;
  const subId = randomUUID();
  try {
    const c1 = await pool.connect();
    try {
      await c1.query("begin");
      const first = await insertPostIdempotent(c1, {
        clientId,
        title: "Post único",
        idea: "Ideia",
        tones: [],
        submissionId: subId,
      });
      await c1.query("commit");
      assert.equal(first.created, true);
    } finally {
      c1.release();
    }

    const c2 = await pool.connect();
    try {
      await c2.query("begin");
      const second = await insertPostIdempotent(c2, {
        clientId,
        title: "Post único (duplo clique)",
        idea: "Ideia",
        tones: [],
        submissionId: subId,
      });
      await c2.query("commit");
      assert.equal(second.created, false);
    } finally {
      c2.release();
    }

    // Múltiplos posts com submission_id nulo continuam permitidos (índice único parcial)
    const c3 = await pool.connect();
    try {
      await c3.query("begin");
      const n1 = await insertPostIdempotent(c3, { clientId, title: "Sem id 1", idea: "", tones: [], submissionId: null });
      const n2 = await insertPostIdempotent(c3, { clientId, title: "Sem id 2", idea: "", tones: [], submissionId: null });
      await c3.query("commit");
      assert.equal(n1.created, true);
      assert.equal(n2.created, true);
    } finally {
      c3.release();
    }

    const countRes = await pool.query<{ total: string }>(
      "select count(*)::text as total from posts where client_id = $1 and submission_id = $2",
      [clientId, subId],
    );
    assert.equal(countRes.rows[0].total, "1");
  } finally {
    await pool.query("delete from clients where id = $1", [clientId]);
  }
});
