'use strict';
// Consent clauses (“Klausul persetujuan”): format version 5 (0–2 options and
// one `qualifyingOptionId`), historical format-4 clauses (2–5 options,
// `required`, per-option `qualifies`) and format-3 fixed “Tidak / Ya”
// clauses, rendering, snapshots, acceptance answers, legacy editing.
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
const opt = (id, label) => ({ id, label });
const content = (title, body) => [
  title == null ? { type: 'clauseTitle' } : { type: 'clauseTitle', content: [txt(title)] },
  { type: 'clauseBody', content: body && body.length ? body : [p(txt('Penjelasan.'))] },
];
/** Format-5 clause. */
const clause = (clauseId, options, qualifyingOptionId, title, ...body) => ({
  type: 'consentClause', attrs: { clauseId, options, qualifyingOptionId }, content: content(title, body),
});
/** Historical format-4 clause. */
const clause4 = (clauseId, required, options, title) => ({
  type: 'consentClause', attrs: { clauseId, required, options: options.map(([id, label, qualifies]) => ({ id, label, qualifies })) }, content: content(title),
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

/** Info (0 options), single option, and two options where the second qualifies. */
const sample = () => env(
  p(txt('Pembuka')),
  clause(A, [], null, 'Informasi'),
  clause(B, [opt(SUDAH, 'Sudah membaca')], SUDAH, 'Pernyataan membaca'),
  clause(C, [opt(X1, 'Belum memahami'), opt(X2, 'Memahami')], X2, 'Pemahaman'),
);
const withOptions = (options, q) => env(clause(A, options, q, 'Klausul uji'));

/* ---------- Structure (format 5) ---------- */

test('format 5 for the current clause rules; historical clauses keep versions 3 and 4', () => {
  assert.equal(sample().formatVersion, 5);
  assert.deepEqual(messages(sample()), []);
  assert.equal(env(clause4(A, true, [[X1, 'A', true], [X2, 'B', false]], 'Lama')).formatVersion, 4);
  assert.deepEqual(messages(env(clause4(A, true, [[X1, 'A', true], [X2, 'B', false]], 'Lama'))), [], 'historical format-4 clauses remain valid');
  assert.equal(env(fixed(A, true, 'Lama')).formatVersion, 3);
  assert.deepEqual(messages(env(fixed(A, true, 'Lama'))), []);
  assert.ok(messages({ ...sample(), formatVersion: 4 }).some((m) => /memerlukan format versi 5/.test(m)));
  const mixed = env(clause(A, [], null, 'Baru'), clause4(B, false, [[X1, 'A', false], [X2, 'B', false]], 'Lama'));
  assert.equal(mixed.formatVersion, 5);
  assert.ok(messages(mixed).some((m) => /Klausul “Lama” memakai aturan klausul lama \(format 4\)/.test(m)));
  assert.equal(RT.legacyClauseCount(mixed), 1);
  assert.equal(RT.legacyClauseCount(sample()), 0);
  assert.equal(RT.legacyClauseCount(env(fixed(A, true, 'X'))), 1);
});

test('zero to two options; more than two is reported, never truncated', () => {
  assert.deepEqual(messages(withOptions([], null)), [], 'information-only clause');
  assert.deepEqual(messages(withOptions([opt(X1, 'Saya setuju')], X1)), [], 'single option');
  assert.deepEqual(messages(withOptions([opt(X1, 'A'), opt(X2, 'B')], X1)), [], 'two options');
  const three = withOptions([opt(X1, 'A'), opt(X2, 'B'), opt(X3, 'C')], X1);
  const before = JSON.stringify(three);
  assert.ok(messages(three).some((m) => /Maksimal 2 pilihan jawaban \(saat ini 3\)/.test(m) && /tidak ada pilihan yang dihapus otomatis/.test(m)));
  assert.equal(JSON.stringify(three), before, 'validation never removes content');
});

test('qualifyingOptionId: null without options, the only option, or exactly one of two', () => {
  const ok = (options, q) => assert.deepEqual(messages(withOptions(options, q)), [], JSON.stringify([options, q]));
  const bad = (options, q, re) => assert.ok(messages(withOptions(options, q)).some((m) => re.test(m)), JSON.stringify([options, q]));
  const two = [opt(X1, 'A'), opt(X2, 'B')];
  ok([], null);
  bad([], X1, /tanpa pilihan \(informasi saja\) tidak boleh memiliki pilihan yang memenuhi syarat/);
  ok([opt(X1, 'A')], X1);
  bad([opt(X1, 'A')], null, /Satu-satunya pilihan harus menjadi pilihan yang memenuhi syarat/);
  bad([opt(X1, 'A')], X2, /Satu-satunya pilihan/);
  ok(two, X1);
  ok(two, X2);
  bad(two, null, /Tentukan satu “Pilihan yang memenuhi syarat”/);
  bad(two, X3, /harus merujuk ke salah satu pilihan klausul ini/);
  bad(two, SUDAH, /harus merujuk/);
  bad(two, 42, /tidak valid/);
  // Qualification is one reference, never per-option flags.
  bad([{ ...opt(X1, 'A'), qualifies: true }, opt(X2, 'B')], X1, /Properti tidak dikenal: qualifies/);
  const c = clause(A, two, X1, 'X');
  assert.ok(messages(env({ ...c, attrs: { ...c.attrs, required: true } })).some((m) => /“Wajib dijawab” tidak dipakai lagi/.test(m)), 'no optional/required flag');
});

test('labels: required, plain text, no placeholders, unique after trimming and case-insensitively', () => {
  const two = (l1, l2) => withOptions([opt(X1, l1), opt(X2, l2)], X1);
  assert.ok(messages(two('', 'B')).some((m) => /Klausul “Klausul uji”, pilihan 1: Label pilihan wajib diisi/.test(m)));
  assert.ok(messages(two('   ', 'B')).some((m) => /Label pilihan wajib diisi/.test(m)));
  assert.ok(messages(two('Ya', '  ya ')).some((m) => /pilihan 2: Label “ya” sama dengan pilihan 1/.test(m)));
  assert.ok(messages(two('Sudah Membaca', 'sudah membaca')).some((m) => /sama dengan pilihan 1/.test(m)));
  assert.ok(messages(two('<b>Ya</b>', 'B')).some((m) => /tanpa HTML/.test(m)));
  assert.ok(messages(two('Ya {{nama_lengkap}}', 'B')).some((m) => /placeholder/.test(m)));
  assert.ok(messages(two('Ya\nTidak', 'B')).some((m) => /karakter kontrol/.test(m)));
  assert.ok(messages(two('x'.repeat(81), 'B')).some((m) => /maksimal 80/.test(m)));
  assert.deepEqual(messages(two('x'.repeat(80), 'Belum & “lain”')), []);
  assert.ok(messages(withOptions([opt(X1, 42)], X1)).some((m) => /wajib berupa teks/.test(m)));
  assert.deepEqual(RT.clauseOptionIssues([opt(X1, 'Ya'), opt(X2, 'YA ')], X1).filter((i) => i.message).map((i) => i.index), [1], 'shared with the editor');
});

test('IDs: system format, unique across the document; malformed structures are refused', () => {
  assert.ok(messages(withOptions([opt('Ya', 'Ya')], 'Ya')).some((m) => /ID pilihan tidak valid/.test(m)));
  assert.ok(messages(withOptions([opt(X1, 'A'), opt(X1, 'B')], X1)).some((m) => /ID pilihan “op_xxxxxxxxx1” dipakai lebih dari sekali/.test(m)));
  const shared = env(clause(A, [opt(X1, 'A')], X1, 'Satu'), clause(B, [opt(X1, 'A')], X1, 'Dua'));
  assert.ok(messages(shared).some((m) => /Klausul “Dua”: ID pilihan “op_xxxxxxxxx1” dipakai lebih dari sekali/.test(m)));
  assert.ok(messages(env(clause(A, [], null, 'Satu'), clause(A, [], null, 'Dua'))).some((m) => /ID klausul “cl_aaaaaaaaaa” dipakai lebih dari sekali/.test(m)));
  for (const id of ['', 'cl_short', 'CL_AAAAAAAAAA', 42, null]) {
    assert.ok(messages(env(clause(id, [], null, 'X'))).some((m) => /ID klausul tidak valid|wajib/.test(m)), String(id));
  }
  assert.ok(messages(withOptions('A,B', null)).some((m) => /harus berupa daftar/.test(m)));
  assert.ok(messages(withOptions([null], null)).some((m) => /Pilihan tidak valid/.test(m)));
  const c = clause(A, [], null, 'X');
  assert.ok(messages(env({ ...c, attrs: { ...c.attrs, defaultAnswer: X1 } })).some((m) => /tidak didukung pada klausul persetujuan/.test(m)));
  assert.ok(messages(null).length);
  assert.ok(messages('{"format": "richtext-json"').length, 'unparsed JSON text');
});

test('title and body rules and nesting are unchanged', () => {
  assert.ok(messages(env(clause(A, [], null, null))).some((m) => /Judul klausul persetujuan wajib diisi/.test(m)));
  const bold = env({ ...clause(A, [], null, 'X'), content: [{ type: 'clauseTitle', content: [txt('X', [{ type: 'bold' }])] }, { type: 'clauseBody', content: [p()] }] });
  assert.ok(messages(bold).some((m) => /teks biasa tanpa format/.test(m)));
  const inList = env({ type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('a')), clause(A, [], null, 'X')] }] });
  assert.ok(messages(inList).some((m) => /tidak diizinkan di dalam butir daftar/.test(m)));
  assert.deepEqual(messages(env(clause(A, [], null, 'X', p(txt('Halo '), { type: 'variable', attrs: { key: 'nama_lengkap' } })))), []);
});

