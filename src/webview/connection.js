/**
 * connection.js — Bridge polling and provider setup screens
 *
 * Manages the connect screen flow:
 *   1. Poll /api/setup every 2s to detect what phase the bridge is in.
 *   2. Show the provider selection screen if waiting_provider_selection.
 *   3. Show the confirm/launch screen if waiting_confirm.
 *   4. Call _onBridgeReady() when ready — moves to the project screen.
 *
 * Also manages provider confirmation cards (.pcard) shown on the confirm screen.
 *
 * Exports:
 *   cncShow(state)     — switch the connect screen sub-state
 *   cncStartPoll()     — start the bridge polling loop
 *   cncStopPoll()      — stop the bridge polling loop
 *   buildCards(providers) — create provider confirmation card DOM
 *   buildProviderCards(providers) — populate the provider selection list
 *   startBridgeTicker() — start the bridge-launch elapsed timer
 *   stopBridgeTicker()  — stop the bridge-launch elapsed timer
 *   _onBridgeReady(data) — handle bridge_ready / ready phase
 */

import {
  _bridgePort, _inSetupMode, _availableProviders, _selectedProvider,
  setBridgePort, setInSetupMode, setAvailableProviders, setSelectedProvider,
} from './state.js';

// vscode API — acquired in index.js and stored on window
const vscode = window._vscode;

// ── Element refs ───────────────────────────────────────────────────────────
const scrConnect  = document.getElementById('scr-connect');
const scrProvider = document.getElementById('scr-provider');
const scrConfirm  = document.getElementById('scr-confirm');
const scrProject  = document.getElementById('scr-project');
const scrChat     = document.getElementById('scr-chat');
const pcardList   = document.getElementById('pcard-list');

// ── Connect screen state ───────────────────────────────────────────────────

let _cncPollTimer = null;
let _cncElapsed   = 0;
let _cncState     = 'connecting';

/**
 * Switch the connect screen to a given sub-state.
 * Sub-states: 'connecting' | 'waiting' | 'offline' | 'error'
 *
 * @param {'connecting'|'waiting'|'offline'|'error'} state
 */
export function cncShow(state) {
  _cncState = state;
  document.getElementById('cnc-connecting').classList.toggle('hidden', state !== 'connecting');
  document.getElementById('cnc-waiting').classList.toggle('hidden',    state !== 'waiting');
  document.getElementById('cnc-offline').classList.toggle('hidden',    state !== 'offline');
  document.getElementById('cnc-error').classList.toggle('hidden',      state !== 'error');
}

/**
 * Stop the bridge polling interval.
 */
export function cncStopPoll() {
  clearInterval(_cncPollTimer);
  _cncPollTimer = null;
}

/**
 * Single tick of the bridge poll loop.
 * Calls /api/setup and reacts to the current bridge phase.
 *
 * @returns {Promise<void>}
 */
