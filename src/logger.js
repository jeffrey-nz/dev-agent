const fs = require("fs");
const path = require("path");

class SessionLogger {
  constructor(extensionPath) {
    this._path = path.join(extensionPath, "dev-agent.log");
    this._fd = null;
  }

  start(meta = {}) {
    // Overwrite the previous session log every time
    this._fd = fs.openSync(this._path, "w");
    this._write(`=== Dev Agent Session ===`);
    this._write(`Started: ${new Date().toISOString()}`);
    for (const [k, v] of Object.entries(meta)) {
      this._write(`${k}: ${v}`);
    }
    this._write("");
  }

  event(type, data = {}) {
    const parts = [`[${new Date().toISOString()}] [${type}]`];
    if (data.text) parts.push(data.text);
    else if (data.content) parts.push(data.content);
    else if (data.message) parts.push(data.message);
    const extras = Object.entries(data)
      .filter(([k]) => !["text", "content", "message", "type"].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    if (extras) parts.push(`(${extras})`);
    this._write(parts.join(" "));
  }

  info(text) {
    this._write(`[${new Date().toISOString()}] [info] ${text}`);
  }

  error(text) {
    this._write(`[${new Date().toISOString()}] [error] ${text}`);
  }

  end() {
    this._write(`\nEnded: ${new Date().toISOString()}`);
    if (this._fd !== null) {
      try { fs.closeSync(this._fd); } catch {}
      this._fd = null;
    }
  }

  _write(line) {
    if (this._fd === null) return;
    try {
      fs.writeSync(this._fd, line + "\n");
    } catch {}
  }
}

module.exports = { SessionLogger };
