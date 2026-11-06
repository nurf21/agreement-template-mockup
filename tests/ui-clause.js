// DOM test of “Klausul persetujuan” (format 5: 0–2 options, one qualifying
// option): editor option form (option-count transitions, “Pilihan yang
// memenuhi syarat”, add/remove/rename/reorder, stable IDs, duplication,
// validation), admin preview simulation, the user flow (information blocks,
// radio groups, clause-specific blocking text, stale confirmation, read-only
// answers with snapshot labels), legacy format-4 drafts that the admin must
// correct, and historical fixed “Tidak / Ya” clauses.
// jsdom has no layout or native radio arrow-key handling; see README.
const { load } = require('./dom-harness');

const OPT_ID = /^op_[a-z0-9]{10}$/;
const CL_ID = /^cl_[a-z0-9]{10}$/;

function helpers(h) {
  const { w, $, $$ } = h;
  const ed = () => h.editor();
  const clauses = () => ed().getJSON().content.filter((n) => n.type === 'consentClause');
  const forms = () => $$('#f-content section.clause-edit');
  const rows = (i) => Array.from(forms()[i].querySelectorAll('li.clause-opt'));
  const input = (i, j) => rows(i)[j].querySelector('[data-role="label"]');
  const role = (i, j, r) => rows(i)[j].querySelector(`[data-role="${r}"]`);
  const quals = (i) => Array.from(forms()[i].querySelectorAll('input[data-role="qualifying"]'));
  const qualSet = (i) => forms()[i].querySelector('fieldset.clause-qual');
  const stateText = (i) => forms()[i].querySelector('.clause-opts-state').textContent;
  const addBtn = (i) => forms()[i].querySelector('[data-role="add"]');
  const typeLabel = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const blur = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
  const attrsOf = (i) => clauses()[i].attrs;
  return { ed, clauses, forms, rows, input, role, quals, qualSet, stateText, addBtn, typeLabel, blur, attrsOf };
}

