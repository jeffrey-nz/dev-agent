/**
 * events.js — Main `window.addEventListener('message', ...)` handler
 *
 * Processes all events forwarded from the VS Code extension host.
 * Each case corresponds to an event type in FORWARDED_EVENTS (agentSession.js).
 *
 * This module is intentionally free of DOM setup — it only reacts to
 * incoming messages and delegates to the appropriate module functions.
 *
 * Event types handled here:
 *   bridge_port, bridge_info, bridge_offline, bridge_starting
 *   setup_state, bridge_ready, bridge_failed
 *   workspaces, folder_chosen, workspace_confirmed, show_project_screen
 *   provider_selected_quickpick
 *   phase_change
 *   tool_call_start, tool_call_end
 *   file_diff
 *   message_chunk, message_complete
 *   task_started
 *   session_replay
 *   system_message
 *   debug_snapshot_request
 *   session_end, task_complete
 *   subtask_kickoff, subtask_status
 *   progress_update, research_progress, pipeline_selected
 *   browser_context_update
 *   session_handoff, copilot365_segment_boundary
 *   session_role_update
 */

import {
  _bridgePort, _inSetupMode, _selectedProvider, _availableProviders, _activeTaskId,
  setBridgePort, setInSetupMode, setSelectedProvider, setAvailableProviders,
  setActiveTaskId, setStoppedByUser, setHadError,
  _stoppedByUser, _hadError, currentPhase, setCurrentPhase, setLastPhase,
  _streamingEl, _streamingBuf, setStreamingEl, setStreamingBuf,
  _stepTimes, setStepTimes,
} from './state.js';

import { renderMarkdown, extractAgentText } from './markdown.js';
import { addFileDiff } from './diffs.js';
import { createSession, finishSession } from './sessions.js';
import {
  setStep, setProgress, resetProgress, startPhaseTimer, stopPhaseTimer,
  enterStep, renderPhasePills, addPhaseDivider, PHASE_COLORS, PHASE_PROGRESS,
  phaseToStep, STEPS,
} from './phases.js';
import { toolStyle, addToolCard, resolveCard, flushReads, readBuf } from './tools.js';
import { addActivityChip, updateSessionDelta, updatePhaseStats, addChangesSummary } from './activity.js';
import {
  addUserMsg, addAgentMsg, addSysMsg, addAttachmentMsg,
  addSpecialCard, addDoneBanner, addStopBanner, addHandoffCard,
  updateCtxMeter, ibt, showTyping, hideTyping, _addExpandToggle,
} from './messages.js';
import {
  cncShow, cncStartPoll, cncStopPoll, buildCards, buildProviderCards,
  startBridgeTicker, stopBridgeTicker, setCardPending, setCardDone,
  pcards, _onBridgeReady,
} from './connection.js';
import { debugSnapshot } from './export.js';
import { showToast, showRateLimitToast } from './toast.js';
import { _debugLog, MAX_DEBUG_LOG } from './state.js';

// vscode API (set by index.js)
const vscode = window._vscode;

// ── Element refs ───────────────────────────────────────────────────────────
const scrConnect  = document.getElementById('scr-connect');
const scrProvider = document.getElementById('scr-provider');
const scrConfirm  = document.getElementById('scr-confirm');
const scrProject  = document.getElementById('scr-project');
const scrChat     = document.getElementById('scr-chat');
const pcardList   = document.getElementById('pcard-list');
const projBody    = document.getElementById('proj-body');
const phaseBar    = document.getElementById('phase-bar');
const phaseLbl    = document.getElementById('phase-lbl');
const phaseStats  = document.getElementById('phase-stats');
const phasePillsEl = document.getElementById('phase-pills');
const toolChip    = document.getElementById('tool-chip');
const hdrProj     = document.getElementById('hdr-proj');
const phaseSubtask = document.getElementById('phase-subtask');
const taskPin     = document.getElementById('task-pin');
const typingLblEl = document.querySelector('#typing .t-lbl');
const progressFill = document.getElementById('progress-fill');
const aiSessionsBar = document.getElementById('ai-sessions-bar');
const aiSessPrimary = document.getElementById('ai-sess-primary');
const aiSessAuxiliary = document.getElementById('ai-sess-auxiliary');
const btnSend     = document.getElementById('btn-send');
const btnStop     = document.getElementById('btn-stop');
const ctxMeterEl  = document.getElementById('ctx-meter');

