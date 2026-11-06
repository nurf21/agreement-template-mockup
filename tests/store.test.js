'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');
const RT = require('../js/richtext.js');

const T0 = '2026-11-05T01:00:00Z';
const fresh = () => ({ nextId: 1, templates: [] });

/** One-paragraph rich-text document; '' gives an empty paragraph. */
const doc = (text) => RT.wrap({ type: 'doc', content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }] });
const json = (fields) => (typeof fields.content === 'string' ? { ...fields, content: doc(fields.content) } : fields);
const textOf = (record) => RT.plainText(record.content);

function create(state, extra) {
  return S.saveDraft(state, json({
    templateId: null, code: S.generateCode(state), internalName: 'Nama',
    title: 'Judul', content: 'Isi', ...extra,
  }), 'A', T0);
}

/** Save as an admin who reviewed `lock` (defaults to the current lockVersion). */
function save(state, t, fields, lock) {
  return S.saveDraft(state, json({
    templateId: t.id, code: t.code, internalName: t.internalName,
    title: t.draft ? t.draft.title : 'Judul', content: 'Isi', ...fields,
    lockVersion: lock === undefined ? t.lockVersion : lock,
  }), 'A', T0);
}

const publish = (state, t, lock) => S.publishDraft(state, t.id, lock === undefined ? t.lockVersion : lock, 'A', T0);
const snapshot = (t) => JSON.stringify(t);

test('saving a draft bumps the revision but never creates a version', () => {
  const st = fresh();
  const t = create(st);
  assert.equal(t.draft.revision, 1);
  save(st, t, { content: 'Isi 2' });
  assert.equal(t.draft.revision, 2);
  assert.equal(t.versions.length, 0);
  assert.equal(S.statusOf(t), 'draft');
});

test('valid drafts save and publish; lockVersion rises on each mutation, separately from revision and version', () => {
  const st = fresh();
  const t = create(st);
  assert.equal(t.lockVersion, 1);
  save(st, t, { content: 'Isi 2' });
  assert.equal(t.lockVersion, 2);
  assert.equal(t.draft.revision, 2);
  const v = publish(st, t);
  assert.equal(t.lockVersion, 3);
  assert.equal(v.number, 1);
  assert.equal(v.fromRevision, 2);
  assert.ok(!('lockVersion' in v));
  S.archiveTemplate(st, t.id, 3, 'A', T0);
  assert.equal(t.lockVersion, 4);
});

test('publishing freezes a version and closes the draft', () => {
  const st = fresh();
  const t = create(st);
  const v = S.publishDraft(st, t.id, t.lockVersion, 'B', T0);
  assert.equal(v.number, 1);
  assert.equal(v.publishedBy, 'B');
  assert.equal(v.fromRevision, 1);
  assert.equal(t.draft, null);
  assert.ok(Object.isFrozen(v));
  assert.throws(() => { 'use strict'; v.content = 'x'; }, TypeError);
  assert.throws(() => { 'use strict'; v.content.document.content[0].content[0].text = 'x'; }, TypeError, 'JSON content deep-frozen');
  assert.equal(v.format, 'richtext-json');
  assert.equal(S.statusOf(t), 'published');
});

test('publishing does not assign the agreement to anyone', () => {
  const st = fresh();
  const t = create(st);
  const v = publish(st, t);
  assert.deepEqual(Object.keys(v).sort(), ['content', 'format', 'fromRevision', 'number', 'publishedAt', 'publishedBy', 'renderVersion', 'title']);
  assert.deepEqual(Object.keys(st).sort(), ['nextId', 'templates']);
});

test('editing a published template copies it into one draft; replacement keeps history', () => {
  const st = fresh();
  const t = create(st, { content: 'Versi satu' });
  publish(st, t);
  save(st, t, { content: 'Versi dua' });
  assert.equal(t.draft.basedOnVersion, 1);
  assert.equal(t.draft.revision, 1);
  publish(st, t);
  assert.deepEqual(t.versions.map((v) => [v.number, textOf(v)]), [[1, 'Versi satu'], [2, 'Versi dua']]);
});

