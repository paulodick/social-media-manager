import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_POST_TIME, isTime } from "../src/lib/dates.ts";
import { parseGenerateWeekdays } from "../src/lib/editorial-rules.ts";

test("parseGenerateWeekdays exige ao menos um dia válido sem fallback silencioso", () => {
  assert.equal(parseGenerateWeekdays([]), null);
  assert.equal(parseGenerateWeekdays(undefined), null);
  assert.equal(parseGenerateWeekdays(null), null);
  assert.equal(parseGenerateWeekdays([-1, 7, "1"]), null);
  assert.deepEqual(parseGenerateWeekdays([1, 3, 5]), [1, 3, 5]);
  assert.deepEqual(parseGenerateWeekdays([0, 6, 0, 99]), [0, 6]);
});

test("DEFAULT_POST_TIME é horário HH:MM válido e unificado", () => {
  assert.equal(DEFAULT_POST_TIME, "10:00");
  assert.equal(isTime(DEFAULT_POST_TIME), true);
});

test("módulo editorial não utiliza window.prompt em nenhum componente", () => {
  const dir = path.join(process.cwd(), "src", "components", "editorial");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    assert.equal(content.includes("window.prompt"), false, `window.prompt encontrado em ${file}`);
  }
});
