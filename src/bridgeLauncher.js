const vscode = require("vscode");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

const BRIDGE_BIN = path.join(__dirname, "../node_modules/browser-ai-bridge/bin/browser-ai-bridge.js");
const CONFIG_FILE = path.join(os.tmpdir(), "browser-ai-bridge-config.json");

// Reads the port the bridge bound to. Returns 3333 if config not yet written.
function resolvePort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (cfg.port) return cfg.port;
  } catch {}
  return 3333;
}

function _get(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "localhost", port, path: urlPath, timeout: 2000 },
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

function _post(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "localhost", port, path: urlPath, method: "POST",
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

async function checkStatus() {
  const port = resolvePort();
  const res = await _get(port, "/api/setup");
  if (!res.ok) return { running: false, port };
  return { running: true, phase: res.data?.phase ?? "unknown", port, data: res.data };
}

async function confirmProvider() {
  return _post(resolvePort(), "/api/setup/confirm");
}

async function skipProvider() {
  return _post(resolvePort(), "/api/setup/skip");
}

function launch(providers = []) {
  let binExists = false;
  try { fs.accessSync(BRIDGE_BIN); binExists = true; } catch {}
  console.log(`[DevAgent bridge] launching binary: ${BRIDGE_BIN} (exists=${binExists})`);
  console.log(`[DevAgent bridge] providers: ${providers.join(",") || "(none)"}`);

  if (!binExists) {
    vscode.window.showErrorMessage(
      `Dev Agent: bridge binary not found at ${BRIDGE_BIN}. Run 'npm run sync-modules' in the extension directory.`,
    );
  }

  const terminal = vscode.window.createTerminal({
    name: "browser-ai-bridge",
    env: providers.length ? { BROWSER_AI_PROVIDERS: providers.join(",") } : {},
  });
  terminal.sendText(`node "${BRIDGE_BIN}"`);
  terminal.show(false);
  return terminal;
}

/**
 * Polls until the bridge reaches phase "ready".
 *
 * Key behaviours:
 * - Re-reads the port config on every poll until the server responds, because
 *   the bridge writes the config file AFTER it binds its port.
 * - Emits richer state objects that include `elapsed` and a `waiting_for_server`
 *   phase before the HTTP server is up.
 * - Adaptive delay: 1 500 ms while waiting for the process to start, 700 ms
 *   once the server is responding.
 * - Periodic elapsed heartbeats (every 5 s) so the UI can update a timer even
 *   when the setup phase hasn't changed.
 * - Detects lost-connection (server was up then stopped responding) and emits a
 *   dedicated phase so the panel can show a useful error.
 */
async function waitForReady(onSetupState, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const startTs  = Date.now();
  let serverUp         = false;
  let lastEmittedPhase = null;
  let lastHeartbeat    = 0;
  let port             = resolvePort();
  let pollCount        = 0;

  // Emit immediately so the panel can start showing "launching…"
  onSetupState?.({ phase: "waiting_for_server", elapsed: 0, port });

  while (Date.now() < deadline) {
    pollCount++;
    const elapsed = Math.round((Date.now() - startTs) / 1000);

    // Keep re-reading the port file until the server is up — the bridge writes
    // it after binding, so early reads return the previous value or default.
    if (!serverUp) port = resolvePort();

    const res = await _get(port, "/api/setup");

    let emitPhase, emitData;

    if (res.ok) {
      if (!serverUp) {
        serverUp = true;
        console.log(`[DevAgent bridge] server up port=${port} elapsed=${elapsed}s`);
      }
      emitPhase = res.data?.phase ?? "starting";
      emitData  = { ...res.data, elapsed, port };
    } else {
      if (serverUp) {
        // Was responding, now isn't — possible crash.
        console.log(`[DevAgent bridge] lost connection port=${port} elapsed=${elapsed}s`);
        serverUp = false; // allow port re-read in case it restarted on a new port
        emitPhase = "lost_connection";
      } else {
        emitPhase = "waiting_for_server";
      }
      emitData = { phase: emitPhase, elapsed, port };
    }

    console.log(`[DevAgent bridge] poll #${pollCount} port=${port} elapsed=${elapsed}s phase=${emitPhase}`);

    const phaseChanged = emitPhase !== lastEmittedPhase;
    const heartbeatDue = elapsed - lastHeartbeat >= 5 && elapsed > 0;

    if (phaseChanged || heartbeatDue) {
      lastEmittedPhase = emitPhase;
      lastHeartbeat    = elapsed;
      onSetupState?.(emitData);
    }

    if (emitPhase === "ready") return true;

    // Wait longer while the process is still starting (avoids hammering before
    // the server is even up), faster once it's responding.
    await new Promise((r) => setTimeout(r, serverUp ? 700 : 1500));
  }

  const elapsed = Math.round((Date.now() - startTs) / 1000);
  console.log(`[DevAgent bridge] timed out after ${elapsed}s (${pollCount} polls, serverUp=${serverUp})`);
  onSetupState?.({ phase: "timeout", elapsed, port, serverUp });
  return false;
}

function checkInstall() {
  let binExists = false;
  try { fs.accessSync(BRIDGE_BIN); binExists = true; } catch {}
  return { binExists, binPath: BRIDGE_BIN };
}

module.exports = { isRunning, checkStatus, confirmProvider, skipProvider, launch, waitForReady, resolvePort, checkInstall };
