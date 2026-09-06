// Tiny DOM builder — no framework. `html:` deliberately does not exist: every
// call site passes text as a plain string/Node, so user-controlled text (names,
// chat) can never reach innerHTML.
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>;

export function h(tag: string, attrs: Attrs = {}, ...children: unknown[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === false || v == null) { /* omit */ }
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity as 1)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg: string): void {
  const t = h('div', { class: 'copy-toast' }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}
