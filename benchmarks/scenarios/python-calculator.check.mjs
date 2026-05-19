/**
 * Check script for python-calculator benchmark.
 * Run via: node --test python-calculator.check.mjs
 * Expects BENCHMARK_WORKSPACE env var pointing to the agent's output directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ws = process.env.BENCHMARK_WORKSPACE;
if (!ws) throw new Error("BENCHMARK_WORKSPACE env var not set");

const venvPython = join(ws, ".venv", "bin", "python");
const python = existsSync(venvPython) ? venvPython : "python3";

test("calculator.py was created", () => {
  assert.ok(
    existsSync(join(ws, "calculator.py")),
    "calculator.py not found — agent did not create the main module",
  );
});

test("test_calculator.py was created", () => {
  const files = readdirSync(ws).filter((f) => f.match(/test.*\.py$/i));
  assert.ok(files.length > 0, `No test_*.py file found in workspace. Files: ${readdirSync(ws).join(", ")}`);
});

test("pytest exits 0 (all tests pass)", () => {
  const r = spawnSync(python, ["-m", "pytest", "-q", "--tb=short"], {
    cwd: ws, encoding: "utf8", timeout: 60_000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.strictEqual(r.status, 0, `pytest failed:\n${out}`);
  // Guard against empty test suites
  assert.ok(!/collected 0 items/i.test(out), `pytest collected 0 tests — no test functions found:\n${out}`);
});

test("Calculator.add(2, 3) returns 5", () => {
  const r = spawnSync(python, ["-c", `
from calculator import Calculator
c = Calculator()
result = c.add(2, 3)
assert result == 5, f"Expected 5, got {result!r}"
print("ok")
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  assert.strictEqual(r.status, 0, `Smoke test failed:\n${(r.stdout || "")}${(r.stderr || "")}`);
});

test("Calculator.divide raises ValueError on zero divisor", () => {
  const r = spawnSync(python, ["-c", `
from calculator import Calculator
c = Calculator()
try:
    c.divide(1, 0)
    print("FAIL: no exception raised")
    exit(1)
except ValueError:
    print("ok: ValueError raised")
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  assert.strictEqual(r.status, 0, `ValueError check failed:\n${(r.stdout || "")}${(r.stderr || "")}`);
});