async function main() {
  const h = load('#/t/tpl_6/edit');
  const { w, $, $$, errors, text, go, click, check, setChecked, setDoc, para, confirmDialog, cancelDialog, tick } = h;
  const { ed, clauses, forms, rows, input, role, quals, qualSet, stateText, addBtn, typeLabel, blur, attrsOf } = helpers(h);
  const tool = (key) => $(`.rte-toolbar [data-fmt="${key}"]`);
  const disabled = (key) => tool(key).getAttribute('aria-disabled') === 'true';

  /* ---------- Seed sample in the editor ---------- */

  check($('#save-state').textContent.includes('Tersimpan') && $('#btn-save').disabled, 'seed sample loads without unsaved changes');
  check(forms().length === 3 && !$('#clause-migration'), 'three sample clauses; no legacy notice');
  check(!tool('clauseRequired') && !$('#f-content').textContent.includes('Opsional'), 'no optional/required toggle anywhere');
  check(rows(0).length === 0 && stateText(0) === 'Informasi saja' && forms()[0].querySelector('.clause-edit-req').textContent === 'Informasi saja', 'zero options: “Informasi saja”');
  check(rows(1).length === 1 && stateText(1) === 'Pilihan ini otomatis memenuhi syarat' && quals(1).length === 0 && qualSet(1).hidden, 'one option: automatic, no qualification control');
  check(rows(2).length === 2 && quals(2).length === 2 && qualSet(2).querySelector('legend').textContent === 'Pilihan yang memenuhi syarat', 'two options: single-choice “Pilihan yang memenuhi syarat”');
  check(quals(2).map((r) => r.checked).join() === 'false,true' && quals(2)[1].labels[0].textContent === 'Pilihan 2: Memahami dan menerima', 'stored qualifying option checked (the second; order implies nothing)');
  check(new Set(quals(2).map((r) => r.name)).size === 1 && quals(2).every((r) => r.type === 'radio'), 'qualification is one radio group');
  check(addBtn(2).disabled && addBtn(2).textContent === 'Maksimal 2 pilihan' && !addBtn(1).disabled, 'cannot add a third option');
  check(rows(2).every((r) => r.querySelector('label.clause-opt-lab').htmlFor === r.querySelector('[data-role="label"]').id), 'label inputs have explicit labels');
  check(role(2, 0, 'up').getAttribute('aria-label') === 'Naikkan pilihan 1' && role(2, 0, 'up').disabled && role(2, 1, 'down').disabled, 'move buttons named and disabled at the ends');
  check($$('#preview-doc section.clause-info').length === 1 && !$('#preview-doc section.clause-info input'), 'preview: information block without controls');
  check($$('#preview-doc fieldset.clause').length === 2 && $$('#preview-doc .clause-sim').length === 2, 'preview labels answerable clauses as a simulation');
  check($$('#preview-doc input[type="radio"]').every((r) => !r.checked), 'preview: nothing selected');

  /* ---------- Option-count transitions ---------- */

  setDoc(para('Pembuka'));
  ed().commands.focus('end');
  check(disabled('duplicateClause') && disabled('deleteClause'), 'clause actions disabled outside a clause');
  click(tool('insertClause'));
  let c = clauses()[0];
  check(CL_ID.test(c.attrs.clauseId) && c.attrs.options.length === 0 && c.attrs.qualifyingOptionId === null && !('required' in c.attrs), 'inserted clause: generated ID, information only');
  ed().commands.insertContent('Pernyataan uji');
  check(stateText(0) === 'Informasi saja' && !$('#err-content .issues'), 'information-only clause (with a title) is valid');
  const clauseId = c.attrs.clauseId;

  click(addBtn(0));
  const id1 = attrsOf(0).options[0].id;
  check(OPT_ID.test(id1) && attrsOf(0).qualifyingOptionId === id1 && w.document.activeElement === input(0, 0), '0 → 1: the only option qualifies automatically; focus in its label');
  check(stateText(0) === 'Pilihan ini otomatis memenuhi syarat' && quals(0).length === 0, 'one option: no qualification toggle');
  check(input(0, 0).getAttribute('aria-invalid') === 'true' && rows(0)[0].textContent.includes('Label pilihan wajib diisi'), 'empty label flagged inline');
  typeLabel(input(0, 0), 'Sudah membaca');
  check(w.document.activeElement === input(0, 0), 'typing keeps focus in the label input');
  check($('#preview-doc fieldset.clause').textContent.includes('dengan pilihan “Sudah membaca”') && !$('#preview-doc input:checked'), 'preview: single option required, not pre-selected');

  click(addBtn(0));
  const id2 = attrsOf(0).options[1].id;
  check(attrsOf(0).qualifyingOptionId === id1 && quals(0).length === 2 && quals(0)[0].checked, '1 → 2: existing qualifying option preserved');
  typeLabel(input(0, 1), ' sudah MEMBACA ');
  check(input(0, 1).getAttribute('aria-invalid') === 'true' && rows(0)[1].textContent.includes('sama dengan pilihan 1'), 'duplicate label (trim, case-insensitive) flagged');
  check($('#err-content').textContent.includes('sama dengan pilihan 1'), 'duplicate label listed in content issues');
  typeLabel(input(0, 1), '<b>Belum</b>');
  check(rows(0)[1].textContent.includes('tanpa HTML'), 'HTML in a label refused');
  typeLabel(input(0, 1), 'Belum {{nama_lengkap}}');
  check(rows(0)[1].textContent.includes('placeholder'), 'placeholder in a label refused');
  typeLabel(input(0, 1), '  Belum membaca  ');
  blur(input(0, 1));
  check(attrsOf(0).options[1].label === 'Belum membaca', 'label trimmed when leaving the field');
  check(quals(0)[1].labels[0].textContent === 'Pilihan 2: Belum membaca', 'qualification choices follow the labels');
  const enter = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input(0, 1).dispatchEvent(enter);
  check(enter.defaultPrevented, 'Enter in a label does not submit the form');
  check(addBtn(0).disabled, 'at most two options');

  setChecked(quals(0)[1], true);
  check(attrsOf(0).qualifyingOptionId === id2 && w.document.activeElement === quals(0)[1], 'admin changes the qualifying option; focus stays');
  check($('#preview-doc fieldset.clause').textContent.includes('dengan pilihan “Belum membaca”'), 'qualification is the admin’s choice, not inferred from labels');
  setChecked(quals(0)[0], true);
  check(attrsOf(0).options.map((o) => o.id).join() === [id1, id2].join() && attrsOf(0).clauseId === clauseId, 'renaming keeps clause and option IDs');

  click(role(0, 1, 'up'));
  check(attrsOf(0).options.map((o) => o.id).join() === [id2, id1].join() && attrsOf(0).qualifyingOptionId === id1, 'reorder keeps IDs and the qualifying option');
  check(w.document.activeElement === role(0, 0, 'down'), 'at the top, focus moves to “Turunkan”');
  check(quals(0)[1].checked && quals(0)[1].value === id1, 'qualification control follows the order');
  click(role(0, 0, 'down'));
  check(attrsOf(0).options.map((o) => o.id).join() === [id1, id2].join(), 'move down restores the order');
  check(!$('#err-content .issues'), 'valid two-option clause has no issues');

  await new Promise((r) => setTimeout(r, 600)); // separate undo group (ProseMirror groups edits within 500 ms)
  setChecked(quals(0)[1], true);
  click(role(0, 0, 'remove'));
  check(attrsOf(0).options.map((o) => o.id).join() === id2 && attrsOf(0).qualifyingOptionId === id2 && stateText(0) === 'Pilihan ini otomatis memenuhi syarat', '2 → 1 (qualifying kept): remaining option qualifies');
  ed().commands.undo();
  check(attrsOf(0).options.length === 2, 'undo restores a removed option');
  setChecked(quals(0)[0], true);
  click(role(0, 0, 'remove'));
  check(attrsOf(0).options.map((o) => o.id).join() === id2 && attrsOf(0).qualifyingOptionId === id2, '2 → 1 (qualifying removed): remaining option qualifies automatically');
  await new Promise((r) => setTimeout(r, 600));
  click(role(0, 0, 'remove'));
  check(attrsOf(0).options.length === 0 && attrsOf(0).qualifyingOptionId === null && stateText(0) === 'Informasi saja', '1 → 0: information only');
  check(w.document.activeElement === addBtn(0), 'focus moves to “Tambah pilihan” after removing the last option');
  ed().commands.undo();
  check(attrsOf(0).options.length === 1 && attrsOf(0).qualifyingOptionId === id2, 'undo restores the single qualifying option');

  // Two options without a qualifying choice (e.g. pasted): must be chosen before saving.
  const node = clauses()[0];
  setDoc({ ...node, attrs: { ...node.attrs, options: [{ id: id1, label: 'Ya' }, { id: id2, label: 'Tidak' }], qualifyingOptionId: null } });
  check(quals(0).every((r) => !r.checked) && forms()[0].querySelector('.clause-opts-err').textContent.includes('Tentukan satu “Pilihan yang memenuhi syarat”'), 'two options, none chosen: flagged inline; nothing inferred from “Ya”');
  click($('#btn-save'));
  await tick();
  check($('#error-summary') && $('#error-summary').textContent.includes('Tentukan satu “Pilihan yang memenuhi syarat”'), 'save blocked until one qualifying option is chosen');
  check($('#preview-doc .md-invalid'), 'invalid structure: preview replaced by a notice');
  setChecked(quals(0)[1], true);
  check(attrsOf(0).qualifyingOptionId === id2 && !$('#err-content .issues'), 'choosing resolves the issue');

  /* ---------- Duplication ---------- */

  let clausePos = 0;
  ed().state.doc.forEach((n, pos) => { if (n.type.name === 'consentClause') clausePos = pos; });
  ed().commands.setTextSelection(clausePos + 2);
  click(tool('duplicateClause'));
  await tick();
  const [orig, copy] = clauses();
  check(clauses().length === 2 && orig.attrs.clauseId === clauseId && orig.attrs.options.map((o) => o.id).join() === [id1, id2].join(), 'original keeps its IDs');
  check(CL_ID.test(copy.attrs.clauseId) && copy.attrs.clauseId !== clauseId && copy.attrs.options.every((o) => OPT_ID.test(o.id) && ![id1, id2].includes(o.id)), 'duplicate gets a fresh clause ID and fresh option IDs');
  check(copy.attrs.options.map((o) => o.label).join('/') === 'Ya/Tidak' && copy.attrs.qualifyingOptionId === copy.attrs.options[1].id, 'duplicate keeps labels, order, and qualification (mapped to the new ID)');
  // Copy-paste duplication behaves the same (clipboard HTML from the schema serializer).
  const holder = w.document.createElement('div');
  holder.innerHTML = ed().getHTML();
  ed().commands.focus('end');
  ed().view.pasteHTML(holder.querySelector('section[data-clause-id]').outerHTML);
  await tick();
  const pasted = clauses()[2];
  check(pasted && pasted.attrs.clauseId !== clauseId && pasted.attrs.options.every((o) => ![id1, id2].includes(o.id)) && pasted.attrs.qualifyingOptionId === pasted.attrs.options[1].id, 'pasted copy: fresh IDs, qualification follows');
  check(!$('#err-content .issues'), 'editor-produced JSON validates');

  // Preview interactions never record anything.
  const pv = $$('#preview-doc input[type="radio"]');
  check(pv.every((r) => r.name.startsWith('pv-clause-')), 'preview radios are preview-prefixed');
  setChecked(pv[1], true);
  check(!$('#dialog').open, 'choosing in preview opens nothing');

  /* ---------- Publish the seed sample and assign it ---------- */

  await go('#/t/tpl_6');
  await go('#/t/tpl_6/edit'); // discard unsaved test edits (confirm() returns true)
  await go('#/t/tpl_6');
  check(text().includes('Editor visual (JSON v5)'), 'draft shows format v5');
  click($('[data-action="publish"]'));
  confirmDialog(); await tick();
  await go('#/saya');
  check(!$$('.agr-link').some((a) => a.textContent.startsWith('Profil Perusahaan')) && $$('.agr-card').length === 4, 'publishing assigned nothing; preview recorded nothing');
  $('#sim-assign-tpl').value = 'tpl_6';
  click($('[data-action="sim-assign"]'));
  const href = $$('.agr-link').find((a) => a.textContent.startsWith('Profil Perusahaan')).getAttribute('href');
  await go(href);

  /* ---------- User presentation ---------- */

  const sets = () => $$('.doc-user fieldset.clause');
  const radios = (i) => Array.from(sets()[i].querySelectorAll('input[type="radio"]'));
  const pick = (i, label) => setChecked(radios(i).find((r) => r.labels[0].textContent.trim() === label), true);
  const btn = () => $('#btn-accept');
  const issuesText = () => ($('#clause-issues') ? $('#clause-issues').textContent.replace(/\s+/g, ' ') : '');
  const status = (i) => sets()[i].querySelector('.clause-status').textContent;
  const info = $('.doc-user section.clause-info');
  check(info && info.textContent.includes('Informasi pengolahan data') && !info.querySelector('input, fieldset') && info.getAttribute('aria-labelledby'), 'information-only clause: ordinary block, no controls');
  check(sets().length === 2 && info.previousElementSibling.matches('.kv-wrap'), 'clauses rendered inline at their position');
  check(radios(0).length === 1 && radios(0)[0].value === 'op_sudahbaca1' && !radios(0)[0].checked, 'single option: a radio group, not pre-selected');
  check(radios(1).map((r) => r.labels[0].textContent.trim()).join('/') === 'Belum memahami/Memahami dan menerima', 'labels in configured order');
  check(sets().every((fs) => fs.querySelector('legend')) && new Set(sets().map((_, i) => radios(i)[0].name)).size === 2, 'accessible radio groups (fieldset + legend), one per clause');
  check(sets()[1].querySelector('.clause-req').textContent.includes('“Memahami dan menerima”') && !sets()[1].querySelector('.clause-req').textContent.includes('Belum memahami'), 'requirement names only the qualifying option');
  check(sets()[0].getAttribute('aria-describedby').split(' ').every((id) => w.document.getElementById(id)), 'fieldset description references exist (incl. status)');

  /* ---------- Validation ---------- */

  check(btn().disabled && issuesText().includes('Pernyataan telah membaca profil perusahaan') && issuesText().includes('Pemahaman ketentuan layanan') && issuesText().includes('belum dijawab'), 'each unanswered clause named');
  check(!issuesText().includes('Informasi pengolahan data'), 'information-only clause never blocks');
  setChecked($('#consent'), true);
  check(btn().disabled, 'consent alone does not enable acceptance');
  pick(0, 'Saya sudah membaca profil perusahaan');
  check(btn().disabled && !issuesText().includes('Pernyataan telah membaca'), 'explicitly selected single option satisfies its clause');
  pick(1, 'Belum memahami');
  check(status(1).includes('tidak memenuhi persyaratan') && status(1).includes('“Memahami dan menerima”') && sets()[1].classList.contains('is-blocking'), 'non-qualifying choice explained in text inside the clause');
  check(issuesText().includes('jawaban saat ini “Belum memahami” tidak memenuhi persyaratan'), 'issue list names the current answer');
  check($('.lede .badge').textContent === 'Belum disetujui' && !$('#dialog').open, 'a non-qualifying choice records nothing and keeps access');
  click(btn());
  check(!$('#dialog').open, 'blocked button opens nothing');
  click($('#clause-issues [data-action="focus-clause"]'));
  check(w.document.activeElement === radios(1)[0], 'issue link focuses the clause (its selected option)');
  pick(1, 'Memahami dan menerima');
  check(status(1) === '' && !btn().disabled && issuesText() === '', 'qualifying answers + consent enable acceptance');

  /* ---------- Stale confirmation ---------- */

  click(btn());
  const dlg = $('#dialog');
  check(dlg.open && dlg.textContent.includes('Memahami dan menerima') && !dlg.textContent.includes('Informasi pengolahan data'), 'dialog lists answers of answerable clauses only');
  pick(1, 'Belum memahami'); // answer changes while the dialog is open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui' && $('#toasts').textContent.includes('Jawaban klausul berubah'), 'changed answers make the confirmation stale');
  pick(1, 'Memahami dan menerima');
  click(btn());
  pick(1, 'Belum memahami');
  pick(1, 'Memahami dan menerima'); // changed and changed back: still the reviewed answers
  setChecked($('#consent'), false); // consent withdrawn while open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui', 'unchecked consent after opening is refused on confirm');
  setChecked($('#consent'), true);
  await go('#/saya');
  await go(href);
  check(sets().flatMap((_, i) => radios(i)).every((r) => !r.checked), 'answers start empty again after leaving');
  pick(0, 'Saya sudah membaca profil perusahaan');
  pick(1, 'Memahami dan menerima');
  setChecked($('#consent'), true);

  /* ---------- Acceptance and read-only answers ---------- */

  click(btn());
  confirmDialog();
  check($('#accept-result') && $('.lede .badge').textContent === 'Sudah disetujui', 'explicit confirmation accepts');
  const recorded = () => $$('#accept-result [data-clause-answer]').map((d) => d.textContent).join('/');
  check(recorded() === 'Saya sudah membaca profil perusahaan/Memahami dan menerima', 'recorded answers listed; no entry for the information-only clause');
  check(sets().every((fs) => fs.disabled) && radios(1)[1].checked && !$('.doc-user section.clause-info .clause-recorded'), 'document shows recorded answers read-only');
  const at = $('#accept-result time').getAttribute('datetime');
  dlg.returnValue = 'confirm'; dlg.onclose();
  check($('#accept-result time').getAttribute('datetime') === at && recorded().endsWith('/Memahami dan menerima'), 'repeated confirmation preserves the original timestamp and answers');

  // Later renames, reorders, and option-count changes do not alter the snapshot or the answers.
  await go('#/t/tpl_6/edit');
  const all = ed().getJSON().content;
  const [cInfo, cOne, cTwo] = all.filter((n) => n.type === 'consentClause');
  setDoc(
    { ...cInfo, attrs: { ...cInfo.attrs, options: [{ id: 'op_infobaru01', label: 'Mengerti' }], qualifyingOptionId: 'op_infobaru01' } },
    { ...cOne, attrs: { ...cOne.attrs, options: [], qualifyingOptionId: null } },
    { ...cTwo, attrs: { ...cTwo.attrs, options: [{ ...cTwo.attrs.options[1], label: 'Paham' }, { ...cTwo.attrs.options[0], label: 'Belum' }], qualifyingOptionId: cTwo.attrs.options[0].id } },
  );
  click($('#btn-save')); await tick();
  click($('#btn-publish')); confirmDialog(); await tick();
  await go('#/t/tpl_6');
  check(text().includes('Versi terbit (Versi 2)'), 'edited sample published as Versi 2');
  await go(href);
  check(radios(1).map((r) => r.labels[0].textContent.trim()).join('/') === 'Belum memahami/Memahami dan menerima' && recorded() === 'Saya sudah membaca profil perusahaan/Memahami dan menerima' && $('.doc-user section.clause-info'), 'historical snapshot and answers unchanged after later edits');

  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

/* ---------- Legacy format-4 draft ---------- */

async function legacy4() {
  const h = load('#/t/tpl_7/edit', {
    beforeApp: (win) => {
      const { AgreementStore: S, AgreementRichText: RT } = win;
      const doc = () => RT.freezeCopy(RT.wrap({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Draf lama.' }] },
          ...[
            ['cl_tigapilih1', true, [['op_lama000001', 'Setuju penuh', true], ['op_lama000002', 'Setuju dengan catatan', true], ['op_lama000003', 'Tidak setuju', false]], 'Tiga pilihan'],
            ['cl_satuqual01', true, [['op_lama000004', 'Sudah', true], ['op_lama000005', 'Belum', false]], 'Satu memenuhi'],
          ].map(([clauseId, required, options, title]) => ({
            type: 'consentClause', attrs: { clauseId, required, options: options.map(([id, label, qualifies]) => ({ id, label, qualifies })) },
            content: [{ type: 'clauseTitle', content: [{ type: 'text', text: title }] }, { type: 'clauseBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Teks.' }] }] }],
          })),
        ],
      }));
      const origS = S.createSeedState;
      S.createSeedState = () => {
        const st = origS();
        st.templates.push({
          id: 'tpl_' + st.nextId++, code: 'TPL-V4D7RF', internalName: 'Draf klausul format 4',
          createdAt: '2026-11-05T02:00:00Z', createdBy: 'Admin', updatedAt: '2026-11-05T03:00:00Z',
          archived: null, lockVersion: 1, versions: Object.freeze([]),
          draft: { title: 'Draf Lama', format: RT.FORMAT, content: doc(), revision: 1, basedOnVersion: null, createdAt: '2026-11-05T02:00:00Z', updatedAt: '2026-11-05T03:00:00Z', updatedBy: 'Admin' },
        });
        return st;
      };
    },
  });
  const { $, check, click, tick, go, text, errors, setChecked, confirmDialog } = h;
  const { forms, rows, quals, role, attrsOf } = helpers(h);
  await tick();
  check($('#clause-migration') && $('#clause-migration').textContent.includes('2 klausul') && $('#clause-migration').textContent.includes('Tidak ada pilihan yang dihapus otomatis'), 'legacy draft: admin asked to correct the clauses');
  check(rows(0).length === 3 && attrsOf(0).options.map((o) => o.id).join() === 'op_lama000001,op_lama000002,op_lama000003', 'all three options kept (none removed silently)');
  check(forms()[0].querySelector('.clause-opts-err').textContent.includes('Maksimal 2 pilihan') && quals(0).every((r) => !r.checked), 'too many options and ambiguous qualification flagged; nothing inferred');
  check(attrsOf(1).qualifyingOptionId === 'op_lama000004' && quals(1)[0].checked, 'unambiguous single qualifying option carried over');
  check(!attrsOf(0).options.some((o) => 'qualifies' in o) && !('required' in attrsOf(0)), 'editor holds the current shape only');
  check($('#save-state').textContent.includes('belum disimpan') && $('#err-content').textContent.includes('Maksimal 2 pilihan'), 'mapped clauses are an unsaved change; issues listed');
  click($('#btn-save'));
  await tick();
  check($('#error-summary') && $('#error-summary').textContent.includes('Maksimal 2 pilihan'), 'save blocked until corrected');
  await go('#/t/tpl_7');
  check(text().includes('JSON v4'), 'stored legacy draft unchanged');
  click($('[data-action="publish"]'));
  check($('#dialog').open && $('#dialog').textContent.includes('aturan pilihan lama (format 4)'), 'publish dialog explains the legacy clauses');
  confirmDialog(); await tick();
  check(!$('#toasts').textContent.includes('diterbitkan dan tersedia') && !text().includes('Versi terbit (Versi 1)'), 'publishing the uncorrected legacy draft is refused');
  await go('#/t/tpl_7/edit');
  click(role(0, 2, 'remove'));
  setChecked(quals(0)[0], true);
  check(attrsOf(0).options.length === 2 && attrsOf(0).qualifyingOptionId === 'op_lama000001' && !$('#err-content .issues'), 'admin corrects the clause');
  click($('#btn-save'));
  await tick();
  check($('#save-state').textContent.includes('Tersimpan') && !$('#error-summary'), 'corrected draft saves');
  await go('#/t/tpl_7');
  check(text().includes('JSON v5'), 'saved with the current clause format');
  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

