import assert from "node:assert/strict";
import test from "node:test";
import { resolveDayNoteSave } from "../src/lib/day-note.ts";

test("Novo post: abrir dia D com nota e trocar data para D2 sem editar não grava nem altera D2", () => {
  const res = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "Ideia do dia D",
    noteOrig: "Ideia do dia D",
    noteFrom: "2026-11-24",
    noteDay: "2026-11-25",
  });
  assert.deepEqual(res, { shouldSave: false, replace: false });
});

test("Novo post: trocar data para D2 com recarga da nota vazia e salvar sem digitar não altera D2", () => {
  const res = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "",
    noteOrig: "",
    noteFrom: "2026-11-25",
    noteDay: "2026-11-25",
  });
  assert.deepEqual(res, { shouldSave: false, replace: false });
});

test("Novo post: editar a nota no mesmo dia substitui a nota do dia", () => {
  const res = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "Ideia atualizada",
    noteOrig: "Ideia antiga",
    noteFrom: "2026-11-24",
    noteDay: "2026-11-24",
  });
  assert.deepEqual(res, { shouldSave: true, replace: true });
});

test("Novo post: apagar a nota no mesmo dia substitui por vazio (remove nota)", () => {
  const res = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "   ",
    noteOrig: "Ideia antiga",
    noteFrom: "2026-11-24",
    noteDay: "2026-11-24",
  });
  assert.deepEqual(res, { shouldSave: true, replace: true });
});

test("Novo post: se enviar nota editada para outra data sem noteFrom coincidir, acrescenta (exceto se vazia)", () => {
  const edited = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "Nova ideia para D2",
    noteOrig: "Ideia do dia D",
    noteFrom: "2026-11-24",
    noteDay: "2026-11-25",
  });
  assert.deepEqual(edited, { shouldSave: true, replace: false });

  const cleared = resolveDayNoteSave({
    editing: false,
    hasNoteField: true,
    note: "",
    noteOrig: "Ideia do dia D",
    noteFrom: "2026-11-24",
    noteDay: "2026-11-25",
  });
  assert.deepEqual(cleared, { shouldSave: false, replace: false });
});

test("Edição na tela do dia: formulário sem campo note não altera day_notes", () => {
  const res = resolveDayNoteSave({
    editing: true,
    hasNoteField: false,
    note: "",
    noteOrig: "",
    noteFrom: "",
    noteDay: "",
  });
  assert.deepEqual(res, { shouldSave: false, replace: false });
});