/* ---------- Rendering ---------- */

test('rendering: information block without controls; radio groups for one and two options, nothing checked', () => {
  const html = RT.renderDocument(sample(), {});
  assert.match(html, /<section class="clause clause-info" data-clause-id="cl_aaaaaaaaaa" aria-labelledby="clause-cl_aaaaaaaaaa-title"><p class="clause-title" id="clause-cl_aaaaaaaaaa-title">Informasi<\/p><div class="clause-body"/);
  const info = html.slice(0, html.indexOf('</section>'));
  assert.doesNotMatch(info, /<input|fieldset|Wajib/, 'information-only: no answer controls or requirement');
  assert.equal((html.match(/<fieldset class="clause/g) || []).length, 2);
  assert.match(html, /<input type="radio" id="clause-cl_bbbbbbbbbb-op_sudahbaca1" name="clause-cl_bbbbbbbbbb" value="op_sudahbaca1"> <span>Sudah membaca<\/span>/);
  assert.match(html, /<span>Belum memahami<\/span>.*<span>Memahami<\/span>/, 'stored order');
  assert.doesNotMatch(html, /checked/, 'never pre-selected, not even a single option');
  assert.match(html, /id="clause-cl_bbbbbbbbbb-req"><strong>Wajib dijawab\.<\/strong> Perjanjian hanya dapat disetujui dengan pilihan “Sudah membaca”\./);
  assert.match(html, /id="clause-cl_cccccccccc-req"><strong>Wajib dijawab\.<\/strong> Perjanjian hanya dapat disetujui dengan pilihan “Memahami”\./);
  const evil = RT.renderDocument(withOptions([opt(X1, 'A & “B”'), opt(X2, "C'D")], X1), {});
  assert.match(evil, /<span>A &amp; “B”<\/span>/);
  assert.match(evil, /<span>C&#39;D<\/span>/);
  const preview = RT.renderDocument(sample(), {}, { preview: true });
  assert.equal((preview.match(/Simulasi pratinjau/g) || []).length, 2, 'only answerable clauses are simulated');
  assert.doesNotMatch(preview, /id="clause-/, 'preview IDs never collide with user IDs');
});

test('historical clauses render exactly as before', () => {
  const v3 = RT.renderDocument(env(fixed(A, true, 'Lama'), fixed(B, false, 'Opsional lama')), {});
  assert.match(v3, /<label class="clause-option" for="clause-cl_aaaaaaaaaa-tidak"><input type="radio" id="clause-cl_aaaaaaaaaa-tidak" name="clause-cl_aaaaaaaaaa" value="tidak"> <span>Tidak<\/span><\/label>/);
  assert.equal((v3.match(/Wajib dijawab Ya/g) || []).length, 1);
  const v4 = RT.renderDocument(env(
    clause4(A, true, [[X1, 'Setuju penuh', true], [X2, 'Setuju dengan catatan', true], [X3, 'Tidak setuju', false]], 'Tiga'),
    clause4(B, false, [[SUDAH, 'Bersedia', false], [BELUM, 'Tidak bersedia', false]], 'Opsional'),
  ), {});
  assert.match(v4, /pilihan “Setuju penuh” atau “Setuju dengan catatan”\./);
  assert.match(v4, /id="clause-cl_bbbbbbbbbb-req">Opsional — boleh tidak dijawab/);
});

test('clausesOf and clauseRule: format 5 shape; historical shapes unchanged', () => {
  const clauses = RT.clausesOf(env(clause(A, [], null, 'Info'), clause(B, [opt(X1, '  Setuju ')], X1, 'Satu')));
  assert.deepEqual(clauses, [
    { id: A, title: 'Info', options: [], qualifyingOptionId: null },
    { id: B, title: 'Satu', options: [{ id: X1, label: 'Setuju' }], qualifyingOptionId: X1 },
  ]);
  assert.deepEqual(RT.clauseRule(clauses[0]), { options: [], answerable: false, required: false, qualifying: [] });
  assert.deepEqual(RT.clauseRule(clauses[1]).qualifying, [X1]);
  const old = RT.clausesOf(env(clause4(A, false, [[X1, 'A', false], [X2, 'B', true]], 'Lama')))[0];
  assert.deepEqual(old, { id: A, title: 'Lama', required: false, options: [{ id: X1, label: 'A', qualifies: false }, { id: X2, label: 'B', qualifies: true }] });
  assert.deepEqual(RT.clauseRule(old), { options: old.options, answerable: true, required: false, qualifying: [X2] });
  assert.deepEqual(RT.clauseRule({ id: B, title: 'Tetap', required: true }).qualifying, ['ya']);
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

/** A template whose Versi 1 was published with historical clauses. */
function historical(doc) {
  const v = RT.freezeCopy(doc);
  const tpl = {
    nextId: 2,
    templates: [{
      id: 'tpl_1', code: 'TPL-AAAAAA', internalName: 'Lama', createdAt: T1, createdBy: 'Admin', updatedAt: T1,
      archived: null, lockVersion: 1, draft: null,
      versions: Object.freeze([Object.freeze({ number: 1, title: 'Dokumen lama', format: RT.FORMAT, content: v, renderVersion: v.formatVersion, publishedAt: T1, publishedBy: 'Admin', fromRevision: 1 })]),
    }],
  };
  const user = U.emptyUserState();
  const a = U.assignVersion(user, tpl, 'tpl_1', 1, T1);
  return { tpl, user, a, v };
}
const fixedDoc = () => env(p(txt('Lama')), fixed(A, true, 'Persetujuan lama'), fixed(B, false, 'Survei lama'));
const v4Doc = () => env(
  p(txt('Lama')),
  clause4(A, true, [[X1, 'Setuju penuh', true], [X2, 'Setuju dengan catatan', true], [X3, 'Tidak setuju', false]], 'Tiga pilihan'),
  clause4(B, true, [[SUDAH, 'Sudah membaca', true], [BELUM, 'Belum membaca', false]], 'Pernyataan membaca'),
  clause4(C, false, [['op_ooooooooo1', 'Bersedia', false], ['op_ooooooooo2', 'Tidak bersedia', false]], 'Opsional'),
);

const review = (a, answers) => ({ snapshotId: a.snapshot.id, answers });

test('snapshot freezes clause text, options, order, and the qualifying option', () => {
  const { a } = setup();
  const s = a.snapshot;
  assert.equal(s.formatVersion, 5);
  assert.equal(s.renderVersion, 5);
  assert.deepEqual(s.clauses, RT.clausesOf(sample()));
  assert.deepEqual(s.clauses[2], { id: C, title: 'Pemahaman', options: [{ id: X1, label: 'Belum memahami' }, { id: X2, label: 'Memahami' }], qualifyingOptionId: X2 });
  assert.ok(Object.isFrozen(s.clauses[2]) && Object.isFrozen(s.clauses[2].options) && Object.isFrozen(s.content));
  assert.throws(() => { s.clauses[2].qualifyingOptionId = X1; }, TypeError);
  assert.throws(() => { s.clauses[2].options.reverse(); }, TypeError);
});

test('unanswered and non-qualifying answers block with clause-specific messages', () => {
  const { user, a } = setup();
  const bad = [undefined, {}, { [B]: SUDAH }, { [C]: X2 }, { [B]: SUDAH, [C]: X1 }, { [B]: null, [C]: X2 }];
  for (const answers of bad) {
    assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, answers)), { code: 'CLAUSE_REQUIRED' }, JSON.stringify(answers));
  }
  assert.equal(user.acceptances.length, 0);
  const issues = U.clauseIssues(a.snapshot, { [C]: X1 });
  assert.deepEqual(issues.map((i) => i.clauseId), [B, C], 'the information-only clause never blocks');
  assert.equal(issues[0].message, 'Klausul “Pernyataan membaca” wajib dijawab (belum dijawab). Pilih “Sudah membaca”.');
  assert.equal(issues[1].message, 'Klausul “Pemahaman”: jawaban saat ini “Belum memahami” tidak memenuhi persyaratan. Pilih “Memahami”.');
  assert.ok(U.getAssignment(user, a.id), 'a non-qualifying answer does not remove access');
});

test('a single option qualifies automatically but must still be selected explicitly', () => {
  const { user, a } = setup(env(clause(A, [opt(X1, 'Saya setuju')], X1, 'Satu pilihan')));
  assert.equal(U.clauseIssues(a.snapshot, {}).length, 1);
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, {})), { code: 'CLAUSE_REQUIRED' });
  assert.throws(() => U.acceptAssignment(user, a.id, T2), { code: 'CLAUSE_REQUIRED' }, 'nothing is selected on the user’s behalf');
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [A]: X1 }));
  assert.deepEqual({ ...acceptance.answers }, { [A]: X1 });
});