// ── System message deduplication ──────────────────────────────────────────
// Suppresses repeated identical messages within a short window

let _lastSysMsg = { text: '', ts: 0 };

// ── Streaming render throttle ──────────────────────────────────────────────
// Batches chunk renders to ~30fps so rapid streaming doesn't thrash the DOM

let _streamRenderTimer = null;

// ── Debug log helper ───────────────────────────────────────────────────────

function _dlog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  _debugLog.push(`[${ts}] ${msg}`);
  if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.shift();
}

// ── Screen helper ──────────────────────────────────────────────────────────

function show(s) { window._showScreen?.(s); }

// ── AI session bar helpers ─────────────────────────────────────────────────

const _PROVIDER_LABELS = {
  deepseek: 'DeepSeek', chatgpt: 'ChatGPT', gemini: 'Gemini',
  grok: 'Grok', copilot: 'Copilot', claude: 'Claude', unknown: '—',
};

function _providerLabel(id) {
  if (!id) return '—';
  return _PROVIDER_LABELS[id.toLowerCase()] || id;
}

/**
 * Update the AI sessions bar for primary or auxiliary role.
 *
 * @param {'primary'|'auxiliary'} role
 * @param {'active'|'idle'} status
 * @param {string} provider
 * @param {string} [task]
 */
function updateAiSessionBar(role, status, provider, task) {
  if (!aiSessionsBar) return;
  const el = role === 'primary' ? aiSessPrimary : aiSessAuxiliary;
  if (!el) return;
  const nameEl = el.querySelector('.ai-sess-name');
  const taskEl = el.querySelector('.ai-sess-task');
  const isActive = status === 'active';
  el.classList.toggle('active', isActive);
  if (nameEl) nameEl.textContent = _providerLabel(provider);
  if (taskEl) taskEl.textContent = isActive && task ? task : '';
  aiSessionsBar.classList.add('show');
}

function resetAiSessionBar() {
  if (!aiSessionsBar) return;
  aiSessionsBar.classList.remove('show');
  [aiSessPrimary, aiSessAuxiliary].forEach(el => {
    if (!el) return;
    el.classList.remove('active');
    const nameEl = el.querySelector('.ai-sess-name');
    const taskEl = el.querySelector('.ai-sess-task');
    if (nameEl) nameEl.textContent = '—';
    if (taskEl) taskEl.textContent = '';
  });
}

// ── Workspace list renderer ────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render the workspace list on the project selection screen.
 *
 * @param {Array<{name:string, path:string}>} folders
 */
function renderWorkspaces(folders) {
  projBody.innerHTML = '';
  if (folders.length) {
    const l = document.createElement('div');
    l.className = 'proj-lbl'; l.textContent = 'Open workspaces';
    projBody.appendChild(l);
    folders.forEach(f => {
      const c = document.createElement('div');
      c.className = 'proj-card';
      c.innerHTML = `<div class="pinfo"><div class="pname">${esc(f.name)}</div><div class="ppath">${esc(f.path)}</div></div>`
        + `<span class="parr">›</span>`;
      c.addEventListener('click', () => chooseFolder(f));
      projBody.appendChild(c);
    });
  } else {
    const e = document.createElement('div');
    e.className = 'proj-lbl';
    e.textContent = 'No workspace folders open';
    projBody.appendChild(e);
  }
}

/**
 * Confirm a workspace folder selection.
 * @param {{ name:string, path:string }} f
 */
function chooseFolder(f) {
  vscode?.postMessage({ type: 'confirm_workspace', name: f.name, path: f.path });
}

// ── Provider chip / dropdown ───────────────────────────────────────────────
// window._applyProviderChip is defined in index.js (entry point) where the
// DOM refs for btn-prov / prov-name / prov-drop are available as module-level vars.

// ── Main message handler ───────────────────────────────────────────────────

/**
 * Register the window-level message handler that processes all events
 * forwarded from the VS Code extension host.
 */
export function registerMessageHandler() {
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg?.type) return;
    _handleMessage(msg);
  });
}

/**
 * Process a single message from the extension host.
 * @param {object} msg
 */
