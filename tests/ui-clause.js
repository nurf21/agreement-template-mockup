// DOM test of “Klausul persetujuan” with administrator-defined options:
// editor option form (labels, “Memenuhi persyaratan”, add/remove/reorder,
// stable IDs, validation), admin preview simulation, the user flow
// (radio groups, required/optional, clause-specific blocking text, stale
// confirmation, read-only answers with snapshot labels), and historical fixed
// “Tidak / Ya” clauses with explicit conversion.
// jsdom has no layout or native radio arrow-key handling; see README.
const { load } = require('./dom-harness');

const OPT_ID = /^op_[a-z0-9]{10}$/;
const CL_ID = /^cl_[a-z0-9]{10}$/;

async function main() {
  const h = load('#/t/tpl_6/edit');
  const { w, $, $$, errors, text, go, click, check, setChecked, setDoc, para, editor, confirmDialog, cancelDialog, tick } = h;
  const ed = () => editor();
  const tool = (key) => $(`.rte-toolbar [data-fmt="${key}"]`);
  const disabled = (key) => tool(key).getAttribute('aria-disabled') === 'true';
  const clauses = () => ed().getJSON().content.filter((n) => n.type === 'consentClause');
  const forms = () => $$('#f-content section.clause-edit');
  const rows = (i) => Array.from(forms()[i].querySelectorAll('li.clause-opt'));
  const input = (i, j) => rows(i)[j].querySelector('[data-role="label"]');
  const role = (i, j, r) => rows(i)[j].querySelector(`[data-role="${r}"]`);
  const typeLabel = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const blur = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
  const optsOf = (i) => clauses()[i].attrs.options;

  /* ---------- Seed sample in the editor ---------- */

  check($('#save-state').textContent.includes('Tersimpan') && $('#btn-save').disabled, 'seed sample with option clauses loads without unsaved changes');
  check(forms().length === 3, 'editor shows the three sample clauses');
  check(rows(0).map((r) => r.querySelector('[data-role="label"]').value).join('/') === 'Sudah membaca/Belum membaca', 'labels shown in editable inputs');
  check(rows(1).filter((r) => r.querySelector('[data-role="qualifies"]').checked).length === 2, 'three-option clause: two qualifying options checked');
  check(!rows(2)[0].querySelector('[data-role="qualifies"]'), 'optional clause hides “Memenuhi persyaratan”');
  check(forms()[0].querySelector('.clause-edit-req').textContent === 'Wajib dijawab' && forms()[2].querySelector('.clause-edit-req').textContent === 'Opsional', 'head shows required state');
  check(rows(0).every((r) => r.querySelector('label.clause-opt-lab').htmlFor === r.querySelector('[data-role="label"]').id), 'label inputs have explicit labels');
  check(role(0, 0, 'up').getAttribute('aria-label') === 'Naikkan pilihan 1' && role(0, 0, 'up').disabled && role(0, 1, 'down').disabled, 'move buttons named and disabled at the ends');
  check(role(0, 0, 'remove').disabled, 'cannot remove below two options');
  check($$('#preview-doc fieldset.clause').length === 3 && $$('#preview-doc .clause-sim').length === 3, 'preview labels each clause as a simulation');
  check($$('#preview-doc fieldset.clause')[0].textContent.includes('Sudah membaca') && $$('#preview-doc input[type="radio"]').every((r) => !r.checked), 'preview shows custom labels, nothing selected');

  /* ---------- Insert and edit a clause ---------- */

  setDoc(para('Pembuka'));
  ed().commands.focus('end');
  check(disabled('clauseRequired') && disabled('deleteClause'), 'clause settings disabled outside a clause');
  check(tool('clauseRequired').getAttribute('aria-label') === 'Wajib dijawab', 'toolbar setting renamed “Wajib dijawab”');
  click(tool('insertClause'));
  let c = clauses()[0];
  check(CL_ID.test(c.attrs.clauseId) && c.attrs.required === true, 'inserted clause: generated ID, required by default');
  check(c.attrs.options.length === 2 && c.attrs.options.every((o) => OPT_ID.test(o.id) && o.label === '' && o.qualifies === false) && c.attrs.options[0].id !== c.attrs.options[1].id, 'two empty options with generated unique IDs');
  check(input(0, 0).getAttribute('aria-invalid') === 'true' && rows(0)[0].textContent.includes('Label pilihan wajib diisi'), 'empty label flagged inline');
  check(forms()[0].querySelector('.clause-opts-err').textContent.includes('Memenuhi persyaratan'), 'missing qualifying option flagged inline');
  ed().commands.insertContent('Pernyataan uji');
  const clauseId = c.attrs.clauseId;
  const [id1, id2] = c.attrs.options.map((o) => o.id);

  typeLabel(input(0, 0), 'Sudah membaca');
  check(w.document.activeElement === input(0, 0), 'typing keeps focus in the label input');
  typeLabel(input(0, 1), ' sudah MEMBACA ');
  check(input(0, 1).getAttribute('aria-invalid') === 'true' && rows(0)[1].textContent.includes('sama dengan pilihan 1'), 'duplicate label (trim, case-insensitive) flagged');
  check($('#err-content').textContent.includes('sama dengan pilihan 1'), 'duplicate label listed in content issues');
  typeLabel(input(0, 1), '<b>Belum</b>');
  check(rows(0)[1].textContent.includes('tanpa HTML'), 'HTML in a label refused');
  typeLabel(input(0, 1), 'Belum {{nama_lengkap}}');
  check(rows(0)[1].textContent.includes('placeholder'), 'placeholder in a label refused');
  typeLabel(input(0, 1), '  Belum membaca  ');
  blur(input(0, 1));
  check(optsOf(0)[1].label === 'Belum membaca', 'label trimmed when leaving the field');
  const enter = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input(0, 1).dispatchEvent(enter);
  check(enter.defaultPrevented, 'Enter in a label does not submit the form');
  setChecked(role(0, 0, 'qualifies'), true);
  check(optsOf(0)[0].qualifies === true && optsOf(0)[1].qualifies === false, '“Memenuhi persyaratan” stored per option');
  check(!forms()[0].querySelector('.clause-opts-err').textContent && !$('#err-content .issues'), 'valid clause has no issues');
  check(optsOf(0).map((o) => o.id).join() === [id1, id2].join() && clauses()[0].attrs.clauseId === clauseId, 'renaming keeps clause and option IDs');
  check($('#preview-doc fieldset.clause').textContent.includes('dengan pilihan “Sudah membaca”'), 'preview states the qualifying option');

  // Add up to five, reorder, remove.
  click(forms()[0].querySelector('[data-role="add"]'));
  check(optsOf(0).length === 3 && w.document.activeElement === input(0, 2), 'add: new option, focus in its label');
  typeLabel(input(0, 2), 'Perlu waktu');
  click(forms()[0].querySelector('[data-role="add"]'));
  typeLabel(input(0, 3), 'Empat');
  click(forms()[0].querySelector('[data-role="add"]'));
  typeLabel(input(0, 4), 'Lima');
  check(optsOf(0).length === 5 && forms()[0].querySelector('[data-role="add"]').disabled, 'maximum of five options');
  const id3 = optsOf(0)[2].id;
  click(role(0, 2, 'up'));
  check(optsOf(0).map((o) => o.label).join('/') === 'Sudah membaca/Perlu waktu/Belum membaca/Empat/Lima' && optsOf(0)[1].id === id3, 'move up reorders and keeps the ID');
  check(w.document.activeElement === role(0, 1, 'up'), 'focus follows the moved option');
  click(role(0, 1, 'up'));
  check(optsOf(0)[0].id === id3 && w.document.activeElement === role(0, 0, 'down'), 'at the top, focus moves to “Turunkan”');
  click(role(0, 0, 'down'));
  check(optsOf(0).map((o) => o.id).slice(0, 3).join() === [id1, id3, id2].join(), 'move down reorders and keeps IDs');
  click(role(0, 4, 'remove'));
  click(role(0, 3, 'remove'));
  check(optsOf(0).length === 3 && !role(0, 0, 'remove').disabled && !forms()[0].querySelector('[data-role="add"]').disabled, 'remove options');
  await new Promise((r) => setTimeout(r, 600)); // separate undo group (ProseMirror groups edits within 500 ms)
  click(role(0, 1, 'remove'));
  check(optsOf(0).map((o) => o.id).join() === [id1, id2].join() && role(0, 0, 'remove').disabled, 'back to two options; removal disabled');
  ed().commands.undo();
  check(optsOf(0).length === 3, 'undo restores a removed option');
  ed().commands.redo();

  // Required off hides qualification (stored values kept); on shows it again.
  let clausePos = 0;
  ed().state.doc.forEach((n, pos) => { if (n.type.name === 'consentClause') clausePos = pos; });
  ed().commands.setTextSelection(clausePos + 2);
  click(tool('clauseRequired'));
  check(clauses()[0].attrs.required === false && !forms()[0].querySelector('[data-role="qualifies"]') && optsOf(0)[0].qualifies === true, 'optional: qualification hidden, settings kept');
  check($('#preview-doc .clause-optional'), 'preview: optional note');
  click(tool('clauseRequired'));
  check(role(0, 0, 'qualifies').checked, 'required again: qualification shown');

  // Duplicate by copy-paste: new clause ID and new option IDs; labels kept.
  // Clipboard HTML comes from the schema serializer (same as getHTML), not the editing view.
  const holder = w.document.createElement('div');
  holder.innerHTML = ed().getHTML();
  const html = holder.querySelector('section[data-clause-id]').outerHTML;
  ed().commands.focus('end');
  ed().view.pasteHTML(html);
  await tick();
  const [orig, copy] = clauses();
  check(clauses().length === 2 && orig.attrs.clauseId === clauseId && optsOf(0).map((o) => o.id).join() === [id1, id2].join(), 'original keeps its IDs');
  check(CL_ID.test(copy.attrs.clauseId) && copy.attrs.clauseId !== clauseId && copy.attrs.options.every((o) => OPT_ID.test(o.id) && ![id1, id2].includes(o.id)), 'pasted duplicate gets a new clause ID and new option IDs');
  check(copy.attrs.options.map((o) => `${o.label}:${o.qualifies}`).join('/') === 'Sudah membaca:true/Belum membaca:false', 'duplicate keeps labels, order, and qualification');
  check(!$('#err-content .issues'), 'editor-produced JSON validates');

  // A required clause without a qualifying option blocks saving.
  setChecked(role(1, 0, 'qualifies'), false);
  click($('#btn-save'));
  await tick();
  check($('#error-summary') && $('#error-summary').textContent.includes('minimal satu pilihan yang “Memenuhi persyaratan”'), 'save blocked: required clause needs a qualifying option');

  check($('#preview-doc .md-invalid'), 'invalid structure: preview replaced by a notice');
  setChecked(role(1, 0, 'qualifies'), true);

  // Preview interactions never record anything.
  const pv = $$('#preview-doc input[type="radio"]');
  check(pv.every((r) => r.name.startsWith('pv-clause-')), 'preview radios are preview-prefixed');
  setChecked(pv[1], true);
  check(!$('#dialog').open, 'choosing in preview opens nothing');

  /* ---------- Publish the seed sample and assign it ---------- */

  await go('#/t/tpl_6');
  await go('#/t/tpl_6/edit'); // discard unsaved test edits (confirm() returns true)
  await go('#/t/tpl_6');
  check(text().includes('Editor visual (JSON v4)'), 'draft shows format v4');
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
  check(sets().length === 3 && sets()[0].previousElementSibling.matches('.kv-wrap'), 'clauses rendered inline at their position');
  check(radios(1).map((r) => r.labels[0].textContent.trim()).join('/') === 'Memahami dan menerima/Memahami, akan berkonsultasi dahulu/Belum memahami', 'custom labels in configured order');
  check(radios(0).map((r) => r.value).join() === 'op_sudahbaca1,op_belumbaca1', 'radio values are option IDs');
  check(new Set(sets().map((fs) => radios(sets().indexOf(fs))[0].name)).size === 3, 'one radio group per clause');
  check(sets().flatMap((_, i) => radios(i)).every((r) => !r.checked), 'nothing selected initially');
  check(sets()[0].querySelector('.clause-req').textContent.includes('Wajib dijawab.') && sets()[0].querySelector('.clause-req').textContent.includes('“Sudah membaca”'), 'requirement stated in text');
  check(sets()[1].querySelector('.clause-req').textContent.includes('“Memahami dan menerima” atau “Memahami, akan berkonsultasi dahulu”'), 'both qualifying options named');
  check(sets()[2].querySelector('.clause-req').textContent.startsWith('Opsional'), 'optional clause says so');
  check(sets()[0].getAttribute('aria-describedby').split(' ').every((id) => w.document.getElementById(id)), 'fieldset description references exist (incl. status)');

  /* ---------- Validation ---------- */

  check(btn().disabled && issuesText().includes('Pernyataan telah membaca profil perusahaan') && issuesText().includes('Pemahaman ketentuan layanan') && issuesText().includes('belum dijawab'), 'each unanswered required clause named');
  check(!issuesText().includes('Kesediaan menerima'), 'optional clause never blocks');
  setChecked($('#consent'), true);
  check(btn().disabled, 'consent alone does not enable acceptance');
  pick(0, 'Belum membaca');
  check(status(0).includes('tidak memenuhi persyaratan') && status(0).includes('“Sudah membaca”') && sets()[0].classList.contains('is-blocking'), 'non-qualifying choice explained in text inside the clause');
  check(issuesText().includes('jawaban saat ini “Belum membaca” tidak memenuhi persyaratan'), 'issue list names the current answer');
  check($('.lede .badge').textContent === 'Belum disetujui' && !$('#dialog').open, 'a non-qualifying choice records nothing and keeps access');
  click(btn());
  check(!$('#dialog').open, 'blocked button opens nothing');
  pick(0, 'Sudah membaca');
  check(status(0) === '' && !sets()[0].classList.contains('is-blocking'), 'changing to a qualifying option clears the explanation');
  pick(1, 'Belum memahami');
  check(btn().disabled && status(1).includes('“Memahami dan menerima” atau “Memahami, akan berkonsultasi dahulu”'), 'three-option clause: non-qualifying blocks');
  pick(1, 'Memahami, akan berkonsultasi dahulu');
  check(!btn().disabled && issuesText() === '', 'second qualifying option enables acceptance; optional left unanswered');
  pick(2, 'Tidak bersedia');
  check(!btn().disabled, 'any optional answer is allowed');
  click(btn());
  check($('#dialog').open, 'dialog opens with valid answers');
  cancelDialog();

  // Focus link from an issue message.
  pick(1, 'Belum memahami');
  click($('#clause-issues [data-action="focus-clause"]'));
  check(w.document.activeElement === radios(1)[2], 'issue link focuses the clause (its selected option)');
  pick(1, 'Memahami dan menerima');

  /* ---------- Stale confirmation ---------- */

  click(btn());
  const dlg = $('#dialog');
  check(dlg.textContent.includes('Memahami dan menerima') && dlg.textContent.includes('Tidak bersedia'), 'dialog lists the answers with their labels');
  setChecked(radios(2)[0], true); // optional answer changes while the dialog is open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui' && $('#toasts').textContent.includes('Jawaban klausul berubah'), 'changed answers make the confirmation stale');
  click(btn());
  pick(0, 'Belum membaca'); // required becomes non-qualifying while open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui', 'non-qualifying answer after opening is refused on confirm');
  pick(0, 'Sudah membaca');
  click(btn());
  setChecked($('#consent'), false); // consent withdrawn while open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui', 'unchecked consent after opening is refused on confirm');
  setChecked($('#consent'), true);
  setChecked(radios(2)[0], false);
  radios(2).forEach((r) => { r.checked = false; });
  await go('#/saya');
  await go(href);
  check(sets().flatMap((_, i) => radios(i)).every((r) => !r.checked), 'answers start empty again after leaving');
  pick(0, 'Sudah membaca');
  pick(1, 'Memahami, akan berkonsultasi dahulu');
  setChecked($('#consent'), true);

  /* ---------- Acceptance and read-only answers ---------- */

  click(btn());
  check($('#dialog').textContent.includes('Tidak dijawab'), 'unanswered optional clause shown as “Tidak dijawab”');
  confirmDialog();
  check($('#accept-result') && $('.lede .badge').textContent === 'Sudah disetujui', 'explicit confirmation accepts');
  const recorded = () => $$('#accept-result [data-clause-answer]').map((d) => d.textContent).join('/');
  check(recorded() === 'Sudah membaca/Memahami, akan berkonsultasi dahulu/Tidak dijawab', 'recorded answers listed with snapshot labels');
  check(sets().every((fs) => fs.disabled) && radios(1)[1].checked && radios(2).every((r) => !r.checked), 'document shows recorded answers read-only');
  check(sets()[1].querySelector('.clause-recorded').textContent === 'Jawaban tercatat: Memahami, akan berkonsultasi dahulu', 'per-clause recorded answer text');
  const at = $('#accept-result time').getAttribute('datetime');
  dlg.returnValue = 'confirm'; dlg.onclose();
  check($('#accept-result time').getAttribute('datetime') === at && recorded().startsWith('Sudah membaca/'), 'repeated confirmation preserves the original timestamp and answers');

  // Later renames/reorders do not alter the snapshot's labels or the answers.
  await go('#/t/tpl_6/edit');
  const node = ed().getJSON().content.find((n) => n.type === 'consentClause');
  setDoc({ ...node, attrs: { ...node.attrs, options: [{ ...node.attrs.options[1], label: 'Belum', qualifies: true }, { ...node.attrs.options[0], label: 'Sudah', qualifies: false }] } });
  click($('#btn-save')); await tick();
  click($('#btn-publish')); confirmDialog(); await tick();
  await go(href);
  check(radios(0).map((r) => r.labels[0].textContent.trim()).join('/') === 'Sudah membaca/Belum membaca' && recorded().startsWith('Sudah membaca/'), 'historical labels unchanged after later edits');

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
  check(json.length === 2 && json.every((c) => c.attrs.options.map((o) => `${o.label}:${o.qualifies}`).join('/') === 'Tidak:false/Ya:true'), 'converted draft: “Tidak / Ya” as editable options, “Ya” qualifying');
  check(json[0].attrs.clauseId === 'cl_datalama01' && json.flatMap((c) => c.attrs.options).every((o) => OPT_ID.test(o.id)), 'clause IDs kept; option IDs generated');
  check($$('#f-content li.clause-opt').length === 4, 'converted clauses editable in the option form');
  await go('#/t/tpl_7');
  check(text().includes('Versi terbit (Versi 1)') && text().includes('pilihan tetap “Tidak / Ya”') === false && $$('.doc-body fieldset.clause .clause-req')[0].textContent === 'Wajib dijawab Ya', 'published version kept with its fixed options');
  click($('[data-action="detail-view"][data-val="draft"]'));
  check(text().includes('dikonversi dari klausul “Tidak / Ya” lama Versi 1') && text().includes('JSON v4'), 'new draft records its source');
  await go('#/saya');
  await go(link.getAttribute('href'));
  check($('.doc-user').innerHTML === before && recorded() === 'Ya/Tidak', 'snapshot and acceptance unchanged by conversion');
  await go('#/saya');
  check($$('.agr-card').length === 5 && $$('#done-h + .agr-list .agr-card').length === 2, 'nothing reassigned; no reacceptance required');
  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

main().then(historical).catch((e) => { console.error(e.stack); process.exit(1); });