async function _cncTick() {
  try {
    const res = await fetch('http://localhost:' + _bridgePort + '/api/setup', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error('not ok');
    const data = await res.json();

    if (data.phase === 'ready') {
      cncStopPoll();
      _onBridgeReady(data);
    } else if (data.phase === 'waiting_provider_selection') {
      // Only show provider screen if we haven't already advanced past it.
      const alreadyAdvanced = !scrConfirm.classList.contains('hidden')
        || !scrProject.classList.contains('hidden')
        || !scrChat.classList.contains('hidden');
      if (!_inSetupMode && !alreadyAdvanced) {
        setAvailableProviders(data.availableProviders || []);
        setInSetupMode(true);
        buildProviderCards(_availableProviders);
        _showScreen(scrProvider);
        vscode?.postMessage({ type: 'bridge_connected_direct' });
      }
    } else if (data.phase === 'waiting_confirm') {
      if (scrConfirm.classList.contains('hidden')) {
        _showScreen(scrConfirm);
        startBridgeTicker();
      }
      if (data.provider) {
        const pid = data.provider.id;
        const provLabel = data.provider.name || pid;
        if (!pcards[pid]) buildCards([{ id: pid, label: provLabel }]);
        document.getElementById('bridge-launch').style.display = 'none';
        document.getElementById('pcard-list').classList.remove('hidden');
        setCardPending(pid, data.provider.detected);
        const titleEl = scrConfirm.querySelector('.sh-title');
        if (titleEl) titleEl.textContent = 'Log in to ' + provLabel;
      }
      vscode?.postMessage({ type: 'bridge_connected_direct' });
    } else if (data.phase === 'starting') {
      if (_cncState !== 'waiting') cncShow('waiting');
    }
  } catch {
    if (_cncState !== 'offline') {
      cncShow('offline');
      vscode?.postMessage({ type: 'get_bridge_info' });
    }
    _cncElapsed++;
    const countdown = 3 - (_cncElapsed % 3);
    const lbl = document.getElementById('cnc-poll-lbl');
    if (lbl) lbl.textContent = countdown > 0 ? 'Retrying in ' + countdown + 's…' : 'Checking…';
  }
}

/**
 * Start polling the bridge /api/setup endpoint every 2 seconds.
 * Fires one tick immediately.
 */
export function cncStartPoll() {
  cncStopPoll();
  _cncElapsed = 0;
  _cncTick();
  _cncPollTimer = setInterval(_cncTick, 2000);
}

// ── Screen navigation helper ───────────────────────────────────────────────
// Show one screen, hide all others

const ALL_SCRS = [scrConnect, scrConfirm, scrProvider, scrProject, scrChat];

function _showScreen(s) {
  ALL_SCRS.forEach(x => x.classList.add('hidden'));
  s.classList.remove('hidden');
  // Close any open dropdowns
  window._closeDropdowns?.();
}

// Expose on window for other modules (events.js uses show() directly)
window._showScreen = _showScreen;

// ── Provider selection cards (screen 2) ──────────────────────────────────

/**
 * Populate the provider selection list with clickable provider cards.
 * Called when the bridge reports waiting_provider_selection.
 *
 * @param {Array<{id:string, name:string}>} providers
 */
export function buildProviderCards(providers) {
  const list = document.getElementById('psel-list');
  if (!list) return;
  list.innerHTML = '';
  providers.forEach(p => {
    const color = window._PROV_COLORS?.[p.id] || '#888';
    const btn = document.createElement('button');
    btn.className = 'psel-card';
    btn.dataset.id = p.id;
    btn.innerHTML = `<span class="psel-card-dot" style="background:${color}"></span>`
      + `<span class="psel-card-name">${p.name || p.label || p.id}</span>`
      + `<span class="psel-card-arr">›</span>`;
    btn.addEventListener('click', () => _onProviderCardClick(p));
    list.appendChild(btn);
  });
}

/**
 * Handle a provider card click during setup mode.
 * Sends the chosen provider to the bridge and moves to the confirm screen.
 *
 * @param {{ id: string, name?: string, label?: string }} p
 */
async function _onProviderCardClick(p) {
  setSelectedProvider(p.id);
  window._applyProviderChip?.(p.id);
  vscode?.postMessage({ type: 'provider_chosen', id: p.id });

  if (_inSetupMode) {
    setInSetupMode(false);
    buildCards([{ id: p.id, label: p.name || p.label || p.id }]);
    _showScreen(scrConfirm);
    startBridgeTicker();
    try {
      await fetch('http://localhost:' + _bridgePort + '/api/setup/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: [p.id] }),
      });
    } catch { /* ignore network errors */ }
    cncStartPoll();
  } else {
    // Bridge already ready — go straight to project
    _showScreen(scrProject);
    vscode?.postMessage({ type: 'get_workspaces' });
  }
}

// ── Provider confirmation cards (screen 3) ────────────────────────────────

/** Map of provider ID → {el, phase} for confirmation card tracking. */
export let pcards = {};

/**
 * Build the provider confirmation card list.
 *
 * @param {Array<{id:string, label:string}>} providers
 */
export function buildCards(providers) {
  pcardList.innerHTML = '';
  pcards = {};
  providers.forEach(({ id, label }) => {
    const el = document.createElement('div');
    el.className = 'pcard';
    el.dataset.id = id;
    el.innerHTML = `<div class="pcard-head">
      <div class="dot waiting" data-dot></div>
      <span class="pcard-name">${label}</span>
      <span class="pcard-tag" data-tag>Waiting…</span>
    </div>
    <div class="pcard-body hidden" data-body></div>`;
    pcardList.appendChild(el);
    pcards[id] = { el, phase: 'waiting' };
  });
}

