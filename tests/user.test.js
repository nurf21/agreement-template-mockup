'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');
const U = require('../js/user.js');

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
  const t = S.saveDraft(tpl, { templateId: null, code: S.generateCode(tpl), internalName: 'N', title: 'J', content: 'Halo {{nama_lengkap}}' }, 'A', T1);
  S.publishDraft(tpl, t.id, t.lockVersion, 'A', T1);
  const user = U.emptyUserState();
  user.profile = Object.freeze({ userId: U.SIM_USER_ID, preset: 'x', values: { nama_lengkap: '<img src=x onerror=alert(1)> **b**' } });
  const a = U.assignVersion(user, tpl, t.id, 1, T1);
  assert.doesNotMatch(a.snapshot.html, /<img|<strong>/);
  assert.match(a.snapshot.html, /&lt;img src=x onerror=alert\(1\)&gt; \*\*b\*\*/);
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
