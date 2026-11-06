'use strict';
// Table preset “labelValue” (richtext-json format version 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const RT = require('../js/richtext.js');
const S = require('../js/store.js');
const U = require('../js/user.js');

const T1 = '2026-11-06T02:00:00Z';
const T2 = '2026-11-06T03:00:00Z';

const txt = (text) => ({ type: 'text', text });
const p = (...content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const cell = (type, ...paras) => ({ type, content: paras.length ? paras : [p()] });
const row = (label, ...values) => ({
  type: 'tableRow',
  content: [cell('tableHeader', p(txt(label))), cell('tableCell', ...values.map((v) => (typeof v === 'string' ? p(txt(v)) : v)))],
});
const kv = (rows, attrs) => ({ type: 'table', attrs: { preset: 'labelValue', labelWidth: 25, ...attrs }, content: rows });
const env = (...blocks) => RT.wrap({ type: 'doc', content: blocks });
const messages = (e) => RT.contentIssues(e).map((i) => i.message);
const emptyRow = { type: 'tableRow', content: [cell('tableHeader'), cell('tableCell')] };

test('format version: a preset needs v2; documents without one stay v1', () => {
  assert.equal(env(p(txt('a'))).formatVersion, 1);
  assert.equal(env({ type: 'table', attrs: { preset: null, labelWidth: null }, content: [row('A', 'B')] }).formatVersion, 1);
  assert.equal(env(kv([row('A', 'B')])).formatVersion, 2);
  const v1 = { ...env(kv([row('A', 'B')])), formatVersion: 1 };
  assert.ok(messages(v1).some((m) => /memerlukan format versi 2/.test(m)));
});

test('allowed label widths are exactly 20, 25, and 30', () => {
  for (const w of [20, 25, 30]) assert.deepEqual(messages(env(kv([row('A', 'B')], { labelWidth: w }))), [], String(w));
  for (const w of [10, 40, 25.5, '25', '25%', 'calc(25%)']) {
    assert.ok(messages(env(kv([row('A', 'B')], { labelWidth: w }))).some((m) => /Lebar kolom label harus 20%, 25%, atau 30%/.test(m)), String(w));
  }
  assert.ok(messages(env(kv([row('A', 'B')], { labelWidth: null }))).some((m) => /wajib memiliki lebar kolom label/.test(m)));
});

test('malformed preset tables produce clear errors instead of losing content', () => {
  const three = { type: 'tableRow', content: [cell('tableHeader', p(txt('A'))), cell('tableCell', p(txt('B'))), cell('tableCell', p(txt('C')))] };
  const swapped = { type: 'tableRow', content: [cell('tableCell', p(txt('A'))), cell('tableHeader', p(txt('B')))] };
  const merged = { type: 'tableRow', content: [{ ...cell('tableHeader', p(txt('A'))), attrs: { colspan: 2, rowspan: 1, colwidth: null } }] };
  const cases = [
    [env(kv([three, three])), /tepat dua kolom \(baris 1 memiliki 3 sel\)/],
    [env(kv([swapped])), /Kolom kiri .* sel label/],
    [env(kv([swapped])), /Kolom kanan .* sel nilai/],
    [env(kv([merged])), /Sel tabel gabungan tidak didukung/],
    [env(kv([row('A', 'B')], { preset: 'fancy' })), /Jenis tabel “fancy” tidak didukung/],
    [env(kv([row('A', 'B')], { style: 'width:40%' })), /Atribut “style” tidak didukung pada tabel/],
    [env({ type: 'table', attrs: { preset: null, labelWidth: 25 }, content: [row('A', 'B')] }), /hanya berlaku untuk tabel label–nilai/],
  ];
  for (const [doc, re] of cases) {
    const msgs = messages(doc);
    assert.ok(msgs.some((m) => re.test(m)), `${re} not in ${JSON.stringify(msgs)}`);
    assert.throws(() => RT.renderDocument(doc, null), /Dokumen tidak valid/, 'renderer refuses instead of dropping cells');
  }
});

test('an empty label–value table is not meaningful content', () => {
  const empty = env(kv([emptyRow, emptyRow, emptyRow]));
  assert.deepEqual(RT.structureIssues(empty), []);
  assert.equal(RT.hasMeaningfulContent(empty), false);
  assert.ok(messages(empty).some((m) => /Isi dokumen wajib diisi/.test(m)));
  assert.equal(RT.hasMeaningfulContent(env(kv([row('Nama')]))), true, 'a filled label counts');
});

test('rendering: row headers, derived width class, escaped rich text, multi-paragraph cells, placeholders', () => {
  const long = 'Sejarah panjang '.repeat(200).trim();
  const doc = env(
    { type: 'heading', attrs: { level: 2 }, content: [txt('Profil')] },
    kv([
      row('Nama <b>', { type: 'paragraph', content: [{ type: 'text', text: 'PT "Contoh" & Co', marks: [{ type: 'bold' }] }] }),
      row('Kontak', { type: 'paragraph', content: [txt('Halo '), { type: 'variable', attrs: { key: 'nama_lengkap' } }] }),
      row('Sejarah', long, 'Paragraf kedua.', { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('butir'))] }] }),
    ], { labelWidth: 30 }),
  );
  const html = RT.renderDocument(doc, { nama_lengkap: '<script>x</script>' });
  assert.match(html, /^<h3>Profil<\/h3>\n<div class="kv-wrap"><table class="kv-table kv-w30"><colgroup><col class="kv-col-label"><col><\/colgroup><tbody>/);
  assert.equal((html.match(/<th scope="row">/g) || []).length, 3);
  assert.ok(!/<thead|style=|scope="col"/.test(html), 'no header row, no inline styles');
  assert.ok(html.includes('<th scope="row"><p>Nama &lt;b&gt;</p></th><td><p><strong>PT &quot;Contoh&quot; &amp; Co</strong></p></td>'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;') && !html.includes('<script>'), 'placeholder value escaped');
  assert.ok(html.includes(`<p>${long}</p><p>Paragraf kedua.</p><ul><li><p>butir</p></li></ul>`), 'long text and all paragraphs kept, untruncated');
});

