'use strict';
// Consent clauses (“Klausul persetujuan”, richtext-json format version 3):
// structure, rendering, snapshots, and acceptance answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const RT = require('../js/richtext.js');
const S = require('../js/store.js');
const U = require('../js/user.js');

const T1 = '2026-11-06T02:00:00Z';
const T2 = '2026-11-06T03:00:00Z';
const T3 = '2026-11-06T04:00:00Z';

const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const clause = (clauseId, required, title, ...body) => ({
  type: 'consentClause', attrs: { clauseId, required },
  content: [
    title == null ? { type: 'clauseTitle' } : { type: 'clauseTitle', content: [txt(title)] },
    { type: 'clauseBody', content: body.length ? body : [p(txt('Penjelasan.'))] },
  ],
});
const env = (...blocks) => RT.wrap({ type: 'doc', content: blocks });
const messages = (e) => RT.contentIssues(e).map((i) => i.message);
const A = 'cl_aaaaaaaaaa';
const B = 'cl_bbbbbbbbbb';
const twoClauses = () => env(p(txt('Pembuka')), clause(A, true, 'Pernyataan wajib'), clause(B, false, 'Pernyataan opsional'));

/* ---------- Structure ---------- */

test('a clause needs format version 3; documents without clauses keep their version', () => {
  assert.equal(env(p(txt('a'))).formatVersion, 1);
  assert.equal(twoClauses().formatVersion, 3);
  assert.deepEqual(messages(twoClauses()), []);
  assert.ok(messages({ ...twoClauses(), formatVersion: 2 }).some((m) => /memerlukan format versi 3/.test(m)));
});

test('clauses cannot be nested in clauses, lists, or table cells', () => {
  const nestedInClause = env({ ...clause(A, true, 'Luar'), content: [{ type: 'clauseTitle', content: [txt('Luar')] }, { type: 'clauseBody', content: [clause(B, true, 'Dalam')] }] });
  assert.ok(messages(nestedInClause).some((m) => /klausul persetujuan tidak diizinkan di dalam penjelasan klausul/.test(m)));
  const inList = env({ type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('a')), clause(A, true, 'X')] }] });
  assert.ok(messages(inList).some((m) => /tidak diizinkan di dalam butir daftar/.test(m)));
  const inCell = env({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [clause(A, true, 'X')] }] }] });
  assert.ok(messages(inCell).some((m) => /tidak diizinkan di dalam sel tabel/.test(m)));
});

test('duplicate or invalid clause IDs are refused', () => {
  assert.ok(messages(env(clause(A, true, 'Satu'), clause(A, false, 'Dua'))).some((m) => /dipakai lebih dari sekali/.test(m)));
  for (const id of ['', 'cl_short', 'CL_AAAAAAAAAA', 'x', 42, null]) {
    assert.ok(messages(env(clause(id, true, 'X'))).some((m) => /ID klausul tidak valid|wajib/.test(m)), String(id));
  }
});

test('title is required plain text; required flag is boolean; answer options are not configurable', () => {
  assert.ok(messages(env(clause(A, true, null))).some((m) => /Judul klausul persetujuan wajib diisi/.test(m)));
  assert.ok(messages(env(clause(A, true, '   '))).some((m) => /Judul klausul persetujuan wajib diisi/.test(m)));
  const bold = env({ ...clause(A, true, 'X'), content: [{ type: 'clauseTitle', content: [txt('X', [{ type: 'bold' }])] }, { type: 'clauseBody', content: [p()] }] });
  assert.ok(messages(bold).some((m) => /teks biasa tanpa format/.test(m)));
  assert.ok(messages(env(clause(A, 'ya', 'X'))).some((m) => /Wajib dijawab Ya/.test(m)));
  const noRequired = env({ ...clause(A, true, 'X'), attrs: { clauseId: A } });
  assert.ok(messages(noRequired).some((m) => /“required” wajib/.test(m)));
  for (const extra of [{ options: ['Ya', 'Tidak'] }, { defaultAnswer: 'ya' }]) {
    const c = clause(A, true, 'X');
    assert.ok(messages(env({ ...c, attrs: { ...c.attrs, ...extra } })).some((m) => /tidak didukung pada klausul persetujuan/.test(m)), JSON.stringify(extra));
  }
  assert.ok(messages(env({ ...clause(A, true, 'X'), content: [{ type: 'clauseBody', content: [p()] }, { type: 'clauseTitle', content: [txt('X')] }] }))
    .some((m) => /tepat satu judul diikuti satu penjelasan/.test(m)));
});

