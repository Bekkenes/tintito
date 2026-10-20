import {
  Terminal, cellsToRuns, CP437, DEFAULT_STYLE,
  BOLD, DIM, ITALIC, UNDERLINE, BLINK, INVERSE, HIDDEN, STRIKE,
} from './terminal.js';

const $ = (sel, root = document) => root.querySelector(sel);

const FONTS = {
  jetbrains: { name: 'JetBrains Mono', family: '"JetBrains Mono"', stack: '"JetBrains Mono", ui-monospace, monospace' },
  plex: { name: 'IBM Plex Mono', family: '"IBM Plex Mono"', stack: '"IBM Plex Mono", ui-monospace, monospace' },
  system: { name: 'System mono', family: 'ui-monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
};

const PREFS_KEY = 'tintito.prefs.v1';
const LAST_KEY = 'tintito.last.v1';
const DEFAULTS = { font: 'jetbrains', size: 14, theme: 'midnight', encoding: 'utf-8', bell: true };

const els = {
  appbar: $('#appbar'),
  welcome: $('#welcome'),
  play: $('#play'),
  connLabel: $('#connLabel'),
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  homeLink: $('#homeLink'),
  connectForm: $('#connectForm'),
  hostInput: $('#hostInput'),
  portInput: $('#portInput'),
  tlsInput: $('#tlsInput'),
  connectBtn: $('#connectBtn'),
  formError: $('#formError'),
  presets: [...document.querySelectorAll('.preset[data-host]')],
  customPreset: $('#customPreset'),
  fontQuick: $('#fontQuick'),
  sizeQuick: $('#sizeQuick'),
  openSettings: $('#openSettings'),
  installBtn: $('#installBtn'),
  viewport: $('#viewport'),
  scrollback: $('#scrollback'),
  screen: $('#screen'),
  cursor: $('#cursor'),
  jump: $('#jump'),
  composer: $('#composer'),
  cmd: $('#cmd'),
  sendBtn: $('#sendBtn'),
  banner: $('#banner'),
  bannerText: $('#bannerText'),
  btnReconnect: $('#btnReconnect'),
  btnLeave: $('#btnLeave'),
  btnSettings: $('#btnSettings'),
  settings: $('#settings'),
  closeSettings: $('#closeSettings'),
  doneSettings: $('#doneSettings'),
  fontSelect: $('#fontSelect'),
  fontPreview: $('#fontPreview'),
  sizeRange: $('#sizeRange'),
  sizeOutput: $('#sizeOutput'),
  themeSelect: $('#themeSelect'),
  encodingSelect: $('#encodingSelect'),
  bellToggle: $('#bellToggle'),
  resetSettings: $('#resetSettings'),
  toast: $('#toast'),
};

const prefs = loadPrefs();
const state = {
  term: new Terminal({ cols: 80, rows: 24 }),
  ws: null,
  connected: false,
  connecting: false,
  intentionalClose: false,
  profile: null,
  decoder: null,
  cw: 8,
  lh: 19,
  history: [],
  histIndex: 0,
  draft: '',
  pinned: true,
  renderedLayout: -1,
  renderedScrollback: 0,
  renderedScrollbackTotal: 0,
  renderedAlt: null,
  screenLines: [],
  renderQueued: false,
  frameQueued: false,
  lastCloseHandled: false,
  audio: null,
  lastBell: 0,
  lastClientHeight: 0,
  jumpHoldUntil: 0,
};

let deferredPrompt = null;

// ---------------- boot ----------------

async function init() {
  applyPrefs();
  bindEvents();
  setupBell();
  setupInstall();
  registerServiceWorker();
  setAppHeight();
  restoreLast();
  fillFromUrl();

  await document.fonts.ready.catch(() => {});
  rendererReset();

  if (new URLSearchParams(location.search).get('autoconnect') === '1' && els.hostInput.value) {
    await connectFromForm();
  }
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function restoreLast() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (last && last.host) {
      els.hostInput.value = last.host;
      els.portInput.value = last.port || 23;
      els.tlsInput.checked = !!last.tls;
      els.portInput.defaultValue = last.port || 23;
    }
  } catch {}
}

function fillFromUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('host')) els.hostInput.value = q.get('host');
  if (q.get('port')) els.portInput.value = q.get('port');
  if (q.get('tls') === '1') els.tlsInput.checked = true;
}

// ---------------- preferences / layout ----------------

function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.style.setProperty('--term-size', `${prefs.size}px`);
  document.documentElement.style.setProperty('--term-font', FONTS[prefs.font]?.stack || FONTS.jetbrains.stack);
  els.fontQuick.value = prefs.font;
  els.sizeQuick.value = String(prefs.size);
  if (![...els.sizeQuick.options].some((o) => o.value === String(prefs.size))) {
    const opt = new Option(String(prefs.size), String(prefs.size));
    els.sizeQuick.add(opt);
    els.sizeQuick.value = String(prefs.size);
  }
  els.fontSelect.value = prefs.font;
  els.sizeRange.value = String(prefs.size);
  els.sizeOutput.textContent = `${prefs.size}px`;
  els.themeSelect.value = prefs.theme;
  els.encodingSelect.value = prefs.encoding;
  els.bellToggle.checked = prefs.bell;
  els.fontPreview.style.fontFamily = FONTS[prefs.font]?.stack || FONTS.jetbrains.stack;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', prefs.theme === 'parchment' ? '#efe4cf' : '#0b1017');
}

async function ensureFont() {
  const f = FONTS[prefs.font] || FONTS.jetbrains;
  if (prefs.font === 'system') return;
  try {
    await document.fonts.load(`400 ${prefs.size}px ${f.family}`);
    await document.fonts.load(`700 ${prefs.size}px ${f.family}`);
  } catch {}
}

function measureCell() {
  const f = FONTS[prefs.font] || FONTS.jetbrains;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `400 ${prefs.size}px ${f.family || 'monospace'}`;
  const sample = '00000000000000000000';
  const width = ctx.measureText(sample).width / sample.length;
  state.cw = Math.max(5, width);
  state.lh = Math.max(14, Math.round(prefs.size * 1.36));
}

async function layoutTerminal(force = false) {
  if (els.play.hidden || !els.play.isConnected) return;
  await ensureFont();
  measureCell();
  document.documentElement.style.setProperty('--cw', `${state.cw.toFixed(3)}px`);
  document.documentElement.style.setProperty('--lh', `${state.lh}px`);
  document.documentElement.style.setProperty('--term-size', `${prefs.size}px`);

  const cs = getComputedStyle(els.viewport);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = Math.max(0, els.viewport.clientWidth - padX);
  const availH = Math.max(0, els.viewport.clientHeight - padY);
  if (availW < 40 || availH < 40) return;

  // Remember whether we were at the bottom *before* the viewport changed size.
  const oldHeight = state.lastClientHeight || els.viewport.clientHeight;
  const stick = els.viewport.scrollHeight - els.viewport.scrollTop - oldHeight < 36;

  let cols = Math.floor(availW / state.cw);
  let rows = Math.floor(availH / state.lh);
  cols = Math.max(20, Math.min(300, cols));
  rows = Math.max(6, Math.min(160, rows));

  if (cols !== state.term.cols || rows !== state.term.rows || force) {
    state.term.resize(cols, rows);
    render(true);
    if (stick) scrollToBottom();
    requestAnimationFrame(() => {
      if (stick) {
        els.viewport.scrollTop = els.viewport.scrollHeight;
      }
      state.lastClientHeight = els.viewport.clientHeight;
      updateJump();
    });
    if (state.connected && state.ws?.readyState === WebSocket.OPEN) {
      sendJson({ type: 'resize', cols, rows });
    }
  } else {
    state.lastClientHeight = els.viewport.clientHeight;
  }
}

