'use strict';
// Consent clauses (“Klausul persetujuan”): administrator-defined options
// (richtext-json format version 4), historical fixed “Tidak / Ya” clauses
// (format version 3), rendering, snapshots, acceptance answers, conversion.
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
const opt = (id, label, qualifies) => ({ id, label, qualifies });
const content = (title, body) => [
  title == null ? { type: 'clauseTitle' } : { type: 'clauseTitle', content: [txt(title)] },
  { type: 'clauseBody', content: body && body.length ? body : [p(txt('Penjelasan.'))] },
];
/** Format-4 clause with options. */
const clause = (clauseId, required, options, title, ...body) => ({
  type: 'consentClause', attrs: { clauseId, required, options }, content: content(title, body),
});
/** Historical format-3 clause (fixed “Tidak / Ya”). */
const fixed = (clauseId, required, title) => ({ type: 'consentClause', attrs: { clauseId, required }, content: content(title) });
const env = (...blocks) => RT.wrap({ type: 'doc', content: blocks });
const messages = (e) => RT.contentIssues(e).map((i) => i.message);

const A = 'cl_aaaaaaaaaa';
const B = 'cl_bbbbbbbbbb';
const C = 'cl_cccccccccc';
const SUDAH = 'op_sudahbaca1';
const BELUM = 'op_belumbaca1';
const X1 = 'op_xxxxxxxxx1';
const X2 = 'op_xxxxxxxxx2';
const X3 = 'op_xxxxxxxxx3';
const O1 = 'op_ooooooooo1';
const O2 = 'op_ooooooooo2';
const readOpts = () => [opt(SUDAH, 'Sudah membaca', true), opt(BELUM, 'Belum membaca', false)];
const threeOpts = () => [opt(X1, 'Setuju penuh', true), opt(X2, 'Setuju dengan catatan', true), opt(X3, 'Tidak setuju', false)];
const optionalOpts = () => [opt(O1, 'Bersedia', false), opt(O2, 'Tidak bersedia', false)];
const sample = () => env(
  p(txt('Pembuka')),
  clause(A, true, readOpts(), 'Pernyataan membaca'),
  clause(B, true, threeOpts(), 'Tiga pilihan'),
  clause(C, false, optionalOpts(), 'Pernyataan opsional'),
);
const withOptions = (options, required = true) => env(clause(A, required, options, 'Klausul uji'));

/* ---------- Structure (format 4) ---------- */

test('configurable options need format version 4; fixed clauses stay version 3', () => {
  assert.equal(sample().formatVersion, 4);
  assert.deepEqual(messages(sample()), []);
  assert.equal(env(fixed(A, true, 'Lama')).formatVersion, 3);
  assert.deepEqual(messages(env(fixed(A, true, 'Lama'))), [], 'historical fixed clauses remain valid');
  assert.ok(messages({ ...sample(), formatVersion: 3 }).some((m) => /memerlukan format versi 4/.test(m)));
  // In a version-4 document every clause needs options.
  assert.ok(messages({ format: RT.FORMAT, formatVersion: 4, document: { type: 'doc', content: [fixed(A, true, 'X')] } })
    .some((m) => /wajib memiliki 2–5 pilihan jawaban/.test(m)));
  assert.equal(RT.fixedClauseCount(env(fixed(A, true, 'X'), fixed(B, false, 'Y'))), 2);
  assert.equal(RT.fixedClauseCount(sample()), 0);
});

test('between 2 and 5 options', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => opt(`op_nnnnnnnnn${i}`, `Pilihan ${i}`, i === 0));
  assert.ok(messages(withOptions(many(1))).some((m) => /harus 2–5 \(saat ini 1\)/.test(m)));
  assert.ok(messages(withOptions(many(6))).some((m) => /harus 2–5 \(saat ini 6\)/.test(m)));
  assert.ok(messages(withOptions([])).some((m) => /harus 2–5 \(saat ini 0\)/.test(m)));
  for (const n of [2, 3, 4, 5]) assert.deepEqual(messages(withOptions(many(n))), [], String(n));
});