test('clause body uses the existing rich-text format, including placeholders', () => {
  const c = clause(A, true, 'X', p(txt('Halo '), { type: 'variable', attrs: { key: 'nama_lengkap' } }), { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('butir'))] }] });
  assert.deepEqual(messages(env(c)), []);
  assert.deepEqual(RT.placeholderKeys(env(c)), ['nama_lengkap']);
  assert.ok(messages(env({ ...c, content: [c.content[0], { type: 'clauseBody', content: [{ type: 'heading', attrs: { level: 2 }, content: [txt('h')] }] }] })).length);
});

/* ---------- Rendering ---------- */

test('rendering: fieldset/legend, explicit labels, fixed Tidak/Ya order, unique group per clause, nothing checked', () => {
  const html = RT.renderDocument(twoClauses(), {});
  assert.equal((html.match(/<fieldset class="clause/g) || []).length, 2);
  assert.match(html, /<legend class="clause-title">Pernyataan wajib<\/legend>/);
  assert.match(html, /<label class="clause-option" for="clause-cl_aaaaaaaaaa-tidak"><input type="radio" id="clause-cl_aaaaaaaaaa-tidak" name="clause-cl_aaaaaaaaaa" value="tidak"> <span>Tidak<\/span><\/label><label class="clause-option" for="clause-cl_aaaaaaaaaa-ya">/);
  assert.match(html, /name="clause-cl_bbbbbbbbbb"/);
  assert.doesNotMatch(html, /checked/);
  assert.equal((html.match(/Wajib dijawab Ya/g) || []).length, 1, 'only the required clause shows the badge');
  assert.doesNotMatch(html, /Simulasi pratinjau/);
  const preview = RT.renderDocument(twoClauses(), {}, { preview: true });
  assert.equal((preview.match(/Simulasi pratinjau/g) || []).length, 2);
  assert.match(preview, /name="pv-clause-cl_aaaaaaaaaa"/);
  assert.doesNotMatch(preview, /id="clause-/, 'preview IDs never collide with user IDs');
});

test('clausesOf lists ID, plain title, and required flag in document order', () => {
  assert.deepEqual(RT.clausesOf(twoClauses()), [
    { id: A, title: 'Pernyataan wajib', required: true },
    { id: B, title: 'Pernyataan opsional', required: false },
  ]);
  assert.deepEqual(RT.clausesOf(env(p(txt('a')))), []);
  assert.deepEqual(RT.CLAUSE_ANSWERS.map((x) => x.label), ['Tidak', 'Ya']);
  assert.ok(Object.isFrozen(RT.CLAUSE_ANSWERS));
});

/* ---------- Snapshots and acceptance ---------- */

function setup(content) {
  const tpl = { nextId: 1, templates: [] };
  const t = S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'Klausul', title: 'Dokumen klausul', content: content || twoClauses() }, 'Admin', T1);
  S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
  const user = U.emptyUserState();
  const a = U.assignVersion(user, tpl, t.id, 1, T1);
  return { tpl, user, t, a };
}

test('snapshot freezes clause IDs, titles, text, order, and required settings', () => {
  const { a } = setup();
  const s = a.snapshot;
  assert.deepEqual(s.clauses, RT.clausesOf(twoClauses()));
  assert.ok(Object.isFrozen(s.clauses) && Object.isFrozen(s.clauses[0]));
  assert.ok(Object.isFrozen(s.content.document.content[1].attrs));
  assert.throws(() => { s.clauses[0].required = false; }, TypeError);
  assert.equal(s.formatVersion, 3);
  assert.match(s.html, /<fieldset class="clause clause-required" data-clause-id="cl_aaaaaaaaaa"/);
});

test('required clause blocks acceptance when unanswered or “Tidak”; nothing is recorded', () => {
  const { user, a } = setup();
  for (const answers of [undefined, {}, { [A]: null }, { [A]: 'tidak' }, { [A]: 'tidak', [B]: 'ya' }]) {
    assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers }),
      (err) => err.code === 'CLAUSE_REQUIRED' && /Pernyataan wajib/.test(err.message), JSON.stringify(answers));
  }
  assert.throws(() => U.acceptAssignment(user, a.id, T2), { code: 'CLAUSE_REQUIRED' });
  assert.equal(user.acceptances.length, 0);
  assert.ok(U.getAssignment(user, a.id), '“Tidak” does not remove access');
  assert.match(U.clauseIssues(a.snapshot, { [A]: 'tidak' })[0].message, /jawaban saat ini: Tidak/);
  assert.match(U.clauseIssues(a.snapshot, {})[0].message, /belum dijawab/);
});

test('optional clause allows Ya, Tidak, or no answer; unanswered is recorded as null', () => {
  for (const [given, expected] of [[undefined, null], ['tidak', 'tidak'], ['ya', 'ya']]) {
    const { user, a } = setup();
    const answers = given === undefined ? { [A]: 'ya' } : { [A]: 'ya', [B]: given };
    const { acceptance, created } = U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers });
    assert.ok(created);
    assert.deepEqual({ ...acceptance.answers }, { [A]: 'ya', [B]: expected });
    assert.ok(Object.prototype.hasOwnProperty.call(acceptance.answers, B));
    assert.ok(Object.isFrozen(acceptance.answers));
    assert.equal(acceptance.userId, U.SIM_USER_ID);
    assert.equal(acceptance.snapshotId, a.snapshot.id);
  }
});