test('at most one draft: a second editor starting from the published version conflicts', () => {
  const st = fresh();
  const t = create(st);
  publish(st, t);
  const reviewed = t.lockVersion;
  save(st, t, {}); // first editor creates the draft
  const before = snapshot(t);
  assert.throws(
    () => S.saveDraft(st, { templateId: t.id, internalName: 'Nama', title: 'J', content: doc('x'), lockVersion: reviewed }, 'B', T0),
    (e) => e.code === 'CONFLICT'
  );
  assert.equal(snapshot(t), before);
});

test('a stale lockVersion conflicts on save and on publish without changing data', () => {
  const st = fresh();
  const t = create(st);
  const reviewed = t.lockVersion;
  S.simulateExternalEdit(st, t.id, 'Lain', T0);
  const before = snapshot(t);
  assert.throws(
    () => save(st, t, { content: 'x' }, reviewed),
    (e) => e.code === 'CONFLICT' && e.details.revision === 2 && e.details.by === 'Lain' && e.details.lockVersion === reviewed + 1
  );
  assert.throws(() => publish(st, t, reviewed), (e) => e.code === 'CONFLICT');
  assert.equal(snapshot(t), before);
});

test('mutations without a lockVersion are rejected', () => {
  const st = fresh();
  const t = create(st);
  const before = snapshot(t);
  assert.throws(() => save(st, t, {}, null), (e) => e.code === 'LOCK_REQUIRED');
  assert.throws(() => S.publishDraft(st, t.id, undefined, 'A', T0), (e) => e.code === 'LOCK_REQUIRED');
  assert.throws(() => S.archiveTemplate(st, t.id, undefined, 'A', T0), (e) => e.code === 'LOCK_REQUIRED');
  assert.equal(snapshot(t), before);
});

test('a stale publication request cannot publish a replacement draft with the same revision', () => {
  const st = fresh();
  const t = create(st, { content: 'Draf pertama' });
  const reviewed = t.lockVersion; // admin A reviews draft revision 1
  publish(st, t); // admin B publishes it as Versi 1
  save(st, t, { content: 'Draf pengganti' }); // admin B starts a new draft: revision 1 again
  assert.equal(t.draft.revision, 1);
  const before = snapshot(t);
  assert.throws(() => publish(st, t, reviewed), (e) => e.code === 'CONFLICT');
  assert.equal(snapshot(t), before);
  assert.equal(t.versions.length, 1);
  assert.equal(textOf(t.draft), 'Draf pengganti');
});

test('a concurrent save invalidates an open publication confirmation', () => {
  const st = fresh();
  const t = create(st);
  const confirmLock = t.lockVersion; // confirmation dialog opened
  S.simulateExternalEdit(st, t.id, 'Lain', T0);
  const before = snapshot(t);
  assert.throws(() => publish(st, t, confirmLock), (e) => e.code === 'CONFLICT');
  assert.equal(snapshot(t), before);
  assert.equal(t.versions.length, 0);
});

test('a concurrent publication invalidates open publication and archival confirmations', () => {
  const st = fresh();
  const t = create(st);
  const confirmLock = t.lockVersion;
  publish(st, t); // another admin publishes first
  const before = snapshot(t);
  assert.throws(() => publish(st, t, confirmLock), (e) => e.code === 'CONFLICT' && e.details.published);
  assert.throws(() => S.archiveTemplate(st, t.id, confirmLock, 'A', T0), (e) => e.code === 'CONFLICT');
  assert.equal(snapshot(t), before);
  assert.equal(t.archived, null);
});

test('archival invalidates pending save and publication requests', () => {
  const st = fresh();
  const t = create(st);
  publish(st, t);
  save(st, t, { content: 'Draf baru' });
  const pending = t.lockVersion;
  S.archiveTemplate(st, t.id, pending, 'B', T0);
  const before = snapshot(t);
  assert.throws(() => save(st, t, { content: 'ubah' }, pending), (e) => e.code === 'ARCHIVED');
  assert.throws(() => publish(st, t, pending), (e) => e.code === 'ARCHIVED');
  assert.throws(() => save(st, t, { content: 'ubah' }), (e) => e.code === 'ARCHIVED');
  assert.equal(snapshot(t), before);
});