test('information-only clauses never block and get no answer record', () => {
  const { user, a } = setup();
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [B]: SUDAH, [C]: X2 }));
  assert.deepEqual({ ...acceptance.answers }, { [B]: SUDAH, [C]: X2 });
  assert.ok(!(A in acceptance.answers));
  assert.ok(Object.isFrozen(acceptance.answers));
  assert.equal(acceptance.userId, U.SIM_USER_ID);
  assert.equal(acceptance.snapshotId, a.snapshot.id);
  // Only information-only clauses: plain acceptance, no answers at all.
  const info = setup(env(clause(A, [], null, 'Info'), clause(B, [], null, 'Info 2')));
  const res = U.acceptAssignment(info.user, info.a.id, T2);
  assert.ok(res.created && !('answers' in res.acceptance));
  assert.deepEqual(U.answerableClauses(info.a.snapshot), []);
});

test('answers are option IDs of that clause: labels, other clauses’ options, info clauses, and unknown clauses are refused', () => {
  const { user, a } = setup();
  const refuse = (answers, code) => assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, answers)), { code }, JSON.stringify(answers));
  refuse({ [B]: 'Sudah membaca', [C]: X2 }, 'INVALID');
  refuse({ [B]: X2, [C]: X2 }, 'INVALID');
  refuse({ [A]: SUDAH, [B]: SUDAH, [C]: X2 }, 'INVALID');
  refuse({ [A]: null, [B]: SUDAH, [C]: X2 }, 'INVALID');
  refuse({ [B]: SUDAH, [C]: X2, cl_zzzzzzzzzz: X1 }, 'INVALID');
  refuse({ [B]: true, [C]: X2 }, 'INVALID');
  assert.throws(() => U.acceptAssignment(user, a.id, T2, { snapshotId: 'snp_other', answers: { [B]: SUDAH, [C]: X2 } }), { code: 'STALE' });
  assert.equal(user.acceptances.length, 0);
});