test('labels: required, plain text, no placeholders, unique after trimming and case-insensitively', () => {
  const two = (l1, l2) => withOptions([opt(X1, l1, true), opt(X2, l2, false)]);
  assert.ok(messages(two('', 'B')).some((m) => /Klausul “Klausul uji”, pilihan 1: Label pilihan wajib diisi/.test(m)));
  assert.ok(messages(two('   ', 'B')).some((m) => /Label pilihan wajib diisi/.test(m)));
  assert.ok(messages(two('Ya', '  ya ')).some((m) => /pilihan 2: Label “ya” sama dengan pilihan 1/.test(m)));
  assert.ok(messages(two('Sudah Membaca', 'sudah membaca')).some((m) => /sama dengan pilihan 1/.test(m)));
  assert.ok(messages(two('<b>Ya</b>', 'B')).some((m) => /tanpa HTML/.test(m)));
  assert.ok(messages(two('Ya <script>', 'B')).some((m) => /tanpa HTML/.test(m)));
  assert.ok(messages(two('Ya {{nama_lengkap}}', 'B')).some((m) => /placeholder/.test(m)));
  assert.ok(messages(two('Ya\nTidak', 'B')).some((m) => /karakter kontrol/.test(m)));
  assert.ok(messages(two('x'.repeat(81), 'B')).some((m) => /maksimal 80/.test(m)));
  assert.deepEqual(messages(two('x'.repeat(80), 'Belum & “lain”')), []);
  assert.ok(messages(withOptions([opt(X1, 42, true), opt(X2, 'B', false)])).some((m) => /wajib berupa teks/.test(m)));
});

test('IDs: system format, unique across the document; references must be valid', () => {
  assert.ok(messages(withOptions([opt('Ya', 'Ya', true), opt(X2, 'B', false)])).some((m) => /ID pilihan tidak valid/.test(m)));
  assert.ok(messages(withOptions([opt(X1, 'A', true), opt(X1, 'B', false)])).some((m) => /ID pilihan “op_xxxxxxxxx1” dipakai lebih dari sekali/.test(m)));
  const shared = env(clause(A, true, readOpts(), 'Satu'), clause(B, true, readOpts(), 'Dua'));
  assert.ok(messages(shared).some((m) => /Klausul “Dua”: ID pilihan “op_sudahbaca1” dipakai lebih dari sekali/.test(m)));
  assert.ok(messages(env(clause(A, true, readOpts(), 'Satu'), clause(A, false, optionalOpts(), 'Dua'))).some((m) => /ID klausul “cl_aaaaaaaaaa” dipakai lebih dari sekali/.test(m)));
  for (const id of ['', 'cl_short', 'CL_AAAAAAAAAA', 42, null]) {
    assert.ok(messages(env(clause(id, true, readOpts(), 'X'))).some((m) => /ID klausul tidak valid|wajib/.test(m)), String(id));
  }
  assert.ok(messages(withOptions([{ ...opt(X1, 'A', true), value: 'ya' }, opt(X2, 'B', false)])).some((m) => /Properti tidak dikenal: value/.test(m)));
  assert.ok(messages(withOptions([opt(X1, 'A', 'ya'), opt(X2, 'B', false)])).some((m) => /“Memenuhi persyaratan” harus bernilai benar atau salah/.test(m)));
  assert.ok(messages(withOptions('Ya,Tidak')).some((m) => /Pilihan jawaban klausul harus berupa daftar/.test(m)));
  assert.ok(messages(withOptions([null, opt(X2, 'B', true)])).some((m) => /Pilihan tidak valid/.test(m)));
});

test('required clauses need a qualifying option; optional ones do not; multiple may qualify', () => {
  const none = [opt(X1, 'A', false), opt(X2, 'B', false)];
  assert.ok(messages(withOptions(none, true)).some((m) => /minimal satu pilihan yang “Memenuhi persyaratan”/.test(m)));
  assert.deepEqual(messages(withOptions(none, false)), [], 'optional clause without qualifying options is fine');
  assert.deepEqual(messages(withOptions(threeOpts())), [], 'two qualifying options allowed');
});

