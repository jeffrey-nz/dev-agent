/**
 * Check script for python-expr-eval benchmark.
 * Verifies recursive-descent correctness: precedence, parentheses, division.
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

test("Core modules exist (tokenizer, parser, evaluator, calc)", () => {
  const required = ["tokenizer.py", "parser.py", "evaluator.py", "calc.py"];
  const missing = required.filter((f) => !existsSync(join(ws, f)));
  assert.deepStrictEqual(missing, [], `Missing modules: ${missing.join(", ")}. Files: ${readdirSync(ws).join(", ")}`);
});

test("Test files exist", () => {
  const testFiles = readdirSync(ws).filter((f) => /^test_.*\.py$/.test(f));
  assert.ok(testFiles.length >= 2, `Expected >= 2 test_*.py files, found: ${testFiles.join(", ") || "none"}`);
});

test("pytest exits 0 with at least 6 tests passing", () => {
  const r = spawnSync(python, ["-m", "pytest", "-q", "--tb=short"], {
    cwd: ws, encoding: "utf8", timeout: 60_000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.ok(!/collected 0 items/i.test(out), `pytest collected 0 tests:\n${out}`);
  assert.strictEqual(r.status, 0, `pytest failed:\n${out}`);
  const m = out.match(/(\d+)\s+passed/);
  const passed = m ? parseInt(m[1], 10) : 0;
  assert.ok(passed >= 6, `Expected >= 6 passing tests, got ${passed}.\n${out}`);
});

// Run each correctness case through whatever end-to-end entrypoint exists.
// Tries evaluate_expression from a few likely module locations.
function evalExpr(expr) {
  const script = `
import sys
fn = None
for modname in ['evaluator', 'calc_eval', 'calc', 'parser', 'tokenizer']:
    try:
        mod = __import__(modname)
    except Exception:
        continue
    if hasattr(mod, 'evaluate_expression'):
        fn = getattr(mod, 'evaluate_expression')
        break
if fn is None:
    print('NO_ENTRYPOINT'); sys.exit(2)
try:
    result = fn(${JSON.stringify(expr)})
    print(repr(result))
except ZeroDivisionError:
    print('ZERODIV')
except Exception as e:
    print('ERR:' + type(e).__name__ + ':' + str(e))
`;
  const r = spawnSync(python, ["-c", script], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  return { status: r.status, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

test("Precedence: 3 + 4 * 2 == 11", () => {
  const { out } = evalExpr("3 + 4 * 2");
  assert.ok(/^11(\.0)?$/.test(out), `Expected 11, got "${out}" (parser must apply * before +)`);
});

test("Parentheses: (3 + 4) * 2 == 14", () => {
  const { out } = evalExpr("(3 + 4) * 2");
  assert.ok(/^14(\.0)?$/.test(out), `Expected 14, got "${out}"`);
});

test("Mixed: 10 / 2 - 3 == 2", () => {
  const { out } = evalExpr("10 / 2 - 3");
  assert.ok(/^2(\.0)?$/.test(out), `Expected 2, got "${out}"`);
});

test("Nested parens: 2 * (3 + (4 - 1)) == 12", () => {
  const { out } = evalExpr("2 * (3 + (4 - 1))");
  assert.ok(/^12(\.0)?$/.test(out), `Expected 12, got "${out}"`);
});

test("Division by zero raises ZeroDivisionError", () => {
  const { out } = evalExpr("1 / 0");
  assert.ok(/ZERODIV/.test(out), `Expected ZeroDivisionError, got "${out}"`);
});

test("CLI: calc.py \"3 + 4 * 2\" prints 11", () => {
  assert.ok(existsSync(join(ws, "calc.py")), "calc.py missing");
  const r = spawnSync(python, ["calc.py", "3 + 4 * 2"], {
    cwd: ws, encoding: "utf8", timeout: 10_000,
  });
  const out = (r.stdout || "").trim();
  assert.strictEqual(r.status, 0, `calc.py exited ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.ok(/\b11(\.0)?\b/.test(out), `calc.py output should contain 11, got "${out}"`);
});

test("CLI: calc.py \"2 * (3 + (4 - 1))\" prints 12", () => {
  const r = spawnSync(python, ["calc.py", "2 * (3 + (4 - 1))"], {
    cwd: ws, encoding: "utf8", timeout: 10_000,
  });
  const out = (r.stdout || "").trim();
  assert.strictEqual(r.status, 0, `calc.py exited ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.ok(/\b12(\.0)?\b/.test(out), `calc.py output should contain 12, got "${out}"`);
});
