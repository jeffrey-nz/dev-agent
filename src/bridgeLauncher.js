const vscode = require("vscode");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

// Resolved at runtime so it works from both dist/ and src/ contexts
const BRIDGE_BIN = path.join(__dirname, "../node_modules/browser-ai-bridge/bin/browser-ai-bridge.js");

const CONFIG_FILE = path.join(os.tmpdir(), "browser-ai-bridge-config.json");

function resolvePort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (cfg.port) return cfg.port;
  } catch {}
  return 3333;
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "localhost", port, path: "/api/ping", timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function isRunning() {
  return ping(resolvePort());
}

function launch(providers = []) {
  const terminal = vscode.window.createTerminal({
    name: "browser-ai-bridge",
    env: providers.length
      ? { BROWSER_AI_PROVIDERS: providers.join(",") }
      : {},
  });
  terminal.sendText(`node "${BRIDGE_BIN}"`);
  terminal.show(false); // show without stealing focus from the sidebar
  return terminal;
}

async function waitForReady(onProgress, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const port = resolvePort();
    if (await ping(port)) return true;
    attempt++;
    onProgress?.(`Waiting for bridge… (${attempt}s)`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

module.exports = { isRunning, launch, waitForReady };