test('malformed content is refused', () => {
  assert.ok(messages(null).length);
  assert.ok(messages('{"format": "richtext-json"').length, 'unparsed JSON text');
  assert.ok(messages({ format: RT.FORMAT, formatVersion: 4, document: { type: 'doc', content: 'x' } }).length);
  const c = clause(A, true, readOpts(), 'X');
  assert.ok(messages(env({ ...c, attrs: { ...c.attrs, defaultAnswer: SUDAH } })).some((m) => /tidak didukung pada klausul persetujuan/.test(m)));
  assert.ok(messages(env({ ...c, attrs: { clauseId: A, options: readOpts() } })).some((m) => /“required” wajib/.test(m)));
  assert.ok(messages(env(clause(A, 'ya', readOpts(), 'X'))).some((m) => /“Wajib dijawab” harus bernilai/.test(m)));
});

test('title and body rules and nesting are unchanged', () => {
  assert.ok(messages(env(clause(A, true, readOpts(), null))).some((m) => /Judul klausul persetujuan wajib diisi/.test(m)));
  const bold = env({ ...clause(A, true, readOpts(), 'X'), content: [{ type: 'clauseTitle', content: [txt('X', [{ type: 'bold' }])] }, { type: 'clauseBody', content: [p()] }] });
  assert.ok(messages(bold).some((m) => /teks biasa tanpa format/.test(m)));
  const inList = env({ type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('a')), clause(A, true, readOpts(), 'X')] }] });
  assert.ok(messages(inList).some((m) => /tidak diizinkan di dalam butir daftar/.test(m)));
  const c = clause(A, true, readOpts(), 'X', p(txt('Halo '), { type: 'variable', attrs: { key: 'nama_lengkap' } }));
  assert.deepEqual(messages(env(c)), []);
});

/* ---------- Rendering ---------- */

