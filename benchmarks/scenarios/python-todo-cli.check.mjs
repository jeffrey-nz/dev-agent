/**
 * Check script for python-todo-cli benchmark.
 * Verifies multi-module structure, pytest passes, and CLI works end-to-end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ws = process.env.BENCHMARK_WORKSPACE;
if (!ws) throw new Error("BENCHMARK_WORKSPACE env var not set");

const venvPython = join(ws, ".venv", "bin", "python");
const python = existsSync(venvPython) ? venvPython : "python3";

test("All three source modules exist", () => {
  const required = ["todo.py", "storage.py", "models.py"];
  const missing = required.filter((f) => !existsSync(join(ws, f)));
  assert.deepStrictEqual(missing, [], `Missing modules: ${missing.join(", ")}. Files: ${readdirSync(ws).join(", ")}`);
});

test("Both test files exist", () => {
  const required = ["test_storage.py", "test_models.py"];
  const missing = required.filter((f) => !existsSync(join(ws, f)));
  assert.deepStrictEqual(missing, [], `Missing test files: ${missing.join(", ")}`);
});

test("pytest exits 0 with at least 5 tests passing", () => {
  const r = spawnSync(python, ["-m", "pytest", "-q", "--tb=short"], {
    cwd: ws, encoding: "utf8", timeout: 60_000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.ok(!/collected 0 items/i.test(out), `pytest collected 0 tests:\n${out}`);
  assert.strictEqual(r.status, 0, `pytest failed:\n${out}`);
  const m = out.match(/(\d+)\s+passed/);
  const passed = m ? parseInt(m[1], 10) : 0;
  assert.ok(passed >= 5, `Expected >= 5 passing tests, got ${passed}.\n${out}`);
});

test("Todo dataclass: defaults and to_dict/from_dict round-trip", () => {
  const r = spawnSync(python, ["-c", `
from models import Todo
t = Todo(id=1, title='x', created_at='2026-01-01T00:00:00')
assert t.completed is False, f'expected completed=False default, got {t.completed!r}'
d = t.to_dict()
t2 = Todo.from_dict(d)
assert t2.id == t.id and t2.title == t.title and t2.completed == t.completed and t2.created_at == t.created_at, f'round-trip failed: {d} -> {t2}'
print('ok')
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.strictEqual(r.status, 0, `Todo model smoke failed:\n${out}`);
});

test("storage: load returns [] on missing file, save/load round-trips", () => {
  // Clean any pre-existing .todos.json before running
  try { rmSync(join(ws, ".todos.json"), { force: true }); } catch {}
  const r = spawnSync(python, ["-c", `
import os
from storage import load_todos, save_todos, next_id
from models import Todo

# Empty case
assert load_todos() == [], 'load should return [] for missing file'
assert next_id([]) == 1, f'next_id of empty should be 1, got {next_id([])}'

# Round-trip
todos = [
  Todo(id=1, title='a', created_at='2026-01-01T00:00:00'),
  Todo(id=2, title='b', completed=True, created_at='2026-01-02T00:00:00'),
]
save_todos(todos)
loaded = load_todos()
assert len(loaded) == 2, f'expected 2 todos, got {len(loaded)}'
assert loaded[0].id == 1 and loaded[1].id == 2
assert loaded[1].completed is True
assert next_id(loaded) == 3, f'next_id should be 3, got {next_id(loaded)}'
os.remove('.todos.json')
print('ok')
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.strictEqual(r.status, 0, `storage smoke failed:\n${out}`);
});

test("CLI end-to-end: add, list, complete", () => {
  // Clean state
  try { rmSync(join(ws, ".todos.json"), { force: true }); } catch {}

  const run = (...args) =>
    spawnSync(python, ["todo.py", ...args], { cwd: ws, encoding: "utf8", timeout: 15_000 });

  const addA = run("add", "buy milk");
  assert.strictEqual(addA.status, 0, `add 1 failed:\n${addA.stdout}${addA.stderr}`);
  const addB = run("add", "call mom");
  assert.strictEqual(addB.status, 0, `add 2 failed:\n${addB.stdout}${addB.stderr}`);

  const list1 = run("list");
  assert.strictEqual(list1.status, 0, `list failed:\n${list1.stdout}${list1.stderr}`);
  // Both todos should appear, both unchecked
  assert.ok(/buy milk/i.test(list1.stdout), `list missing 'buy milk':\n${list1.stdout}`);
  assert.ok(/call mom/i.test(list1.stdout), `list missing 'call mom':\n${list1.stdout}`);
  // Format: should have unchecked brackets
  assert.ok(/\[\s\]/.test(list1.stdout), `list output not in '[ ]' format:\n${list1.stdout}`);

  const comp = run("complete", "1");
  assert.strictEqual(comp.status, 0, `complete 1 failed:\n${comp.stdout}${comp.stderr}`);

  const list2 = run("list");
  assert.strictEqual(list2.status, 0, `list 2 failed:\n${list2.stdout}${list2.stderr}`);
  // After completing id 1, output should contain [x] and 'buy milk' on the same line
  const buyMilkLine = list2.stdout.split("\n").find((l) => /buy milk/i.test(l));
  assert.ok(buyMilkLine, `'buy milk' missing from list 2:\n${list2.stdout}`);
  assert.ok(/\[x\]/i.test(buyMilkLine), `'buy milk' not marked completed:\n${buyMilkLine}`);

  // Cleanup
  try { rmSync(join(ws, ".todos.json"), { force: true }); } catch {}
});

test("CLI errors: complete with unknown id exits non-zero", () => {
  // Guard against false-pass: if todo.py doesn't exist Python exits non-zero too.
  assert.ok(existsSync(join(ws, "todo.py")), "todo.py missing — cannot validate error handling");
  try { rmSync(join(ws, ".todos.json"), { force: true }); } catch {}
  const r = spawnSync(python, ["todo.py", "complete", "99"], {
    cwd: ws, encoding: "utf8", timeout: 10_000,
  });
  assert.notStrictEqual(r.status, 0, `complete on unknown id should exit non-zero, got exit ${r.status}:\n${r.stdout}${r.stderr}`);
  // Make sure the non-zero exit was from the app, not a Python crash
  const out = (r.stdout || "") + (r.stderr || "");
  assert.ok(!/No such file or directory|can't open file/i.test(out), `Python failed to find todo.py:\n${out}`);
});

test("storage uses .todos.json as the default path", () => {
  const src = readFileSync(join(ws, "storage.py"), "utf8");
  assert.ok(/\.todos\.json/.test(src), "storage.py does not reference '.todos.json'");
});
