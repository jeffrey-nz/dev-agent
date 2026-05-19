#!/usr/bin/env node
/**
 * Benchmark runner: measures AI effectiveness across predefined tasks.
 *
 * Usage:
 *   node scripts/benchmark.mjs [provider] [options]
 *   node scripts/benchmark.mjs anthropic
 *   node scripts/benchmark.mjs deepseek --scenario python-calculator
 *   node scripts/benchmark.mjs anthropic --timeout 600 --keep
 *
 * Options:
 *   --scenario <id>   Run only the named scenario (can repeat for multiple)
 *   --timeout <sec>   Per-scenario timeout override (default: from scenario JSON or 300s)
 *   --out <dir>       Results directory (default: benchmarks/results/)
 *   --keep            Keep temp workspaces after run
 *   --list            List available scenarios and exit
 *   --mode <mode>     Provider mode (e.g. fast, thinking)
 *
 * Requires: browser-ai-bridge must be running (same constraint as run-agent.mjs)
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SCENARIOS_DIR = join(__dirname, "../benchmarks/scenarios");
const DEFAULT_OUT_DIR = join(__dirname, "../benchmarks/results");

// ── Parse CLI args ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let provider = "anthropic";
let providerMode = null;
const scenarioFilter = [];
let timeoutOverrideSec = null;
let outDir = DEFAULT_OUT_DIR;
let keepWorkspace = false;
let listOnly = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--scenario")    { scenarioFilter.push(argv[++i]); }
  else if (a === "--timeout") { timeoutOverrideSec = Number(argv[++i]); }
  else if (a === "--out")     { outDir = argv[++i]; }
  else if (a === "--mode")    { providerMode = argv[++i]; }
  else if (a === "--keep")    { keepWorkspace = true; }
  else if (a === "--list")    { listOnly = true; }
  else if (!a.startsWith("--")) { provider = a; }
}

// ── Load scenarios ───────────────────────────────────────────────────────────

async function loadScenarios() {
  let entries;
  try {
    entries = await fs.readdir(SCENARIOS_DIR);
  } catch {
    console.error(`No scenarios directory found at ${SCENARIOS_DIR}`);
    process.exit(1);
  }
  const scenarioIds = [...new Set(
    entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => basename(f, ".json")),
  )].sort();

  const scenarios = [];
  for (const id of scenarioIds) {
    if (scenarioFilter.length > 0 && !scenarioFilter.includes(id)) continue;
    const jsonPath = join(SCENARIOS_DIR, `${id}.json`);
    try {
      const raw = await fs.readFile(jsonPath, "utf8");
      scenarios.push({ id, ...JSON.parse(raw) });
    } catch (err) {
      console.warn(`  [warn] Could not load scenario "${id}": ${err.message}`);
    }
  }
  return scenarios;
}

// ── Check script runner (same TAP parsing as agent-core evaluate.js) ─────────

function runCheck(checkPath, workspace) {
  return new Promise((resolve) => {
    const output = [];
    let passCount = 0, failCount = 0;

    const child = spawn(process.execPath, ["--test", "--no-warnings", checkPath], {
      env: { ...process.env, BENCHMARK_WORKSPACE: workspace },
      timeout: 60_000,
    });

    child.stdout.on("data", (d) => output.push(d.toString()));
    child.stderr.on("data", (d) => output.push(d.toString()));

    child.on("close", (code) => {
      const full = output.join("");
      for (const line of full.split("\n")) {
        const m = line.match(/^(not ok|ok)\s+\d+\s*[-–]?\s*(.*)/);
        if (m) {
          const passed = m[1] === "ok";
          if (passed) passCount++; else failCount++;
        }
      }
      resolve({ passed: code === 0, passCount, failCount, output: full });
    });

    child.on("error", (err) => {
      resolve({ passed: false, passCount: 0, failCount: 1, output: err.message });
    });
  });
}

// ── Run one scenario ──────────────────────────────────────────────────────────

async function runScenario(scenario, opts) {
  const ws = mkdtempSync(join(os.tmpdir(), `bench-${scenario.id}-`));

  const metrics = {
    coderRetries: 0,
    patchRetries: 0,
    subtasksPassed: 0,
    subtasksFailed: 0,
    phases: [],
  };

  const startMs = Date.now();
  let sessionError = null;

  const { AgentSession } = require(join(__dirname, "../src/agentSession.js"));

  const session = new AgentSession({
    workspaceRoot: ws,
    prompt: scenario.prompt,
    provider: opts.provider,
    providerMode: opts.providerMode,
    onEvent: (e) => {
      if (e.type === "subtask_status") {
        if (e.feedback === "PASS") metrics.subtasksPassed++;
        else if (e.feedback === "FAIL") metrics.subtasksFailed++;
        // retries is cumulative for this subtask — sum across all subtasks
        if (e.retries > 0) metrics.coderRetries += e.retries;
      }
      if (
        e.type === "system_message" &&
        typeof e.text === "string" &&
        /patch review.*issue/i.test(e.text)
      ) {
        metrics.patchRetries++;
      }
      if (e.type === "phase_change") {
        metrics.phases.push({ phase: e.phase, msFromStart: Date.now() - startMs });
      }
    },
  });

  const effectiveTimeoutMs = opts.timeoutSec
    ? opts.timeoutSec * 1000
    : (scenario.timeoutMs || 300_000);

  const timer = setTimeout(() => {
    sessionError = new Error(`Timed out after ${effectiveTimeoutMs / 1000}s`);
    session.stop("timeout");
  }, effectiveTimeoutMs);

  try {
    await session.run();
  } catch (err) {
    if (!sessionError) sessionError = err;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startMs;

  // Evaluate the workspace
  let checkResult = { passed: false, passCount: 0, failCount: 0, output: "no check script" };
  const checkPath = join(SCENARIOS_DIR, `${scenario.id}.check.mjs`);
  try {
    await fs.access(checkPath);
    checkResult = await runCheck(checkPath, ws);
  } catch (err) {
    checkResult = { passed: false, passCount: 0, failCount: 1, output: `Check script error: ${err.message}` };
  }

  if (!opts.keepWorkspace) {
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name || scenario.id,
    language: scenario.language || "unknown",
    provider: opts.provider,
    durationMs,
    sessionError: sessionError?.message || null,
    checkPassed: checkResult.passed,
    checkPassCount: checkResult.passCount,
    checkFailCount: checkResult.failCount,
    checkOutput: checkResult.output,
    coderRetries: metrics.coderRetries,
    patchRetries: metrics.patchRetries,
    subtasksPassed: metrics.subtasksPassed,
    subtasksFailed: metrics.subtasksFailed,
    phases: metrics.phases,
    workspace: opts.keepWorkspace ? ws : null,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function pad(str, n, right = false) {
  const s = String(str ?? "").slice(0, n);
  return right ? s.padStart(n) : s.padEnd(n);
}

function printTable(results) {
  const cols = [
    { label: "Scenario",   key: "name",     w: 22 },
    { label: "Outcome",    key: "outcome",  w: 9  },
    { label: "Tests",      key: "tests",    w: 8  },
    { label: "Duration",   key: "duration", w: 10 },
    { label: "Cod.Retry",  key: "coderR",   w: 9  },
    { label: "PatchRetry", key: "patchR",   w: 10 },
    { label: "Subtasks",   key: "subtasks", w: 12 },
  ];

  const rows = results.map((r) => ({
    name:     r.name,
    outcome:  r.checkPassed ? "PASS" : "FAIL",
    tests:    `${r.checkPassCount}/${r.checkPassCount + r.checkFailCount}`,
    duration: fmtDuration(r.durationMs),
    coderR:   String(r.coderRetries),
    patchR:   String(r.patchRetries),
    subtasks: `${r.subtasksPassed}p/${r.subtasksFailed}f`,
  }));

  const GREEN = "\x1b[32m", RED = "\x1b[31m", RESET = "\x1b[0m", DIM = "\x1b[2m";

  const bar = "+" + cols.map((c) => "-".repeat(c.w + 2)).join("+") + "+";
  const header = "|" + cols.map((c) => ` ${pad(c.label, c.w)} `).join("|") + "|";

  console.log("\n" + bar);
  console.log(header);
  console.log(bar);

  for (let i = 0; i < results.length; i++) {
    const r = results[i], row = rows[i];
    const color = r.checkPassed ? GREEN : RED;
    const cells = cols.map((c) => {
      const val = row[c.key];
      const cell = ` ${pad(val, c.w)} `;
      if (c.key === "outcome") return ` ${color}${pad(val, c.w)}${RESET} `;
      return cell;
    });
    console.log("|" + cells.join("|") + "|");
  }

  console.log(bar);

  const passed = results.filter((r) => r.checkPassed).length;
  const total = results.length;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
  const outcomeColor = passed === total ? GREEN : passed === 0 ? RED : "\x1b[33m";
  console.log(
    `\n  ${total} scenario${total !== 1 ? "s" : ""}  |  ` +
    `${outcomeColor}${passed}/${total} passed (${pct}%)${RESET}  |  ` +
    `Total time: ${DIM}${fmtDuration(totalMs)}${RESET}\n`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const scenarios = await loadScenarios();

if (listOnly) {
  console.log("\nAvailable benchmark scenarios:\n");
  for (const s of scenarios) {
    console.log(`  ${s.id.padEnd(28)} ${s.name || ""} [${s.language || "?"}]`);
  }
  console.log();
  process.exit(0);
}

if (scenarios.length === 0) {
  const msg = scenarioFilter.length > 0
    ? `No scenarios match filter: ${scenarioFilter.join(", ")}`
    : "No scenarios found in benchmarks/scenarios/";
  console.error(msg);
  process.exit(1);
}

const modeLabel = providerMode ? ` (${providerMode})` : "";
console.log(`\n[benchmark] Provider: ${provider}${modeLabel}`);
console.log(`[benchmark] Scenarios: ${scenarios.map((s) => s.id).join(", ")}`);
console.log(`[benchmark] Timeout: ${timeoutOverrideSec ? timeoutOverrideSec + "s (override)" : "per-scenario"}`);
if (keepWorkspace) console.log("[benchmark] Workspaces will be kept after run");
console.log();

await fs.mkdir(outDir, { recursive: true });

const runOpts = {
  provider,
  providerMode,
  timeoutSec: timeoutOverrideSec,
  keepWorkspace,
};

const results = [];
const runStartedAt = Date.now();

for (const scenario of scenarios) {
  const label = `${scenario.id} (${scenario.language || "?"})`;
  process.stdout.write(`  Running: ${label} ... `);

  let result;
  try {
    result = await runScenario(scenario, runOpts);
  } catch (err) {
    result = {
      scenarioId: scenario.id,
      name: scenario.name || scenario.id,
      language: scenario.language || "unknown",
      provider,
      durationMs: 0,
      sessionError: err.message,
      checkPassed: false,
      checkPassCount: 0,
      checkFailCount: 1,
      checkOutput: err.message,
      coderRetries: 0,
      patchRetries: 0,
      subtasksPassed: 0,
      subtasksFailed: 0,
      phases: [],
    };
  }

  const PASS = "\x1b[32mPASS\x1b[0m", FAIL = "\x1b[31mFAIL\x1b[0m";
  const outcome = result.checkPassed ? PASS : FAIL;
  console.log(`${outcome}  (${fmtDuration(result.durationMs)})`);
  if (result.sessionError) console.log(`    Error: ${result.sessionError}`);

  results.push(result);
}

printTable(results);

// Save JSON results
const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const outFile = join(outDir, `${ts}_${provider}.json`);
const runSummary = {
  provider,
  providerMode,
  startedAt: new Date(runStartedAt).toISOString(),
  completedAt: new Date().toISOString(),
  totalDurationMs: Date.now() - runStartedAt,
  passRate: results.filter((r) => r.checkPassed).length / results.length,
  results,
};
await fs.writeFile(outFile, JSON.stringify(runSummary, null, 2), "utf8");
console.log(`  Results saved to: ${outFile}\n`);
