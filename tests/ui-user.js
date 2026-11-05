// DOM test of the simulated user flow: list, reading, explicit acceptance.
const { load } = require('./dom-harness');

const { w, $, $$, errors, text, go, click, setChecked, confirmDialog, cancelDialog, check } = load('#/saya');

const visible = (sel) => $$(sel).filter((el) => !el.hidden);
const group = (id) => $(`section[aria-labelledby="${id}"]`);
const cards = (id) => Array.from(group(id).querySelectorAll('.agr-card'));
const cardText = (id) => cards(id).map((c) => c.textContent.replace(/\s+/g, ' ').trim());
const linkFor = (title, version) => $$('.agr-link').find((a) => a.textContent === `${title}, Versi ${version}`);
const open = async (title, version) => { const a = linkFor(title, version); if (!a) throw new Error(`no link ${title} v${version}`); await go(a.getAttribute('href')); };
const acceptedAt = () => $('#accept-result time').getAttribute('datetime');

(async () => {
// Separate navigation and simulation notice.
check(visible('[data-side="user"]').length === 2 && visible('[data-side="admin"]').length === 0, 'user chrome shown, admin chrome hidden');
check($('[data-view="user"]').getAttribute('aria-current') === 'page', 'view switch marks user app');
check($('.simbar-user').textContent.includes('pengguna sintetis') && $('.simbar-user').textContent.includes('tidak sah secara hukum'), 'simulation notice');
check(w.document.title.includes('Perjanjian Saya'), 'document title');

// Pending and accepted lists.
check(cards('pending-h').length === 3 && cards('done-h').length === 1, '3 pending, 1 accepted');
check(cardText('pending-h').every((t) => t.includes('Belum disetujui')) && cardText('done-h').every((t) => t.includes('Sudah disetujui')), 'status labels');
check(cardText('done-h')[0].includes('Persetujuan Layanan') && cardText('done-h')[0].includes('Versi 1') && cardText('done-h')[0].includes('WIB'), 'accepted v1 with time');
check(cardText('pending-h').some((t) => t.startsWith('Persetujuan Layanan Umum') && t.includes('Versi 2')), 'new version v2 is a separate pending agreement');
check(!text().includes('Persetujuan Komunikasi') && !text().includes('Poin ketiga'), 'drafts never listed');

// Reading a pending agreement.
await open('Persetujuan Layanan Umum', 2);
check($('#page-title').textContent === 'Persetujuan Layanan Umum' && w.document.activeElement === $('#page-title'), 'title shown and focused on navigation');
check($('.doc-version').textContent === 'Versi 2' && $('.lede .badge').textContent === 'Belum disetujui', 'version and status shown');
check($('.doc-user').textContent.includes('Halo Dewi Lestari,') && !$('.doc-user .ph-token'), 'synthetic value substituted');
const tw = $('.doc-user .table-wrap');
check(tw && tw.getAttribute('tabindex') === '0' && tw.getAttribute('role') === 'region' && tw.getAttribute('aria-label'), 'table scroller keyboard-focusable and labelled');
check($$('#main input, #main textarea, #main select').length === 1 && $('#consent'), 'no editable personal fields; only the consent checkbox');

// Checkbox and confirmation requirements.
const consent = $('#consent');
const btn = $('#btn-accept');
check($('.consent').textContent.trim() === 'Saya telah membaca dan menyetujui perjanjian ini.', 'consent label text');
check(!consent.checked && btn.disabled && btn.textContent === 'Setujui Perjanjian', 'checkbox unchecked and button disabled initially');
check(btn.getAttribute('aria-describedby') === 'accept-hint' && $('#accept-hint').textContent.includes('Centang'), 'button explains how to enable it');
click(btn);
check(!$('#dialog').open, 'disabled button opens nothing');
setChecked(consent, true);
check(!btn.disabled, 'checking enables the button');
check($('.lede .badge').textContent === 'Belum disetujui', 'checking is not acceptance');
setChecked(consent, false);
check(btn.disabled, 'unchecking disables it again');
setChecked(consent, true);
click(btn);
const dlg = $('#dialog');
check(dlg.open && dlg.textContent.includes('Persetujuan Layanan Umum') && dlg.textContent.includes('Versi 2'), 'dialog names exact title and version');
cancelDialog();
check($('.lede .badge').textContent === 'Belum disetujui' && $('#consent'), 'closing the dialog records nothing');
click($('#btn-accept'));
confirmDialog();
check($('#accept-result') && $('#accept-result').textContent.includes('Perjanjian telah disetujui'), 'success message');
check($('#accept-result').getAttribute('role') === 'status' && w.document.activeElement === $('#accept-result'), 'success is a focused status region');
check($('#accept-result').textContent.includes('Versi 2') && $('#accept-result time').textContent.endsWith('WIB'), 'accepted version and WIB timestamp');
check(!$('#consent') && !$('#btn-accept') && $('.doc-user').textContent.includes('Dewi Lestari'), 'accepted document stays readable, read-only');
const firstAt = acceptedAt();

// Stale dialog / repeated confirmation keeps one acceptance and the original timestamp.
dlg.returnValue = 'confirm'; dlg.onclose();
check(acceptedAt() === firstAt, 'repeated confirmation keeps original timestamp');
check($('#toasts').textContent.includes('sudah disetujui'), 'repeat is reported, not recorded');
await go('#/saya');
check(cards('pending-h').length === 2 && cards('done-h').length === 2, 'exactly one new acceptance');
check(cardText('done-h').some((t) => t.startsWith('Persetujuan Layanan, Versi 1')), 'previous v1 acceptance preserved');

// Leaving the page with the dialog open records nothing.
await open('Ketentuan Dompet', 1);
setChecked($('#consent'), true);
click($('#btn-accept'));
check($('#dialog').open, 'dialog open');
await go('#/saya');
confirmDialog();
check(cards('pending-h').length === 2, 'confirming after leaving the page records nothing');

// Archived template: snapshot assigned before archival remains readable and acceptable.
await open('Ketentuan Dompet', 1);
check($('.doc-user') && !$('#consent').checked, 'archived template snapshot readable; checkbox reset to unchecked');
setChecked($('#consent'), true);
click($('#btn-accept'));
confirmDialog();
check($('#accept-result'), 'archived template snapshot accepted');

// Simulation controls: assignable list excludes drafts and archived templates.
await go('#/saya');
const options = $$('#sim-assign-tpl option').map((o) => o.value);
check(options.includes('tpl_1') && !options.includes('tpl_3') && !options.includes('tpl_5'), 'only published, non-archived templates are assignable');

// Profile changes leave existing snapshots unchanged.
click($('#sim-panel summary'));
setChecked($('#sim-profile-diperbarui'), true);
await open('Ketentuan Program Rujukan', 1);
check($('.doc-user').textContent.includes('rujukan, Dewi Lestari.') && !$('.doc-user').textContent.includes('Wijaya'), 'existing snapshot keeps original value after profile change');

// Missing placeholder data prevents acceptance.
await go('#/saya');
setChecked($('#sim-profile-kosong'), true);
$('#sim-assign-tpl').value = 'tpl_4';
click($('[data-action="sim-assign"]'));
check(cardText('pending-h').some((t) => t.includes('Pemberitahuan Perubahan Layanan') && t.includes('Dokumen tidak tersedia')), 'unavailable assignment flagged in list');
await open('Pemberitahuan Perubahan Layanan', 3);
check($('#doc-unavailable') && $('#doc-unavailable').textContent.includes('Nama lengkap') && !$('.doc-user'), 'unavailable state, no document rendered');
check($('#consent').disabled && $('#btn-accept').disabled, 'acceptance disabled');
check(!text().includes('Halo ,') && !text().includes('{{nama_lengkap}}'), 'no silent empty substitution');

// Admin publication creates no assignment and changes nothing on the user side.
await go('#/saya');
const lists = () => group('pending-h').outerHTML + group('done-h').outerHTML;
const before = lists();
await go('#/t/tpl_1');
check(visible('[data-side="admin"]').length === 2 && visible('[data-side="user"]').length === 0, 'admin chrome on admin routes');
click($('[data-action="publish"]'));
confirmDialog();
check(text().includes('Versi 3'), 'admin published Versi 3');
await go('#/saya');
check(lists() === before, 'user lists unchanged after publication');
check(!linkFor('Persetujuan Layanan Umum', 3), 'no automatic assignment of new version');

// Archiving blocks new assignment through the simulation control.
await go('#/t/tpl_4');
click($('[data-action="archive"]'));
confirmDialog();
await go('#/saya');
check(!$$('#sim-assign-tpl option').some((o) => o.value === 'tpl_4'), 'archived template no longer assignable');

// Admin permissions do not gate the user side; unknown assignment.
const perm = $('[data-perm="read"]'); perm.checked = false; perm.dispatchEvent(new w.Event('change'));
check(cards('done-h').length === 3, 'user side unaffected by admin permission simulation');
perm.checked = true; perm.dispatchEvent(new w.Event('change'));
await go('#/saya/asg_999');
check(text().includes('Perjanjian tidak ditemukan') && $('a[href="#/saya"].btn'), 'unknown agreement not found');

check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
})().catch((e) => { console.error(e.message); process.exit(1); });