test('archiving preserves everything and blocks edits and publication', () => {
  const st = fresh();
  const t = create(st);
  publish(st, t);
  save(st, t, {});
  S.archiveTemplate(st, t.id, t.lockVersion, 'A', T0);
  assert.equal(S.statusOf(t), 'archived');
  assert.equal(t.versions.length, 1);
  assert.ok(t.draft);
  assert.throws(() => save(st, t, {}), (e) => e.code === 'ARCHIVED');
  assert.throws(() => publish(st, t), (e) => e.code === 'ARCHIVED');
  assert.throws(() => S.archiveTemplate(st, t.id, t.lockVersion, 'A', T0), (e) => e.code === 'ARCHIVED');
  assert.equal(st.templates.length, 1);
});

test('template code is generated once and cannot change', () => {
  const st = fresh();
  const t = create(st);
  const code = t.code;
  assert.match(code, /^TPL-[A-Z2-9]{6}$/);
  save(st, t, { code: 'TPL-AAAAAA' });
  assert.equal(t.code, code);
});

test('generated codes are unique', () => {
  const st = S.createSeedState();
  const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  st.templates.push({ code: 'TPL-AAAAAA' });
  let i = 0;
  assert.notEqual(S.generateCode(st, () => seq[i++]), 'TPL-AAAAAA');
});

test('seed templates carry a lockVersion and valid content in their own format', () => {
  for (const t of S.createSeedState().templates) {
    assert.ok(Number.isInteger(t.lockVersion), t.code);
    for (const rec of [t.draft, ...t.versions].filter(Boolean)) {
      assert.deepEqual(S.validateRecord(t.internalName, rec), [], t.code);
    }
  }
});

test('seed: published versions stay legacy Markdown without a format field; editable drafts are JSON', () => {
  const st = S.createSeedState();
  for (const t of st.templates) {
    for (const v of t.versions) {
      assert.equal(v.format, undefined, `${t.code} v${v.number}`);
      assert.equal(typeof v.content, 'string');
      assert.equal(S.formatOf(v), 'markdown');
    }
  }
  assert.equal(S.getTemplate(st, 'tpl_1').draft.format, 'richtext-json');
  assert.deepEqual(S.getTemplate(st, 'tpl_1').draft.convertedFrom, { format: 'markdown', version: 2 });
  assert.equal(S.getTemplate(st, 'tpl_3').draft.format, 'richtext-json');
  assert.equal(S.formatOf(S.getTemplate(st, 'tpl_5').draft), 'markdown', 'archived legacy draft untouched');
});

for (const field of ['internalName', 'title', 'content']) {
  for (const [label, value] of [['empty', ''], ['whitespace-only', ' \t\n ']]) {
    test(`saving is refused when ${field} is ${label}, for new and existing drafts`, () => {
      const st = fresh();
      assert.throws(() => create(st, { [field]: value }),
        (e) => e.code === 'INVALID' && e.details.errors.some((er) => er.field === field && er.kind === 'required'));
      assert.equal(st.templates.length, 0);
      const t = create(st);
      const before = snapshot(t);
      assert.throws(() => save(st, t, { [field]: value }),
        (e) => e.code === 'INVALID' && e.details.errors.some((er) => er.field === field && er.kind === 'required'));
      assert.equal(snapshot(t), before);
    });
  }
}

test('publishing re-checks the required fields', () => {
  const st = fresh();
  const t = create(st);
  t.draft.title = '   '; // corrupt stored data directly; publish must still refuse it
  assert.throws(() => publish(st, t), (e) => e.code === 'INVALID' && e.details.errors[0].field === 'title');
  assert.equal(t.versions.length, 0);
});

const cell = (type, text) => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const raggedTable = RT.wrap({ type: 'doc', content: [{ type: 'table', content: [
  { type: 'tableRow', content: [cell('tableHeader', 'A'), cell('tableHeader', 'B')] },
  { type: 'tableRow', content: [cell('tableCell', '1'), cell('tableCell', '2'), cell('tableCell', '3')] },
] }] });

test('saving and publishing refuse inconsistent tables', () => {
  const st = fresh();
  assert.throws(() => create(st, { content: raggedTable }),
    (e) => e.code === 'INVALID' && e.details.errors.some((er) => /jumlah sel yang sama/.test(er.message)));
  const t = create(st);
  t.draft.content = raggedTable; // corrupt stored data directly; publish must still refuse it
  assert.throws(() => publish(st, t), (e) => e.code === 'INVALID' && /Blok 1/.test(e.details.errors[0].message));
  assert.equal(t.versions.length, 0);
});

