/**
 * Check script for go-fibonacci benchmark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ws = process.env.BENCHMARK_WORKSPACE;
if (!ws) throw new Error("BENCHMARK_WORKSPACE env var not set");

test("Go source files were created", () => {
  const goFiles = readdirSync(ws).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
  assert.ok(goFiles.length > 0, `No .go source files found. Files: ${readdirSync(ws).join(", ")}`);
});

test("_test.go file was created", () => {
  const testFiles = readdirSync(ws).filter((f) => f.endsWith("_test.go"));
  assert.ok(testFiles.length > 0, `No _test.go files found. Files: ${readdirSync(ws).join(", ")}`);
});

test("go.mod was created", () => {
  assert.ok(existsSync(join(ws, "go.mod")), "go.mod not found — go mod init was not run");
});

test("go test ./... passes with tests present", () => {
  const r = spawnSync("go", ["test", "-v", "./..."], {
    cwd: ws, encoding: "utf8", timeout: 60_000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/command not found|No such file/i.test(out)) return; // go not installed — skip
  assert.ok(!/warning: no tests to run/i.test(out), `go test ran 0 tests:\n${out}`);
  assert.strictEqual(r.status, 0, `go test failed:\n${out}`);
});

test("Fib(10) == 55 and Fib(0) == 0 (correctness smoke)", () => {
  // Inject a tiny verification program into the workspace package and run it.
  // Uses build tag //go:build ignore so it never conflicts with the agent's code.
  const verifyGo = `//go:build ignore
package main

import "fmt"

func main() {
\texpect := map[int]int{0: 0, 1: 1, 2: 1, 3: 2, 10: 55, 20: 6765}
\tfor n, want := range expect {
\t\tgot := Fib(n)
\t\tif got != want {
\t\t\tfmt.Printf("FAIL Fib(%d)=%d want %d\\n", n, got, want)
\t\t\treturn
\t\t}
\t}
\tfmt.Println("ok")
}
`;
  const verifyPath = join(ws, "_bench_fib_verify.go");
  writeFileSync(verifyPath, verifyGo);
  try {
    const r = spawnSync("go", ["run", "_bench_fib_verify.go"], {
      cwd: ws, encoding: "utf8", timeout: 15_000,
    });
    const out = (r.stdout || "") + (r.stderr || "");
    if (/command not found|No such file/i.test(out)) return; // go not installed
    // Build errors mean the Fib function wasn't exported or has wrong signature
    assert.strictEqual(r.status, 0, `Fib correctness check failed:\n${out}`);
    assert.ok(out.includes("ok"), `Fib returned wrong values:\n${out}`);
  } finally {
    try { unlinkSync(verifyPath); } catch {}
  }
});