/**
 * Set a provider card to "pending" state (needs user confirmation).
 *
 * @param {string}  id  - Provider ID.
 * @param {boolean} det - True if the AI interface was detected in the browser.
 */
export function setCardPending(id, det) {
  const c = pcards[id];
  if (!c) return;
  c.phase = 'pending';
  c.el.querySelector('[data-dot]').className = 'dot pending';
  c.el.querySelector('[data-tag]').textContent = 'Needs confirmation';
  const b = c.el.querySelector('[data-body]');
  b.classList.remove('hidden');
  b.innerHTML = `<div class="${det ? 'det-y' : 'det-n'}">${det ? '✓ Interface detected' : '⚠ Not detected — log in via the browser panel →'}</div>
    <div class="conf-hint">Log in using the browser panel on the right, then confirm.</div>
    <div class="conf-btns">
      <button class="btn-conf">✓ Confirm Ready</button>
      <button class="btn-skip">Skip</button>
    </div>`;
  b.querySelector('.btn-conf').addEventListener('click', confirmCard);
  b.querySelector('.btn-skip').addEventListener('click', skipCard);
}

/**
 * Mark a provider card as done (confirmed or skipped).
 *
 * @param {string}  id     - Provider ID.
 * @param {'confirm'|'skip'} action
 */
export function setCardDone(id, action) {
  const c = pcards[id];
  if (!c) return;
  const ok = action === 'confirm';
  c.phase = ok ? 'confirmed' : 'skipped';
  c.el.querySelector('[data-dot]').className = 'dot ' + (ok ? 'confirmed' : 'skipped');
  c.el.querySelector('[data-tag]').textContent = ok ? '✓ Ready' : 'Skipped';
  c.el.querySelector('[data-body]').classList.add('hidden');
}

/**
 * User clicked "Confirm Ready" — mark pending cards confirmed and notify extension.
 */
function confirmCard() {
  Object.entries(pcards).forEach(([id, c]) => {
    if (c.phase === 'pending') setCardDone(id, 'confirm');
  });
  vscode?.postMessage({ type: 'confirm_provider' });
}

/**
 * User clicked "Skip" — mark pending cards skipped and notify extension.
 */
function skipCard() {
  Object.entries(pcards).forEach(([id, c]) => {
    if (c.phase === 'pending') setCardDone(id, 'skip');
  });
  vscode?.postMessage({ type: 'skip_provider' });
}

// ── Bridge ready handler ──────────────────────────────────────────────────

/**
 * Handle the bridge transitioning to the ready state.
 * Merges provider info, applies the provider chip, and navigates to project screen.
 * No-op if we're already on the project or chat screen.
 *
 * @param {object} data - bridge_ready message payload or /api/setup response.
 */
export function _onBridgeReady(data) {
  if (!scrProject.classList.contains('hidden') || !scrChat.classList.contains('hidden')) return;

  const provs = data?.providers || [];
  if (provs.length) {
    setAvailableProviders(provs.map(p => ({ id: p.id, name: p.label || p.id })));
    if (!_selectedProvider) setSelectedProvider(provs[0].id);
  }

  if (_selectedProvider) window._applyProviderChip?.(_selectedProvider);
  _showScreen(scrProject);
  vscode?.postMessage({ type: 'get_workspaces' });
}

// ── Bridge launch elapsed ticker ──────────────────────────────────────────

let _bridgeLaunchTs = null;
let _elapsedTick    = null;

/**
 * Start a 1-second ticker that updates the "Xs elapsed" label on the confirm screen.
 */
export function startBridgeTicker() {
  _bridgeLaunchTs = Date.now();
  if (_elapsedTick) clearInterval(_elapsedTick);
  _elapsedTick = setInterval(() => {
    const el = document.getElementById('bl-elapsed');
    if (el && _bridgeLaunchTs) {
      el.textContent = Math.round((Date.now() - _bridgeLaunchTs) / 1000) + 's elapsed';
    }
  }, 1000);
}

/**
 * Stop the bridge launch elapsed ticker.
 */
export function stopBridgeTicker() {
  if (_elapsedTick) { clearInterval(_elapsedTick); _elapsedTick = null; }
}