test('answers can change before acceptance; only the confirmed set is recorded', () => {
  const { user, a } = setup();
  const answers = { [C]: X1 };
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 2);
  answers[B] = SUDAH;
  answers[C] = X2;
  assert.equal(U.clauseIssues(a.snapshot, answers).length, 0);
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, answers));
  answers[C] = X1;
  assert.equal(acceptance.answers[C], X2, 'later changes to the input object do not leak in');
});

test('repeated confirmation keeps the original acceptance, timestamp, and answers', () => {
  const { user, a } = setup();
  const first = U.acceptAssignment(user, a.id, T2, review(a, { [B]: SUDAH, [C]: X2 }));
  const again = U.acceptAssignment(user, a.id, T3, review(a, { [B]: SUDAH, [C]: X1 }));
  const invalid = U.acceptAssignment(user, a.id, T3, review(a, {}));
  assert.ok(first.created && !again.created && !invalid.created);
  assert.equal(again.acceptance, first.acceptance);
  assert.equal(again.acceptance.acceptedAt, T2);
  assert.deepEqual({ ...again.acceptance.answers }, { [B]: SUDAH, [C]: X2 });
  assert.throws(() => { first.acceptance.answers[C] = X1; }, TypeError, 'accepted answers are read-only');
  assert.equal(user.acceptances.length, 1);
});

