// Shared jsdom setup for the UI tests: loads index.html and the app scripts.
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

function load(hash) {
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
  for (const f of ['markdown.js', 'store.js', 'user.js', 'app.js']) w.eval(fs.readFileSync(path.join(root, 'js', f), 'utf8'));

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
  };
  return h;
}

module.exports = { load };
