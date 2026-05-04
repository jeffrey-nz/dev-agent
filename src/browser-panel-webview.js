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
let overlayTimer = null;
let hasReceivedFrame = false;

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

// ── Frame rendering ───────────────────────────────────────────────────────────

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

// ── WebSocket connection ──────────────────────────────────────────────────────
// CDP screencast frames are pushed from the bridge over WebSocket in real time,
// giving far higher FPS than the old 150ms HTTP polling approach.

let _ws = null;
let _reconnectTimer = null;
let _reconnecting = false;

function wsUrl() { return `ws://localhost:${port}/api/browser/ws`; }

function connectWs() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(_reconnectTimer);
  showOverlay('Connecting…', !hasReceivedFrame);

  _ws = new WebSocket(wsUrl());

  _ws.onopen = () => {
    _reconnecting = false;
  };

  _ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.f) handleFrame(payload);
    } catch {}
  };

  _ws.onclose = () => {
    _ws = null;
    if (!_reconnecting) {
      const isSetup = hintBar && !hintBar.classList.contains('hidden');
      showOverlay(isSetup ? 'Browser loading…' : 'Waiting for browser…', false);
    }
    _reconnectTimer = setTimeout(connectWs, 1500);
  };

  _ws.onerror = () => {
    // onclose fires immediately after, which handles reconnect
  };
}

function disconnectWs() {
  clearTimeout(_reconnectTimer);
  if (_ws) {
    _ws.onclose = null; // suppress auto-reconnect
    _ws.close();
    _ws = null;
  }
}

function connect() {
  _reconnecting = false;
  connectWs();
}

function disconnect() {
  disconnectWs();
}

// ── Input forwarding ──────────────────────────────────────────────────────────

let _mouseDown = false;

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

btnRefresh.addEventListener('click', () => {
  hasReceivedFrame = false;
  _reconnecting = true;
  disconnectWs();
  connect();
});

setInterval(async () => {
  try {
    const r = await fetch(`http://localhost:${port}/api/browser/info`);
    const d = await r.json();
    urlBar.value = d.available && d.url ? d.url : '';
    if (!d.available) {
      const isSetup = !hintBar?.classList.contains('hidden');
      showOverlay(isSetup ? 'Browser loading…' : 'Waiting for browser…', true);
    }
  } catch {
    urlBar.value = '';
  }
}, 2000);

// ── Extension messages ────────────────────────────────────────────────────────

const hintBar    = document.getElementById('hint-bar');
const hintText   = document.getElementById('hint-text');
const hintSub    = document.getElementById('hint-sub');
const btnConfirm = document.getElementById('btn-hint-confirm');
const btnDismiss = document.getElementById('btn-hint-dismiss');

if (btnConfirm) {
  btnConfirm.addEventListener('click', () => {
    btnConfirm.textContent = '…';
    btnConfirm.disabled = true;
    vscode.postMessage({ type: 'browser_confirm_ready' });
  });
}

if (btnDismiss) {
  btnDismiss.addEventListener('click', () => {
    hintBar?.classList.add('hidden');
  });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'set_port' && msg.port !== port) {
    port = msg.port;
    hasReceivedFrame = false;
    disconnect();
    connect();
  }
  if (msg.type === 'set_hint') {
    if (hintText) hintText.textContent = msg.text || 'Log in here';
    if (hintSub) hintSub.textContent = msg.sub || 'Once logged in, click Confirm Ready →';
    if (btnConfirm) { btnConfirm.textContent = '✓ Confirm Ready'; btnConfirm.disabled = false; }
    hintBar?.classList.remove('hidden');
  }
  if (msg.type === 'clear_hint') {
    hintBar?.classList.add('hidden');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

fitCanvas();
connect();
