// Tiny DOM builder. All text is inserted with text nodes, never as HTML,
// so names coming from external data can never be interpreted as markup.

const BOOL_PROPS = new Set(['checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple']);
const VALUE_PROPS = new Set(['value']);
const SAFE_ATTR = /^(class|id|for|type|name|placeholder|title|min|max|step|role|scope|accept|label|colspan|rowspan|tabindex|lang|autocomplete|inputmode|spellcheck|aria-[a-z-]+|data-[a-z0-9-]+)$/;

/** Only internal hash links and a small allowlist of external hosts may be used as hrefs. */
export function safeHref(href) {
  if (typeof href !== 'string') return null;
  if (href.startsWith('#/')) return href;
  try {
    const u = new URL(href);
    const allowed = ['www.sermeatball.com', 'sermeatball.com', 'aa-classic.com', 'wiki.aa-classic.com', 'github.com'];
    if (u.protocol === 'https:' && allowed.includes(u.hostname)) return u.href;
  } catch { /* not a URL */ }
  return null;
}

/**
 * h('div', {class: 'card', on: {click: fn}}, 'text', child, [more])
 */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false && !BOOL_PROPS.has(k)) continue;
      if (k === 'on') { for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn); continue; }
      if (k === 'href') {
        const safe = safeHref(v);
        if (safe) {
          el.setAttribute('href', safe);
          if (!safe.startsWith('#')) { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
        }
        continue;
      }
      if (k === 'style') { Object.assign(el.style, v); continue; } // CSSOM: allowed under our CSP
      if (BOOL_PROPS.has(k)) { el[k] = !!v; continue; }
      if (VALUE_PROPS.has(k)) { el.value = String(v); continue; }
      if (SAFE_ATTR.test(k)) el.setAttribute(k, String(v));
      else console.warn('h(): ignored attribute', k);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };
export function mount(el, ...children) { clear(el); append(el, children); return el; }

/** Debounce for search boxes. */
export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function notice(kind, ...children) { return h('div', { class: `notice ${kind}` }, ...children); }

export function kpi(label, value, hint = null, kind = '') {
  return h('div', { class: `kpi ${kind}` }, h('div', { class: 'k-label' }, label), h('div', { class: 'k-val' }, value), hint ? h('div', { class: 'k-hint' }, hint) : null);
}

export function field(label, control, { full = false, id = null } = {}) {
  if (id) control.id = id;
  return h('div', { class: full ? 'field full' : 'field' }, h('label', id ? { for: id } : null, label), control);
}

export function select(options, value, onChange, attrs = {}) {
  const el = h('select', attrs, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function bar(fraction) {
  const span = h('span');
  span.style.width = `${Math.max(0, Math.min(1, fraction || 0)) * 100}%`;
  return h('div', { class: 'bar' }, span);
}