test('later renames, reorders, qualification and option-count changes never alter snapshots, answers, or labels', () => {
  const { tpl, user, t, a } = setup();
  U.acceptAssignment(user, a.id, T2, review(a, { [B]: SUDAH, [C]: X2 }));
  const before = JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances });
  const edited = env(
    clause(A, [opt(X3, 'Baru')], X3, 'Informasi (kini berpilihan)'),
    clause(B, [], null, 'Pernyataan membaca (kini informasi)'),
    clause(C, [opt(X2, 'Paham'), opt(X1, 'Belum')], X1, 'Pemahaman'),
  );
  S.saveDraft(tpl, { templateId: t.id, internalName: 'Klausul', title: 'Dokumen klausul', content: edited, lockVersion: S.getTemplate(tpl, t.id).lockVersion }, 'Admin', T3);
  S.publishDraft(tpl, t.id, S.getTemplate(tpl, t.id).lockVersion, 'Admin', T3);
  assert.equal(JSON.stringify({ assignments: user.assignments, acceptances: user.acceptances }), before);
  const acc = U.acceptanceFor(user, a);
  assert.deepEqual(U.answerableClauses(a.snapshot).map((c) => U.answerLabel(c, acc.answers[c.id])), ['Sudah membaca', 'Memahami']);
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

