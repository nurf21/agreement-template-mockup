# Agreement template mockup

Interactive mockup (Bahasa Indonesia UI) with two sides:

- **Konsol Admin** (desktop-first): manage personalized agreement templates.
- **Aplikasi Pengguna** (mobile-first): a simulated user reads and accepts
  agreements explicitly assigned to them.

Plain HTML/CSS/JS, no build step, no backend: all data is in-memory mock data
that resets on page reload. The dark bar at the top switches between the two
sides; it exists only in the mockup.

## Run

Open `index.html` in a browser (works from `file://`), or serve the folder:

```bash
python3 -m http.server 8000   # then open http://127.0.0.1:8000
```

## Test

```bash
npm test          # markdown, template lifecycle store, user assignments/acceptance (node:test, no deps)
npm install       # once, for jsdom
npm run test:ui   # jsdom: admin smoke test (tests/ui-smoke.js) + user flow (tests/ui-user.js)
```

## What it models

- **Lifecycle:** draft → published → archived. At most one draft per template.
  Saving a draft bumps its *revision*; only publishing creates a new *version*.
  Published versions are frozen (`Object.freeze`) and never deleted.
- **Editing a published template** opens a copy of the latest version; the
  draft is created on first save.
- **Required fields:** "Nama internal", "Judul dokumen", and "Isi dokumen" must
  each contain non-whitespace text. The same rules apply to saving a draft and to
  publishing. A new editor may start empty; a save attempt with missing fields
  shows an error next to each field plus a focused error summary (`role="alert"`)
  and saves nothing. Length limits, Markdown validation, and placeholder rules
  are unchanged.
