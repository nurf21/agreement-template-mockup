// DOM smoke test: drives the mockup through its main flows in jsdom.
const { load } = require('./dom-harness');

const h = load();
const { w, $, errors, text, tick, go, click, type, confirmDialog, check, setDoc, typeText, para, docText } = h;

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
setDoc(para('  '), para(), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [para()] }] }] });
click($('#btn-save'));
check($('#err-title').textContent.includes('wajib') && $('#err-content').textContent.includes('wajib') && !$('#err-internalName').textContent, 'whitespace-only title and whitespace/empty-structure content rejected');
setDoc(para('Halo {{email}}'));
check($('#err-content').textContent.includes('kurung kurawal ganda'), 'live content issues: typed {{…}} text is not a placeholder');
check($('#f-content').getAttribute('aria-invalid') === 'true', 'editor marked aria-invalid');
click($('#btn-save'));
check(w.location.hash === '#/baru' && $('#error-summary').textContent.includes('kurung kurawal'), 'save refused for invalid content');
type('#f-title', 'Judul Uji');
setDoc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A' }] }, para('Halo '));
h.editor().commands.focus('end');
click($('#ph-btn'));
click($('[data-action="ph-insert"][data-key="nama_lengkap"]'));
check($('#f-content .ph-chip') && $('#f-content .ph-chip').textContent === 'Nama lengkap', 'placeholder inserted as a labelled chip');
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
setDoc(para('Revisi kedua.'));
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
typeText('ubah');
click($('#btn-save'));
check(text().includes('Draf telah diubah oleh admin lain'), 'conflict banner');
click($('[data-action="reload-draft"]'));
check(docText().includes('admin lain (simulasi)') && text().includes('Draf terbaru telah dimuat'), 'reload loads latest draft');
check($('#recovered').value.includes('ubah'), 'unsaved text kept for copying');

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
