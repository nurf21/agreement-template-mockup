'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');
const U = require('../js/user.js');
const RT = require('../js/richtext.js');

const T1 = '2026-11-05T02:00:00Z';
const T2 = '2026-11-05T03:00:00Z';

function seed() {
  const tpl = S.createSeedState();
  return { tpl, user: U.createSeedUserState(tpl) };
}
const pending = (user) => U.listForUser(user).filter((x) => !x.acceptance);
const accepted = (user) => U.listForUser(user).filter((x) => x.acceptance);
const find = (user, templateId, version) => U.listForUser(user)
  .find((x) => x.assignment.snapshot.templateId === templateId && x.assignment.snapshot.templateVersion === version);

test('seed: explicit assignments split into pending and accepted', () => {
  const { user } = seed();
  assert.equal(U.listForUser(user).length, 4);
  assert.deepEqual(accepted(user).map((x) => [x.assignment.snapshot.templateId, x.assignment.snapshot.templateVersion]), [['tpl_1', 1]]);
  assert.deepEqual(
    pending(user).map((x) => [x.assignment.snapshot.templateId, x.assignment.snapshot.templateVersion]).sort(),
    [['tpl_1', 2], ['tpl_2', 1], ['tpl_5', 1]],
  );
});

test('seed: a newer version is a separate pending agreement; the accepted one is preserved', () => {
  const { user } = seed();
  const v1 = find(user, 'tpl_1', 1);
  const v2 = find(user, 'tpl_1', 2);
  assert.ok(v1.acceptance && !v2.acceptance);
  assert.notEqual(v1.assignment.snapshot.id, v2.assignment.snapshot.id);
  assert.equal(v1.assignment.snapshot.title, 'Persetujuan Layanan');
  assert.equal(v1.acceptance.acceptedAt, '2026-09-15T03:20:00Z');
});

test('drafts never reach the user side', () => {
  const { tpl, user } = seed();
  // tpl_3 has only a draft; tpl_1 has a draft (revision 3) on top of version 2.
  assert.ok(U.listForUser(user).every((x) => x.assignment.snapshot.templateId !== 'tpl_3'));
  const draftContent = S.getTemplate(tpl, 'tpl_1').draft.content;
  assert.ok(U.listForUser(user).every((x) => x.assignment.snapshot.content !== draftContent));
  assert.throws(() => U.assignVersion(user, tpl, 'tpl_3', 1, T1), { code: 'NOT_PUBLISHED' });
  assert.throws(() => U.assignVersion(user, tpl, 'tpl_1', 3, T1), { code: 'NOT_PUBLISHED' });
});

test('snapshot pins version, title, values and rendered content, and is frozen', () => {
  const { user } = seed();
  const s = find(user, 'tpl_2', 1).assignment.snapshot;
  assert.equal(s.userId, U.SIM_USER_ID);
  assert.equal(s.templateVersion, 1);
  assert.deepEqual({ ...s.values }, { nama_lengkap: 'Dewi Lestari' });
  assert.match(s.html, /Dewi Lestari/);
  assert.doesNotMatch(s.html, /ph-token|ph-unknown/);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.values));
  assert.throws(() => { 'use strict'; s.title = 'x'; }, TypeError);
});

test('acceptance is bound to the exact user, version, and snapshot', () => {
  const { user } = seed();
  const a = find(user, 'tpl_1', 2).assignment;
  const r = U.acceptAssignment(user, a.id, T1);
  assert.equal(r.created, true);
  assert.deepEqual(
    { snapshotId: r.acceptance.snapshotId, templateId: r.acceptance.templateId, templateVersion: r.acceptance.templateVersion, userId: r.acceptance.userId, acceptedAt: r.acceptance.acceptedAt },
    { snapshotId: a.snapshot.id, templateId: 'tpl_1', templateVersion: 2, userId: U.SIM_USER_ID, acceptedAt: T1 },
  );
  assert.ok(Object.isFrozen(r.acceptance));
  // Accepting version 2 does not touch version 1's acceptance, and vice versa.
  assert.equal(find(user, 'tpl_1', 1).acceptance.acceptedAt, '2026-09-15T03:20:00Z');
  assert.equal(user.acceptances.length, 2);
});

test('duplicate confirmation keeps one acceptance and the original timestamp', () => {
  const { user } = seed();
  const a = find(user, 'tpl_2', 1).assignment;
  const first = U.acceptAssignment(user, a.id, T1);
  const again = U.acceptAssignment(user, a.id, T2);
  assert.equal(again.created, false);
  assert.equal(again.acceptance, first.acceptance);
  assert.equal(again.acceptance.acceptedAt, T1);
  assert.equal(user.acceptances.filter((x) => x.snapshotId === a.snapshot.id).length, 1);
});