test('rendering: one radio group per clause, stored order, option IDs as values, nothing checked', () => {
  const html = RT.renderDocument(sample(), {});
  assert.equal((html.match(/<fieldset class="clause/g) || []).length, 3);
  assert.match(html, /<label class="clause-option" for="clause-cl_aaaaaaaaaa-op_sudahbaca1"><input type="radio" id="clause-cl_aaaaaaaaaa-op_sudahbaca1" name="clause-cl_aaaaaaaaaa" value="op_sudahbaca1"> <span>Sudah membaca<\/span><\/label><label class="clause-option" for="clause-cl_aaaaaaaaaa-op_belumbaca1">/);
  assert.match(html, /<span>Setuju penuh<\/span>.*<span>Setuju dengan catatan<\/span>.*<span>Tidak setuju<\/span>/);
  assert.doesNotMatch(html, /checked/);
  assert.doesNotMatch(html, /value="(ya|tidak)"/, 'labels are never used as values');
  assert.match(html, /<strong>Wajib dijawab\.<\/strong> Perjanjian hanya dapat disetujui dengan pilihan “Sudah membaca”\./);
  assert.match(html, /pilihan “Setuju penuh” atau “Setuju dengan catatan”\./);
  assert.match(html, /id="clause-cl_cccccccccc-req">Opsional — boleh tidak dijawab/);
  assert.doesNotMatch(html, /Wajib dijawab Ya/);
  const evil = RT.renderDocument(withOptions([opt(X1, 'A & “B”', true), opt(X2, "C'D", false)]), {});
  assert.match(evil, /<span>A &amp; “B”<\/span>/);
  assert.match(evil, /<span>C&#39;D<\/span>/);
  const preview = RT.renderDocument(sample(), {}, { preview: true });
  assert.equal((preview.match(/Simulasi pratinjau/g) || []).length, 3);
  assert.doesNotMatch(preview, /id="clause-/, 'preview IDs never collide with user IDs');
});

test('a label such as “Ya” has no meaning unless configured', () => {
  const swapped = withOptions([opt(X1, 'Ya', false), opt(X2, 'Tidak', true)]);
  assert.deepEqual(messages(swapped), []);
  assert.match(RT.renderDocument(swapped, {}), /dengan pilihan “Tidak”\./);
  const { user, a } = setup(swapped);
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: X1 } }), { code: 'CLAUSE_REQUIRED' });
  assert.ok(U.acceptAssignment(user, a.id, T2, { snapshotId: a.snapshot.id, answers: { [A]: X2 } }).created);
});

test('historical fixed clauses render exactly as before', () => {
  const html = RT.renderDocument(env(fixed(A, true, 'Lama'), fixed(B, false, 'Opsional lama')), {});
  assert.match(html, /<label class="clause-option" for="clause-cl_aaaaaaaaaa-tidak"><input type="radio" id="clause-cl_aaaaaaaaaa-tidak" name="clause-cl_aaaaaaaaaa" value="tidak"> <span>Tidak<\/span><\/label><label class="clause-option" for="clause-cl_aaaaaaaaaa-ya">/);
  assert.equal((html.match(/Wajib dijawab Ya/g) || []).length, 1);
  assert.match(html, /aria-describedby="clause-cl_bbbbbbbbbb-desc"/, 'optional fixed clause has no requirement note');
});

test('clausesOf freezes options in order with trimmed labels; fixed clauses keep their shape', () => {
  const doc = env(clause(A, true, [opt(X1, '  Setuju ', true), opt(X2, 'Tidak setuju', false)], 'Klausul'), fixed(B, false, 'Lama'));
  // (mixed documents are invalid; clausesOf only describes shape)
  assert.deepEqual(RT.clausesOf(doc), [
    { id: A, title: 'Klausul', required: true, options: [{ id: X1, label: 'Setuju', qualifies: true }, { id: X2, label: 'Tidak setuju', qualifies: false }] },
    { id: B, title: 'Lama', required: false },
  ]);
  assert.deepEqual(RT.clauseOptions({ id: B }).map((o) => [o.id, o.label, o.qualifies]), [['tidak', 'Tidak', false], ['ya', 'Ya', true]]);
});

/* ---------- Snapshots and acceptance ---------- */

function setup(c) {
  const tpl = { nextId: 1, templates: [] };
  const t = S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'Klausul', title: 'Dokumen klausul', content: c || sample() }, 'Admin', T1);
  S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
  const user = U.emptyUserState();
  const a = U.assignVersion(user, tpl, t.id, 1, T1);
  return { tpl, user, t, a };
}

/** A template whose Versi 1 was published with fixed clauses (before options were configurable). */
function historical() {
  const v3 = RT.freezeCopy(env(p(txt('Lama')), fixed(A, true, 'Persetujuan lama'), fixed(B, false, 'Survei lama')));
  const tpl = {
    nextId: 2,
    templates: [{
      id: 'tpl_1', code: 'TPL-AAAAAA', internalName: 'Lama', createdAt: T1, createdBy: 'Admin', updatedAt: T1,
      archived: null, lockVersion: 1, draft: null,
      versions: Object.freeze([Object.freeze({ number: 1, title: 'Dokumen lama', format: RT.FORMAT, content: v3, renderVersion: 3, publishedAt: T1, publishedBy: 'Admin', fromRevision: 1 })]),
    }],
  };
  const user = U.emptyUserState();
  const a = U.assignVersion(user, tpl, 'tpl_1', 1, T1);
  return { tpl, user, a, v3 };
}

const review = (a, answers) => ({ snapshotId: a.snapshot.id, answers });

test('snapshot freezes option IDs, labels, order, and qualification settings', () => {
  const { a } = setup();
  const s = a.snapshot;
  assert.deepEqual(s.clauses, RT.clausesOf(sample()));
  assert.deepEqual(s.clauses[1].options.map((o) => [o.id, o.label, o.qualifies]), [[X1, 'Setuju penuh', true], [X2, 'Setuju dengan catatan', true], [X3, 'Tidak setuju', false]]);
  assert.ok(Object.isFrozen(s.clauses[0].options) && Object.isFrozen(s.clauses[0].options[0]));
  assert.throws(() => { s.clauses[0].options[1].qualifies = true; }, TypeError);
  assert.throws(() => { s.clauses[0].options.reverse(); }, TypeError);
  assert.equal(s.formatVersion, 4);
});

