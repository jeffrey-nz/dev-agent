#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env walking up from cwd
let dir = process.cwd();
for (let i = 0; i < 4; i++) {
  const envPath = resolve(dir, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([^#=][^=]*?)\s*=\s*(["']?)(.*?)\2\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[3];
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

// Optional workspace path — open VS Code if provided
const workspacePath = process.argv[2];
if (workspacePath) {
  spawn("code", [workspacePath], { stdio: "ignore", detached: true }).unref();
}

const { init } = await import(resolve(__dirname, "../node_modules/browser-ai-bridge/src/index.js"));
init();