/* ---------- Historical format-4 clauses ---------- */

test('historical format-4 snapshots keep their rules: several qualifying options, optional clauses', () => {
  const { user, a } = historical(v4Doc());
  assert.equal(a.snapshot.formatVersion, 4);
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, { [A]: X3, [B]: SUDAH })), { code: 'CLAUSE_REQUIRED' });
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [A]: X2, [B]: SUDAH }));
  assert.deepEqual({ ...acceptance.answers }, { [A]: X2, [B]: SUDAH, [C]: null }, 'unanswered optional clause recorded as null, as before');
});

test('legacy format-4 content cannot be saved or published unchanged', () => {
  const tpl = { nextId: 1, templates: [] };
  assert.throws(() => S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'X', title: 'X', content: v4Doc() }, 'Admin', T1),
    (err) => err.code === 'INVALID' && /aturan pilihan lama \(format 4\)/.test(err.details.errors[0].message));
  const { tpl: h } = historical(v4Doc());
  const t = S.getTemplate(h, 'tpl_1');
  t.draft = { title: 'Lama', format: RT.FORMAT, content: RT.freezeCopy(v4Doc()), revision: 1, basedOnVersion: 1, createdAt: T1, updatedAt: T1, updatedBy: 'Admin' };
  assert.throws(() => S.publishDraft(h, t.id, t.lockVersion, 'Admin', T2), (err) => err.code === 'LEGACY_FORMAT' && /format 4/.test(err.message));
  assert.equal(t.versions.length, 1);
  assert.equal(t.draft.content.formatVersion, 4, 'the legacy draft is not rewritten');
});