test('required clauses block when unanswered or non-qualifying, with clause-specific messages', () => {
  const { user, a } = setup();
  const bad = [undefined, {}, { [A]: SUDAH }, { [A]: BELUM, [B]: X1 }, { [A]: SUDAH, [B]: X3 }, { [A]: SUDAH, [B]: null }];
  for (const answers of bad) {
    assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, answers)), { code: 'CLAUSE_REQUIRED' }, JSON.stringify(answers));
  }
  assert.equal(user.acceptances.length, 0);
  const [unanswered, wrong] = U.clauseIssues(a.snapshot, { [B]: X3 });
  assert.equal(unanswered.message, 'Klausul “Pernyataan membaca” wajib dijawab (belum dijawab). Pilih “Sudah membaca”.');
  assert.equal(wrong.message, 'Klausul “Tiga pilihan”: jawaban saat ini “Tidak setuju” tidak memenuhi persyaratan. Pilih “Setuju penuh” atau “Setuju dengan catatan”.');
  assert.equal(wrong.answer, X3);
  assert.ok(U.getAssignment(user, a.id), 'a non-qualifying answer does not remove access');
});

test('either qualifying option of the three-option clause allows acceptance', () => {
  for (const choice of [X1, X2]) {
    const { user, a } = setup();
    const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [A]: SUDAH, [B]: choice }));
    assert.equal(acceptance.answers[B], choice);
  }
});

test('optional clauses: any option or none, recorded without blocking; unanswered is null', () => {
  for (const [given, expected] of [[undefined, null], [O1, O1], [O2, O2]]) {
    const { user, a } = setup();
    const answers = { [A]: SUDAH, [B]: X2, ...(given ? { [C]: given } : {}) };
    const { acceptance, created } = U.acceptAssignment(user, a.id, T2, review(a, answers));
    assert.ok(created);
    assert.deepEqual({ ...acceptance.answers }, { [A]: SUDAH, [B]: X2, [C]: expected });
    assert.ok(Object.isFrozen(acceptance.answers));
    assert.equal(acceptance.userId, U.SIM_USER_ID);
    assert.equal(acceptance.snapshotId, a.snapshot.id);
  }
});

test('answers are option IDs of that clause: labels, other clauses’ options, and unknown clauses are refused', () => {
  const { user, a } = setup();
  const refuse = (answers, code) => assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, answers)), { code }, JSON.stringify(answers));
  refuse({ [A]: 'Sudah membaca', [B]: X1 }, 'INVALID');
  refuse({ [A]: 'ya', [B]: X1 }, 'INVALID');
  refuse({ [A]: X1, [B]: X1 }, 'INVALID');
  refuse({ [A]: SUDAH, [B]: X1, cl_zzzzzzzzzz: O1 }, 'INVALID');
  refuse({ [A]: true, [B]: X1 }, 'INVALID');
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: 'snp_other', answers: { [A]: SUDAH, [B]: X1 } }), { code: 'STALE' });
  assert.equal(user.acceptances.length, 0);
});

test('answers can change before acceptance; only the confirmed set is recorded', () => {
  const { user, a } = setup();
  const answers = { [A]: BELUM, [B]: X3 };
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 2);
  answers[A] = SUDAH;
  answers[B] = X2;
  answers[C] = O1;
  answers[C] = O2;
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 0);
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, answers));
  answers[C] = O1;
  assert.equal(acceptance.answers[C], O2, 'later changes to the input object do not leak in');
});

