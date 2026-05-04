/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');
const connectingEl = document.getElementById('connecting');
const urlBar = document.getElementById('url-bar');
const btnRefresh = document.getElementById('btn-refresh');
const fpsEl = document.getElementById('fps');

let port = (() => {
  try { return JSON.parse(document.getElementById('init-data')?.textContent || '{}').port || 3333; }
  catch { return 3333; }
})();
let es = null;
let remoteW = 1440, remoteH = 900;
let frameCount = 0, lastFpsTs = Date.now();
let reconnectTimer = null;
let _mouseDown = false;

// ── Scaling ──────────────────────────────────────────────────────────────────

function fitCanvas() {
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  if (!ww || !wh) return;
  const aspect = remoteW / remoteH;
  let cw = ww, ch = Math.round(ww / aspect);
  if (ch > wh) { ch = wh; cw = Math.round(wh * aspect); }
  canvas.width = cw; canvas.height = ch;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
}

new ResizeObserver(fitCanvas).observe(wrap);

function toRemote(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round((clientX - r.left) * (remoteW / r.width)),
    y: Math.round((clientY - r.top)  * (remoteH / r.height)),
  };
}

// ── FPS ticker ────────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now(), elapsed = (now - lastFpsTs) / 1000;
  if (elapsed > 0) fpsEl.textContent = Math.round(frameCount / elapsed) + ' fps';
  frameCount = 0; lastFpsTs = now;
}, 1000);

// ── Screencast connection ─────────────────────────────────────────────────────

function connect() {
  if (es) { es.close(); es = null; }
  clearTimeout(reconnectTimer);
  connectingEl.style.display = 'flex';
  connectingEl.textContent = 'Connecting…';

  es = new EventSource(`http://localhost:${port}/api/browser/screencast`);

  es.onmessage = (e) => {
    let payload;
    try { payload = JSON.parse(e.data); } catch { return; }
    const img = new Image();
    img.onload = () => {
      if (connectingEl.style.display !== 'none') {
        connectingEl.style.display = 'none';
        fitCanvas();
      }
      if (payload.w && payload.h && (payload.w !== remoteW || payload.h !== remoteH)) {
        remoteW = payload.w; remoteH = payload.h; fitCanvas();
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      frameCount++;
    };
    img.src = 'data:image/jpeg;base64,' + payload.f;
  };

  es.addEventListener('error', () => {
    // Stream event (not error): ignore
  });

  es.onerror = () => {
    if (es) { es.close(); es = null; }
    connectingEl.style.display = 'flex';
    connectingEl.textContent = 'Reconnecting…';
    reconnectTimer = setTimeout(connect, 3000);
  };
}

// ── Input forwarding ──────────────────────────────────────────────────────────

async function input(body) {
  try {
    await fetch(`http://localhost:${port}/api/browser/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
}

canvas.setAttribute('tabindex', '0');

canvas.addEventListener('mousemove', (e) => {
  input({ type: 'mouseMove', ...toRemote(e.clientX, e.clientY) });
});

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  canvas.focus();
  _mouseDown = true;
  input({ type: 'mouseDown', ...toRemote(e.clientX, e.clientY), button: e.button === 2 ? 'right' : 'left' });
});

canvas.addEventListener('mouseup', (e) => {
  if (!_mouseDown) return;
  _mouseDown = false;
  input({ type: 'mouseUp', ...toRemote(e.clientX, e.clientY), button: e.button === 2 ? 'right' : 'left' });
});

canvas.addEventListener('click', (e) => {
  input({ type: 'click', ...toRemote(e.clientX, e.clientY) });
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pos = toRemote(e.clientX, e.clientY);
  input({ type: 'scroll', ...pos, deltaX: e.deltaX, deltaY: e.deltaY });
}, { passive: false });

canvas.addEventListener('keydown', (e) => {
  e.preventDefault();
  // Printable characters → insertText (handles all unicode correctly)
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    input({ type: 'insertText', text: e.key });
  } else {
    input({ type: 'keyDown', key: e.key });
  }
});

canvas.addEventListener('keyup', (e) => {
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey) {
    input({ type: 'keyUp', key: e.key });
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Toolbar ───────────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', () => connect());

// Poll the bridge for current page URL and update the toolbar
setInterval(async () => {
  try {
    const r = await fetch(`http://localhost:${port}/api/browser/info`);
    const d = await r.json();
    if (d.available && d.url) urlBar.value = d.url;
  } catch {}
}, 2000);

// ── Extension messages ────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'set_port') {
    port = msg.port;
    connect();
  } else if (msg.type === 'navigate') {
    // Could drive navigation if needed in future
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

fitCanvas();
connect();
