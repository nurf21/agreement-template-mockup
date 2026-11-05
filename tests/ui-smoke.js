// DOM smoke test: drives the mockup through its main flows in jsdom.
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true,
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
for (const f of ['markdown.js', 'store.js', 'app.js']) w.eval(fs.readFileSync(path.join(root, 'js', f), 'utf8'));

const $ = (s) => w.document.querySelector(s);
const text = () => $('#main').textContent.replace(/\s+/g, ' ');
const tick = () => new Promise((r) => setTimeout(r, 20));
const go = async (h) => { w.location.hash = h; await tick(); };
const click = (el) => { if (!el) throw new Error('missing element'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const type = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const confirmDialog = () => { const d = $('#dialog'); d.returnValue = 'confirm'; d.close(); };
const check = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok -', msg); };

(async () => {
check($('.data-table tbody').children.length === 5, 'list shows 5 seed templates');
type('#q', 'rujukan');
check($('.data-table tbody').children.length === 1, 'search filters rows');
type('#q', 'zzz');
check(text().includes('Tidak ada template yang cocok'), 'no-results empty state');
click($('[data-action="clear-filters"]'));
const arch = $('input[name="status"][value="archived"]'); arch.checked = true; arch.dispatchEvent(new w.Event('change', { bubbles: true }));
check($('.data-table tbody').children.length === 1, 'archived filter');

// Create flow: empty editor is allowed, saving requires all three fields.
await go('#/baru');
const code = $('#f-code').value;
check(/^TPL-/.test(code) && $('#f-code').readOnly, 'code generated and read-only');
check(!$('#error-summary') && $('#f-name').getAttribute('aria-invalid') === 'false', 'empty editor shows no errors before a save attempt');
check([...w.document.querySelectorAll('.req')].every((el) => el.textContent === 'wajib') && !text().includes('wajib untuk terbit'), 'labels say all three fields are required');
click($('#btn-save'));
const summary = $('#error-summary');
check(summary && summary.getAttribute('role') === 'alert' && w.document.activeElement === summary, 'error summary shown and focused');
check(['Nama internal wajib diisi', 'Judul dokumen wajib diisi', 'Isi dokumen wajib diisi'].every((m) => summary.textContent.includes(m)), 'summary lists all required fields');
check($('#err-internalName').textContent.includes('wajib') && $('#err-title').textContent.includes('wajib') && $('#err-content').textContent.includes('wajib'), 'field-level required errors');
check(['#f-name', '#f-title', '#f-content'].every((s) => $(s).getAttribute('aria-invalid') === 'true'), 'fields marked aria-invalid');
check(w.location.hash === '#/baru', 'nothing saved');
type('#f-name', 'Uji Baru');
type('#f-title', '   ');
type('#f-content', ' \n ');
click($('#btn-save'));
check($('#err-title').textContent.includes('wajib') && $('#err-content').textContent.includes('wajib') && !$('#err-internalName').textContent, 'whitespace-only title/content rejected');
type('#f-content', 'Halo <b>x</b> {{email}}');
check($('#err-content').textContent.includes('HTML mentah'), 'live content issues');
type('#f-content', '| A | B |\n|---|---|\n| 1 | 2 | sel-ekstra |');
check($('#err-content').textContent.includes('Baris 3: Baris tabel memiliki 3 kolom'), 'inconsistent table reported with line');
check(!$('#preview-doc table') && $('#preview-doc .md-invalid') && $('#preview-doc').textContent.includes('sel-ekstra'), 'malformed table previewed as literal text, no text lost');
click($('#btn-save'));
check(w.location.hash === '#/baru' && $('#error-summary').textContent.includes('Baris 3'), 'save refused for inconsistent table');
type('#f-title', 'Judul Uji');
type('#f-content', '## A\n\nHalo {{nama_lengkap}}');
check($('#preview-doc').textContent.includes('Dewi Lestari (contoh)'), 'preview substitutes sample value');
check($('#preview-doc').textContent.includes('Contoh — bukan dokumen pengguna'), 'preview label');
click($('#btn-save')); await tick();
check(w.location.hash.endsWith('/edit') && $('#save-state').textContent.includes('revisi 1'), 'saved state, revision 1');
check($('#f-code').value === code, 'code unchanged after save');

// Publish succeeds.
click($('#btn-publish'));
check($('#dialog').textContent.includes('tidak menugaskan perjanjian') && !$('#dialog [value="confirm"]').disabled, 'publish confirmation states no automatic assignment');
confirmDialog(); await tick();
check(/#\/t\/tpl_\d+$/.test(w.location.hash) && text().includes('Versi 1'), 'published and on detail page');

// A concurrent save invalidates an open publication confirmation.
const id0 = w.location.hash.split('/')[2];
await go(`#/t/${id0}/edit`);
type('#f-content', '## A\n\nRevisi kedua.');
click($('#btn-save'));
click($('#btn-publish'));
check($('#dialog').open, 'confirmation open');
click($('[data-action="sim-conflict"]'));
confirmDialog(); await tick();
check(text().includes('Draf telah diubah oleh admin lain') && w.location.hash.endsWith('/edit'), 'stale confirmation rejected with conflict banner');
await go(`#/t/${id0}`);
check(!text().includes('Versi 2'), 'no version created by stale confirmation');

// Edit published -> draft copied; conflict simulation.
const id = w.location.hash.split('/')[2];
await go(`#/t/${id}/edit`);
check($('#draft-status').textContent.includes('disalin dari Versi 1'), 'new draft copied from published');
click($('[data-action="sim-conflict"]'));
type('#f-content', 'ubah');
click($('#btn-save'));
check(text().includes('Draf telah diubah oleh admin lain'), 'conflict banner');
click($('[data-action="reload-draft"]'));
check($('#f-content').value.includes('admin lain (simulasi)') && text().includes('Draf terbaru telah dimuat'), 'reload loads latest draft');

// Permissions.
const perm = (p, v) => { const b = $(`[data-perm="${p}"]`); b.checked = v; b.dispatchEvent(new w.Event('change')); };
perm('edit', false);
check(text().includes('Akses ditolak'), 'editor denied without edit permission');
perm('edit', true);
await go(`#/t/${id}`);
perm('publish', false);
check([...w.document.querySelectorAll('.page-actions button')].every((b) => b.disabled), 'publish/archive disabled without permission');
perm('publish', true);
perm('read', false);
check(text().includes('Akses ditolak'), 'everything denied without read');
perm('read', true);

// Archive.
click($('[data-action="archive"]'));
confirmDialog();
check(text().includes('Diarsipkan pada') && !$('[data-action="publish"]'), 'archived; no publish/edit actions');
check(text().includes('Riwayat versi') && text().includes('Versi 1'), 'history preserved');
await go(`#/t/${id}/v/1`);
check(text().includes('hanya baca'), 'version view read-only');

// Empty state.
click(w.document.querySelector('[data-action="clear-data"]')); await tick();
check(text().includes('Belum ada template'), 'empty state');

check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
})().catch((e) => { console.error(e.message); process.exit(1); });