- **Concurrency (`lockVersion`):** every template has a `lockVersion` that goes
  up by one on each successful save, publication, and archival. It is separate
  from the draft *revision* (which restarts at 1 for every new draft) and from
  document *version* numbers. The editor captures the `lockVersion` it loaded;
  the detail page captures the one shown when it rendered. Saving, publishing,
  and archiving must pass that value. It is checked when the confirmation opens
  and again by the store when the admin confirms; a stale or missing value is
  rejected (`CONFLICT` / `LOCK_REQUIRED`) before anything changes. So a
  publication request for an earlier draft can never publish a replacement
  draft that happens to have the same revision number. In the editor a conflict
  shows a banner with a reload action (try "Simulasi: admin lain menyimpan
  draf"); elsewhere a warning toast and the latest data are shown.
- **Archive** blocks editing and publishing but keeps drafts, versions, history.
  It also bumps `lockVersion`, so pending save/publish requests are refused.
- **Publishing** never assigns an agreement to users.
- **Permissions** (top "Mode simulasi" bar): Baca, Edit, Terbitkan/Arsipkan.

## User flow (Aplikasi Pengguna, `#/saya`)

This is a **simulation**: one fixed synthetic user (`usr-sim-001`), no real
authentication, no personal-data lookup, no e-signature, no legal effect. A
notice under the user header says so on every user page.

1. **Perjanjian Saya** (`#/saya`) lists agreements explicitly assigned to the
   simulated user, split into “Belum disetujui” and “Sudah disetujui”, each with
   title, document version, and status.
2. **Document** (`#/saya/:assignmentId`) shows the title, version, and full
   content with synthetic values substituted into catalogue placeholders. Tables
   scroll inside a keyboard-focusable region on small screens.
3. **Acceptance** (pending only): the checkbox “Saya telah membaca dan menyetujui
   perjanjian ini.” starts unchecked; “Setujui Perjanjian” is enabled only when
   it is checked and the document is available. The button opens a confirmation
   dialog naming the exact title and version. Only confirming records
   acceptance. Opening the page, scrolling, checking the box, cancelling or
   closing the dialog (Escape), or navigating away records nothing; scrolling is
   never required.
4. **After acceptance** the page shows “Perjanjian telah disetujui”, the accepted
   version, and the time in WIB (focused, `role="status"`). The document stays
   readable, read-only.

### Assignments and snapshots

- Publishing never assigns anything. Assignments come only from seed data or the
  simulation control below. Only published versions of non-archived templates
  can be assigned; drafts never reach the user side.
- Each assignment pins an immutable, frozen **snapshot**: template ID and code,
  version number, title, Markdown content, the synthetic values used, and the
  rendered HTML. Reading and accepting always use the snapshot, so later
  publications or profile changes never alter it.
- Rendering reuses the admin Markdown renderer; placeholder values are escaped
  plain text. Every placeholder in the content is required. If the profile has
  no (or a blank) value, the snapshot records it as missing, no HTML is rendered,
  the page shows “Dokumen tidak tersedia”, and acceptance is disabled. Values are
  never silently replaced by empty text.
- **Acceptance record** (local state): snapshot ID, template ID, template
  version, user ID, and timestamp, all taken from the simulation, never from
  form fields. Acceptance is re-checked on confirmation: a repeated click or a
  stale dialog returns the existing record unchanged (one record, original
  timestamp) and shows a notice.
- **New versions:** publishing creates no assignment and requires nothing again.
  A newer version assigned explicitly (seed: “Persetujuan Layanan Umum” Versi 2)
  appears as a separate pending agreement; the accepted Versi 1 stays.
- **Archive:** prevents new assignments. Existing snapshots remain readable and
  can still be accepted (seed: “Ketentuan Dompet”, assigned before archival);
  accepted snapshots remain available.

### Seed data

| Template | Version | State |
|---|---|---|
| Persetujuan Layanan (`tpl_1`) | 1 | accepted 15 Sep 2026 |
| Persetujuan Layanan Umum (`tpl_1`) | 2 | pending |
| Ketentuan Program Rujukan (`tpl_2`) | 1 | pending |
| Ketentuan Dompet (`tpl_5`, archived) | 1 | pending |

### Simulation controls

The collapsible **Kontrol simulasi** panel on `#/saya` (dashed, clearly
labelled; not part of the admin product UI) offers:

- **Data profil sintetis:** switch the same user's synthetic values between
  three fixed presets (initial name, updated name, name unavailable). The user
  ID never changes and there is no free-text input. Only new assignments use the
  new values.
- **Tugaskan versi terbit terbaru:** explicitly assign the latest published
  version of a non-archived template. Try “Nama lengkap tidak tersedia” and then
  assign a template using `{{nama_lengkap}}` to see the unavailable state.

The admin permission toggles do not affect the user side.

### Persistence

Everything lives in memory (`app.data` for templates, `app.user` for profile,
assignments, and acceptances). Reloading the page resets all sample data,
including acceptances. “Muat ulang data contoh” resets both sides; “Kosongkan
data” empties templates only, and existing user snapshots stay readable because
they do not depend on templates.

## Markdown subset

Supported: `#`–`###` headings, paragraphs, `**bold**`, `*italic*`, `-`/`1.`
lists, pipe tables. Everything else is escaped. Validation rejects raw HTML,
images, `${…}`, expressions in `{{…}}`, and placeholders outside the fixed
catalogue. Placeholder values are substituted after parsing and escaped, so they
always render as plain text.

Tables must have the same number of columns in the header, the separator row
(`|---|---|`), and every data row. Inconsistent tables are rejected on save and
publish with an error naming the line, e.g. `Baris 6: Baris tabel memiliki 3
kolom, sedangkan header tabel (baris 3) memiliki 2 kolom.` The live preview
never drops cells: a malformed table is shown as escaped literal text under a
notice instead of as a table.

The catalogue currently holds one **provisional** placeholder,
`{{nama_lengkap}}`; sample value only.

## Files

- `js/markdown.js` — renderer, validator, placeholder catalogue
- `js/store.js` — lifecycle operations and seed data
- `js/user.js` — simulated user: profile presets, assignments/snapshots, acceptances, seed
- `js/app.js` — UI, routing (`#/`, `#/baru`, `#/t/:id`, `#/t/:id/edit`, `#/t/:id/v/:n`,
  `#/saya`, `#/saya/:assignmentId`)
- `styles.css` — single teal accent, shared document styling
- `tests/dom-harness.js` — shared jsdom setup for the UI tests

## Out of scope

Real authentication, personal-data lookup, legally verified acceptance,
assignment management in the admin UI, withdrawal of acceptance, agreement
cancellation, automatic re-acceptance policies, transaction fields, file
upload/export (including PDF), e-signatures, notifications, legal approval,
un-archiving, and permanent deletion.
