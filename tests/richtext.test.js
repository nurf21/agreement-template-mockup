'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RT = require('../js/richtext.js');
const MD = require('../js/markdown.js');

const txt = (text, ...marks) => (marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text });
const p = (...content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const v = (key, ...marks) => (marks.length ? { type: 'variable', attrs: { key }, marks: marks.map((type) => ({ type })) } : { type: 'variable', attrs: { key } });
const docOf = (...blocks) => RT.wrap({ type: 'doc', content: blocks });
const cell = (type, ...content) => ({ type, content: [p(...content)] });
const row = (...cells) => ({ type: 'tableRow', content: cells });
const messages = (env) => RT.contentIssues(env).map((i) => i.message);

test('envelope: format discriminator and version are required', () => {
  assert.deepEqual(messages(docOf(p(txt('a')))), []);
  assert.match(messages({ format: 'html', formatVersion: 1, document: { type: 'doc', content: [p(txt('a'))] } })[0], /Format isi tidak didukung/);
  assert.match(messages({ ...docOf(p(txt('a'))), formatVersion: 2 })[0], /Versi format/);
  assert.match(messages({ ...docOf(p(txt('a'))), html: '<p>a</p>' })[0], /Properti tidak dikenal/);
  assert.match(messages('## Markdown')[0], /richtext-json/);
  assert.match(messages(null)[0], /JSON terstruktur/);
});

test('validation rejects unsupported nodes, marks, and attributes instead of dropping them', () => {
  const cases = [
    [docOf(p(txt('a')), { type: 'image', attrs: { src: 'x.png' } }), /“image” tidak didukung/],
    [docOf({ type: 'blockquote', content: [p(txt('a'))] }), /“blockquote” tidak didukung/],
    [docOf(p({ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] })), /“link” tidak didukung/],
    [docOf(p({ type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] })), /“textStyle” tidak didukung/],
    [docOf({ type: 'paragraph', attrs: { style: 'color:red' }, content: [txt('a')] }), /Atribut “style” tidak didukung/],
    [docOf({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [txt('a')] }), /Nilai atribut “textAlign”/],
    [docOf({ type: 'heading', attrs: { level: 1 }, content: [txt('a')] }), /Nilai atribut “level”/],
    [docOf({ type: 'heading', content: [txt('a')] }), /“level” wajib/],
    [docOf(p({ type: 'text', text: '' })), /Teks kosong/],
    [docOf(p({ type: 'text', text: 'a', onclick: 'x' })), /Properti tidak dikenal/],
    [docOf(p(v('email'))), /Placeholder “email” tidak ada dalam katalog/],
    [docOf(p({ type: 'variable', attrs: { key: 'nama_lengkap', label: 'x' } })), /Atribut “label”/],
    [docOf({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'paragraph' }] }), /paragraf tidak diizinkan di dalam judul/],
    [docOf({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [txt('a')] }] }] }), /judul tidak diizinkan di dalam butir daftar/],
    [docOf({ type: 'table', content: [row({ type: 'tableCell', content: [{ type: 'table', content: [] }] })] }), /tabel tidak diizinkan di dalam sel tabel/],
    [docOf({ type: 'table', content: [row({ type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p(txt('a'))] })] }), /Sel tabel gabungan/],
    [docOf({ type: 'table', content: [row(cell('tableCell', txt('a')), cell('tableCell', txt('b'))), row(cell('tableCell', txt('c')))] }), /jumlah sel yang sama/],
    [docOf(p(txt('a', 'bold', 'bold'))), /ganda/],
    [docOf(), /Dokumen tidak boleh kosong/],
  ];
  for (const [env, re] of cases) {
    const msgs = messages(env);
    assert.ok(msgs.some((m) => re.test(m)), `${re} not in ${JSON.stringify(msgs)}`);
    assert.throws(() => RT.renderDocument(env, null), /Dokumen tidak valid/, 'renderer refuses invalid structure');
  }
});