const scheduleLayout = (() => {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => layoutTerminal(false).catch(() => {}), 80);
  };
})();

function setAppHeight() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
}

// ---------------- rendering ----------------

function rendererReset() {
  state.renderedLayout = -1;
  state.renderedScrollback = 0;
  state.renderedScrollbackTotal = 0;
  state.renderedAlt = null;
  state.screenLines = [];
  els.scrollback.replaceChildren();
  for (const n of [...els.screen.querySelectorAll('.sline')]) n.remove();
  els.screen.hidden = true;
  state.term.dirty.clear();
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render(false);
  });
}

function render(force) {
  const term = state.term;
  if (els.play.hidden) return;
  const altChanged = term.alt !== state.renderedAlt;
  const needsRebuild = force || altChanged ||
    term.layoutVersion !== state.renderedLayout ||
    state.screenLines.length !== term.rows ||
    term.scrollback.length < state.renderedScrollback ||
    term.scrollbackTotal < state.renderedScrollbackTotal;

  if (needsRebuild) {
    rebuildAll();
    return;
  }

  if (!term.alt && term.scrollbackTotal > state.renderedScrollbackTotal) {
    const wasPinned = isPinned();
    const added = term.scrollbackTotal - state.renderedScrollbackTotal;
    const start = Math.max(0, term.scrollback.length - added);
    const frag = document.createDocumentFragment();
    for (let i = start; i < term.scrollback.length; i++) {
      frag.append(scrollLine(term.scrollback[i]));
    }
    els.scrollback.append(frag);
    state.renderedScrollback = term.scrollback.length;
    state.renderedScrollbackTotal = term.scrollbackTotal;
    let excess = els.scrollback.children.length - term.scrollback.length;
    while (excess-- > 0 && els.scrollback.firstChild) els.scrollback.firstChild.remove();
    if (wasPinned) scrollToBottom();
  }

  for (const y of term.dirty) {
    if (y >= 0 && y < term.rows) renderRow(y);
  }
  term.dirty.clear();
  updateCursor();
  updateJump();
  requestAnimationFrame(updateJump);
}

function rebuildAll() {
  const term = state.term;
  const wasPinned = isPinned();
  const frag = document.createDocumentFragment();
  if (!term.alt) {
    for (const line of term.scrollback) frag.append(scrollLine(line));
  }
  els.scrollback.replaceChildren(frag);
  els.scrollback.hidden = term.alt;
  state.renderedScrollback = term.alt ? 0 : term.scrollback.length;
  state.renderedScrollbackTotal = term.alt ? 0 : term.scrollbackTotal;

  for (const n of state.screenLines) n.remove();
  const lineFrag = document.createDocumentFragment();
  state.screenLines = [];
  for (let y = 0; y < term.rows; y++) {
    const div = document.createElement('div');
    div.className = 'sline';
    lineFrag.append(div);
    state.screenLines.push(div);
  }
  els.screen.insertBefore(lineFrag, els.cursor);
  els.screen.hidden = false;
  els.screen.style.height = `${term.rows * state.lh}px`;

  for (let y = 0; y < term.rows; y++) renderRow(y);
  term.dirty.clear();
  state.renderedLayout = term.layoutVersion;
  state.renderedAlt = term.alt;
  state.renderedScrollback = term.alt ? 0 : term.scrollback.length;
  state.renderedScrollbackTotal = term.alt ? 0 : term.scrollbackTotal;
  updateCursor();
  updateJump();
  if (wasPinned) scrollToBottom();
  requestAnimationFrame(updateJump);
}

function scrollLine(line) {
  const div = document.createElement('div');
  div.className = 'line';
  appendRuns(div, cellsToRuns(line.cells));
  return div;
}

function renderRow(y) {
  const el = state.screenLines[y];
  if (!el) return;
  const runs = cellsToRuns(state.term.lines[y].cells);
  appendRuns(el, runs);
}