test('publishing a new version leaves assignments, snapshots, and acceptances unchanged', () => {
  const { tpl, user } = seed();
  const before = JSON.stringify(user);
  const t = S.getTemplate(tpl, 'tpl_1');
  const v3 = S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
  assert.equal(v3.number, 3);
  assert.equal(JSON.stringify(user), before, 'no new assignment, no re-acceptance, no snapshot change');
  assert.equal(find(user, 'tpl_1', 3), undefined);
});

test('profile changes leave existing snapshots unchanged; new assignments use the new values', () => {
  const { tpl, user } = seed();
  const s = find(user, 'tpl_2', 1).assignment.snapshot;
  const html = s.html;
  U.setProfile(user, 'diperbarui');
  assert.equal(user.profile.userId, U.SIM_USER_ID, 'identity never changes');
  assert.equal(find(user, 'tpl_2', 1).assignment.snapshot.html, html);
  assert.equal(s.values.nama_lengkap, 'Dewi Lestari');
  const a = U.assignVersion(user, tpl, 'tpl_4', 3, T1);
  assert.match(a.snapshot.html, /Dewi Lestari Wijaya/);
});

test('missing placeholder data makes the snapshot unavailable and blocks acceptance', () => {
  const { tpl, user } = seed();
  U.setProfile(user, 'kosong');
  const a = U.assignVersion(user, tpl, 'tpl_4', 3, T1);
  assert.deepEqual([...a.snapshot.missing], ['nama_lengkap']);
  assert.equal(a.snapshot.html, null, 'no silent empty substitution');
  assert.throws(() => U.acceptAssignment(user, a.id, T2), { code: 'UNAVAILABLE' });
  assert.equal(user.acceptances.length, 1);
  // Restoring the profile does not repair the frozen snapshot; a new assignment is allowed.
  U.setProfile(user, 'awal');
  assert.equal(a.snapshot.html, null);
  const b = U.assignVersion(user, tpl, 'tpl_4', 3, T2);
  assert.equal(b.snapshot.missing.length, 0);
  assert.throws(() => U.assignVersion(user, tpl, 'tpl_4', 3, T2), { code: 'DUPLICATE' });
});

test('a template without placeholders needs no profile data', () => {
  const { user } = seed();
  U.setProfile(user, 'kosong');
  const a = find(user, 'tpl_5', 1).assignment;
  assert.equal(a.snapshot.missing.length, 0);
  assert.equal(U.acceptAssignment(user, a.id, T1).created, true);
});

test('archiving blocks new assignments but existing snapshots stay readable and acceptable', () => {
  const { tpl, user } = seed();
  const t = S.getTemplate(tpl, 'tpl_2');
  S.archiveTemplate(tpl, t.id, t.lockVersion, 'Admin', T1);
  assert.throws(() => U.assignVersion(user, tpl, 'tpl_2', 1, T1), { code: 'ARCHIVED' });
  const a = find(user, 'tpl_2', 1).assignment;
  assert.ok(a.snapshot.html);
  assert.equal(U.acceptAssignment(user, a.id, T2).created, true);
  // tpl_5 was archived in the seed after its assignment; also acceptable.
  assert.throws(() => U.assignVersion(user, tpl, 'tpl_5', 1, T1), { code: 'ARCHIVED' });
  assert.equal(U.acceptAssignment(user, find(user, 'tpl_5', 1).assignment.id, T2).created, true);
});

test('placeholder values stay plain text in the snapshot', () => {
  const tpl = { nextId: 1, templates: [] };
  const content = RT.wrap({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halo ', marks: [{ type: 'bold' }] }, { type: 'variable', attrs: { key: 'nama_lengkap' }, marks: [{ type: 'bold' }] }] }] });
  const t = S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'N', title: 'J', content }, 'A', T1);
  S.publishDraft(tpl, t.id, t.lockVersion, 'A', T1);
  const user = U.emptyUserState();
  user.profile = Object.freeze({ userId: U.SIM_USER_ID, preset: 'x', values: { nama_lengkap: '<img src=x onerror=alert(1)> **b**' } });
  const a = U.assignVersion(user, tpl, t.id, 1, T1);
  assert.doesNotMatch(a.snapshot.html, /<img|<strong>\*|<b>/);
  assert.match(a.snapshot.html, /<strong><span class="ph-value"[^>]*>&lt;img src=x onerror=alert\(1\)&gt; \*\*b\*\*<\/span><\/strong>/);
  // Legacy Markdown path keeps the same guarantee.
  const legacy = U.assignVersion(user, S.createSeedState(), 'tpl_2', 1, T1);
  assert.match(legacy.snapshot.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(legacy.snapshot.html, /<img/);
});

test('whitespace-only value counts as missing', () => {
  const tpl = S.createSeedState();
  const user = U.emptyUserState();
  user.profile = Object.freeze({ userId: U.SIM_USER_ID, preset: 'x', values: { nama_lengkap: '   ' } });
  assert.deepEqual([...U.assignVersion(user, tpl, 'tpl_2', 1, T1).snapshot.missing], ['nama_lengkap']);
});

test('another user\'s assignment is not visible or acceptable', () => {
  const { user } = seed();
  const a = user.assignments[0];
  user.assignments.push(Object.freeze({ ...a, id: 'asg_other', snapshot: Object.freeze({ ...a.snapshot, id: 'snp_other', userId: 'usr-other' }) }));
  assert.equal(U.getAssignment(user, 'asg_other'), null);
  assert.throws(() => U.acceptAssignment(user, 'asg_other', T1), { code: 'NOT_FOUND' });
  assert.equal(U.listForUser(user).length, 4);
});

/* ---------- Rich-text (JSON) versions and legacy compatibility ---------- */

/** Convert tpl_2's Markdown v1 explicitly and publish it as JSON Versi 2. */
function publishJsonVersion(tpl) {
  const t = S.getTemplate(tpl, 'tpl_2');
  S.convertLegacyDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
  return S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T1);
}