test('explicit editing maps format-4 clauses without removing options or inferring qualification', () => {
  const source = RT.freezeCopy(v4Doc());
  const { content, migrated } = RT.editableClauses(source);
  assert.equal(migrated, 3);
  assert.equal(source.formatVersion, 4, 'source unchanged');
  const clauses = RT.clausesOf(content);
  assert.deepEqual(clauses.map((c) => [c.options.map((o) => o.id), c.qualifyingOptionId]), [
    [[X1, X2, X3], null], // two qualifying options: ambiguous, admin decides; three options kept
    [[SUDAH, BELUM], SUDAH], // exactly one qualifying option: carried over
    [['op_ooooooooo1', 'op_ooooooooo2'], null], // optional clause: admin decides
  ]);
  const msgs = messages(content);
  assert.ok(msgs.some((m) => /Klausul “Tiga pilihan”: Maksimal 2 pilihan/.test(m)));
  assert.ok(msgs.some((m) => /Klausul “Opsional”: Tentukan satu “Pilihan yang memenuhi syarat”/.test(m)));
  assert.equal(RT.editableClauses(sample()).migrated, 0);
  // After the admin corrects them, the draft saves and publishes normally.
  const { tpl } = historical(v4Doc());
  const fixedUp = JSON.parse(JSON.stringify(content));
  fixedUp.document.content[1].attrs = { clauseId: A, options: [opt(X1, 'Setuju penuh'), opt(X3, 'Tidak setuju')], qualifyingOptionId: X1 };
  fixedUp.document.content[3].attrs = { clauseId: C, options: [], qualifyingOptionId: null };
  const t = S.saveDraft(tpl, { templateId: 'tpl_1', internalName: 'Lama', title: 'Dokumen lama', content: fixedUp, lockVersion: 1 }, 'Admin', T2);
  assert.equal(S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T2).content.formatVersion, 5);
});

/* ---------- Historical fixed “Tidak / Ya” clauses ---------- */

test('historical fixed clauses keep their original behaviour: only “Ya” satisfies a required clause', () => {
  const { user, a } = historical(fixedDoc());
  assert.deepEqual(a.snapshot.clauses, [{ id: A, title: 'Persetujuan lama', required: true }, { id: B, title: 'Survei lama', required: false }]);
  assert.match(a.snapshot.html, /Wajib dijawab Ya/);
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'tidak' })), (err) => err.code === 'CLAUSE_REQUIRED' && /jawaban saat ini “Tidak”/.test(err.message) && /Pilih “Ya”/.test(err.message));
  assert.throws(() => U.acceptAssignment(user, a.id, T2, review(a, { [A]: SUDAH })), { code: 'INVALID' });
  const { acceptance } = U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'ya', [B]: 'tidak' }));
  assert.deepEqual({ ...acceptance.answers }, { [A]: 'ya', [B]: 'tidak' });
});

