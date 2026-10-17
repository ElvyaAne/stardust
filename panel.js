const $ = id => document.getElementById(id);

const CHIPS = [
  ['🤍', 'Soft cream', 'Soft cream and warm beige, gentle shadows, rounded corners'],
  ['☕', 'Cozy coffee shop', 'Cozy coffee shop: warm browns, cream, soft serif headings'],
  ['🌌', 'Galaxy night', 'Galaxy night mode with lavender and sky-blue accents'],
  ['🌸', 'Pastel & rounded', 'Soft pastel colours and rounded everything'],
  ['🧘', 'Calm & minimal', 'Calm and minimal: hide distractions, more whitespace'],
  ['📰', 'Old newspaper', 'Old printed newspaper'],
  ['💾', '90s GeoCities', '90s GeoCities homepage, go all out'],
  ['🔠', 'Easier to read', 'Bigger text and easier to read']
];

let tab = null;
let host = '';
let siteKey = '';
let site = blankSite();
let settings = {};
let port = null;
let gen = null;            // { host, tabId, prompt, status }
const errors = new Map();  // host -> last error message (not persisted)

function blankSite() {
  return { enabled: true, css: '', history: [], current: -1 };
}

// ---------- storage helpers ----------
async function loadSettings() {
  settings = (await chrome.storage.local.get('settings')).settings || {};
}
async function loadSite() {
  if (!siteKey) { site = blankSite(); return; }
  site = { ...blankSite(), ...((await chrome.storage.local.get(siteKey))[siteKey] || {}) };
}
function saveSite() {
  return chrome.storage.local.set({ [siteKey]: site });
}

// ---------- current tab ----------
function hostOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

async function refreshTab() {
  [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  host = tab ? hostOf(tab.url) : '';
  siteKey = host ? 'site:' + host : '';
  await loadSite();
  render();
}

// ---------- rendering ----------
function render() {
  const supported = !!host;
  $('unsupported').hidden = supported;
  $('siteCard').hidden = !supported;
  $('tools').hidden = !supported || site.history.length === 0 && !site.css;
  $('composer').hidden = !supported;

  if (supported) {
    $('host').textContent = host;
    if (tab && tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)) {
      $('favicon').src = tab.favIconUrl;
      $('favicon').style.visibility = '';
    } else {
      $('favicon').style.visibility = 'hidden';
    }
    const versions = site.history.length;
    $('enabled').checked = site.enabled !== false && !!site.css;
    $('enabled').disabled = !site.css;
    $('siteSub').textContent = !site.css ? 'Original look'
      : site.enabled === false ? 'Your style is switched off'
      : `Restyled ✦ version ${site.current + 1} of ${versions}`;

    $('undo').disabled = site.current < 0;
    $('redo').disabled = site.current >= versions - 1;
    $('startOver').disabled = !site.css && !versions;
    if (document.activeElement !== $('css')) $('css').value = site.css || '';
  }

  renderThread();

  const busy = !!gen;
  $('empty').hidden = !supported || site.history.length > 0 || busy || errors.has(host);
  $('status').hidden = !busy;
  if (busy) $('statusText').textContent = gen.host === host ? gen.status : `Restyling ${gen.host}… ${gen.status.toLowerCase()}`;
  $('send').disabled = busy || !$('prompt').value.trim();
  $('prompt').disabled = busy;
}

