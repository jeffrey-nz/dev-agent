/**
 * Check script for react-counter benchmark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ws = process.env.BENCHMARK_WORKSPACE;
if (!ws) throw new Error("BENCHMARK_WORKSPACE env var not set");

test("Counter.tsx was created", () => {
  assert.ok(
    existsSync(join(ws, "src", "Counter.tsx")),
    `src/Counter.tsx not found. src/ contents: ${existsSync(join(ws, "src")) ? readdirSync(join(ws, "src")).join(", ") : "(missing)"}`,
  );
});

test("Counter.test.tsx was created", () => {
  const srcDir = join(ws, "src");
  const testFiles = existsSync(srcDir)
    ? readdirSync(srcDir).filter((f) => /Counter.*\.(test|spec)\.(tsx?|jsx?)$/.test(f))
    : [];
  assert.ok(testFiles.length > 0, `No Counter test file found in src/. src/ contents: ${existsSync(srcDir) ? readdirSync(srcDir).join(", ") : "(missing)"}`);
});

test("node_modules were installed", () => {
  assert.ok(
    existsSync(join(ws, "node_modules")),
    "node_modules/ not found — npm install was not run",
  );
});

test("npm test passes", () => {
  const r = spawnSync("npm", ["test"], {
    cwd: ws, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  // Vitest: "X passed", no "X failed"
  const hasFailed = /\d+\s+failed/i.test(out);
  const hasPassed = /\d+\s+passed/i.test(out) || /tests\s+\d+/i.test(out);
  assert.ok(!hasFailed, `Tests failed:\n${out.slice(-2000)}`);
  assert.ok(r.status === 0, `npm test exited ${r.status}:\n${out.slice(-2000)}`);
  assert.ok(hasPassed, `npm test ran 0 tests or output unclear:\n${out.slice(-1000)}`);
});

test("Counter component has required data-testids", () => {
  const src = readFileSync(join(ws, "src", "Counter.tsx"), "utf8");
  assert.ok(src.includes('data-testid="count"') || src.includes("data-testid='count'"),
    "Counter.tsx missing data-testid=\"count\"");
  assert.ok(src.includes('data-testid="increment"') || src.includes("data-testid='increment'"),
    "Counter.tsx missing data-testid=\"increment\"");
  assert.ok(src.includes('data-testid="decrement"') || src.includes("data-testid='decrement'"),
    "Counter.tsx missing data-testid=\"decrement\"");
});