test('new content cannot be saved or published with fixed clauses', () => {
  const tpl = { nextId: 1, templates: [] };
  assert.throws(() => S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'X', title: 'X', content: env(fixed(A, true, 'Lama')) }, 'Admin', T1),
    (err) => err.code === 'INVALID' && /pilihan tetap “Tidak \/ Ya”/.test(err.details.errors[0].message));
  const { tpl: h } = historical(fixedDoc());
  const t = S.getTemplate(h, 'tpl_1');
  t.draft = { title: 'Lama', format: RT.FORMAT, content: RT.freezeCopy(env(fixed(A, true, 'Lama'))), revision: 1, basedOnVersion: 1, createdAt: T1, updatedAt: T1, updatedBy: 'Admin' };
  assert.throws(() => S.publishDraft(h, t.id, t.lockVersion, 'Admin', T2), { code: 'LEGACY_FORMAT' });
  assert.equal(t.versions.length, 1);
});

test('explicit conversion of fixed clauses keeps history; the admin then applies the current rules', () => {
  const { tpl, user, a } = historical(fixedDoc());
  U.acceptAssignment(user, a.id, T2, review(a, { [A]: 'ya' }));
  const before = JSON.stringify({ tpl: tpl.templates[0].versions, assignments: user.assignments, acceptances: user.acceptances });
  const t = S.convertLegacyDraft(tpl, 'tpl_1', 1, 'Admin', T3);
  assert.equal(JSON.stringify({ tpl: t.versions, assignments: user.assignments, acceptances: user.acceptances }), before);
  assert.equal(U.acceptanceFor(user, a).acceptedAt, T2, 'no reacceptance required');
  const d = t.draft;
  assert.deepEqual(d.convertedFrom, { format: RT.FORMAT, formatVersion: 3, clauses: 'fixed', version: 1 });
  assert.equal(S.legacyKind(d), null, 'opens in the editor');
  assert.throws(() => S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T3), { code: 'LEGACY_FORMAT' }, 'not publishable until edited');
  const { content } = RT.editableClauses(d.content);
  assert.deepEqual(RT.clausesOf(content).map((c) => [c.id, c.options.map((o) => o.label), c.qualifyingOptionId && c.options.find((o) => o.id === c.qualifyingOptionId).label]), [
    [A, ['Tidak', 'Ya'], 'Ya'], // required: same rule as before
    [B, ['Tidak', 'Ya'], null], // optional: no equivalent, the admin decides
  ]);
});

/* ---------- Seed ---------- */

test('seed sample demonstrates zero, one, and two options', () => {
  const t = S.getTemplate(S.createSeedState(), 'tpl_6');
  assert.deepEqual(S.validateRecord(t.internalName, t.draft), []);
  assert.equal(t.draft.content.formatVersion, 5);
  const clauses = RT.clausesOf(t.draft.content);
  assert.deepEqual(clauses.map((c) => [c.title, c.options.map((o) => `${o.label}${o.id === c.qualifyingOptionId ? '*' : ''}`)]), [
    ['Informasi pengolahan data', []],
    ['Pernyataan telah membaca profil perusahaan', ['Saya sudah membaca profil perusahaan*']],
    ['Pemahaman ketentuan layanan', ['Belum memahami', 'Memahami dan menerima*']],
  ]);
  const types = t.draft.content.document.content.map((b) => b.type);
  assert.ok(types.lastIndexOf('table') < types.indexOf('consentClause'), 'clauses follow the profile tables');
});
