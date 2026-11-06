// Shared jsdom setup for the UI tests: loads index.html and the app scripts.
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

/**
 * `opts.beforeApp(window)` runs after the data modules load and before app.js
 * starts, so a test can adjust seed data (e.g. add unconvertible legacy content).
 */
function load(hash, opts) {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html' + (hash || ''), runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.error || e.message));
  w.matchMedia = () => ({ matches: true });
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function (v) { this.open = false; if (v !== undefined) this.returnValue = v; this.onclose && this.onclose(); };
  w.confirm = () => true;
  // Layout APIs ProseMirror calls that jsdom does not implement.
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => rect;
  w.Element.prototype.getClientRects = function () { return []; };
  w.document.elementFromPoint = () => null;
  if (!w.ClipboardEvent) w.ClipboardEvent = class extends w.Event { constructor(t, o) { super(t, o); this.clipboardData = null; } };
  const run = (f) => w.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  for (const f of ['js/markdown.js', 'js/richtext.js', 'js/store.js', 'js/user.js', 'dist/editor.js']) run(f);
  if (opts && opts.beforeApp) opts.beforeApp(w);
  run('js/app.js');

  const $ = (s) => w.document.querySelector(s);
  const h = {
    w, $, errors,
    $$: (s) => Array.from(w.document.querySelectorAll(s)),
    text: () => $('#main').textContent.replace(/\s+/g, ' '),
    tick: () => new Promise((r) => setTimeout(r, 20)),
    go: async (hh) => { w.location.hash = hh; await h.tick(); },
    click: (el) => { if (!el) throw new Error('missing element'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); },
    type: (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    setChecked: (el, v) => { el.checked = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    confirmDialog: () => { const d = $('#dialog'); d.returnValue = 'confirm'; d.close(); },
    cancelDialog: () => { const d = $('#dialog'); d.returnValue = 'cancel'; d.close(); },
    check: (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok -', msg); },
    /** The Tiptap editor instance mounted in the page (Tiptap sets view.dom.editor). */
    editor: () => { const el = $('#f-content'); return el && el.editor; },
    /** Replace the editor document (emits an update like user edits do). */
    setDoc: (...blocks) => h.editor().commands.setContent({ type: 'doc', content: blocks }),
    /** Type plain text at the cursor. */
    typeText: (text) => h.editor().chain().focus().insertContent({ type: 'text', text }).run(),
    para: (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }),
    docText: () => $('#f-content').textContent,
  };
  return h;
}

module.exports = { load };