test('a JSON version assignment freezes title, version, format, JSON content, values, and rendered output', () => {
  const { tpl, user } = seed();
  const v2 = publishJsonVersion(tpl);
  assert.equal(v2.format, 'richtext-json');
  const a = U.assignVersion(user, tpl, 'tpl_2', 2, T2);
  const s = a.snapshot;
  assert.equal(s.format, 'richtext-json');
  assert.equal(s.formatVersion, 1);
  assert.equal(s.templateVersion, 2);
  assert.equal(s.title, 'Ketentuan Program Rujukan');
  assert.deepEqual(s.content, v2.content);
  assert.notEqual(s.content, v2.content, 'detached copy');
  assert.deepEqual({ ...s.values }, { nama_lengkap: 'Dewi Lestari' });
  assert.equal(s.html, RT.renderDocument(v2.content, { nama_lengkap: 'Dewi Lestari' }), 'same renderer as the admin preview');
  assert.match(s.html, /rujukan, <span class="ph-value"[^>]*>Dewi Lestari<\/span>\./);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.content.document.content[0]));
});

test('JSON snapshots and acceptances stay unchanged after edits, publications, profile changes, and archival', () => {
  const { tpl, user } = seed();
  publishJsonVersion(tpl);
  const a = U.assignVersion(user, tpl, 'tpl_2', 2, T2);
  const acc = U.acceptAssignment(user, a.id, T2).acceptance;
  const before = JSON.stringify(user);
  const t = S.getTemplate(tpl, 'tpl_2');
  const edited = RT.wrap({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi baru' }] }] });
  S.saveDraft(tpl, { templateId: t.id, internalName: t.internalName, title: 'Judul baru', content: edited, lockVersion: t.lockVersion }, 'Admin', T2);
  S.publishDraft(tpl, t.id, t.lockVersion, 'Admin', T2);
  U.setProfile(user, 'diperbarui');
  S.archiveTemplate(tpl, t.id, t.lockVersion, 'Admin', T2);
  U.setProfile(user, 'awal');
  assert.equal(JSON.stringify(user), before);
  assert.equal(U.acceptAssignment(user, a.id, '2027-01-01T00:00:00Z').acceptance, acc, 'repeat keeps the original record');
  assert.equal(acc.acceptedAt, T2);
});

test('legacy Markdown snapshots, including accepted ones, are unchanged by explicit conversion', () => {
  const { tpl, user } = seed();
  const accepted = find(user, 'tpl_1', 1);
  const pendingV1 = find(user, 'tpl_2', 1).assignment.snapshot;
  const before = JSON.stringify(user);
  publishJsonVersion(tpl); // converts and republishes tpl_2
  assert.equal(JSON.stringify(user), before);
  assert.equal(pendingV1.format, undefined, 'legacy snapshot keeps its original shape');
  assert.equal(typeof pendingV1.content, 'string');
  assert.equal(pendingV1.html, require('../js/markdown.js').renderMarkdown(pendingV1.content, pendingV1.values));
  assert.equal(accepted.acceptance.acceptedAt, '2026-09-15T03:20:00Z');
  // Assigning the still-published Markdown v1 of another template keeps the legacy renderer.
  const legacy = U.assignVersion(user, tpl, 'tpl_4', 3, T2);
  assert.equal(legacy.snapshot.format, undefined);
  assert.match(legacy.snapshot.html, /<table>/);
});

test('JSON snapshot with missing placeholder data is unavailable and cannot be accepted', () => {
  const { tpl, user } = seed();
  publishJsonVersion(tpl);
  U.setProfile(user, 'kosong');
  const a = U.assignVersion(user, tpl, 'tpl_2', 2, T2);
  assert.deepEqual([...a.snapshot.missing], ['nama_lengkap']);
  assert.equal(a.snapshot.html, null);
  assert.throws(() => U.acceptAssignment(user, a.id, T2), { code: 'UNAVAILABLE' });
  assert.equal(user.acceptances.length, 1);
});
