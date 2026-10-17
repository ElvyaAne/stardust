// Runs on every page: applies the saved style for this site, streams live previews,
// and describes the page's structure so the AI knows what to target.
(() => {
  if (window.__stardustLoaded) return;
  window.__stardustLoaded = true;

  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const KEY = 'site:' + host;
  let saved = { enabled: true, css: '' };
  let preview = null; // CSS being streamed in, shown instead of the saved CSS
  let styleEl = null;

  function apply() {
    if (!document.documentElement) return;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'stardust-style';
    }
    if (styleEl.parentNode !== document.documentElement) document.documentElement.appendChild(styleEl);
    let css = '';
    if (preview !== null) css = preview;
    else if (saved.enabled !== false) css = saved.css || '';
    // @import must come first in a stylesheet, which it is since we only have one block
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  // keep our stylesheet last so it wins ties with the page's own
  const bump = () => styleEl && document.documentElement.appendChild(styleEl);
  document.addEventListener('DOMContentLoaded', bump);
  addEventListener('load', bump);

  chrome.storage.local.get(KEY, res => {
    saved = { enabled: true, css: '', ...(res[KEY] || {}) };
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      saved = { enabled: true, css: '', ...(changes[KEY].newValue || {}) };
      apply();
    }
  });

  // ---------- page description for the model ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR', 'PATH', 'G', 'DEFS', 'USE', 'SOURCE', 'TRACK']);
  const HASHY = /^(css|sc|jsx|emotion|svelte)-|[a-z]+_[a-zA-Z0-9]{5,}$|^[a-zA-Z]{1,3}[0-9][a-zA-Z0-9]{3,}$/;

  function label(el) {
    let s = el.localName;
    if (el.id && el.id.length < 40) s += '#' + el.id;
    const cls = [...el.classList].filter(c => c.length < 40).slice(0, 4);
    if (cls.length) s += '.' + cls.join('.');
    const attrs = [];
    for (const a of ['role', 'aria-label', 'type', 'name', 'placeholder', 'data-testid']) {
      const v = el.getAttribute(a);
      if (v) attrs.push(`${a}="${v.slice(0, 30)}"`);
    }
    if (attrs.length) s += `[${attrs.join(' ')}]`;
    return s;
  }

  function signature(el) {
    return el.localName + '.' + [...el.classList].filter(c => !HASHY.test(c)).slice(0, 2).join('.');
  }

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 50 ? t.slice(0, 47) + '…' : t;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) {
      // custom elements often have display:contents-like boxes; keep them if they have children
      return el.children.length > 0 && el.localName.includes('-');
    }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function styleNote(el, parentBg) {
    const cs = getComputedStyle(el);
    const notes = [];
    const bg = cs.backgroundColor;
    const floating = cs.position === 'fixed' || cs.position === 'sticky';
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && (bg !== parentBg || floating)) notes.push('bg ' + bg);
    if (floating) notes.push(cs.position);
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url')) notes.push('gradient');
    return { notes, bg: bg !== 'rgba(0, 0, 0, 0)' ? bg : parentBg };
  }

  function describeTree(maxLines = 420, maxDepth = 9) {
    const lines = [];
    function walk(el, depth, parentBg) {
      if (lines.length >= maxLines || depth > maxDepth) return;
      if (SKIP.has(el.tagName) || el.id === 'stardust-style') return;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg') return;
      if (!visible(el)) return;
      const { notes, bg } = styleNote(el, parentBg);
      const text = ownText(el);
      lines.push('  '.repeat(depth) + label(el) + (notes.length ? ` {${notes.join(', ')}}` : '') + (text ? ` "${text}"` : ''));
      if (el.localName === 'svg') return;

      // collapse long runs of look-alike siblings (feeds, grids, lists)
      const kids = [...el.children];
      let i = 0;
      while (i < kids.length) {
        const sig = signature(kids[i]);
        let j = i + 1;
        while (j < kids.length && signature(kids[j]) === sig) j++;
        const run = j - i;
        walk(kids[i], depth + 1, bg);
        if (run > 2) {
          walk(kids[i + 1], depth + 1, bg);
          lines.push('  '.repeat(depth + 1) + `… ${run - 2} more ${sig.replace(/\.$/, '')}`);
        } else if (run === 2) {
          walk(kids[i + 1], depth + 1, bg);
        }
        i = j;
      }
    }
    if (document.body) walk(document.body, 0, 'rgba(0, 0, 0, 0)');
    if (lines.length >= maxLines) lines.push('… (truncated)');
    return lines.join('\n');
  }

  function rootVariables(max = 160) {
    const out = [];
    const seen = new Set();
    for (const el of [document.documentElement, document.body, document.querySelector('[class*="app" i], #app, #root, ytd-app')]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i];
        if (!name.startsWith('--') || seen.has(name)) continue;
        const val = cs.getPropertyValue(name).trim();
        if (!val || val.length > 80) continue;
        seen.add(name);
        out.push({ name, val, el: el === document.documentElement ? ':root' : label(el) });
      }
    }
    // colour-ish variables first: they're the cheapest way to retheme a whole site
    const score = v => (/(color|colour|bg|background|text|surface|border|accent|primary|brand|fg|spec|theme)/i.test(v.name) ? 0 : 1)
      + (/^(#|rgb|hsl|oklch|color\()/i.test(v.val) ? 0 : 1);
    out.sort((a, b) => score(a) - score(b));
    return out.slice(0, max).map(v => `${v.name}: ${v.val}` + (v.el !== ':root' ? `  (on ${v.el})` : '')).join('\n');
  }

  function pageContext() {
    const bs = document.body ? getComputedStyle(document.body) : null;
    const hs = getComputedStyle(document.documentElement);
    return {
      url: location.href,
      title: document.title,
      viewport: `${innerWidth}x${innerHeight}`,
      colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      base: bs ? `html bg ${hs.backgroundColor}; body bg ${bs.backgroundColor}; text ${bs.color}; font ${bs.fontFamily.slice(0, 120)}; size ${bs.fontSize}` : '',
      variables: rootVariables(),
      tree: describeTree()
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'stardust:context') {
      // describe the page as the site itself draws it, not with our style on top
      const prev = styleEl ? styleEl.textContent : '';
      if (styleEl) styleEl.textContent = '';
      try { reply({ ok: true, context: pageContext() }); }
      catch (e) { reply({ ok: false, error: String(e) }); }
      finally { if (styleEl) styleEl.textContent = prev; }
      return;
    }
    if (msg.type === 'stardust:preview') {
      preview = msg.css;
      apply();
      reply({ ok: true });
      return;
    }
    if (msg.type === 'stardust:endPreview') {
      preview = null;
      apply();
      reply({ ok: true });
      return;
    }
    if (msg.type === 'stardust:ping') reply({ ok: true, host });
  });
})();
