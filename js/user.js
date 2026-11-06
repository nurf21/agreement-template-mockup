/*
 * User-side mock state: one fixed synthetic user, explicit assignments, and
 * acceptances. Simulation only: no real identity, no legal effect.
 *
 * - An assignment is created explicitly (seed data or a labelled simulation
 *   control), never by publishing. It pins an immutable snapshot of one
 *   published version: title, content, rendered HTML, and the synthetic values
 *   used. Later publications or profile changes never touch it.
 * - Only published versions of non-archived templates can be newly assigned.
 *   Drafts are never assigned. Existing snapshots stay readable after archival.
 * - Acceptance is bound to the user and the snapshot. Accepting twice returns
 *   the original record; it is never duplicated or re-timestamped.
 * - Consent clauses (rich-text format 3) are frozen into the snapshot as
 *   `clauses` (ID, title, required, in document order). An acceptance of a
 *   snapshot with clauses records `answers` keyed by clause ID ('ya',
 *   'tidak', or null for an unanswered optional clause). A required clause
 *   must be answered 'ya'. Snapshots without clauses, and acceptances made
 *   before clauses existed, have neither field; nothing is invented for them.
 */
(function (root) {
  'use strict';

  const node = typeof module === 'object' && module.exports;
  const MD = node ? require('./markdown.js') : root.AgreementMarkdown;
  const RT = node ? require('./richtext.js') : root.AgreementRichText;
  const S = node ? require('./store.js') : root.AgreementStore;
  const { StoreError } = S;

  const SIM_USER_ID = 'usr-sim-001';

  // Fixed synthetic profiles for the same simulated user. Values are never
  // typed by the user; they only switch through labelled simulation controls.
  const PROFILE_PRESETS = Object.freeze({
    awal: Object.freeze({ label: 'Profil awal', values: Object.freeze({ nama_lengkap: 'Dewi Lestari' }) }),
    diperbarui: Object.freeze({ label: 'Nama di profil diperbarui', values: Object.freeze({ nama_lengkap: 'Dewi Lestari Wijaya' }) }),
    kosong: Object.freeze({ label: 'Nama lengkap tidak tersedia', values: Object.freeze({}) }),
  });

  const PH_RE = /\{\{([a-z0-9_]+)\}\}/g;

  function placeholdersIn(content) {
    return Array.from(new Set(Array.from(String(content).matchAll(PH_RE), (m) => m[1])));
  }

  const hasValue = (v) => typeof v === 'string' && v.trim() !== '';

  /**
   * Freeze one published version for one user. Every placeholder in the
   * content is required: a missing or blank value is recorded in `missing`
   * and no HTML is rendered, so nothing is ever substituted with "".
   *
   * Legacy Markdown versions keep the original snapshot shape and renderer.
   * Rich-text versions also pin the format, format version, and JSON content,
   * and are rendered by the same validated path as the admin preview.
   */
  function buildSnapshot(id, t, v, profile, now) {
    const json = S.formatOf(v) === RT.FORMAT;
    const values = {};
    const missing = [];
    (json ? RT.placeholderKeys(v.content) : placeholdersIn(v.content)).forEach((key) => {
      if (hasValue(profile.values[key])) values[key] = profile.values[key];
      else missing.push(key);
    });
    const render = json ? RT.renderDocument : MD.renderMarkdown;
    return Object.freeze({
      id,
      userId: profile.userId,
      templateId: t.id,
      templateCode: t.code,
      templateVersion: v.number,
      title: v.title,
      // renderVersion: the HTML layout rules used for `html` below (rich text only).
      ...(json ? {
        format: RT.FORMAT, formatVersion: v.content.formatVersion, renderVersion: RT.RENDER_VERSION, content: RT.freezeCopy(v.content),
        clauses: RT.freezeCopy(RT.clausesOf(v.content)),
      } : { content: v.content }),
      values: Object.freeze(values),
      missing: Object.freeze(missing),
      html: missing.length ? null : render(v.content, values),
      createdAt: now,
    });
  }

  function makeProfile(presetKey) {
    const preset = PROFILE_PRESETS[presetKey];
    if (!preset) throw new StoreError('INVALID', 'Profil simulasi tidak dikenal.');
    return Object.freeze({ userId: SIM_USER_ID, preset: presetKey, values: preset.values });
  }

  /** Switch the synthetic profile values. The user ID never changes. */
  function setProfile(state, presetKey) {
    state.profile = makeProfile(presetKey);
    return state.profile;
  }

  function pushAssignment(state, t, v, now) {
    const n = state.nextId++;
    const a = Object.freeze({
      id: 'asg_' + n,
      assignedAt: now,
      snapshot: buildSnapshot('snp_' + n, t, v, state.profile, now),
    });
    state.assignments.push(a);
    return a;
  }

  /**
   * Explicitly assign a published version to the simulated user (simulation
   * control only; not part of the admin product UI).
   */
  function assignVersion(state, templateState, templateId, versionNumber, now) {
    const t = S.getTemplate(templateState, templateId);
    if (!t) throw new StoreError('NOT_FOUND', 'Template tidak ditemukan.');
    if (t.archived) throw new StoreError('ARCHIVED', 'Template diarsipkan dan tidak dapat ditugaskan lagi.');
    const v = t.versions.find((x) => x.number === versionNumber);
    if (!v) throw new StoreError('NOT_PUBLISHED', 'Hanya versi terbit yang dapat ditugaskan. Draf tidak pernah ditugaskan.');
    const dup = ownAssignments(state).some((a) => a.snapshot.templateId === t.id &&
      a.snapshot.templateVersion === v.number && !a.snapshot.missing.length);
    if (dup) throw new StoreError('DUPLICATE', `Versi ${v.number} sudah ditugaskan kepada pengguna ini.`);
    return pushAssignment(state, t, v, now);
  }

  function ownAssignments(state) {
    return state.assignments.filter((a) => a.snapshot.userId === state.profile.userId);
  }

  function getAssignment(state, id) {
    return ownAssignments(state).find((a) => a.id === id) || null;
  }

  function acceptanceFor(state, a) {
    return state.acceptances.find((x) => x.snapshotId === a.snapshot.id && x.userId === state.profile.userId) || null;
  }

  function listForUser(state) {
    return ownAssignments(state).map((a) => ({ assignment: a, acceptance: acceptanceFor(state, a) }));
  }

  const ANSWER_VALUES = RT.CLAUSE_ANSWERS.map((x) => x.value);
  const clausesOfSnapshot = (s) => s.clauses || [];

  /**
   * Answers for every clause of the snapshot, in clause order, with `null`
   * for unanswered ones. Unknown clause IDs or values are refused.
   */
  function normalizeAnswers(snapshot, answers) {
    const given = answers == null ? {} : answers;
    if (typeof given !== 'object' || Array.isArray(given)) throw new StoreError('INVALID', 'Jawaban klausul tidak valid.');
    const clauses = clausesOfSnapshot(snapshot);
    const unknown = Object.keys(given).filter((k) => !clauses.some((c) => c.id === k));
    if (unknown.length) throw new StoreError('INVALID', 'Jawaban untuk klausul yang tidak ada di dokumen ini.', { clauseIds: unknown });
    const out = {};
    clauses.forEach((c) => {
      const v = given[c.id] == null ? null : given[c.id];
      if (v !== null && !ANSWER_VALUES.includes(v)) throw new StoreError('INVALID', `Jawaban klausul “${c.title}” tidak valid.`);
      out[c.id] = v;
    });
    return out;
  }

  /** Required clauses not answered “Ya”, each with a message naming the clause. */
  function clauseIssues(snapshot, answers) {
    const given = answers || {};
    return clausesOfSnapshot(snapshot).filter((c) => c.required && given[c.id] !== 'ya').map((c) => {
      const answer = given[c.id] == null ? null : given[c.id];
      return {
        clauseId: c.id, title: c.title, answer,
        message: `Klausul “${c.title}” wajib dijawab “Ya” (${answer === 'tidak' ? 'jawaban saat ini: Tidak' : 'belum dijawab'}).`,
      };
    });
  }

  /**
   * Record acceptance of one assignment's snapshot by the simulated user.
   * Re-checks state every time: an existing acceptance is returned unchanged
   * (`created: false`), so repeated or stale confirmations never duplicate it
   * or replace its timestamp or answers.
   *
   * `review` = { snapshotId, answers }: the snapshot and clause answers the
   * user confirmed. A different snapshot ID is refused (STALE). For snapshots
   * with clauses, every required clause must be answered 'ya'.
   */
  function acceptAssignment(state, assignmentId, now, review) {
    const a = getAssignment(state, assignmentId);
    if (!a) throw new StoreError('NOT_FOUND', 'Perjanjian tidak ditemukan.');
    const existing = acceptanceFor(state, a);
    if (existing) return { acceptance: existing, created: false };
    if (a.snapshot.missing.length) {
      throw new StoreError('UNAVAILABLE', 'Dokumen tidak tersedia karena data profil belum lengkap.');
    }
    const s = a.snapshot;
    if (review && review.snapshotId != null && review.snapshotId !== s.id) {
      throw new StoreError('STALE', 'Konfirmasi tidak cocok dengan dokumen ini. Tinjau ulang dokumen.');
    }
    let answers = null;
    if (clausesOfSnapshot(s).length) {
      answers = normalizeAnswers(s, review && review.answers);
      const issues = clauseIssues(s, answers);
      if (issues.length) throw new StoreError('CLAUSE_REQUIRED', issues[0].message, { issues });
    }
    const acceptance = Object.freeze({
      id: 'acc_' + state.nextId++,
      snapshotId: s.id,
      templateId: s.templateId,
      templateVersion: s.templateVersion,
      userId: state.profile.userId,
      acceptedAt: now,
      ...(answers ? { answers: Object.freeze(answers) } : {}),
    });
    state.acceptances.push(acceptance);
    return { acceptance, created: true };
  }

  function emptyUserState() {
    return { nextId: 1, profile: makeProfile('awal'), assignments: [], acceptances: [] };
  }

  /**
   * Seed assignments against the seed templates (store.createSeedState):
   * tpl_1 v1 (accepted) and v2 (pending), tpl_2 v1 (pending), and tpl_5 v1,
   * assigned before that template was archived (pending, still acceptable).
   */
  function createSeedUserState(templateState) {
    const state = emptyUserState();
    const seed = (templateId, number, at) => {
      const t = S.getTemplate(templateState, templateId);
      const v = t && t.versions.find((x) => x.number === number);
      if (!v) throw new Error(`Seed: ${templateId} v${number} missing`);
      // Historical assignment: built directly so tpl_5's later archival does
      // not block it. New assignments always go through assignVersion.
      return pushAssignment(state, t, v, at);
    };
    const first = seed('tpl_1', 1, '2026-09-12T02:00:00Z');
    seed('tpl_5', 1, '2026-06-01T03:00:00Z');
    seed('tpl_2', 1, '2026-08-25T04:30:00Z');
    seed('tpl_1', 2, '2026-10-25T01:15:00Z');
    acceptAssignment(state, first.id, '2026-09-15T03:20:00Z');
    return state;
  }

  const api = {
    SIM_USER_ID, PROFILE_PRESETS, placeholdersIn, setProfile, assignVersion, getAssignment,
    acceptanceFor, listForUser, acceptAssignment, emptyUserState, createSeedUserState, normalizeAnswers, clauseIssues,
  };
  if (node) module.exports = api;
  else root.AgreementUser = api;
})(this);