test('ordinary tables render exactly as before', () => {
  const ordinary = [row('A', 'B')].map((r) => ({ ...r, content: [cell('tableHeader', p(txt('H1'))), cell('tableHeader', p(txt('H2')))] }));
  const html1 = RT.renderDocument(env({ type: 'table', content: ordinary }), null);
  const html2 = RT.renderDocument(env({ type: 'table', attrs: { preset: null, labelWidth: null }, content: ordinary }), null);
  assert.equal(html1, '<div class="table-wrap"><table><thead><tr><th scope="col"><p>H1</p></th><th scope="col"><p>H2</p></th></tr></thead></table></div>');
  assert.equal(html2, html1);
});

function createWithPreset(st, width) {
  const content = env({ type: 'heading', attrs: { level: 2 }, content: [txt('Profil Perusahaan')] }, kv([row('Nama Perusahaan', 'PT Fiktif')], { labelWidth: width }));
  return S.saveDraft(st, { templateId: null, code: S.generateCode(st), internalName: 'KV', title: 'Profil', content }, 'Admin', T1);
}

test('JSON save → reload → publish keeps the preset and records render/format versions', () => {
  const st = { nextId: 1, templates: [] };
  const t = createWithPreset(st, 20);
  const reloaded = JSON.parse(JSON.stringify(t.draft.content));
  assert.deepEqual(reloaded, t.draft.content);
  assert.equal(reloaded.formatVersion, 2);
  assert.deepEqual(reloaded.document.content[1].attrs, { preset: 'labelValue', labelWidth: 20 });
  S.saveDraft(st, { templateId: t.id, internalName: 'KV', title: 'Profil', content: reloaded, lockVersion: t.lockVersion }, 'Admin', T1);
  const v = S.publishDraft(st, t.id, t.lockVersion, 'Admin', T2);
  assert.equal(v.renderVersion, RT.RENDER_VERSION);
  assert.equal(v.content.formatVersion, 2);
  assert.ok(Object.isFrozen(v.content.document.content[1].attrs));
  // Stale lockVersion is still rejected.
  assert.throws(() => S.saveDraft(st, { templateId: t.id, internalName: 'KV', title: 'X', content: reloaded, lockVersion: 1 }, 'Admin', T2), { code: 'CONFLICT' });
});

test('saving refuses a malformed preset table with a clear error', () => {
  const st = { nextId: 1, templates: [] };
  const bad = env(kv([row('A', 'B')], { labelWidth: 50 }));
  assert.throws(() => S.saveDraft(st, { templateId: null, code: S.generateCode(st), internalName: 'N', title: 'J', content: bad }, 'A', T1),
    (err) => err.code === 'INVALID' && err.details.errors.some((e) => /20%, 25%, atau 30%/.test(e.message)));
  assert.equal(st.templates.length, 0);
});

test('user snapshots use the preview renderer and record renderVersion; existing snapshots are untouched', () => {
  const tpl = S.createSeedState();
  const user = U.createSeedUserState(tpl);
  const before = JSON.stringify(user.assignments);
  const t = S.getTemplate(tpl, 'tpl_6');
  const v = S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
  const a = U.assignVersion(user, tpl, t.id, v.number, T2);
  const s = a.snapshot;
  assert.equal(s.renderVersion, RT.RENDER_VERSION);
  assert.equal(s.formatVersion, 5, 'seed sample also holds consent clauses (format 5)');
  assert.equal(s.html, RT.renderDocument(v.content, {}));
  assert.match(s.html, /<table class="kv-table kv-w25">/);
  assert.equal(JSON.stringify(user.assignments.slice(0, -1)), before, 'existing (Markdown) snapshots unchanged');
  assert.ok(user.assignments.slice(0, -1).every((x) => x.snapshot.renderVersion === undefined), 'historical snapshots not re-labelled');
});

test('seed sample: fictional, editable static text with the requested headings and rows', () => {
  const t = S.getTemplate(S.createSeedState(), 'tpl_6');
  const c = t.draft.content;
  assert.deepEqual(S.validateRecord(t.internalName, t.draft), []);
  assert.deepEqual(RT.placeholderKeys(c), [], 'no placeholders or lookups');
  const blocks = c.document.content;
  const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.content[0].text);
  assert.deepEqual(headings, ['Profil Perusahaan', 'Susunan Pengurus Perusahaan']);
  const labels = blocks.filter((b) => b.type === 'table').map((tb) => tb.content.map((r) => r.content[0].content[0].content[0].text));
  assert.deepEqual(labels, [
    ['Nama Perusahaan', 'Alamat Perusahaan', 'Nomor Telepon', 'Nomor Fax', 'Alamat Email', 'Alamat Website',
      'Tempat dan Tanggal Berdirinya Perusahaan', 'Sejarah dan Reputasi Perusahaan'],
    ['Direktur Utama', 'Direktur', 'Komisaris'],
  ]);
  const history = blocks[2].content[7].content[1].content;
  assert.ok(history.length >= 3 && history.every((x) => x.type === 'paragraph'), 'multi-paragraph history');
  assert.match(t.internalName + t.draft.title, /fiktif/i);
  assert.ok(RT.plainText(c).includes('.example'), 'reserved example domain');
});