function renderThread() {
  const box = $('thread');
  box.innerHTML = '';
  if (!host) return;
  site.history.forEach((h, i) => {
    const future = i > site.current;
    const u = document.createElement('div');
    u.className = 'msg user' + (future ? ' future' : '');
    u.textContent = h.prompt;
    const a = document.createElement('div');
    a.className = 'msg ai' + (future ? ' future' : '');
    const s = document.createElement('div');
    s.textContent = h.summary;
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (i === site.current && site.enabled !== false) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'ON PAGE';
      meta.appendChild(b);
    } else {
      const r = document.createElement('button');
      r.className = 'link';
      r.textContent = 'Use this version';
      r.addEventListener('click', () => goTo(i));
      meta.appendChild(r);
    }
    const t = document.createElement('span');
    t.textContent = new Date(h.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    meta.appendChild(t);
    a.append(s, meta);
    box.append(u, a);
  });

  if (gen && gen.host === host) {
    const u = document.createElement('div');
    u.className = 'msg user';
    u.textContent = gen.prompt;
    const p = document.createElement('div');
    p.className = 'msg ai pending';
    p.innerHTML = '<span class="spinner"></span><span>Watch the page ✦</span>';
    box.append(u, p);
  }
  if (errors.has(host)) {
    const e = document.createElement('div');
    e.className = 'msg error';
    e.textContent = errors.get(host);
    box.appendChild(e);
  }
  requestAnimationFrame(() => { $('mainView').scrollTop = $('mainView').scrollHeight; });
}

function buildChips() {
  const box = $('chips');
  for (const [emoji, short, text] of CHIPS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = `${emoji} ${short}`;
    b.title = text;
    b.addEventListener('click', () => send(text));
    box.appendChild(b);
  }
}

// ---------- versions ----------
async function goTo(i) {
  site.current = i;
  site.css = i >= 0 ? site.history[i].css : '';
  site.enabled = true;
  await saveSite();
  render();
}

let startOverArmed = 0;
async function startOver() {
  if (!startOverArmed) {
    $('startOver').textContent = 'Sure? Click again';
    startOverArmed = setTimeout(() => { startOverArmed = 0; $('startOver').textContent = 'Start over'; }, 3000);
    return;
  }
  clearTimeout(startOverArmed);
  startOverArmed = 0;
  $('startOver').textContent = 'Start over';
  site = blankSite();
  errors.delete(host);
  await chrome.storage.local.remove(siteKey);
  $('cssEditor').hidden = true;
  $('editCss').setAttribute('aria-pressed', 'false');
  render();
}

let cssTimer = 0;
function onCssEdit() {
  clearTimeout(cssTimer);
  cssTimer = setTimeout(async () => {
    const css = $('css').value;
    site.css = css;
    site.enabled = true;
    if (site.current >= 0) {
      site.history[site.current] = { ...site.history[site.current], css };
    } else if (css.trim()) {
      site.history = [{ prompt: 'Hand-written CSS', summary: 'Your own CSS.', css, ts: Date.now() }];
      site.current = 0;
    }
    await saveSite();
    render();
  }, 350);
}

// ---------- generating ----------
function connect() {
  if (port) return port;
  port = chrome.runtime.connect({ name: 'stardust' });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    if (gen) {
      errors.set(gen.host, 'Lost connection to the extension. Try again.');
      gen = null;
      render();
    }
  });
  return port;
}

async function onPortMessage(msg) {
  if (!gen) return;
  if (msg.type === 'status') gen.status = msg.text;
  else if (msg.type === 'progress') gen.status = `Designing… ${(msg.chars / 1000).toFixed(1)}k characters of CSS`;
  else if (msg.type === 'done') { gen = null; await loadSite(); }
  else if (msg.type === 'error' || msg.type === 'cancelled') {
    errors.set(gen.host, msg.message);
    gen = null;
    if (/API key|Settings/.test(msg.message) && !settings.apiKey) openSettings();
  }
  render();
}

function send(text) {
  const prompt = (text || $('prompt').value).trim();
  if (!prompt || gen || !host) return;
  if (!settings.apiKey) { openSettings(); return; }
  errors.delete(host);
  gen = { host, tabId: tab.id, prompt, status: 'Starting…' };
  $('prompt').value = '';
  autosize();
  render();
  connect().postMessage({ type: 'generate', tabId: tab.id, host, prompt });
}

function autosize() {
  const t = $('prompt');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}

