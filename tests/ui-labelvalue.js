// DOM test of the “Tabel label–nilai” preset in the visual editor (Tiptap in
// jsdom): insertion, row editing, widths, structure guard, preview, save/reload,
// publication, and the user snapshot. jsdom has no layout; visual checks are separate.
const { load } = require('./dom-harness');

async function main() {
  const h = load('#/t/tpl_6/edit');
  const { w, $, $$, errors, text, go, click, check, setDoc, para, editor, confirmDialog, tick } = h;
  const ed = () => editor();
  const json = () => ed().getJSON();
  const tool = (key) => $(`.rte-toolbar [data-fmt="${key}"]`);
  const pressed = (key) => tool(key).getAttribute('aria-pressed') === 'true';
  const disabled = (key) => tool(key).getAttribute('aria-disabled') === 'true';
  const tables = () => json().content.filter((n) => n.type === 'table');
  const kinds = (tb) => tb.content.map((r) => r.content.map((c) => c.type[5]).join('')).join(','); // H = header, C = cell

  // Seed sample loads as a clean draft and renders the preset in editor and preview.
  check($('#save-state').textContent.includes('Tersimpan') && $('#btn-save').disabled, 'sample draft loads without unsaved changes');
  check($$('#f-content table.kv-table.kv-w25').length === 2, 'editor shows two label–value tables at 25%');
  check($$('#preview-doc table.kv-table th[scope="row"]').length === 11, 'preview renders 11 row headers');
  check($$('#preview-doc h3').map((x) => x.textContent).join('|') === 'Profil Perusahaan|Susunan Pengurus Perusahaan', 'section headings precede the tables');
  check($('.rte-toolbar [role="group"][aria-label="Tabel label–nilai"]') && tool('insertKvTable').getAttribute('aria-label') === 'Tabel label–nilai', 'toolbar action labelled “Tabel label–nilai”');

  // Insert the preset.
  setDoc(para('Pendahuluan'));
  ed().commands.focus('end');
  check(['kvWidth20', 'kvWidth25', 'kvWidth30'].every(disabled), 'width controls disabled outside a label–value table');
  click(tool('insertKvTable'));
  let kv = tables()[0];
  check(kv && kv.attrs.preset === 'labelValue' && kv.attrs.labelWidth === 25 && kinds(kv) === 'HC,HC,HC', 'inserted: 3 rows × (label, value), default 25%');
  check(ed().isActive('tableHeader'), 'cursor placed in the first label cell');
  check(pressed('kvWidth25') && !pressed('kvWidth20') && !pressed('kvWidth30'), '25% pressed');
  check(['addColumnAfter', 'deleteColumn', 'toggleHeaderRow'].every(disabled), 'column and header-row controls disabled for the preset');
  check(!disabled('addRowAfter') && !disabled('deleteRow') && !disabled('deleteTable'), 'row and delete-table controls enabled');

  // Width.
  click(tool('kvWidth30'));
  check(tables()[0].attrs.labelWidth === 30 && pressed('kvWidth30'), 'width set to 30%');
  check($('#f-content table.kv-table').classList.contains('kv-w30') && $('#preview-doc table.kv-table.kv-w30'), 'editor and preview use the 30% class');
  click(tool('kvWidth20'));
  check(tables()[0].attrs.labelWidth === 20 && $('#preview-doc .kv-w20'), 'width set to 20%');
  check(ed().commands.setLabelWidth(40) === false && tables()[0].attrs.labelWidth === 20, 'widths outside the allowlist are refused');

  // Rows and cell content.
  ed().commands.insertContent('Nama Perusahaan');
  ed().commands.goToNextCell();
  ed().commands.insertContent('PT Uji Fiktif');
  ed().commands.insertVariable('nama_lengkap');
  click(tool('addRowAfter'));
  check(kinds(tables()[0]) === 'HC,HC,HC,HC', 'row added keeps label + value cells');
  ed().commands.goToNextCell(); // into the new row
  click(tool('deleteRow'));
  check(kinds(tables()[0]) === 'HC,HC,HC', 'row removed');
  const firstRow = $('#preview-doc .kv-table tbody tr');
  check(firstRow.querySelector('th[scope="row"]').textContent === 'Nama Perusahaan' && firstRow.querySelector('td .ph-value'), 'preview: label as row header, value with placeholder');
  check(!$('#err-content .issues'), 'editor-produced preset validates');

  // Structure guard: no extra columns, no header-row toggling, no merges.
  const before = JSON.stringify(tables()[0]);
  ed().commands.addColumnAfter();
  ed().commands.toggleHeaderRow();
  await tick();
  check(JSON.stringify(tables()[0]) === before, 'direct column/header commands do not change the preset');
  check($('#toasts').textContent.includes('tabel label–nilai harus tetap dua kolom'), 'rejection explained in a toast');
  ed().view.pasteHTML('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>');
  await tick();
  check(tables()[0].content.every((r) => r.content.length === 2) && tables()[0].attrs.preset === 'labelValue', 'pasting a wider table cannot widen the preset');

  // Ordinary tables keep their own controls.
  ed().commands.focus('end');
  click(tool('insertTable'));
  check(tables().length === 2 && tables()[1].attrs.preset === null && !disabled('addColumnAfter') && pressed('toggleHeaderRow'), 'ordinary table: column and header controls still work');
  click(tool('addColumnAfter'));
  check(tables()[1].content[0].content.length === 3, 'ordinary table column added');
  click(tool('deleteTable'));

  // Empty preset is not meaningful content.
  setDoc({ type: 'paragraph' });
  ed().commands.focus();
  click(tool('insertKvTable'));
  click($('#btn-save'));
  await tick();
  check($('#err-content').textContent.includes('Isi dokumen wajib diisi'), 'an empty label–value table does not satisfy required content');

  // Save, reload, publish, assign, read.
  setDoc(
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Susunan Pengurus Perusahaan' }] },
    { type: 'table', attrs: { preset: 'labelValue', labelWidth: 30 }, content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [para('Direktur Utama')] }, { type: 'tableCell', content: [para('Andi Contoh'), para('Paragraf kedua')] }] },
    ] },
  );
  click($('#btn-save'));
  await tick();
  check($('#save-state').textContent.includes('revisi 2'), 'saved as revision 2');
  await go('#/t/tpl_6');
  await go('#/t/tpl_6/edit');
  check(tables()[0].attrs.labelWidth === 30 && $('#save-state').textContent.includes('Tersimpan'), 'reloaded JSON keeps the 30% preset without becoming dirty');
  await go('#/t/tpl_6');
  check(text().includes('Editor visual (JSON v2)'), 'draft shows format v2');
  click($('[data-action="publish"]'));
  confirmDialog(); await tick();
  await go('#/t/tpl_6/v/1');
  check(text().includes('Editor visual (JSON v2) · tata letak v4') && $('.doc-body .kv-table.kv-w30'), 'version records format and layout versions');
  const adminHtml = $('.doc-body').innerHTML;
  await go('#/saya');
  $('#sim-assign-tpl').value = 'tpl_6';
  click($('[data-action="sim-assign"]'));
  const link = $$('.agr-link').find((a) => a.textContent.startsWith('Profil Perusahaan'));
  await go(link.getAttribute('href'));
  const userTable = $('.doc-user .doc-body table.kv-table.kv-w30');
  check(userTable && userTable.querySelector('th[scope="row"]').textContent === 'Direktur Utama' && userTable.querySelectorAll('td p').length === 2, 'user snapshot renders the preset with row headers and both paragraphs');
  check(!$('.doc-user .kv-wrap[tabindex]'), 'label–value tables do not need a scroll region');
  check(adminHtml.includes('<table class="kv-table kv-w30">'), 'admin version view uses the same markup');

  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
