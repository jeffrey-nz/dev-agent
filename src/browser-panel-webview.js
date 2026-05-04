/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');
const overlayEl = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const urlBar = document.getElementById('url-bar');
const btnRefresh = document.getElementById('btn-refresh');
const fpsEl = document.getElementById('fps');

let port = (() => {
  try { return JSON.parse(document.getElementById('init-data')?.textContent || '{}').port || 3333; }
  catch { return 3333; }
})();

let remoteW = 1440, remoteH = 900;
let frameCount = 0, lastFpsTs = Date.now();
let pollTimer = null;
let overlayTimer = null;
let hasReceivedFrame = false;
let polling = false;
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

// ── Overlay helpers ───────────────────────────────────────────────────────────

function showOverlay(msg, immediate) {
  clearTimeout(overlayTimer);
  overlayMsg.textContent = msg;
  if (immediate || !hasReceivedFrame) {
    overlayEl.classList.remove('hidden');
  } else {
    // Delay showing the overlay so brief blips don't flash it
    overlayTimer = setTimeout(() => overlayEl.classList.remove('hidden'), 1200);
  }
}

function hideOverlay() {
  clearTimeout(overlayTimer);
  overlayEl.classList.add('hidden');
}

// ── FPS ticker ────────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now(), elapsed = (now - lastFpsTs) / 1000;
  fpsEl.textContent = elapsed > 0 ? Math.round(frameCount / elapsed) + ' fps' : '';
  frameCount = 0; lastFpsTs = now;
}, 1000);

// ── Screencast connection ─────────────────────────────────────────────────────

function handleFrame(payload) {
  const img = new Image();
  img.onload = () => {
    hideOverlay();
    if (!hasReceivedFrame) { hasReceivedFrame = true; fitCanvas(); }
    if (payload.w && payload.h && (payload.w !== remoteW || payload.h !== remoteH)) {
      remoteW = payload.w; remoteH = payload.h; fitCanvas();
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    frameCount++;
  };
  img.src = 'data:image/jpeg;base64,' + payload.f;
}

// Poll /api/browser/frame at ~150ms instead of SSE streaming.
// VS Code webviews do not support streaming fetch body readers, so we use
// simple short-lived requests that definitely work.
let _pollActive = false;

async function pollFrame() {
  if (!polling) return;
  if (_pollActive) { pollTimer = setTimeout(pollFrame, 150); return; }
  _pollActive = true;
  try {
    const r = await fetch(`http://localhost:${port}/api/browser/frame`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.available && d.f) {
      handleFrame(d);
    } else if (!hasReceivedFrame) {
      showOverlay('Waiting for browser…', false);
    }
    pollTimer = setTimeout(pollFrame, 150);
  } catch {
    if (!hasReceivedFrame) showOverlay('Connecting…', false);
    pollTimer = setTimeout(pollFrame, 1500);
  } finally {
    _pollActive = false;
  }
}

function connect() {
  polling = true;
  clearTimeout(pollTimer);
  showOverlay('Connecting…', !hasReceivedFrame);
  pollFrame();
}

function disconnect() {
  polling = false;
  clearTimeout(pollTimer);
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

btnRefresh.addEventListener('click', () => { hasReceivedFrame = false; connect(); });

setInterval(async () => {
  try {
    const r = await fetch(`http://localhost:${port}/api/browser/info`);
    const d = await r.json();
    urlBar.value = d.available && d.url ? d.url : '';
    if (!d.available) showOverlay('Waiting for browser…', true);
  } catch {
    urlBar.value = '';
  }
}, 2000);

// ── Extension messages ────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'set_port' && msg.port !== port) {
    port = msg.port;
    hasReceivedFrame = false;
    disconnect();
    connect();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

fitCanvas();
connect();