test('repeated confirmation keeps the original acceptance, timestamp, and answers', () => {
  const { user, a } = setup();
  const first = U.acceptAssignment(user, a.id, T2, review(a, { [A]: SUDAH, [B]: X1 }));
  const again = U.acceptAssignment(user, a.id, T3, review(a, { [A]: SUDAH, [B]: X2, [C]: O1 }));
  const invalid = U.acceptAssignment(user, a.id, T3, review(a, { [A]: BELUM }));
  assert.ok(first.created && !again.created && !invalid.created);
  assert.equal(again.acceptance, first.acceptance);
  assert.equal(again.acceptance.acceptedAt, T2);
  assert.deepEqual({ ...again.acceptance.answers }, { [A]: SUDAH, [B]: X1, [C]: null });
  assert.equal(user.acceptances.length, 1);
});

test('later renames, reorders, and qualification changes never alter snapshots, answers, or their labels', () => {
  const { tpl, user, t, a } = setup();
  U.acceptAssignment(user, a.id, T2, review(a, { [A]: SUDAH, [B]: X2, [C]: O2 }));
  const before = JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances });
  const edited = env(
    clause(A, true, [opt(BELUM, 'Saya belum membaca', true), opt(SUDAH, 'Saya sudah membaca', false)], 'Pernyataan membaca (diubah)'),
    clause(B, false, [opt(X3, 'Tidak setuju', false), opt(X1, 'Setuju', false)], 'Tiga pilihan'),
  );
  S.saveDraft(tpl, { templateId: t.id, internalName: 'Klausul', title: 'Dokumen klausul', content: edited, lockVersion: S.getTemplate(tpl, t.id).lockVersion }, 'Admin', T3);
  S.publishDraft(tpl, t.id, S.getTemplate(tpl, t.id).lockVersion, 'Admin', T3);
  assert.equal(JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances }), before);
  const s = a.snapshot;
  const acc = U.acceptanceFor(user, a);
  assert.deepEqual(s.clauses.map((c) => U.answerLabel(c, acc.answers[c.id])), ['Sudah membaca', 'Setuju dengan catatan', 'Tidak bersedia']);
  assert.equal(U.answerLabel(s.clauses[2], null), 'Tidak dijawab');
  assert.equal(U.acceptanceFor(user, U.assignVersion(user, tpl, t.id, 2, T3)), null, 'a new version is a separate, unanswered assignment');
});

test('documents without clauses and seed acceptances are unchanged', () => {
  const plain = setup(env(p(txt('Tanpa klausul'))));
  assert.deepEqual(plain.a.snapshot.clauses, []);
  assert.equal('answers' in U.acceptAssignment(plain.user, plain.a.id, T2).acceptance, false);
  const user = U.createSeedUserState(S.createSeedState());
  assert.equal('answers' in user.acceptances[0], false);
  assert.ok(user.assignments.every((x) => !('clauses' in x.snapshot)));
});

/* ---------- Historical fixed “Tidak / Ya” clauses ---------- */

test('historical fixed clauses keep their original behaviour: only “Ya” satisfies a required clause', () => {
  const { user, a } = historical();
  assert.deepEqual(a.snapshot.clauses, [{ id: A, title: 'Persetujuan lama', required: true }, { id: B, title: 'Survei lama', required: false }]);
  assert.match(a.snapshot.html, /Wajib dijawab Ya/);
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'tidak' })), (err) => err.code === 'CLAUSE_REQUIRED' && /jawaban saat ini “Tidak”/.test(err.message) && /Pilih “Ya”/.test(err.message));
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, { [A]: SUDAH })), { code: 'INVALID' });
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'ya', [B]: 'tidak' }));
  assert.deepEqual({ ...acceptance.answers }, { [A]: 'ya', [B]: 'tidak' });
  assert.deepEqual(a.snapshot.clauses.map((c) => U.answerLabel(c, acceptance.answers[c.id])), ['Ya', 'Tidak']);
});