function appendRuns(el, runs) {
  if (!runs.length) {
    el.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const run of runs) {
    if (!run.text) continue;
    if (run.style === DEFAULT_STYLE) {
      frag.append(document.createTextNode(run.text));
      continue;
    }
    const span = document.createElement('span');
    span.textContent = run.text;
    const styled = cssForStyle(run.style);
    if (styled.css) span.style.cssText = styled.css;
    if (styled.cls) span.className = styled.cls;
    frag.append(span);
  }
  el.replaceChildren(frag);
}

const styleCssCache = new WeakMap();
function cssForStyle(style) {
  const cached = styleCssCache.get(style);
  if (cached) return cached;
  let fg = style.fg;
  let bg = style.bg;
  const inverse = !!(style.flags & INVERSE);
  const parts = [];
  if (inverse) {
    parts.push(`color:${colorCss(bg ?? 'var(--term-bg)')};`);
    parts.push(`background:${colorCss(fg ?? 'var(--term-fg)')};`);
  } else {
    if (fg !== null) parts.push(`color:${colorCss(fg)};`);
    if (bg !== null) parts.push(`background:${colorCss(bg)};`);
  }
  if (style.flags & HIDDEN) parts.push('color:transparent;');
  if (style.flags & BOLD) parts.push('font-weight:700;');
  if (style.flags & DIM) parts.push('opacity:.62;');
  if (style.flags & ITALIC) parts.push('font-style:italic;');
  const deco = [];
  if (style.flags & UNDERLINE) deco.push('underline');
  if (style.flags & STRIKE) deco.push('line-through');
  if (deco.length) parts.push(`text-decoration:${deco.join(' ')};text-decoration-thickness:1px;`);
  const result = { css: parts.join(''), cls: (style.flags & BLINK) ? 'term-blink' : '' };
  styleCssCache.set(style, result);
  return result;
}

function colorCss(c) {
  if (typeof c === 'number' && c >= 0 && c <= 15) return `var(--ansi-${c})`;
  if (typeof c === 'string') return c;
  return 'inherit';
}

function updateCursor() {
  const term = state.term;
  const show = term.cursorVisible && !els.play.hidden;
  els.cursor.classList.toggle('off', !show);
  const x = Math.max(0, Math.min(term.x, term.cols - 1)) * state.cw;
  const y = Math.max(0, Math.min(term.y, term.rows - 1)) * state.lh;
  els.cursor.style.transform = `translate(${x - 0.5}px, ${y}px)`;
}

function isPinned() {
  const v = els.viewport;
  return v.scrollHeight - v.scrollTop - v.clientHeight < 36;
}

function scrollToBottom() {
  els.viewport.scrollTop = els.viewport.scrollHeight;
  state.pinned = true;
  state.jumpHoldUntil = performance.now() + 220;
  requestAnimationFrame(() => {
    if (state.pinned) els.viewport.scrollTop = els.viewport.scrollHeight;
    state.lastClientHeight = els.viewport.clientHeight;
    updateJump();
  });
  updateJump();
}

function updateJump() {
  if (els.play.hidden) {
    els.jump.hidden = true;
    return;
  }
  if (performance.now() < state.jumpHoldUntil) {
    els.jump.hidden = true;
    return;
  }
  const v = els.viewport;
  const overflow = v.scrollHeight - v.clientHeight > 4;
  const pinned = isPinned();
  state.pinned = pinned;
  els.jump.hidden = !overflow || pinned;
}

function updateScrollState() {
  state.lastClientHeight = els.viewport.clientHeight;
  updateJump();
}

// ---------------- terminal feed ----------------

function feedBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  try {
    if (prefs.encoding === 'cp437') {
      for (let i = 0; i < bytes.length; i++) text += CP437[bytes[i]];
    } else {
      text = state.decoder.decode(bytes, { stream: true });
    }
  } catch {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (text) {
    state.term.feed(text);
    scheduleRender();
  }
}

