const vscode = require("vscode");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

const BRIDGE_BIN = path.join(__dirname, "../node_modules/browser-ai-bridge/bin/browser-ai-bridge.js");
const CONFIG_FILE = path.join(os.tmpdir(), "browser-ai-bridge-config.json");

function resolvePort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (cfg.port) return cfg.port;
  } catch {}
  return 3333;
}

function _get(port, path) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "localhost", port, path, timeout: 2000 },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try { resolve({ ok: true, data: JSON.parse(body) }); }
          catch { resolve({ ok: true, data: {} }); }
        });
      },
    );
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
  });
}

function _post(port, path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "localhost", port, path, method: "POST",
        headers: { "Content-Length": 0 }, timeout: 3000 },
      (res) => { res.resume(); resolve(res.statusCode < 400); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function isRunning() {
  const port = resolvePort();
  const res = await _get(port, "/api/ping");
  return res.ok && res.data?.status === "ready";
}

async function getSetupState() {
  const port = resolvePort();
  const res = await _get(port, "/api/setup");
  return res.ok ? res.data : null;
}

async function confirmProvider() {
  return _post(resolvePort(), "/api/setup/confirm");
}

async function skipProvider() {
  return _post(resolvePort(), "/api/setup/skip");
}

function launch(providers = []) {
  const terminal = vscode.window.createTerminal({
    name: "browser-ai-bridge",
    env: providers.length ? { BROWSER_AI_PROVIDERS: providers.join(",") } : {},
  });
  terminal.sendText(`node "${BRIDGE_BIN}"`);
  terminal.show(false);
  return terminal;
}

/**
 * Waits until the bridge's setup state is "ready".
 * Calls onSetupState(state) whenever the state changes so the caller can
 * update the UI with pending provider confirmations.
 */
async function waitForReady(onSetupState, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastPhase = null;

  while (Date.now() < deadline) {
    const state = await getSetupState();

    if (state && state.phase !== lastPhase) {
      lastPhase = state.phase;
      onSetupState?.(state);
    }

    if (state?.phase === "ready") return true;

    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

module.exports = { isRunning, getSetupState, confirmProvider, skipProvider, launch, waitForReady };