test('new content cannot be saved or published with fixed clauses', () => {
  const tpl = { nextId: 1, templates: [] };
  assert.throws(() => S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'X', title: 'X', content: env(fixed(A, true, 'Lama')) }, 'Admin', T1),
    (err) => err.code === 'INVALID' && /pilihan tetap “Tidak \/ Ya”/.test(err.details.errors[0].message));
  const { tpl: h } = historical();
  const t = S.getTemplate(h, 'tpl_1');
  t.draft = { title: 'Lama', format: RT.FORMAT, content: RT.freezeCopy(env(fixed(A, true, 'Lama'))), revision: 1, basedOnVersion: 1, createdAt: T1, updatedAt: T1, updatedBy: 'Admin' };
  assert.throws(() => S.publishDraft(h, t.id, t.lockVersion, 'Admin', T2), { code: 'LEGACY_FORMAT' });
  assert.equal(t.versions.length, 1);
});

test('explicit conversion creates a new editable draft; history, snapshots, and acceptances stay', () => {
  const { tpl, user, a, v3 } = historical();
  U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'ya' }));
  const before = JSON.stringify({ tpl: tpl.templates[0].versions, assignments: user.assignments, acceptances: user.acceptances });
  assert.equal(S.legacyKind(tpl.templates[0].versions[0]), 'fixed-clauses');
  const t = S.convertLegacyDraft(tpl, 'tpl_1', 1, 'Admin', T3);
  assert.equal(JSON.stringify({ tpl: t.versions, assignments: user.assignments, acceptances: user.acceptances }), before);
  assert.equal(t.versions.length, 1, 'nothing republished');
  assert.equal(user.assignments.length, 1, 'nothing reassigned');
  assert.equal(U.acceptanceFor(user, a).acceptedAt, T2, 'no reacceptance required');
  assert.equal(v3.formatVersion, 3);
  const d = t.draft;
  assert.equal(d.content.formatVersion, 4);
  assert.deepEqual(d.convertedFrom, { format: RT.FORMAT, formatVersion: 3, clauses: 'fixed', version: 1 });
  assert.deepEqual(S.validateRecord(t.internalName, d), []);
  const clauses = RT.clausesOf(d.content);
  assert.deepEqual(clauses.map((c) => [c.id, c.required, c.options.map((o) => [o.label, o.qualifies])]), [
    [A, true, [['Tidak', false], ['Ya', true]]],
    [B, false, [['Tidak', false], ['Ya', true]]],
  ]);
  const ids = clauses.flatMap((c) => c.options.map((o) => o.id));
  assert.ok(ids.every((id) => RT.OPTION_ID_RE.test(id)) && new Set(ids).size === 4, 'new, unique option IDs');
  assert.throws(() => S.convertLegacyDraft(tpl, 'tpl_1', t.lockVersion, 'Admin', T3), { code: 'NOT_LEGACY' });
  // The converted draft can be edited, saved, and published normally.
  S.saveDraft(tpl, { templateId: t.id, internalName: t.internalName, title: d.title, content: d.content, lockVersion: t.lockVersion }, 'Admin', T3);
  assert.equal(S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T3).number, 2);
  assert.equal(JSON.stringify(user.acceptances), JSON.stringify(JSON.parse(before).acceptances));
});

/* ---------- Seed ---------- */

test('seed sample has custom-label clauses, including a three-option clause with two qualifying options', () => {
  const t = S.getTemplate(S.createSeedState(), 'tpl_6');
  assert.deepEqual(S.validateRecord(t.internalName, t.draft), []);
  const clauses = RT.clausesOf(t.draft.content);
  assert.deepEqual(clauses.map((c) => [c.title, c.required, c.options.map((o) => `${o.label}${o.qualifies ? '*' : ''}`)]), [
    ['Pernyataan telah membaca profil perusahaan', true, ['Sudah membaca*', 'Belum membaca']],
    ['Pemahaman ketentuan layanan', true, ['Memahami dan menerima*', 'Memahami, akan berkonsultasi dahulu*', 'Belum memahami']],
    ['Kesediaan menerima informasi lanjutan', false, ['Bersedia', 'Tidak bersedia']],
  ]);
  const types = t.draft.content.document.content.map((b) => b.type);
  assert.ok(types.lastIndexOf('table') < types.indexOf('consentClause'), 'clauses follow the profile tables');
});
