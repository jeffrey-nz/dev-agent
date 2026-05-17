#!/usr/bin/env node
/**
 * Standalone agent runner for testing.
 * Usage: node scripts/run-agent.mjs <provider> <workspace> <prompt>
 *
 * Streams events to stdout and writes a session log to /tmp/agent-test.log
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const [,, provider = "deepseek", workspace = "/tmp/agent-test", ...rest] = process.argv;
// Allow --mode <mode> anywhere after the workspace (e.g. fast / thinking / pro).
let providerMode = null;
const modeIdx = rest.indexOf("--mode");
if (modeIdx !== -1) {
  providerMode = rest[modeIdx + 1];
  rest.splice(modeIdx, 2);
}
const prompt = rest.join(" ") || "Hello, build a simple hello world project.";

console.log(`[runner] Provider: ${provider}${providerMode ? ` (mode: ${providerMode})` : ""}`);
console.log(`[runner] Workspace: ${workspace}`);
console.log(`[runner] Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`);
console.log(`[runner] Starting agent...\n`);

// Simple logger that writes to /tmp/agent-test.log
const logPath = "/tmp/agent-test.log";
const logFd = fs.openSync(logPath, "w");
const log = (line) => {
  fs.writeSync(logFd, line + "\n");
  process.stdout.write(line + "\n");
};

const { AgentSession } = require(join(__dirname, "../src/agentSession.js"));

const session = new AgentSession({
  workspaceRoot: workspace,
  prompt,
  provider,
  providerMode,
  onEvent: (e) => {
    if (e.type === "system_message") {
      log(`[${e.level || "info"}] ${e.text}`);
    } else if (e.type === "phase_change") {
      log(`[phase] ${e.phase} — ${e.label || ""}`);
    } else if (e.type === "tool_call_start") {
      log(`[tool] ${e.tool}${e.paramsSummary ? ": " + e.paramsSummary.slice(0, 80) : ""}`);
    } else if (e.type === "tool_call_end" && e.isError) {
      log(`[tool-err] ${e.tool}: ${e.error || "error"}`);
    } else if (e.type === "message_complete" && e.text) {
      log(`[msg] ${e.text.slice(0, 300)}${e.text.length > 300 ? "..." : ""}`);
    } else if (e.type === "session_end") {
      log(`[done] Session ended.`);
    }
  },
  logger: {
    start: (meta) => log(`[session] START ${JSON.stringify(meta)}`),
    end: () => log(`[session] END`),
    info: (t) => log(`[info] ${t}`),
    error: (t) => log(`[error] ${t}`),
    event: () => {},
  },
});

process.on("SIGINT", () => {
  console.log("\n[runner] Stopping...");
  session.stop();
});

const start = Date.now();
await session.run();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

log(`\n[runner] Session complete in ${elapsed}s`);
log(`[runner] Log written to ${logPath}`);
fs.closeSync(logFd);