test('the attribute shapes the editor emits are accepted', () => {
  const env = docOf(
    { type: 'heading', attrs: { level: 2, textAlign: null }, content: [txt('Judul')] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [txt('a', 'bold', 'italic', 'underline'), v('nama_lengkap', 'bold')] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(txt('x')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('y'))] }] }] }] },
    { type: 'table', content: [row({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(txt('H'))] })] },
  );
  assert.deepEqual(messages(env), []);
});

test('meaningful content: text or an approved placeholder; empty structure, marks, and whitespace do not count', () => {
  const required = (env) => RT.contentIssues(env).some((i) => i.kind === 'required');
  assert.ok(required(docOf(p())));
  assert.ok(required(docOf(p(), p(), p())));
  assert.ok(required(docOf(p(txt('   \t ', 'bold')))));
  assert.ok(required(docOf({ type: 'heading', attrs: { level: 2 } })));
  assert.ok(required(docOf({ type: 'table', content: [row(cell('tableHeader'), cell('tableHeader')), row(cell('tableCell'), cell('tableCell'))] })));
  assert.ok(required(docOf({ type: 'bulletList', content: [{ type: 'listItem', content: [p(txt(' '))] }] })));
  assert.ok(!required(docOf(p(txt('a')))));
  assert.ok(!required(docOf(p(v('nama_lengkap')))));
  assert.ok(!required(docOf({ type: 'table', content: [row(cell('tableCell', txt('x')))] })));
});

test('text that looks like a placeholder is refused; placeholders must be nodes', () => {
  assert.match(messages(docOf(p(txt('Halo {{nama_lengkap}}'))))[0], /kurung kurawal ganda/);
  assert.deepEqual(messages(docOf(p(txt('Halo '), v('nama_lengkap')))), []);
});

test('size limit: serialized document length, reported, never truncated', () => {
  const big = docOf(p(txt('x'.repeat(RT.LIMITS.contentJson))));
  const issue = RT.contentIssues(big).find((i) => i.kind === 'length');
  assert.ok(issue);
  assert.match(issue.message, /200\.000 karakter JSON/);
  assert.equal(big.document.content[0].content[0].text.length, RT.LIMITS.contentJson, 'content untouched');
  assert.equal(RT.contentSize(docOf(p(txt('a')))), JSON.stringify(docOf(p(txt('a'))).document).length);
});

test('rendering: headings start at h3, marks, alignment, lists, and header rows', () => {
  const html = RT.renderDocument(docOf(
    { type: 'heading', attrs: { level: 2 }, content: [txt('A')] },
    { type: 'heading', attrs: { level: 3, textAlign: 'right' }, content: [txt('B')] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [txt('t', 'underline', 'bold')] },
    { type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [p(txt('i'))] }] },
    { type: 'table', content: [row(cell('tableHeader', txt('H1')), cell('tableHeader', txt('H2'))), row(cell('tableHeader', txt('R')), cell('tableCell', txt('2')))] },
  ), null);
  assert.match(html, /<h3>A<\/h3>/);
  assert.match(html, /<h4 class="align-right">B<\/h4>/);
  assert.match(html, /<p class="align-center"><strong><u>t<\/u><\/strong><\/p>/);
  assert.match(html, /<ol start="2"><li><p>i<\/p><\/li><\/ol>/);
  assert.match(html, /<div class="table-wrap"><table><thead><tr><th scope="col"><p>H1<\/p><\/th>/);
  assert.match(html, /<tbody><tr><th scope="row"><p>R<\/p><\/th><td><p>2<\/p><\/td><\/tr><\/tbody>/);
  assert.doesNotMatch(html, /style=/);
});

test('rendering escapes text; placeholder values are plain text only', () => {
  const env = docOf(p(txt('<script>alert(1)</script> & "x"'), v('nama_lengkap', 'italic')));
  const evil = '<img src=x onerror=alert(1)> **b** {{nama_lengkap}} </span><b>';
  const html = RT.renderDocument(env, { nama_lengkap: evil });
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
  assert.match(html, /<em><span class="ph-value"[^>]*>&lt;img src=x onerror=alert\(1\)&gt; \*\*b\*\* \{\{nama_lengkap\}\} &lt;\/span&gt;&lt;b&gt;<\/span><\/em>/);
  // Without values a placeholder shows its token; with sample values, the sample.
  assert.match(RT.renderDocument(env, null), /<span class="ph-token">\{\{nama_lengkap\}\}<\/span>/);
  assert.match(RT.renderDocument(env, MD.SAMPLE_VALUES), /Dewi Lestari \(contoh\)/);
});