function makeDecoder() {
  if (prefs.encoding === 'windows-1252') {
    return new TextDecoder('windows-1252', { fatal: false });
  }
  if (prefs.encoding === 'utf-8') {
    return new TextDecoder('utf-8', { fatal: false });
  }
  return { decode: () => '' }; // cp437 handled byte-wise
}

function setupBell() {
  state.term.onBell = () => {
    if (!prefs.bell) return;
    const now = performance.now();
    if (now - state.lastBell < 350) return;
    state.lastBell = now;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      state.audio ||= new Ctx();
      if (state.audio.state === 'suspended') state.audio.resume().catch(() => {});
      const o = state.audio.createOscillator();
      const g = state.audio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.025;
      o.connect(g);
      g.connect(state.audio.destination);
      o.start();
      o.stop(state.audio.currentTime + 0.045);
    } catch {}
  };
}

// ---------------- connection ----------------

function showWelcome() {
  closeSocket(true);
  if (els.settings.open) els.settings.close();
  els.play.hidden = true;
  els.appbar.hidden = true;
  els.welcome.hidden = false;
  els.banner.hidden = true;
  els.connLabel.textContent = 'not connected';
  setStatus('idle', 'Idle');
  document.title = 'TinTito — a pocket MUD client';
  state.profile = null;
  state.connected = false;
  state.connecting = false;
  state.term.dirty.clear();
  setInputEnabled(false);
  if (window.matchMedia('(pointer: fine)').matches) {
    requestAnimationFrame(() => els.hostInput.focus({ preventScroll: true }));
  }
}

async function connectFromForm() {
  els.formError.hidden = true;
  const host = els.hostInput.value.trim();
  const port = Number(els.portInput.value);
  const tls = els.tlsInput.checked;
  if (!host) return formError('Enter a host to connect to.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return formError('Port must be between 1 and 65535.');
  await connect({ host, port, tls });
}

function formError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

async function connect(profile) {
  closeSocket(true);
  state.profile = { ...profile };
  state.intentionalClose = false;
  state.lastCloseHandled = false;
  state.connected = false;
  state.connecting = true;
  state.decoder = makeDecoder();
  state.history = [];
  state.histIndex = 0;

  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(profile));
  } catch {}

  els.welcome.hidden = true;
  els.appbar.hidden = false;
  els.play.hidden = false;
  els.banner.hidden = true;
  els.connLabel.textContent = `${profile.host}:${profile.port}`;
  els.connLabel.title = `${profile.host}:${profile.port}`;
  setStatus('connecting', 'Connecting');
  setInputEnabled(false);
  document.title = `TinTito — ${profile.host}`;

  state.term.clearScrollback();
  state.term.reset(80, 24);
  rendererReset();
  await nextFrame();
  await nextFrame();
  await layoutTerminal(true);
  state.term.clearScrollback();
  state.term.reset(state.term.cols, state.term.rows);
  rendererReset();
  render(true);
  scrollToBottom();

  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('host', profile.host);
  url.searchParams.set('port', String(profile.port));
  url.searchParams.set('tls', profile.tls ? '1' : '0');
  url.searchParams.set('cols', String(state.term.cols));
  url.searchParams.set('rows', String(state.term.rows));
  url.searchParams.set('charset', prefs.encoding);

  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    connectionFailed('Could not open the connection.');
    return;
  }
  ws.binaryType = 'arraybuffer';
  state.ws = ws;

  ws.addEventListener('open', () => {
    if (state.ws !== ws) return;
    setStatus('connecting', 'Connecting');
  });
  ws.addEventListener('message', (event) => {
    if (state.ws !== ws) return;
    if (typeof event.data === 'string') {
      handleServerMessage(event.data);
      return;
    }
    feedBytes(event.data);
  });
  ws.addEventListener('error', () => {
    if (state.ws !== ws) return;
    connectionFailed('The TinTito bridge could not be reached.');
  });
  ws.addEventListener('close', (event) => {
    if (state.ws !== ws) return;
    state.ws = null;
    if (state.intentionalClose) return;
    state.connected = false;
    state.connecting = false;
    setInputEnabled(false);
    if (!state.lastCloseHandled) {
      const msg = event.code === 1000 && event.reason
        ? `Disconnected: ${event.reason}.`
        : 'The connection closed.';
      setStatus('closed', 'Offline');
      showBanner(msg);
    }
  });
}

function handleServerMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || msg.type !== 'status') return;
  if (msg.state === 'connected') {
    state.connected = true;
    state.connecting = false;
    setStatus('connected', 'Connected');
    setInputEnabled(true);
    els.banner.hidden = true;
    sendJson({ type: 'resize', cols: state.term.cols, rows: state.term.rows });
    if (window.matchMedia('(pointer: fine)').matches) {
      els.cmd.focus({ preventScroll: true });
    }

  } else if (msg.state === 'connecting') {
    setStatus('connecting', 'Connecting');
  } else if (msg.state === 'error') {
    state.lastCloseHandled = true;
    state.connected = false;
    state.connecting = false;
    setInputEnabled(false);
    setStatus('error', 'Error');
    showBanner(msg.message || 'Connection failed.');
  } else if (msg.state === 'closed') {
    state.lastCloseHandled = true;
    state.connected = false;
    state.connecting = false;
    setInputEnabled(false);
    setStatus('closed', 'Offline');
    showBanner(msg.message || 'The MUD closed the connection.');
  }
}

function connectionFailed(message) {
  state.lastCloseHandled = true;
  state.connected = false;
  state.connecting = false;
  setInputEnabled(false);
  setStatus('error', 'Error');
  showBanner(message);
  showToast(message);
}

function showBanner(message) {
  els.bannerText.textContent = message;
  els.banner.hidden = false;
}

function closeSocket(intentional) {
  state.intentionalClose = intentional;
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  state.connected = false;
  state.connecting = false;
}

