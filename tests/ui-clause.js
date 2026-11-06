// DOM test of “Klausul persetujuan”: editor insertion, IDs, required setting,
// admin preview simulation, and the user flow (independent radio groups,
// required/optional validation, stale confirmation, read-only answers).
// jsdom has no layout or native radio arrow-key handling; see README.
const { load } = require('./dom-harness');

async function main() {
  const h = load('#/t/tpl_6/edit');
  const { w, $, $$, errors, text, go, click, check, setChecked, setDoc, para, editor, confirmDialog, cancelDialog, tick } = h;
  const ed = () => editor();
  const tool = (key) => $(`.rte-toolbar [data-fmt="${key}"]`);
  const disabled = (key) => tool(key).getAttribute('aria-disabled') === 'true';
  const pressed = (key) => tool(key).getAttribute('aria-pressed') === 'true';
  const clauses = () => ed().getJSON().content.filter((n) => n.type === 'consentClause');
  const ID = /^cl_[a-z0-9]{10}$/;

  /* ---------- Admin editor ---------- */

  check($('#save-state').textContent.includes('Tersimpan') && $('#btn-save').disabled, 'seed sample with clauses loads without unsaved changes');
  check($$('#f-content section.clause-edit').length === 2, 'editor shows the two sample clauses');
  check($('.rte-toolbar [role="group"][aria-label="Klausul persetujuan"]') && tool('insertClause').getAttribute('aria-label') === 'Klausul persetujuan', 'toolbar action labelled “Klausul persetujuan”');
  check($$('#preview-doc fieldset.clause').length === 2 && $$('#preview-doc .clause-sim').length === 2, 'preview labels each clause as a simulation');
  check($$('#preview-doc input[type="radio"]').every((r) => !r.checked), 'preview radios start unselected');

  setDoc(para('Pembuka'));
  ed().commands.focus('end');
  check(disabled('clauseRequired') && disabled('deleteClause'), 'clause settings disabled outside a clause');
  click(tool('insertClause'));
  let c = clauses()[0];
  check(c && ID.test(c.attrs.clauseId) && c.attrs.required === true, 'inserted clause: generated ID, “Wajib dijawab Ya” on by default');
  check(ed().state.selection.$from.parent.type.name === 'clauseTitle', 'cursor placed in the clause title');
  check($('#f-content .clause-edit-title.is-empty'), 'empty title shows a hint');
  check($('#f-content .clause-edit-options').textContent.includes('Tidak') && $('#f-content .clause-edit-options').getAttribute('contenteditable') === 'false', 'fixed Tidak/Ya options shown, not editable');
  const firstId = c.attrs.clauseId;
  ed().commands.insertContent('Pernyataan uji');
  ed().view.dom.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check(ed().state.selection.$from.parent.type.name === 'paragraph' && ed().state.selection.$from.node(-1).type.name === 'clauseBody', 'Enter in the title moves to the explanatory text');
  ed().commands.insertContent('Penjelasan dengan ');
  ed().commands.toggleBold();
  ed().commands.insertContent('teks tebal');
  check(clauses()[0].content[1].content[0].content.some((n) => (n.marks || []).some((m) => m.type === 'bold')), 'explanatory text supports rich-text marks');
  check(disabled('insertClause') && disabled('insertTable') && disabled('h2'), 'cannot insert a clause, table, or heading inside a clause');
  check(ed().commands.insertConsentClause() === false && clauses().length === 1, 'nested clause refused by command');
  check(pressed('clauseRequired'), '“Wajib dijawab Ya” pressed');
  click(tool('clauseRequired'));
  check(clauses()[0].attrs.required === false && $('#f-content .clause-edit-req').textContent === 'Opsional' && !$('#preview-doc .clause-req'), 'required setting toggled off');
  click(tool('clauseRequired'));
  check(clauses()[0].attrs.required === true && $('#preview-doc .clause-req').textContent === 'Wajib dijawab Ya', 'required setting toggled back on');
  check(clauses()[0].attrs.clauseId === firstId, 'ID stable across edits');

  // Duplicate by copy-paste: the copy gets a fresh ID, the original keeps its own.
  const html = $('#f-content section.clause-edit').outerHTML;
  ed().commands.focus('end');
  ed().view.pasteHTML(html);
  await tick();
  let ids = clauses().map((x) => x.attrs.clauseId);
  check(ids.length === 2 && ids[0] === firstId && ID.test(ids[1]) && ids[1] !== firstId, 'pasted duplicate gets a fresh ID');
  check(clauses()[1].content[0].content[0].text === 'Pernyataan uji', 'duplicate keeps title and text');
  // A pasted clause with a broken ID is repaired.
  ed().commands.focus('end');
  ed().view.pasteHTML('<section data-clause-id="<script>" data-required="false"><div class="clause-edit-content"><div data-clause-title>Tempel</div><div data-clause-body><p>x</p></div></div></section>');
  await tick();
  ids = clauses().map((x) => x.attrs.clauseId);
  check(ids.length === 3 && ids.every((id) => ID.test(id)) && new Set(ids).size === 3 && clauses()[2].attrs.required === false, 'invalid pasted ID replaced; IDs unique');
  // Deleting a clause (cursor in the last clause's title).
  let lastPos = 0;
  ed().state.doc.forEach((n, pos) => { if (n.type.name === 'consentClause') lastPos = pos; });
  ed().chain().focus().setTextSelection(lastPos + 2).run();
  check(!disabled('deleteClause'), 'delete enabled inside a clause');
  click(tool('deleteClause'));
  check(clauses().length === 2, 'clause deleted');
  check(!$('#err-content .issues'), 'editor-produced clauses validate');

  // Empty title is reported.
  ed().commands.focus('end');
  click(tool('insertClause'));
  click($('#btn-save'));
  await tick();
  check($('#err-content').textContent.includes('Judul klausul persetujuan wajib diisi'), 'empty clause title blocks save with a clear message');
  ed().commands.insertContent('Klausul ketiga');
  ed().commands.toggleClauseRequired();

  // Preview interactions never create anything.
  const pv = $$('#preview-doc input[type="radio"]');
  check(new Set(pv.map((r) => r.name)).size === 3 && pv.every((r) => r.name.startsWith('pv-clause-')), 'preview: one radio group per clause, preview-prefixed');
  setChecked(pv[1], true);
  check(!$('#dialog').open && pv[1].checked, 'choosing in preview opens nothing');

  /* ---------- Publish the seed sample and assign it ---------- */

  await go('#/t/tpl_6');
  await go('#/t/tpl_6/edit'); // discard unsaved test edits (confirm() returns true)
  await go('#/t/tpl_6');
  check(text().includes('Editor visual (JSON v3)'), 'draft shows format v3');
  click($('[data-action="publish"]'));
  confirmDialog(); await tick();
  await go('#/t/tpl_6/v/1');
  check($$('.doc-body fieldset.clause').length === 2 && $$('.doc-body .clause-sim').length === 2, 'published version view shows clauses as simulation');
  await go('#/saya');
  check(!$$('.agr-link').some((a) => a.textContent.startsWith('Profil Perusahaan')) && $$('.agr-card').length === 4, 'publishing assigned nothing; preview recorded nothing');
  $('#sim-assign-tpl').value = 'tpl_6';
  click($('[data-action="sim-assign"]'));
  const href = $$('.agr-link').find((a) => a.textContent.startsWith('Profil Perusahaan')).getAttribute('href');
  await go(href);

  /* ---------- User presentation ---------- */

  const sets = () => $$('.doc-user fieldset.clause');
  const radios = (i) => Array.from(sets()[i].querySelectorAll('input[type="radio"]'));
  const btn = () => $('#btn-accept');
  const issuesText = () => ($('#clause-issues') ? $('#clause-issues').textContent.replace(/\s+/g, ' ') : '');
  check(sets().length === 2, 'two clauses rendered inline');
  const body = $('.doc-user .doc-body');
  check(body.lastElementChild === sets()[1] && sets()[0].previousElementSibling.matches('.kv-wrap'), 'clauses appear at their position after the profile tables');
  check(sets()[0].querySelector('legend').textContent === 'Pernyataan telah membaca profil perusahaan', 'legend is the clause title');
  check(radios(0).map((r) => r.labels[0].textContent.trim()).join('/') === 'Tidak/Ya', 'explicit labels in order Tidak, Ya');
  check(radios(0).every((r) => $(`label[for="${r.id}"]`)), 'labels reference radio IDs');
  check(radios(0)[0].name !== radios(1)[0].name && new Set(radios(0).concat(radios(1)).map((r) => r.id)).size === 4, 'unique radio group and IDs per clause');
  check(radios(0).concat(radios(1)).every((r) => !r.checked), 'all options initially unselected');
  check(sets()[0].querySelector('.clause-req').textContent === 'Wajib dijawab Ya' && !sets()[1].querySelector('.clause-req'), '“Wajib dijawab Ya” only on the required clause');
  check(sets()[0].getAttribute('aria-describedby').split(' ').every((id) => w.document.getElementById(id)), 'fieldset description references exist');
  check(!$('.doc-user .clause-sim'), 'user document has no simulation-preview label');
  check(!$('.doc-user').closest('form'), 'radios are not inside a form (nothing to submit)');

  /* ---------- Validation ---------- */

  check(btn().disabled && issuesText().includes('Pernyataan telah membaca profil perusahaan') && issuesText().includes('belum dijawab'), 'unanswered required clause named as blocking');
  setChecked($('#consent'), true);
  check(btn().disabled, 'consent alone does not enable acceptance');
  setChecked(radios(0)[0], true); // Tidak
  check(btn().disabled && issuesText().includes('jawaban saat ini: Tidak') && sets()[0].classList.contains('is-blocking'), '“Tidak” blocks with a clear message');
  check($('.lede .badge').textContent === 'Belum disetujui' && sets().length === 2 && !$('#dialog').open, '“Tidak” records nothing, submits nothing, keeps access');
  click(btn());
  check(!$('#dialog').open, 'blocked button opens nothing');
  setChecked(radios(1)[1], true); // optional: Ya
  check(radios(0)[0].checked && radios(1)[1].checked, 'groups are independent');
  setChecked(radios(0)[1], true); // change required to Ya
  check(!radios(0)[0].checked && !btn().disabled && issuesText() === '', 'changing to “Ya” enables acceptance');
  setChecked($('#consent'), false);
  check(btn().disabled, 'unchecking consent disables again');
  setChecked($('#consent'), true);

  // Focus link from an issue message.
  setChecked(radios(0)[0], true);
  click($('#clause-issues [data-action="focus-clause"]'));
  check(w.document.activeElement === radios(0)[0], 'issue link focuses the clause');
  setChecked(radios(0)[1], true);

  // Optional clause may be left unanswered: reset by navigating away and back.
  await go('#/saya');
  check($$('.agr-card').some((c) => c.textContent.includes('Profil Perusahaan') && c.textContent.includes('Belum disetujui')), 'leaving the document records nothing');
  await go(href);
  check(radios(0).concat(radios(1)).every((r) => !r.checked) && !$('#consent').checked, 'answers start empty again after leaving');
  setChecked(radios(0)[1], true);
  setChecked($('#consent'), true);

  /* ---------- Stale confirmation ---------- */

  click(btn());
  const dlg = $('#dialog');
  check(dlg.open && dlg.textContent.includes('Pernyataan telah membaca profil perusahaan') && dlg.textContent.includes('Tidak dijawab'), 'dialog lists the answers to be recorded');
  cancelDialog();
  check($('.lede .badge').textContent === 'Belum disetujui', 'cancel records nothing');
  click(btn());
  setChecked(radios(1)[0], true); // answers change while the dialog is open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui' && $('#toasts').textContent.includes('Jawaban klausul berubah'), 'changed answers make the confirmation stale');
  click(btn());
  setChecked(radios(0)[0], true); // required becomes Tidak while open
  confirmDialog();
  check($('.lede .badge').textContent === 'Belum disetujui', 'required “Tidak” after opening is refused on confirm');
  setChecked(radios(0)[1], true);

  /* ---------- Acceptance and read-only answers ---------- */

  click(btn());
  confirmDialog();
  check($('#accept-result') && $('.lede .badge').textContent === 'Sudah disetujui', 'explicit confirmation accepts');
  const recorded = () => $$('#accept-result [data-clause-answer]').map((d) => d.textContent).join('/');
  check(recorded() === 'Ya/Tidak', 'recorded answers listed with the acceptance');
  check(sets().every((fs) => fs.disabled) && radios(0)[1].checked && radios(1)[0].checked, 'document shows recorded answers read-only');
  check(sets()[0].querySelector('.clause-recorded').textContent === 'Jawaban tercatat: Ya', 'per-clause recorded answer text');
  const at = $('#accept-result time').getAttribute('datetime');

  // Duplicate confirmation keeps the original record and answers.
  dlg.returnValue = 'confirm'; dlg.onclose();
  check($('#accept-result time').getAttribute('datetime') === at && recorded() === 'Ya/Tidak', 'repeated confirmation preserves original timestamp and answers');

  // Later template edits do not alter the snapshot or the responses.
  await go('#/t/tpl_6/edit');
  setDoc({ type: 'consentClause', attrs: { clauseId: 'cl_bacaprofil', required: false }, content: [{ type: 'clauseTitle', content: [{ type: 'text', text: 'Judul diubah' }] }, { type: 'clauseBody', content: [para('Teks baru')] }] });
  click($('#btn-save')); await tick();
  click($('#btn-publish')); confirmDialog(); await tick();
  await go(href);
  check(sets()[0].querySelector('legend').textContent === 'Pernyataan telah membaca profil perusahaan' && sets().length === 2 && recorded() === 'Ya/Tidak', 'snapshot and responses unchanged after later edits');

  // Documents without clauses: unchanged flow.
  await go('#/saya');
  const plain = $$('.agr-link').find((a) => a.textContent.startsWith('Ketentuan Program Rujukan'));
  await go(plain.getAttribute('href'));
  check(!$('#clause-issues') && $$('#main input').length === 1, 'documents without clauses show only the consent checkbox');
  setChecked($('#consent'), true);
  check(!btn().disabled, 'consent alone enables acceptance without clauses');

  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