/* ---------- Historical fixed “Tidak / Ya” clauses ---------- */

async function historical() {
  const fixedDoc = (RT) => RT.freezeCopy(RT.wrap({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Dokumen lama.' }] },
      ...[['cl_datalama01', true, 'Persetujuan data lama'], ['cl_surveilama', false, 'Survei lama']].map(([clauseId, required, title]) => ({
        type: 'consentClause', attrs: { clauseId, required },
        content: [{ type: 'clauseTitle', content: [{ type: 'text', text: title }] }, { type: 'clauseBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Teks.' }] }] }],
      })),
    ],
  }));
  const h = load('#/saya', {
    beforeApp: (win) => {
      const { AgreementStore: S, AgreementUser: U, AgreementRichText: RT } = win;
      const origS = S.createSeedState;
      S.createSeedState = () => {
        const st = origS();
        st.templates.push({
          id: 'tpl_' + st.nextId++, code: 'TPL-W8L4RD', internalName: 'Persetujuan Data (lama)',
          createdAt: '2026-11-02T02:00:00Z', createdBy: 'Admin', updatedAt: '2026-11-02T03:00:00Z',
          archived: null, lockVersion: 1, draft: null,
          versions: Object.freeze([Object.freeze({ number: 1, title: 'Persetujuan Data Lama', format: RT.FORMAT, content: fixedDoc(RT), renderVersion: 3, publishedAt: '2026-11-02T03:00:00Z', publishedBy: 'Admin', fromRevision: 1 })]),
        });
        return st;
      };
      const origU = U.createSeedUserState;
      U.createSeedUserState = (tpl) => {
        const st = origU(tpl);
        const a = U.assignVersion(st, tpl, 'tpl_7', 1, '2026-11-02T04:00:00Z');
        U.acceptAssignment(st, a.id, '2026-11-02T05:00:00Z', { snapshotId: a.snapshot.id, answers: { cl_datalama01: 'ya', cl_surveilama: 'tidak' } });
        return st;
      };
    },
  });
  const { $, $$, check, go, click, tick, text, errors } = h;
  await tick();
  const link = $$('.agr-link').find((a) => a.textContent.startsWith('Persetujuan Data Lama'));
  await go(link.getAttribute('href'));
  const recorded = () => $$('#accept-result [data-clause-answer]').map((d) => d.textContent).join('/');
  check(recorded() === 'Ya/Tidak' && $$('.doc-user fieldset.clause .clause-req')[0].textContent === 'Wajib dijawab Ya', 'historical acceptance shows its original fixed answers');
  const before = $('.doc-user').innerHTML;

  await go('#/t/tpl_7/v/1');
  check(text().includes('pilihan tetap “Tidak / Ya”'), 'version view explains the fixed options');
  await go('#/t/tpl_7/edit');
  check($('[data-action="convert-legacy"]').textContent === 'Buat draf dengan pilihan yang dapat diatur' && !$('#f-content'), 'editing requires an explicit conversion');
  await go('#/t/tpl_7');
  check(!text().includes('Draf (revisi'), 'opening the editor creates no draft');
  await go('#/t/tpl_7/edit');
  click($('[data-action="convert-legacy"]'));
  await tick();
  const json = h.editor().getJSON().content.filter((n) => n.type === 'consentClause');
  check(json.length === 2 && json.every((c) => c.attrs.options.map((o) => o.label).join('/') === 'Tidak/Ya'), 'converted draft: “Tidak / Ya” as editable options');
  check(json[0].attrs.qualifyingOptionId === json[0].attrs.options[1].id && json[1].attrs.qualifyingOptionId === null, 'required clause: “Ya” qualifies as before; optional clause: admin must choose');
  check(json[0].attrs.clauseId === 'cl_datalama01' && json.flatMap((c) => c.attrs.options).every((o) => OPT_ID.test(o.id)), 'clause IDs kept; option IDs generated');
  check($('#clause-migration') && $$('#f-content li.clause-opt').length === 4, 'converted clauses editable; admin asked to apply the current rules');
  await go('#/t/tpl_7');
  check(text().includes('Versi terbit (Versi 1)') && $$('.doc-body fieldset.clause .clause-req')[0].textContent === 'Wajib dijawab Ya', 'published version kept with its fixed options');
  click($('[data-action="detail-view"][data-val="draft"]'));
  check(text().includes('dikonversi dari klausul “Tidak / Ya” lama Versi 1') && text().includes('JSON v4'), 'new draft records its source');
  await go('#/saya');
  await go(link.getAttribute('href'));
  check($('.doc-user').innerHTML === before && recorded() === 'Ya/Tidak', 'snapshot and acceptance unchanged by conversion');
  await go('#/saya');
  check($$('.agr-card').length === 5 && $$('#done-h + .agr-list .agr-card').length === 2, 'nothing reassigned; no reacceptance required');
  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

main().then(legacy4).then(historical).catch((e) => { console.error(e.stack); process.exit(1); });