test('answers can change before acceptance; only the confirmed set is recorded', () => {
  const { user, a } = setup();
  const answers = { [A]: 'tidak' };
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 1);
  answers[A] = 'ya';
  answers[B] = 'ya';
  answers[B] = 'tidak';
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 0);
  const { acceptance } = U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers });
  assert.deepEqual({ ...acceptance.answers }, { [A]: 'ya', [B]: 'tidak' });
  answers[B] = 'ya';
  assert.equal(acceptance.answers[B], 'tidak', 'later changes to the input object do not leak in');
});

test('unknown clause IDs, invalid values, and a different snapshot are refused', () => {
  const { user, a } = setup();
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: 'ya', cl_zzzzzzzzzz: 'ya' } }), { code: 'INVALID' });
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: 'YA' } }), { code: 'INVALID' });
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: true } }), { code: 'INVALID' });
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: 'snp_other', answers: { [A]: 'ya' } }), { code: 'STALE' });
  assert.equal(user.acceptances.length, 0);
});

test('repeated confirmation keeps the original acceptance, timestamp, and answers', () => {
  const { user, a } = setup();
  const first = U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: 'ya' } });
  const again = U.acceptAssignment(user, a.id, T3, { snapshotId: a.snapshot.id, answers: { [A]: 'ya', [B]: 'ya' } });
  const invalid = U.acceptAssignment(user, a.id, T3, { snapshotId: a.snapshot.id, answers: { [A]: 'tidak' } });
  assert.ok(first.created && !again.created && !invalid.created);
  assert.equal(again.acceptance, first.acceptance);
  assert.equal(again.acceptance.acceptedAt, T2);
  assert.deepEqual({ ...again.acceptance.answers }, { [A]: 'ya', [B]: null });
  assert.equal(user.acceptances.length, 1);
});

test('later template edits and publications do not alter existing snapshots or responses', () => {
  const { tpl, user, t, a } = setup();
  U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: 'ya', [B]: 'tidak' } });
  const before = JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances });
  const edited = env(clause(B, true, 'Judul baru'), clause(A, false, 'Pernyataan wajib (diubah)'), clause('cl_cccccccccc', true, 'Klausul baru'));
  const cur = S.getTemplate(tpl, t.id);
  S.saveDraft(tpl, { templateId: t.id, internalName: 'Klausul', title: 'Dokumen klausul', content: edited, lockVersion: cur.lockVersion }, 'Admin', T3);
  S.publishDraft(tpl, t.id, S.getTemplate(tpl, t.id).lockVersion, 'Admin', T3);
  assert.equal(JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances }), before);
  assert.deepEqual(a.snapshot.clauses.map((c) => [c.id, c.title, c.required]), [[A, 'Pernyataan wajib', true], [B, 'Pernyataan opsional', false]]);
  // A new assignment of version 2 is separate and starts with no answers.
  const a2 = U.assignVersion(user, tpl, t.id, 2, T3);
  assert.equal(a2.snapshot.clauses.length, 3);
  assert.equal(U.acceptanceFor(user, a2), null);
});

test('documents without clauses and historical acceptances are unchanged', () => {
  const plain = setup(env(p(txt('Tanpa klausul'))));
  assert.deepEqual(plain.a.snapshot.clauses, []);
  const { acceptance } = U.acceptAssignment(plain.user, plain.a.id, T2);
  assert.equal('answers' in acceptance, false, 'no answers invented for documents without clauses');

  const tpl = S.createSeedState();
  const user = U.createSeedUserState(tpl);
  const legacy = user.acceptances[0];
  assert.equal('answers' in legacy, false, 'seed acceptance has no answers');
  assert.ok(user.assignments.every((x) => !('clauses' in x.snapshot)), 'legacy Markdown snapshots keep their shape');
});

test('seed sample includes the fictional required clause after the company profile', () => {
  const t = S.getTemplate(S.createSeedState(), 'tpl_6');
  assert.deepEqual(S.validateRecord(t.internalName, t.draft), []);
  const clauses = RT.clausesOf(t.draft.content);
  assert.deepEqual(clauses.map((c) => [c.title, c.required]), [
    ['Pernyataan telah membaca profil perusahaan', true],
    ['Kesediaan menerima informasi lanjutan', false],
  ]);
  const types = t.draft.content.document.content.map((b) => b.type);
  assert.ok(types.lastIndexOf('table') < types.indexOf('consentClause'), 'clauses follow the profile tables');
});