// ---------- settings ----------
function openSettings() {
  const first = !settings.apiKey;
  $('settingsTitle').textContent = first ? 'Connect Claude' : 'Settings';
  $('closeSettings').hidden = first;
  $('clearAll').hidden = first;
  $('apiKey').value = settings.apiKey || '';
  $('model').value = settings.model || 'claude-sonnet-5-5';
  $('apiUrl').value = settings.apiUrl || '';
  $('settingsErr').hidden = true;
  $('settingsView').hidden = false;
  $('apiKey').focus();
}

async function saveSettings() {
  const apiKey = $('apiKey').value.trim();
  const apiUrl = $('apiUrl').value.trim();
  if (!apiKey) {
    $('settingsErr').textContent = 'Paste your API key to continue.';
    $('settingsErr').hidden = false;
    return;
  }
  if (apiUrl && !/^https:\/\//.test(apiUrl)) {
    $('settingsErr').textContent = 'The endpoint must start with https://';
    $('settingsErr').hidden = false;
    return;
  }
  settings = { ...settings, apiKey, model: $('model').value, apiUrl: apiUrl || undefined };
  await chrome.storage.local.set({ settings });
  $('settingsView').hidden = true;
  $('prompt').focus();
}

let clearArmed = 0;
async function clearAll() {
  if (!clearArmed) {
    $('clearAll').textContent = 'This removes every site\'s styles. Click again to confirm.';
    clearArmed = setTimeout(() => { clearArmed = 0; $('clearAll').textContent = 'Erase all saved site styles'; }, 4000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = 0;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('site:')));
  $('clearAll').textContent = 'All site styles erased ✓';
  await loadSite();
  render();
}

// ---------- wiring ----------
function wire() {
  $('composer').addEventListener('submit', e => { e.preventDefault(); send(); });
  $('prompt').addEventListener('input', () => { autosize(); $('send').disabled = !!gen || !$('prompt').value.trim(); });
  $('prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('stop').addEventListener('click', () => gen && port && port.postMessage({ type: 'cancel', tabId: gen.tabId }));

  $('enabled').addEventListener('change', async e => { site.enabled = e.target.checked; await saveSite(); render(); });
  $('undo').addEventListener('click', () => goTo(site.current - 1));
  $('redo').addEventListener('click', () => goTo(site.current + 1));
  $('startOver').addEventListener('click', startOver);
  $('editCss').addEventListener('click', () => {
    const open = $('cssEditor').hidden;
    $('cssEditor').hidden = !open;
    $('editCss').setAttribute('aria-pressed', String(open));
    if (open) $('css').value = site.css || '';
  });
  $('css').addEventListener('input', onCssEdit);
  $('copyCss').addEventListener('click', async () => {
    await navigator.clipboard.writeText(site.css || '');
    $('copyCss').textContent = 'Copied ✓';
    setTimeout(() => ($('copyCss').textContent = 'Copy'), 1500);
  });

  $('openSettings').addEventListener('click', openSettings);
  $('saveSettings').addEventListener('click', saveSettings);
  $('closeSettings').addEventListener('click', () => ($('settingsView').hidden = true));
  $('apiKey').addEventListener('keydown', e => { if (e.key === 'Enter') saveSettings(); });
  $('clearAll').addEventListener('click', clearAll);

  chrome.tabs.onActivated.addListener(refreshTab);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (tab && id === tab.id && (info.url || info.status === 'complete' || info.favIconUrl)) refreshTab();
  });
  chrome.windows.onFocusChanged.addListener(w => { if (w !== chrome.windows.WINDOW_ID_NONE) refreshTab(); });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = changes.settings.newValue || {};
    if (siteKey && changes[siteKey]) { await loadSite(); render(); }
  });
}

(async function init() {
  buildChips();
  wire();
  await loadSettings();
  await refreshTab();
  if (!settings.apiKey) openSettings();
})();
