#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";

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

const workspacePath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : null;
const extensionDir = resolve(__dirname, "..");

// Open VS Code as soon as the bridge HTTP server is up and waiting for
// provider selection (waiting_provider_selection phase). No need to wait
// for the full ready state — the VS Code panel drives the rest.
if (workspacePath) {
  let opened = false;
  const poll = setInterval(() => {
    if (opened) return;
    const req = http.get(
      { host: "localhost", port: 3333, path: "/api/setup", timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const phase = data.phase;
            // Open as soon as the server is up and waiting for UI input.
            const openPhases = ["waiting_provider_selection", "waiting_confirm", "ready"];
            if (openPhases.includes(phase) && !opened) {
              opened = true;
              clearInterval(poll);
              console.log(`\n[dev-agent] Bridge ready (phase=${phase}) — opening VS Code at ${workspacePath}`);
              spawn("code", [
                "--new-window",
                `--extensionDevelopmentPath=${extensionDir}`,
                workspacePath,
              ], { stdio: "ignore", detached: true }).unref();
            }
          } catch {}
        });
      },
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
  }, 1500);
}

const { init } = await import(resolve(__dirname, "../node_modules/browser-ai-bridge/src/index.js"));
init();