function _handleMessage(msg) {
  switch (msg.type) {

    case 'bridge_port':
      setBridgePort(msg.port || 3333);
      break;

    case 'bridge_info': {
      const cmd = document.getElementById('cnc-cmd');
      if (cmd) cmd.textContent = msg.cmd || 'dev-agent';
      break;
    }

    case 'bridge_offline':
      // Don't reset UI mid-session — the bridge may be slow under load.
      if (window._runningSid !== null) break;
      cncStopPoll();
      stopBridgeTicker();
      setInSetupMode(false);
      setSelectedProvider(null);
      Object.keys(pcards).forEach(id => delete pcards[id]);
      show(scrConnect);
      cncShow('offline');
      cncStartPoll();
      break;

    case 'bridge_starting':
      // Handled via setup_state messages; no UI action needed here.
      break;

    case 'setup_state': {
      const st = msg.state;
      if (!st) break;
      const blLaunch  = document.getElementById('bridge-launch');
      const blStage   = document.getElementById('bl-stage');
      const blDetail  = document.getElementById('bl-detail');
      const blElapsed = document.getElementById('bl-elapsed');
      const blPort    = document.getElementById('bl-port');

      if (st.elapsed != null && blElapsed) blElapsed.textContent = st.elapsed + 's elapsed';
      if (st.port && blPort) blPort.textContent = 'port ' + st.port;

      if (st.phase === 'waiting_provider_selection') {
        const alreadyAdvanced = !scrConfirm.classList.contains('hidden')
          || !scrProject.classList.contains('hidden')
          || !scrChat.classList.contains('hidden');
        if (!_inSetupMode && !alreadyAdvanced) {
          setAvailableProviders(st.availableProviders || []);
          setInSetupMode(true);
          buildProviderCards(_availableProviders);
          show(scrProvider);
        }
      } else if (st.phase === 'waiting_for_server') {
        blLaunch?.classList.remove('error');
        if (blStage)  blStage.textContent  = 'Launching browser process…';
        if (blDetail) blDetail.textContent = 'Starting the browser and automation server';
        pcardList.classList.add('hidden');
        if (blLaunch) blLaunch.style.display = '';
      } else if (st.phase === 'starting') {
        blLaunch?.classList.remove('error');
        if (blStage)  blStage.textContent  = 'Browser connected';
        if (blDetail) blDetail.textContent = 'Running authentication sequence…';
        pcardList.classList.add('hidden');
        if (blLaunch) blLaunch.style.display = '';
      } else if (st.phase === 'waiting_confirm') {
        if (scrConfirm.classList.contains('hidden')) { show(scrConfirm); startBridgeTicker(); }
        if (blLaunch) blLaunch.style.display = 'none';
        pcardList.classList.remove('hidden');
        if (st.provider) {
          const pid = st.provider.id;
          const provLabel = st.provider.name || pid;
          if (!pcards[pid]) buildCards([{ id: pid, label: provLabel }]);
          setCardPending(pid, st.provider.detected);
          const titleEl = scrConfirm.querySelector('.sh-title');
          if (titleEl) titleEl.textContent = 'Log in to ' + provLabel;
        }
      } else if (st.phase === 'lost_connection') {
        blLaunch?.classList.add('error');
        if (blStage)  blStage.textContent  = 'Lost connection to browser process';
        if (blDetail) blDetail.textContent = 'Lost connection — the bridge process may have crashed.';
        pcardList.classList.add('hidden');
        if (blLaunch) blLaunch.style.display = '';
      }
      break;
    }

    case 'bridge_ready':
      cncStopPoll();
      stopBridgeTicker();
      Object.keys(pcards).forEach(id => { if (pcards[id].phase === 'waiting') setCardDone(id, 'confirm'); });
      _onBridgeReady(msg);
      break;

    case 'bridge_failed':
      cncStopPoll();
      stopBridgeTicker();
      if (!scrChat.classList.contains('hidden') || !scrProject.classList.contains('hidden')) break;
      show(scrConnect);
      cncShow('error');
      const errTxt = document.getElementById('cnc-err-txt');
      if (errTxt) errTxt.textContent = msg.text || 'Bridge failed to start.';
      break;

    case 'workspaces':
      renderWorkspaces(msg.folders || []);
      break;

    case 'folder_chosen':
      chooseFolder(msg.folder);
      break;

    case 'workspace_confirmed':
      if (hdrProj) hdrProj.textContent = msg.name || '—';
      show(scrChat);
      break;

    case 'show_project_screen':
      show(scrProject);
      vscode?.postMessage({ type: 'get_workspaces' });
      break;

    case 'provider_selected_quickpick':
      if (msg.id) {
        setSelectedProvider(msg.id);
        window._applyProviderChip?.(msg.id);
      }
      break;

    case 'phase_change': {
      const ph = msg.phase || '';
      import('./state.js').then(({ lastPhase: lp }) => {
        if (ph === lp) return;
      });
      // Use captured refs to avoid re-importing
      if (ph === window._lastPhase) break;
      flushReads();
      window._lastPhase = ph;
      setLastPhase(ph);
      setCurrentPhase(ph);
      _dlog('phase_change: ' + ph);

      const L = {
        EXECUTION: 'Executing', PLANNING: 'Planning',
        ORCHESTRATING: 'Orchestrating', RESEARCHING: 'Researching',
        SCOPING: 'Scoping', VERIFYING: 'Verifying',
        REVIEWING: 'Reviewing', DEBUGGING: 'Debugging', WRITING: 'Writing',
      };
      const label = (L[ph] || msg.label || ph) + '…';
      if (phaseLbl) phaseLbl.textContent = label;
      startPhaseTimer(label);

      const phColor = PHASE_COLORS[ph] || 'var(--acc)';
      phaseBar?.style.setProperty('--phase-color', phColor);
      if (progressFill) progressFill.style.setProperty('--phase-color', phColor);
      const typingEl2 = document.getElementById('typing');
      typingEl2?.style.setProperty('--phase-color', phColor);
      if (typingLblEl) typingLblEl.textContent = L[ph] || ph;

      const pct = PHASE_PROGRESS[ph];
      if (pct) setProgress(pct);
      const si = phaseToStep(ph);
      if (si >= 0) { setStep(si, ph === 'DEBUGGING'); enterStep(si); }
      addPhaseDivider(ph);
      break;
    }

    case 'tool_call_start':
      if (msg.tool) {
        _dlog('tool_start: ' + msg.tool + ' ' + (msg.paramsSummary || '').slice(0, 40));
        const ts_ = toolStyle(msg.tool);
        if (ts_.label === 'read') {
          if (msg.paramsSummary) {
            window._readsThisSession?.add(msg.paramsSummary.split('\n')[0].trim());
          }
          readBuf.push({ n: msg.tool, s: msg.paramsSummary || '' });
          if (toolChip) { toolChip.style.display = 'flex'; toolChip.textContent = '↳ ' + (msg.paramsSummary || msg.tool).slice(0, 36); }
        } else if (ts_.label === 'write') {
          if (msg.paramsSummary) {
            const p = msg.paramsSummary.split('\n')[0].trim();
            if (!window._writesThisSession?.find(f => f.path === p)) {
              window._writesThisSession?.push({ path: p, isNew: !window._readsThisSession?.has(p) });
            }
          }
          hideTyping(); addToolCard(msg.tool, msg.paramsSummary);
          if (toolChip) { toolChip.style.display = 'flex'; toolChip.textContent = '↳ ' + (msg.paramsSummary || msg.tool).slice(0, 36); }
        } else if (ts_.label === 'run') {
          if (window._runsThisSession != null) window._runsThisSession++;
          hideTyping(); addToolCard(msg.tool, msg.paramsSummary);
          if (toolChip) { toolChip.style.display = 'flex'; toolChip.textContent = '↳ ' + (msg.paramsSummary || msg.tool).slice(0, 36); }
        } else {
          hideTyping(); addToolCard(msg.tool, msg.paramsSummary);
          if (toolChip) { toolChip.style.display = 'flex'; toolChip.textContent = '↳ ' + (msg.paramsSummary || msg.tool).slice(0, 36); }
        }
        updatePhaseStats();
      }
      break;

    case 'tool_call_end': {
      const isRead  = toolStyle(msg.tool || '').label === 'read';
      const isWrite = toolStyle(msg.tool || '').label === 'write';
      const isRun   = toolStyle(msg.tool || '').label === 'run';
      // Increment tool counter for the running session
      if (window._sessions) {
        const s = window._sessions.find(x => x.id === window._runningSid);
        if (s) s.tools = (s.tools || 0) + 1;
      }
      // Track tools per phase step (shown in phase pills at completion)
      {
        const times = window._stepTimes;
        const si    = window._currentStepIdx ?? -1;
        if (si >= 0 && times?.[si]) {
          times[si].tools = (times[si].tools || 0) + 1;
        }
      }
      if (isRead) {
        if (toolChip) toolChip.style.display = 'none';
      } else {
        flushReads();
        resolveCard(!!msg.isError, msg.elapsed);
        if (toolChip) toolChip.style.display = 'none';
        if (!isWrite || msg.isError) showTyping();
        if (msg.isError) {
          const errDetail = msg.errorSummary || msg.error || msg.tool;
          addSysMsg('Tool error: ' + errDetail, true);
        } else if (isRun && msg.result && !msg.result.startsWith('[ERROR]')) {
          const out = msg.result.trimEnd();
          if (out && out.length > 2) {
            if (out.length > 300) {
              // Long output: show a collapsible block (first ~10 lines collapsed)
              const firstLines = out.split('\n').slice(0, 8).join('\n');
              const wrap = document.createElement('div');
              wrap.className = 'run-output-wrap collapsed';
              const pre = document.createElement('pre');
              pre.className = 'run-output';
              pre.textContent = out;
              const toggle = document.createElement('button');
              toggle.className = 'run-output-toggle';
              toggle.textContent = 'Show all ' + out.split('\n').length + ' lines ▾';
              toggle.addEventListener('click', () => {
                const isCollapsed = wrap.classList.toggle('collapsed');
                toggle.textContent = isCollapsed
                  ? 'Show all ' + out.split('\n').length + ' lines ▾'
                  : 'Show less ▴';
              });
              const preview = document.createElement('pre');
              preview.className = 'run-output-preview';
              preview.textContent = firstLines + '\n…';
              wrap.appendChild(preview);
              wrap.appendChild(pre);
              wrap.appendChild(toggle);
              ibt(wrap);
            } else {
              const pre = document.createElement('pre');
              pre.className = 'run-output';
              pre.textContent = out;
              ibt(pre);
            }
          }
        }
      }
      break;
    }

    case 'file_diff': {
      const diffEl = addFileDiff(msg);
      ibt(diffEl);
      addActivityChip(msg, diffEl);
      updateSessionDelta(msg.added || 0, msg.removed || 0);
      showTyping();
      break;
    }

    case 'message_chunk': {
      const chunk = msg.text || msg.chunk || '';
      if (!chunk) break;
      const newBuf = _streamingBuf + chunk;
      setStreamingBuf(newBuf);
      if (!_streamingEl) {
        // First chunk — create a streaming element and hide typing
        const el = document.createElement('div');
        el.className = 'msg-a streaming';
        // Tag with the active provider so the badge survives finalization
        const prov = _selectedProvider || '';
        if (prov) el.dataset.prov = prov;
        const provLabel = _PROVIDER_LABELS[prov] || prov;
        const provBadge = prov
          ? ' <span class="msg-via-prov" data-prov="' + prov + '">' + provLabel + '</span>'
          : '';
        el.innerHTML = '<div class="msg-sender agent">Dev Agent' + provBadge + '</div><div class="mab-md"></div>';
        hideTyping();
        ibt(el);
        setStreamingEl(el);
      }
      // Throttle markdown renders to ~30fps to avoid thrashing the DOM
      // on providers that stream very rapidly (e.g. DeepSeek)
      if (!_streamRenderTimer) {
        _streamRenderTimer = setTimeout(() => {
          _streamRenderTimer = null;
          const mdEl2 = _streamingEl?.querySelector('.mab-md');
          if (mdEl2) {
            mdEl2.innerHTML = renderMarkdown(_streamingBuf);
            if (!window._userScrolled) {
              const messages = document.getElementById('messages');
              if (messages) messages.scrollTop = messages.scrollHeight;
            }
          }
        }, 33);
      }
      break;
    }

    case 'message_complete': {
      hideTyping();
      _dlog('message_complete phase=' + currentPhase + ' len=' + (msg.text || msg.content || '').length);

      // Silent phases: discard streaming content without showing it
      const SILENT = new Set(['ORCHESTRATING', 'RESEARCHING', 'SCOPING']);
      if (SILENT.has(currentPhase)) {
        if (_streamingEl) { _streamingEl.remove(); setStreamingEl(null); setStreamingBuf(''); }
        break;
      }

      const raw = msg.text || msg.content || '';
      // [EMPTY_RESPONSE] is a sentinel for context overflow — show as warning
      if (raw.includes('[EMPTY_RESPONSE]')) {
        if (_streamingEl) { _streamingEl.remove(); setStreamingEl(null); setStreamingBuf(''); }
        addSysMsg('⚠ AI returned empty response — resetting session', false, true);
        break;
      }

      if (_streamingEl) {
        // Flush any pending throttled render before finalizing
        if (_streamRenderTimer) { clearTimeout(_streamRenderTimer); _streamRenderTimer = null; }
        // Finalize the streaming element — preserve the sender div (has provider badge)
        const finalText = _streamingBuf || extractAgentText(raw);
        _streamingEl.classList.remove('streaming');
        const senderEl  = _streamingEl.querySelector('.msg-sender');
        const senderHtml = senderEl ? senderEl.outerHTML : '<div class="msg-sender agent">Dev Agent</div>';
        _streamingEl.innerHTML = senderHtml
          + '<div class="mab-md">' + renderMarkdown(finalText) + '</div>'
          + '<button class="msg-copy" onclick="copyMsg(this)" title="Copy response">⎘</button>';
        const body = _streamingEl.querySelector('.mab-md');
        if (body && body.scrollHeight > 320) {
          _streamingEl.classList.add('collapsible');
          _addExpandToggle(_streamingEl, body);
        }
        setStreamingEl(null);
        setStreamingBuf('');
        const messages2 = document.getElementById('messages');
        if (messages2 && !window._userScrolled) messages2.scrollTop = messages2.scrollHeight;
        break;
      }

      // No streaming: normal path
      const cleaned = extractAgentText(raw);
      if (!cleaned.trim()) break;
      if (currentPhase === 'PLANNING')   addSpecialCard('plan', cleaned);
      else if (currentPhase === 'REVIEWING') addSpecialCard('review', cleaned);
      else addAgentMsg(cleaned, _selectedProvider || undefined);
      break;
    }

    case 'task_started':
      setActiveTaskId(msg.taskId || null);
      break;

    case 'session_replay':
      // Replay buffered messages — fires when panel is reopened during/after a session
      if (Array.isArray(msg.messages) && msg.messages.length > 0) {
        if (scrChat.classList.contains('hidden')) show(scrChat);
        for (const m of msg.messages) {
          window.dispatchEvent(new MessageEvent('message', { data: m }));
        }
      }
      break;

    case 'system_message': {
      const isErr  = msg.level === 'error';
      const isWarn = msg.level === 'warning' || msg.level === 'warn';
      const isOk   = !isErr && !isWarn && msg.level === 'info'
        && (msg.text || '').trimStart().startsWith('✓');
      _dlog('sys_msg [' + msg.level + '] ' + (msg.text || '').slice(0, 60));

      // Suppress repeated identical messages within 4 s to reduce noise
      const now = Date.now();
      if (msg.text === _lastSysMsg.text && now - _lastSysMsg.ts < 4000) break;
      _lastSysMsg = { text: msg.text || '', ts: now };

      // Show non-critical info messages as toasts rather than cluttering the feed
      if (!isErr && !isWarn && !isOk && msg.level === 'info') {
        showToast(msg.text, 'info', 3000);
        break;
      }

      if (isErr || isWarn) hideTyping();
      addSysMsg(msg.text, isErr, isWarn, isOk);
      if (isErr) {
        setHadError(true);
        showToast('Error: ' + (msg.text || '').slice(0, 80), 'err', 5000);
      } else if (!window._sessionLocked) {
        if (btnSend) btnSend.classList.remove('hidden');
        if (btnStop) btnStop.classList.add('hidden');
      }
      break;
    }

    case 'rate_limit': {
      const retryMs = msg.retryAfter ? msg.retryAfter * 1000 : 0;
      _dlog('rate_limit retryAfter=' + (msg.retryAfter || '?'));
      showRateLimitToast(retryMs);
      break;
    }

    case 'debug_snapshot_request':
      debugSnapshot();
      break;

    case 'session_end':
    case 'task_complete': {
      // Drop stale events from a replaced session
      if (msg._taskId && _activeTaskId && msg._taskId !== _activeTaskId) break;
      _dlog('session_end type=' + msg.type + ' stopped=' + _stoppedByUser + ' err=' + _hadError);

      flushReads(); hideTyping();
      if (toolChip) toolChip.style.display = 'none';
      taskPin?.classList.remove('show');
      if (phaseSubtask) phaseSubtask.classList.remove('show');
      if (typingLblEl) typingLblEl.textContent = '';
      stopPhaseTimer();

      if (_stoppedByUser) {
        setStoppedByUser(false);
        // Preserve any partial response the AI had started rather than discarding it
        if (_streamingEl && _streamingBuf) {
          _streamingEl.classList.remove('streaming');
          _streamingEl.classList.add('stopped-partial');
          const senderEl2  = _streamingEl.querySelector('.msg-sender');
          const senderHtml2 = senderEl2 ? senderEl2.outerHTML : '<div class="msg-sender agent">Dev Agent</div>';
          _streamingEl.innerHTML = senderHtml2
            + '<div class="mab-md">' + renderMarkdown(_streamingBuf) + '</div>'
            + '<span class="stream-stopped-badge">(stopped)</span>';
        } else if (_streamingEl) {
          _streamingEl.remove();
        }
        setStreamingEl(null);
        setStreamingBuf('');
        if (btnStop) { btnStop.classList.add('hidden'); btnStop.disabled = false; }
        if (btnSend) btnSend.classList.remove('hidden');
        setTimeout(() => {
          phaseBar?.classList.add('hidden');
          window._setCurrentStepIdx?.(-1);
          resetProgress();
        }, 50);
        break;
      }

      if (_streamingEl) { _streamingEl.remove(); setStreamingEl(null); setStreamingBuf(''); }

      if (_hadError) {
        setHadError(false);
        finishSession('error');
        if (btnStop) { btnStop.classList.add('hidden'); btnStop.disabled = false; }
        if (btnSend) btnSend.classList.remove('hidden');
        phaseBar?.classList.add('hidden');
        window._setCurrentStepIdx?.(-1);
        resetProgress();
        break;
      }

      // Natural completion
      setProgress(100, 'var(--ok)');
      setTimeout(() => {
        const pb = document.getElementById('progress-bar');
        if (pb) pb.style.opacity = '0';
      }, 1200);
      setStep(4);

      // Close all open step timers
      const times = [..._stepTimes];
      for (let i = 0; i < 4; i++) {
        if (times[i] && times[i].end === null) times[i].end = Date.now();
      }
      if (!times[4]) times[4] = { start: Date.now(), end: Date.now() };
      setStepTimes(times);
      renderPhasePills();

      addDoneBanner();
      addChangesSummary();
      finishSession('done');
      if (btnSend) btnSend.classList.remove('hidden');
      if (btnStop) { btnStop.classList.add('hidden'); btnStop.disabled = false; }

      setTimeout(() => {
        phaseBar?.classList.add('hidden');
        window._setCurrentStepIdx?.(-1);
        ctxMeterEl?.classList.remove('show');
        const pb2 = document.getElementById('progress-bar');
        if (pb2) pb2.style.opacity = '';
        resetProgress();
        resetAiSessionBar();
        // Auto-focus prompt so the user can immediately type a follow-up
        document.getElementById('prompt')?.focus();
      }, 1500);
      break;
    }

    case 'subtask_kickoff': {
      const idx   = (msg.index || 0) + 1;
      const total = msg.total || '?';
      const label = msg.label || '';
      _dlog('subtask_kickoff: ' + idx + '/' + total + ' "' + label.slice(0, 30) + '"');
      if (typeof total === 'number' && total > (window._subtasksTotal || 0)) {
        window._subtasksTotal = total;
        import('./state.js').then(m => m.setSubtasksTotal(total));
      }
      if (phaseSubtask) {
        phaseSubtask.textContent = idx + ' / ' + total;
        phaseSubtask.title = label;
        phaseSubtask.classList.add('show');
      }
      if (typeof total === 'number' && total > 1 && label) {
        const chip = document.createElement('div');
        chip.className = 'subtask-chip';
        const shortLabel = label.length > 60 ? label.slice(0, 60) + '…' : label;
        chip.innerHTML = '<span class="stc-num">' + idx + ' / ' + total + '</span>'
          + '<span class="stc-label" title="' + esc(label) + '">' + esc(shortLabel) + '</span>';
        ibt(chip);
      }
      if (typingLblEl) typingLblEl.textContent = label.length > 45 ? label.slice(0, 45) + '…' : label;
      break;
    }

    case 'subtask_status': {
      const isPassed = msg.feedback === 'PASS';
      const idx      = (msg.index || 0) + 1;
      const total    = msg.total || '?';
      const retries  = msg.retries || 0;
      const label    = msg.label || '';
      const score    = msg.score != null ? Math.round(msg.score * 100) : null;
      _dlog('subtask_status: ' + msg.feedback + ' [' + idx + '/' + total + '] retries=' + retries);
      if (typeof total === 'number' && total > (window._subtasksTotal || 0)) {
        window._subtasksTotal = total;
        import('./state.js').then(m => m.setSubtasksTotal(total));
      }
      if (isPassed) {
        import('./state.js').then(m => {
          m.setSubtasksCompleted((m._subtasksCompleted || 0) + 1);
        });
        if (phaseSubtask) {
          phaseSubtask.style.filter = 'brightness(1.5)';
          setTimeout(() => { if (phaseSubtask) phaseSubtask.style.filter = ''; }, 700);
        }
      } else if (retries > 0) {
        const shortLabel = label.length > 42 ? label.slice(0, 42) + '…' : label;
        const notice = document.createElement('div');
        notice.className = 'retry-notice';
        notice.innerHTML = '<span class="rn-icon">↺</span>'
          + 'Retry ' + retries
          + (shortLabel ? ' <span class="rn-label" title="' + esc(label) + '">· ' + esc(shortLabel) + '</span>' : '')
          + (score != null ? '<span class="rn-score">' + score + '%</span>' : '');
        ibt(notice);
      }
      break;
    }

    case 'progress_update': {
      const { completed = 0, total = 1 } = msg;
      _dlog('progress_update: ' + completed + '/' + total);
      if (total > 0) {
        const base = PHASE_PROGRESS['EXECUTION'] || 55;
        const pct  = Math.min(90, Math.round(base + ((90 - base) * completed) / total));
        setProgress(pct);
      }
      break;
    }

    case 'research_progress': {
      const { step, maxSteps, elapsed } = msg;
      _dlog('research_progress: step=' + step + (maxSteps ? '/' + maxSteps : ''));
      if (typingLblEl && step != null) {
        const isExecution = currentPhase === 'EXECUTION' || currentPhase === 'WRITING';
        if (isExecution) {
          const existing = typingLblEl.textContent.replace(/ · \d+s$/, '');
          typingLblEl.textContent = existing + (elapsed != null ? ' · ' + elapsed + 's' : '');
        } else {
          typingLblEl.textContent = 'step ' + step + (maxSteps ? '/' + maxSteps : '')
            + (elapsed != null ? ' · ' + elapsed + 's' : '');
        }
      }
      break;
    }

    case 'pipeline_selected': {
      const lbl = msg.pipelineLabel || msg.taskType || 'unknown';
      _dlog('pipeline_selected: ' + lbl);
      if (typingLblEl) typingLblEl.textContent = lbl;
      break;
    }

    case 'browser_context_update':
      updateCtxMeter(msg.messageCount, msg.threshold, msg.segmentIndex);
      break;

    case 'session_handoff':
      addHandoffCard(msg);
      break;

    case 'copilot365_segment_boundary':
      if (!msg._suppressBanner) addHandoffCard(msg);
      break;

    case 'session_role_update':
      _dlog('sess_role: ' + msg.role + ' ' + msg.status + ' ' + msg.provider);
      updateAiSessionBar(msg.role, msg.status, msg.provider, msg.task);
      break;
  }
}
