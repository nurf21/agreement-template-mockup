// DOM test of the visual editor (Tiptap in jsdom): toolbar, tables, undo/redo,
// keyboard access, placeholders, paste safety, JSON storage, legacy conversion,
// and JSON user snapshots. jsdom has no layout, so visual checks run separately.
const { load } = require('./dom-harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const h = load('#/t/tpl_3/edit');
  const { w, $, $$, errors, text, go, click, check, setDoc, para, editor, confirmDialog, tick } = h;
  const ed = () => editor();
  const json = () => ed().getJSON();
  const tool = (key) => $(`.rte-toolbar [data-fmt="${key}"]`);
  const pressed = (key) => tool(key).getAttribute('aria-pressed') === 'true';
  const disabled = (key) => tool(key).getAttribute('aria-disabled') === 'true';
  const key = (el, k, mods) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
  const selectText = (from, to) => ed().commands.setTextSelection({ from, to });

  // Structure and accessibility of the editor.
  const area = $('#f-content');
  check(area && area.getAttribute('contenteditable') === 'true' && area.getAttribute('role') === 'textbox', 'Tiptap editor mounted as a textbox');
  check(area.getAttribute('aria-labelledby') === 'content-label' && $('#content-label').textContent.includes('Isi dokumen'), 'editor is labelled');
  check(!$('textarea#f-content') && !$('.md-toolbar'), 'Markdown textarea and toolbar removed');
  const bar = $('.rte-toolbar');
  check(bar.getAttribute('role') === 'toolbar' && bar.getAttribute('aria-label'), 'toolbar role and label');
  const groups = $$('.rte-toolbar .tool-group').map((g) => g.getAttribute('aria-label'));
  check(['Riwayat', 'Jenis blok', 'Format teks', 'Perataan', 'Daftar', 'Tabel', 'Placeholder'].every((g) => groups.includes(g)), 'controls grouped and labelled: ' + groups.join(', '));
  const tools = $$('.rte-toolbar .tool');
  check(tools.every((b) => (b.getAttribute('aria-label') || b.textContent.trim()) && b.type === 'button'), 'every control has an accessible name');
  check(tools.filter((b) => b.tabIndex === 0).length === 1, 'toolbar has exactly one tab stop (roving tabindex)');
  check($('#save-state').textContent.includes('Tersimpan') && $('#btn-save').disabled, 'loading a JSON draft is not an unsaved change');
  check(area.querySelector('p[style*="text-align: center"] em u'), 'seed JSON draft shows alignment, italic, underline');

  // Toolbar formatting.
  setDoc(para('halo dunia'));
  selectText(1, 5);
  click(tool('bold'));
  check(JSON.stringify(json()).includes('"marks":[{"type":"bold"}]') && pressed('bold'), 'bold applied, button pressed');
  click(tool('italic'));
  click(tool('underline'));
  const marks = json().content[0].content[0].marks.map((m) => m.type);
  check(['bold', 'italic', 'underline'].every((m) => marks.includes(m)), 'italic and underline applied');
  click(tool('h2'));
  check(json().content[0].type === 'heading' && json().content[0].attrs.level === 2 && pressed('h2'), 'H2 heading');
  click(tool('h3'));
  check(json().content[0].attrs.level === 3, 'H3 heading');
  click(tool('paragraph'));
  check(json().content[0].type === 'paragraph', 'back to paragraph');
  click(tool('alignCenter'));
  check(json().content[0].attrs.textAlign === 'center' && pressed('alignCenter') && !pressed('alignLeft'), 'center alignment');
  click(tool('alignRight'));
  check(json().content[0].attrs.textAlign === 'right', 'right alignment');
  click(tool('alignLeft'));
  check(json().content[0].attrs.textAlign === 'left', 'left alignment');
  click(tool('bulletList'));
  check(json().content[0].type === 'bulletList' && pressed('bulletList'), 'bullet list');
  click(tool('orderedList'));
  check(json().content[0].type === 'orderedList' && pressed('orderedList'), 'ordered list');
  check(disabled('h2') && disabled('insertTable'), 'headings and tables disabled inside lists (not allowed there)');
  click(tool('orderedList'));
  check(json().content[0].type === 'paragraph', 'list toggled off');
  check($('#preview-doc p strong em u') && $('#preview-doc p strong em u').textContent === 'halo', 'preview renders the same formatting');

  // Keyboard shortcuts in the editor.
  setDoc(para('kunci'));
  selectText(1, 6);
  key(area, 'b', { ctrlKey: true });
  check(JSON.stringify(json()).includes('"bold"'), 'Ctrl+B toggles bold');
  key(area, 'u', { ctrlKey: true });
  check(JSON.stringify(json()).includes('"underline"'), 'Ctrl+U toggles underline');

  // Tables.
  setDoc(para('Sebelum tabel'));
  ed().commands.focus('end');
  check(['addRowAfter', 'deleteRow', 'addColumnAfter', 'deleteColumn', 'toggleHeaderRow', 'deleteTable'].every(disabled), 'row/column controls disabled outside a table');
  click(tool('insertTable'));
  const table = () => json().content.find((n) => n.type === 'table');
  const shape = () => table().content.map((r) => r.content.length);
  check(table() && shape().join() === '2,2,2' && table().content[0].content.every((c) => c.type === 'tableHeader'), 'table inserted: 3×2 with header row');
  check(!disabled('addRowAfter') && !disabled('deleteTable') && pressed('toggleHeaderRow'), 'table controls enabled inside a table; header row pressed');
  ed().commands.insertContent('Sel A');
  check($('#preview-doc thead th[scope="col"]').textContent === 'Sel A' && $('#preview-doc .table-wrap'), 'preview renders the header row as <thead>');
  click(tool('addRowAfter'));
  check(shape().join() === '2,2,2,2', 'row added');
  click(tool('addColumnAfter'));
  check(shape().join() === '3,3,3,3', 'column added');
  click(tool('deleteColumn'));
  check(shape().join() === '2,2,2,2', 'column removed');
  click(tool('deleteRow')); // the cursor is in the header row
  check(shape().join() === '2,2,2' && !JSON.stringify(table()).includes('Sel A') && !pressed('toggleHeaderRow'), 'current (header) row removed');
  click(tool('toggleHeaderRow'));
  check(table().content[0].content.every((c) => c.type === 'tableHeader') && pressed('toggleHeaderRow'), 'header row toggled on');
  click(tool('toggleHeaderRow'));
  check(table().content[0].content.every((c) => c.type === 'tableCell'), 'header row toggled off');
  click(tool('toggleHeaderRow'));
  check(!$('#err-content .issues'), 'editor-produced table validates');

  // Undo / redo (history groups changes within 500 ms).
  await sleep(600);
  click(tool('deleteTable'));
  check(!table(), 'table deleted');
  click(tool('undo'));
  check(table() && shape().join() === '2,2,2', 'undo restores the table');
  click(tool('redo'));
  check(!table(), 'redo deletes it again');
  await sleep(600);
  key(area, 'z', { ctrlKey: true });
  check(table(), 'Ctrl+Z undoes');
  key(area, 'y', { ctrlKey: true });
  check(!table(), 'Ctrl+Y redoes');

  // Toolbar keyboard operation (roving tabindex, arrows, Home/End, Escape).
  tools[0].focus();
  key(tools[0], 'ArrowRight');
  check(w.document.activeElement === tools[1] && tools[1].tabIndex === 0 && tools[0].tabIndex === -1, 'ArrowRight moves focus and the tab stop');
  key(tools[1], 'End');
  check(w.document.activeElement === $('#ph-btn'), 'End goes to the last control');
  key($('#ph-btn'), 'Home');
  check(w.document.activeElement === tools[0], 'Home goes to the first control');
  key(tools[0], 'ArrowLeft');
  check(w.document.activeElement === $('#ph-btn'), 'ArrowLeft wraps around');
  key($('#ph-btn'), 'Escape');
  await sleep(40); // Tiptap focuses in requestAnimationFrame
  check(w.document.activeElement === area, 'Escape returns focus to the document');
  key(area, 'Escape');
  check(w.document.activeElement === $('#ph-btn'), 'Escape in the document moves to the toolbar (remembered control)');
  ed().commands.focus();
  await sleep(40);
  key(area, 'F10', { altKey: true });
  check(w.document.activeElement.closest('.rte-toolbar'), 'Alt+F10 moves to the toolbar');
  check(disabled('undo') === false && tool('undo').getAttribute('aria-pressed') === null, 'command buttons are not toggle buttons');

  // Placeholder menu (keyboard) and atomic chips.
  setDoc(para('Halo '));
  ed().commands.focus('end');
  click($('#ph-btn'));
  check(!$('#ph-menu').hidden && $('#ph-btn').getAttribute('aria-expanded') === 'true' && w.document.activeElement.matches('[role="menuitem"]'), 'placeholder menu opens with focus on first item');
  check($('#ph-menu').textContent.includes('Nama lengkap') && $('#ph-menu').textContent.includes('nama_lengkap'), 'menu shows label and fixed key');
  key(w.document.activeElement, 'Escape');
  check($('#ph-menu').hidden && w.document.activeElement === $('#ph-btn'), 'Escape closes the menu');
  click($('#ph-btn'));
  click($('[data-action="ph-insert"][data-key="nama_lengkap"]'));
  const chip = area.querySelector('.ph-chip');
  check(chip && chip.textContent === 'Nama lengkap' && chip.getAttribute('contenteditable') === 'false', 'chip shows the label and is not editable');
  check(JSON.stringify(json().content[0].content[1]) === '{"type":"variable","attrs":{"key":"nama_lengkap"}}', 'stored as an atomic variable node with only its key');
  check(!area.textContent.includes('{{'), 'no {{…}} text in the editor');
  check(ed().commands.insertVariable('email') === false, 'keys outside the catalogue cannot be inserted');
  ed().commands.setNodeSelection(6); // "Halo " spans 1–6
  key(area, 'Backspace');
  check(!JSON.stringify(json()).includes('variable'), 'a selected placeholder is removed as a whole');

  // Paste safety: the editor schema drops scripts, images, links, styles, and unsupported nodes.
  setDoc(para());
  ed().commands.focus();
  w.__pwned = 0;
  ed().view.pasteHTML(
    '<script>window.__pwned=1</script><style>p{color:red}</style>' +
    '<p style="color:red;font-size:40px;text-align:justify" class="x" onclick="window.__pwned=2">Teks <img src="x" onerror="window.__pwned=3">' +
    '<a href="javascript:alert(1)">tautan</a> <s>coret</s> <code>kode</code> <span style="color:red">merah</span></p>' +
    '<blockquote><p>Kutipan</p></blockquote><h1>Besar</h1><pre>pra</pre><hr>' +
    '<p><span data-variable="email">Email</span> <span data-variable="nama_lengkap">X</span></p>' +
    '<ol type="a" start="3"><li>butir</li></ol>' +
    '<table><tr><td style="background:red" data-colwidth="300">sel</td></tr></table>',
  );
  await tick();
  const pasted = JSON.stringify(json());
  check(w.__pwned === 0, 'pasted scripts and handlers never run');
  check(!/image|link|strike|code|blockquote|horizontalRule|textStyle|style|color|justify|"type":"a"|colwidth":\[/.test(pasted), 'pasted images, links, styles, and unsupported nodes are not in the JSON');
  check(['Teks', 'tautan', 'coret', 'kode', 'merah', 'Kutipan', 'Besar', 'butir', 'sel'].every((t) => pasted.includes(t)), 'pasted text is kept as plain text');
  check(pasted.includes('"key":"nama_lengkap"') && pasted.includes('Email') && !pasted.includes('"key":"email"'), 'only catalogue placeholders survive paste');
  check(w.AgreementRichText.structureIssues(w.AgreementRichText.wrap(json())).length === 0, 'pasted result passes structural validation');
  check(!$('#f-content').innerHTML.includes('<img') && !$('#f-content').innerHTML.includes('<script'), 'no image or script elements in the editor');

  // Save the draft: stored as validated JSON; revision changes, version does not.
  setDoc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Komunikasi' }] }, para('Isi baru '));
  ed().commands.focus('end');
  click($('#ph-btn'));
  click($('[data-action="ph-insert"]'));
  check($('#save-state').textContent.includes('belum disimpan') && !$('#btn-save').disabled, 'edits mark the draft dirty');
  key($('#editor-form'), 's', { ctrlKey: true });
  await tick();
  check($('#save-state').textContent.includes('revisi 3'), 'Ctrl+S saves: draft revision 2 → 3');
  check(area.isConnected && $('#f-content') === area, 'editor instance survives re-render');
  click(tool('undo'));
  check(!JSON.stringify(json()).includes('variable'), 'undo history kept after save');
  click(tool('redo'));
  await go('#/t/tpl_3');
  check(text().includes('Draf revisi 3') && text().includes('Editor visual (JSON v1)'), 'detail shows JSON draft and format');
  check($('.doc-body h3').textContent === 'Komunikasi' && $('.doc-body .ph-value').textContent === 'Dewi Lestari (contoh)', 'draft view uses the JSON renderer with sample values');
  click($('[data-action="show-values"][data-val="0"]'));
  check($('.doc-body .ph-token').textContent === '{{nama_lengkap}}', 'code view shows the placeholder key');
  click($('[data-action="show-values"][data-val="1"]'));

  // Publish: immutable JSON version; publishing assigns nothing.
  const userBefore = await (async () => { await go('#/saya'); return $$('.agr-card').length; })();
  await go('#/t/tpl_3');
  click($('[data-action="publish"]'));
  check($('#dialog').textContent.includes('Versi 1') && !$('#dialog [value="confirm"]').disabled, 'publish confirmation for Versi 1');
  confirmDialog(); await tick();
  await go('#/t/tpl_3/v/1');
  check(text().includes('Editor visual (JSON v1)') && text().includes('hanya baca') && $('.doc-body h3'), 'JSON version view, read-only');
  await go('#/saya');
  check($$('.agr-card').length === userBefore, 'publishing created no assignment');

  // Explicit assignment freezes a JSON snapshot; later edits do not change it.
  $('#sim-assign-tpl').value = 'tpl_3';
  click($('[data-action="sim-assign"]'));
  const link = $$('.agr-link').find((a) => a.textContent.startsWith('Persetujuan Komunikasi'));
  await go(link.getAttribute('href'));
  const userDoc = () => $('.doc-user .doc-body').innerHTML;
  const frozen = userDoc();
  check(frozen.includes('<h3>Komunikasi</h3>') && $('.doc-user .ph-value').textContent === 'Dewi Lestari', 'user snapshot rendered from JSON with the synthetic value');
  const userHash = w.location.hash;
  await go('#/t/tpl_3/edit');
  setDoc(para('Diubah setelah penugasan.'));
  click($('#btn-save'));
  await tick();
  click($('#btn-publish'));
  confirmDialog(); await tick();
  await go(userHash);
  check(userDoc() === frozen, 'snapshot unchanged after a later edit and publication');
  h.setChecked($('#consent'), true);
  click($('#btn-accept'));
  check($('#dialog').textContent.includes('Persetujuan Komunikasi') && $('#dialog').textContent.includes('Versi 1'), 'confirmation names exact title and version');
  confirmDialog();
  check($('#accept-result') && userDoc() === frozen, 'accepted; document unchanged');

  // Legacy Markdown version: explicit conversion only.
  await go('#/t/tpl_2/v/1');
  check(text().includes('Markdown lama') && text().includes('tidak dikonversi otomatis'), 'legacy version read with its original renderer');
  const legacyHtml = $('.doc-body').innerHTML;
  await go('#/t/tpl_2/edit');
  check(!$('#f-content') && $('[data-action="convert-legacy"]').textContent === 'Buat draf editor visual', 'legacy source offers “Buat draf editor visual”, no editor');
  check(text().includes('salinan JSON yang dapat diedit') && text().includes('Versi 1 tetap tersimpan tanpa perubahan'), 'explains the JSON copy and preserved original');
  check($('.doc-body').innerHTML === legacyHtml, 'original shown read-only with the legacy renderer');
  click($('[data-action="convert-legacy"]'));
  check($('#f-content') && h.docText().includes('Program bersifat sukarela.') && $('#f-content .ph-chip'), 'converted draft opens in the visual editor with text and chips');
  check($('#save-state').textContent.includes('revisi 1') && $('#toasts').textContent.includes('Versi 1 tidak berubah'), 'draft revision 1 created; toast confirms the original is unchanged');
  await go('#/t/tpl_2/v/1');
  check($('.doc-body').innerHTML === legacyHtml && text().includes('Markdown lama'), 'published Markdown version unchanged after conversion');
  await go('#/t/tpl_2');
  click($('[data-action="detail-view"][data-val="draft"]'));
  check(text().includes('dikonversi dari Markdown Versi 1'), 'draft records its Markdown source');

  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '));

  // Conversion that cannot be faithful: clear error, nothing saved.
  const h2 = load('#/t/tpl_2/edit', {
    beforeApp: (win) => {
      const S = win.AgreementStore;
      const orig = S.createSeedState;
      S.createSeedState = () => {
        const st = orig();
        const t = st.templates.find((x) => x.id === 'tpl_2');
        t.versions = Object.freeze([Object.freeze({ ...t.versions[0], content: '# Bab\n\n## Bagian\n\n### Pasal\n\nTeks {{nama_lengkap}}.' })]);
        return st;
      };
    },
  });
  await h2.tick();
  h2.click(h2.$('[data-action="convert-legacy"]'));
  const box = h2.$('#convert-error');
  h2.check(box && box.getAttribute('role') === 'alert' && h2.w.document.activeElement === box, 'conversion failure shown as a focused alert');
  h2.check(box.textContent.includes('tidak ada yang disimpan') && box.textContent.includes('tiga tingkat judul'), 'error explains why');
  h2.check(!h2.$('#f-content'), 'no editor opened');
  await h2.go('#/t/tpl_2');
  h2.check(!h2.text().includes('Draf (revisi') && h2.text().includes('Edit (buat draf dari Versi 1)'), 'no draft saved');
  h2.check(h2.errors.length === 0, 'no runtime errors (failure case)');
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