test('placeholder keys are collected once, in order', () => {
  assert.deepEqual(RT.placeholderKeys(docOf(p(v('nama_lengkap'), txt(' '), v('nama_lengkap')))), ['nama_lengkap']);
  assert.deepEqual(RT.placeholderKeys(docOf(p(txt('x')))), []);
});

test('legacy conversion preserves text, formatting, lists, tables, and placeholders', () => {
  const src = [
    '## Bagian', '', 'Teks **tebal**, *miring*, dan _miring_ untuk {{nama_lengkap}} & 5 < 6 "x".', 'Baris lanjutan.', '',
    '### Sub', '', '- a', '- **{{nama_lengkap}}**', '', '3. tiga', '4. empat', '',
    '| A | B |', '|---|---|', '| 1 | *2* |',
  ].join('\n');
  const res = RT.convertMarkdown(src);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const blocks = res.content.document.content;
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'heading', 'bulletList', 'orderedList', 'table']);
  assert.deepEqual(blocks.slice(0, 3).filter((b) => b.type === 'heading').map((b) => b.attrs.level), [2, 3]);
  assert.deepEqual(blocks[1].content, [
    txt('Teks '), txt('tebal', 'bold'), txt(', '), txt('miring', 'italic'), txt(', dan '), txt('miring', 'italic'),
    txt(' untuk '), v('nama_lengkap'), txt(' & 5 < 6 "x". Baris lanjutan.'),
  ]);
  assert.deepEqual(blocks[3].content[1].content[0].content, [v('nama_lengkap', 'bold')]);
  assert.equal(blocks[4].attrs.start, 3);
  assert.deepEqual(blocks[5].content[0].content.map((c) => c.type), ['tableHeader', 'tableHeader']);
  assert.deepEqual(blocks[5].content[1].content[1].content[0].content, [txt('2', 'italic')]);
  // Same visible text as the legacy renderer; special characters stay text.
  const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(strip(RT.renderDocument(res.content, MD.SAMPLE_VALUES)), strip(MD.renderMarkdown(src, MD.SAMPLE_VALUES)));
});

test('legacy conversion leaves the source string untouched and is deterministic', () => {
  const src = '## A\n\nHalo {{nama_lengkap}}';
  const copy = String(src);
  const a = RT.convertMarkdown(src);
  const b = RT.convertMarkdown(src);
  assert.equal(src, copy);
  assert.deepEqual(a, b);
});

test('every seed Markdown document converts faithfully', () => {
  const S = require('../js/store.js');
  for (const t of S.createSeedState().templates) {
    for (const rec of [t.draft, ...t.versions].filter((r) => r && S.formatOf(r) === 'markdown')) {
      const res = RT.convertMarkdown(rec.content);
      assert.ok(res.ok, `${t.code}: ${JSON.stringify(res.errors)}`);
    }
  }
});

test('legacy conversion fails as a whole when content cannot be preserved', () => {
  const fails = (src, re) => {
    const res = RT.convertMarkdown(src);
    assert.equal(res.ok, false, src);
    assert.equal(res.content, undefined, 'no partial result');
    assert.ok(res.errors.some((m) => re.test(m)), `${re} not in ${JSON.stringify(res.errors)}`);
  };
  fails('# A\n\n## B\n\n### C', /tiga tingkat judul/);
  fails('Halo {{email}}', /tidak ada dalam katalog/);
  fails('| A | B |\n|---|---|\n| 1 | 2 | 3 |', /Baris 3/);
  fails('<script>x</script>', /HTML mentah/);
  fails('   ', /kosong/);
});