function sendJson(obj) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  try {
    state.ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

function sendCommand(text) {
  if (!state.connected) return;
  sendJson({ type: 'input', data: String(text).slice(0, 2048) });
}

function setInputEnabled(on) {
  els.cmd.disabled = !on;
  els.sendBtn.disabled = !on;
}

function setStatus(name, text) {
  els.statusPill.dataset.state = name;
  els.statusText.textContent = text;
  els.statusPill.title = text;
  els.statusPill.setAttribute('aria-label', `Connection status: ${text}`);
}

// ---------------- input ----------------

function bindEvents() {
  els.connectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await connectFromForm();
  });
  for (const input of [els.hostInput, els.portInput]) {
    input.addEventListener('input', () => { els.formError.hidden = true; });
  }

  for (const preset of els.presets) {
    preset.addEventListener('click', () => {
      els.hostInput.value = preset.dataset.host;
      els.portInput.value = preset.dataset.port;
      els.tlsInput.checked = preset.dataset.tls === '1';
      els.formError.hidden = true;
      showToast(`Loaded ${preset.querySelector('.preset-name').textContent}. Tap Connect.`);
    });
  }
  els.customPreset.addEventListener('click', () => {
    els.hostInput.focus({ preventScroll: true });
    els.hostInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    showToast('Enter a host and port, then tap Connect.');
  });

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.cmd.value;
    els.cmd.value = '';
    if (text.trim()) {
      state.history.push(text);
      if (state.history.length > 100) state.history.shift();
    }
    state.histIndex = state.history.length;
    state.draft = '';
    sendCommand(text);
    els.cmd.focus({ preventScroll: true });
  });

  els.cmd.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (!state.history.length) return;
      e.preventDefault();
      if (state.histIndex === state.history.length) state.draft = els.cmd.value;
      state.histIndex = Math.max(0, state.histIndex - 1);
      els.cmd.value = state.history[state.histIndex];
    } else if (e.key === 'ArrowDown') {
      if (!state.history.length) return;
      e.preventDefault();
      state.histIndex = Math.min(state.history.length, state.histIndex + 1);
      els.cmd.value = state.histIndex === state.history.length ? state.draft : state.history[state.histIndex];
    } else if (e.key === 'Escape') {
      els.cmd.value = '';
    }
  });

  els.viewport.addEventListener('scroll', updateScrollState, { passive: true });
  els.jump.addEventListener('click', scrollToBottom);
  els.btnReconnect.addEventListener('click', () => {
    if (state.profile) connect(state.profile);
  });
  els.btnLeave.addEventListener('click', () => showWelcome());
  els.homeLink.addEventListener('click', (e) => {
    e.preventDefault();
    showWelcome();
  });
  els.btnSettings.addEventListener('click', openSettings);
  els.openSettings.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', () => els.settings.close());
  els.doneSettings.addEventListener('click', () => els.settings.close());
  els.settings.addEventListener('click', (e) => {
    if (e.target === els.settings) els.settings.close();
  });

  els.fontSelect.addEventListener('change', async () => {
    prefs.font = els.fontSelect.value;
    applyPrefs();
    savePrefs();
    await layoutTerminal(true);
  });
  els.fontQuick.addEventListener('change', async () => {
    prefs.font = els.fontQuick.value;
    applyPrefs();
    savePrefs();
    await layoutTerminal(true);
  });
  els.sizeRange.addEventListener('input', async () => {
    prefs.size = Number(els.sizeRange.value) || DEFAULTS.size;
    applyPrefs();
    savePrefs();
    await layoutTerminal(true);
  });
  els.sizeQuick.addEventListener('change', async () => {
    prefs.size = Number(els.sizeQuick.value) || DEFAULTS.size;
    applyPrefs();
    savePrefs();
    await layoutTerminal(true);
  });
  els.themeSelect.addEventListener('change', () => {
    prefs.theme = els.themeSelect.value;
    applyPrefs();
    savePrefs();
  });
  els.encodingSelect.addEventListener('change', () => {
    prefs.encoding = els.encodingSelect.value;
    state.decoder = makeDecoder();
    savePrefs();
    showToast('Encoding set to ' + els.encodingSelect.options[els.encodingSelect.selectedIndex].textContent + '.');
  });
  els.bellToggle.addEventListener('change', () => {
    prefs.bell = els.bellToggle.checked;
    applyPrefs();
    savePrefs();
  });
  els.resetSettings.addEventListener('click', async () => {
    Object.assign(prefs, DEFAULTS);
    applyPrefs();
    savePrefs();
    state.decoder = makeDecoder();
    await layoutTerminal(true);
    showToast('Settings reset.');
  });

  window.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('resize', () => {
    setAppHeight();
    scheduleLayout();
  });
  window.visualViewport?.addEventListener('scroll', () => {
    setAppHeight();
  });
  new ResizeObserver(() => scheduleLayout()).observe(els.viewport);

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !els.play.hidden && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      els.cmd.focus();
    }
  });
}

function openSettings() {
  if (!els.settings.open) els.settings.showModal();
}

// ---------------- install / service worker ----------------

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      showToast('Use your browser menu → “Add to Home Screen”.', 3500);
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null;
    els.installBtn.hidden = true;
  });
  if (window.matchMedia('(display-mode: standalone)').matches) els.installBtn.hidden = true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------------- misc ----------------

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

let toastTimer = 0;
function showToast(message, ms = 2400) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

// Debug handle (also handy for tests).
window.__tintito = { state, prefs };

// Exposed for the terminal's DSR/DA replies.
state.term.onResponse = (reply) => {
  sendJson({ type: 'raw', data: String(reply) });
};

init().catch((err) => {
  console.error(err);
  showToast('Could not start TinTito.');
});