test('new drafts must be rich-text JSON; Markdown strings and unsupported structures are refused', () => {
  const st = fresh();
  assert.throws(() => S.saveDraft(st, { templateId: null, code: S.generateCode(st), internalName: 'N', title: 'J', content: '## Markdown' }, 'A', T0),
    (e) => e.code === 'INVALID' && e.details.errors.some((er) => /richtext-json/.test(er.message)));
  const img = RT.wrap({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'image', attrs: { src: 'x' } }] });
  assert.throws(() => create(st, { content: img }), (e) => e.code === 'INVALID' && /tidak didukung/.test(e.details.errors[0].message));
  assert.equal(st.templates.length, 0);
});

test('saved draft content is a detached frozen copy', () => {
  const st = fresh();
  const input = doc('Asli');
  const t = create(st, { content: input });
  input.document.content[0].content[0].text = 'diubah setelah simpan';
  assert.equal(textOf(t.draft), 'Asli');
  assert.ok(Object.isFrozen(t.draft.content.document));
});

test('a legacy Markdown draft cannot be published until converted', () => {
  const st = S.createSeedState();
  const t = S.getTemplate(st, 'tpl_5');
  t.archived = null; // only to reach the format check on an unarchived copy
  assert.throws(() => publish(st, t), (e) => e.code === 'LEGACY_FORMAT');
  assert.equal(t.versions.length, 1);
});

test('explicit conversion creates a JSON draft from the latest Markdown version and leaves it unchanged', () => {
  const st = S.createSeedState();
  const t = S.getTemplate(st, 'tpl_4'); // published Markdown v1-v3, no draft
  const v3 = t.versions[2];
  const before = JSON.stringify(t.versions);
  const lock = t.lockVersion;
  S.convertLegacyDraft(st, t.id, lock, 'A', T0);
  assert.equal(JSON.stringify(t.versions), before, 'published versions unchanged');
  assert.equal(v3.format, undefined);
  assert.equal(t.lockVersion, lock + 1);
  assert.equal(t.draft.format, 'richtext-json');
  assert.equal(t.draft.revision, 1);
  assert.equal(t.draft.basedOnVersion, 3);
  assert.deepEqual(t.draft.convertedFrom, { format: 'markdown', version: 3 });
  assert.equal(t.draft.title, v3.title);
  assert.deepEqual(RT.placeholderKeys(t.draft.content), ['nama_lengkap']);
  assert.ok(RT.plainText(t.draft.content).includes('Akan diumumkan | Penyesuaian tampilan'));
  // Converting needs the current lockVersion and only applies to Markdown sources.
  assert.throws(() => S.convertLegacyDraft(st, t.id, lock, 'A', T0), (e) => e.code === 'CONFLICT');
  assert.throws(() => S.convertLegacyDraft(st, t.id, t.lockVersion, 'A', T0), (e) => e.code === 'NOT_LEGACY');
  // The converted draft publishes as a JSON version.
  const v4 = publish(st, t);
  assert.equal(v4.format, 'richtext-json');
  assert.equal(v4.number, 4);
});

test('conversion that cannot preserve content saves nothing', () => {
  const st = S.createSeedState();
  const t = S.getTemplate(st, 'tpl_2');
  t.versions = Object.freeze([Object.freeze({ ...t.versions[0], content: '# A\n\n## B\n\n### C\n\nTeks.' })]);
  const before = JSON.stringify(t);
  assert.throws(() => S.convertLegacyDraft(st, t.id, t.lockVersion, 'A', T0),
    (e) => e.code === 'CONVERSION_FAILED' && /tiga tingkat judul/.test(e.details.errors[0]));
  assert.equal(JSON.stringify(t), before, 'no draft, no lockVersion change');
});

test('simulated external edit produces a JSON draft and bumps lockVersion', () => {
  const st = S.createSeedState();
  const t = S.getTemplate(st, 'tpl_2');
  const lock = t.lockVersion;
  S.simulateExternalEdit(st, t.id, 'Lain', T0);
  assert.equal(t.draft.format, 'richtext-json');
  assert.match(RT.plainText(t.draft.content), /admin lain \(simulasi\)\.$/);
  assert.equal(t.lockVersion, lock + 1);
  assert.equal(S.formatOf(t.versions[0]), 'markdown', 'published version untouched');
});
