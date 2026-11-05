'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MD = require('../js/markdown.js');

test('renders the supported subset', () => {
  const html = MD.renderMarkdown([
    '## Bagian', '', 'Teks **tebal** dan *miring*.', '',
    '- a', '- b', '', '1. satu', '2. dua', '',
    '| A | B |', '|---|---|', '| 1 | 2 |',
  ].join('\n'));
  assert.match(html, /<h3>Bagian<\/h3>/);
  assert.match(html, /<strong>tebal<\/strong>/);
  assert.match(html, /<em>miring<\/em>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>satu<\/li><li>dua<\/li><\/ol>/);
  assert.match(html, /<th scope="col">A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

test('raw HTML, scripts, and images are never rendered as markup', () => {
  const html = MD.renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![a](http://x/y.png)');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /!\[a\]\(http:\/\/x\/y\.png\)/);
});

test('substituted values are plain text, not Markdown or HTML', () => {
  const html = MD.renderMarkdown('Halo {{nama_lengkap}}', { nama_lengkap: '**x** <b>y</b> {{nama_lengkap}}' });
  assert.doesNotMatch(html, /<strong>x|<b>/);
  assert.match(html, /\*\*x\*\* &lt;b&gt;y&lt;\/b&gt; \{\{nama_lengkap\}\}/);
});

test('emphasis around a placeholder wraps the value', () => {
  const html = MD.renderMarkdown('**{{nama_lengkap}}**', MD.SAMPLE_VALUES);
  assert.match(html, /<strong><span class="ph-value"[^>]*>Dewi Lestari \(contoh\)<\/span><\/strong>/);
});

test('without values, known placeholders render as tokens; unknown ones are flagged', () => {
  const html = MD.renderMarkdown('{{nama_lengkap}} {{email}}', null);
  assert.match(html, /class="ph-token">\{\{nama_lengkap\}\}/);
  assert.match(html, /class="ph-unknown"[^>]*>\{\{email\}\}/);
});

test('placeholder underscores are not parsed as italics', () => {
  const html = MD.renderMarkdown('_a_ {{nama_lengkap}} snake_case_word', null);
  assert.match(html, /<em>a<\/em>/);
  assert.match(html, /\{\{nama_lengkap\}\}/);
  assert.match(html, /snake_case_word/);
});

test('validation rejects forbidden content and unknown or malformed placeholders', () => {
  const msgs = (content) => MD.validateDraft({ internalName: 'x', title: 't', content }).map((e) => e.message);
  assert.match(msgs('<b>x</b>')[0], /HTML mentah/);
  assert.match(msgs('![a](b)')[0], /Gambar/);
  assert.match(msgs('{{#if x}}')[0], /Ekspresi/);
  assert.match(msgs('{{ a + b }}')[0], /Ekspresi/);
  assert.match(msgs('${x}')[0], /Ekspresi/);
  assert.match(msgs('{{email}}')[0], /tidak ada dalam katalog/);
  assert.match(msgs('{{ nama_lengkap }}')[0], /Hapus spasi/);
  assert.match(msgs('{{nama_lengkap')[0], /tidak lengkap/);
  assert.deepEqual(msgs('Halo {{nama_lengkap}}'), []);
});

test('name, title, and content are all required, and whitespace does not count', () => {
  const empty = MD.validateDraft({ internalName: '', title: '', content: '' });
  assert.deepEqual(empty.map((e) => [e.field, e.kind]), [['internalName', 'required'], ['title', 'required'], ['content', 'required']]);
  const blank = MD.validateDraft({ internalName: ' ', title: '\t', content: ' \n ' });
  assert.deepEqual(blank.map((e) => e.field), ['internalName', 'title', 'content']);
  assert.ok(blank.every((e) => !/sebelum diterbitkan/.test(e.message)));
  assert.deepEqual(MD.validateDraft({ internalName: 'x', title: 't', content: 'c' }), []);
  const title = MD.validateDraft({ internalName: 'x', title: 'Halo {{nama_lengkap}}', content: 'c' });
  assert.match(title[0].message, /tidak boleh berisi placeholder/);
});

test('length limits still apply', () => {
  const errs = MD.validateDraft({
    internalName: 'n'.repeat(MD.LIMITS.internalName + 1),
    title: 't'.repeat(MD.LIMITS.title + 1),
    content: 'c'.repeat(MD.LIMITS.content + 1),
  });
  assert.deepEqual(errs.map((e) => [e.field, e.kind]), [['internalName', 'length'], ['title', 'length'], ['content', 'length']]);
});

const tableIssues = (content) => MD.validateDraft({ internalName: 'x', title: 't', content }).filter((e) => e.kind === 'table');

test('tables with extra columns are rejected with the offending line', () => {
  const issues = tableIssues('Teks\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 | hilang? |');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 6);
  assert.match(issues[0].message, /^Baris 6: Baris tabel memiliki 3 kolom, sedangkan header tabel \(baris 3\) memiliki 2 kolom/);
});

test('tables with missing columns, or a mismatched separator, are rejected', () => {
  assert.deepEqual(tableIssues('| A | B | C |\n|---|---|---|\n| 1 | 2 |').map((e) => e.line), [3]);
  const sep = tableIssues('| A | B |\n|---|---|---|\n| 1 | 2 |');
  assert.deepEqual(sep.map((e) => e.line), [2]);
  assert.match(sep[0].message, /Baris pemisah tabel memiliki 3 kolom/);
  assert.deepEqual(tableIssues('| A | B |\n|---|---|\n| 1 | 2 |'), []);
});

test('malformed tables preview as literal text with a notice; no cell text is lost', () => {
  const src = '| A | B |\n|---|---|\n| 1 | 2 | ekstra <b>x</b> |\n| 3 |';
  const html = MD.renderMarkdown(src, MD.SAMPLE_VALUES);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /class="md-invalid"/);
  assert.match(html, /baris 3, 4/);
  assert.match(html, /\| 1 \| 2 \| ekstra &lt;b&gt;x&lt;\/b&gt; \|/);
  assert.doesNotMatch(html, /<b>/);
  for (const word of ['A', 'B', '1', '2', 'ekstra', '3']) assert.ok(html.includes(word), word);
});

test('well-formed tables still render every cell', () => {
  const html = MD.renderMarkdown('| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |');
  assert.equal((html.match(/<td>/g) || []).length, 3);
  assert.match(html, /<td>3<\/td>/);
});
