# Agreement template mockup

Interactive mockup (Bahasa Indonesia UI) with two sides:

- **Konsol Admin** (desktop-first): manage personalized agreement templates.
- **Aplikasi Pengguna** (mobile-first): a simulated user reads and accepts
  agreements explicitly assigned to them.

Plain HTML/CSS/JS with one bundled script for the visual editor; no backend:
all data is in-memory mock data that resets on page reload. The dark bar at the
top switches between the two sides; it exists only in the mockup.

## Install and run

Requires Node.js 18+ (tested with 24).

```bash
npm install       # once: Tiptap (editor) and esbuild (bundler), jsdom (tests)
npm run build     # bundles src/editor.js -> dist/editor.js (needed after install and after editing src/)
```

Then open `index.html` in a browser (works from `file://`), or serve the folder:

```bash
python3 -m http.server 8000   # then open http://127.0.0.1:8000
```

Alternatively `npm start` serves the folder at http://127.0.0.1:8000 and
rebuilds the editor bundle on each page load (esbuild serve mode; keep the
terminal open). Without the bundle the editor page shows “Editor visual belum
dibangun” instead of an editor; everything else still works.

Only `src/editor.js` is bundled. All other scripts (`js/*.js`) are plain
browser scripts loaded directly, so there is no other build step.

## Test

```bash
npm test          # node:test: rich-text JSON, legacy Markdown, lifecycle store, user assignments/acceptance, consent clauses
npm run test:ui   # builds the bundle, then jsdom: admin smoke, user flow, visual editor, label–value preset, consent clauses (tests/ui-*.js)
```

The UI tests run Tiptap inside jsdom (DOM simulation without layout). Layout,
real keyboard input, and real paste events were additionally checked manually in
headless Chromium; that script is not part of the repository.
The label–value table preset has not yet been checked in a real browser
(layout, desktop/mobile widths); only its DOM output is tested.
Consent clauses were additionally checked in headless Chromium (driven over the
DevTools protocol; script not in the repository): real keyboard input on the
radios (`Space` selects, arrow keys move within one clause's group, `Tab` moves
to the next group, `Enter` on a radio submits nothing), the consent checkbox,
the confirmation dialog (`Enter` opens, `Esc` cancels), and a 375 px mobile
viewport (no horizontal overflow, answer targets at least 44 px tall). No
screen reader was used.
Administrator-defined clause options were checked the same way in headless
Chromium 131 (script not in the repository): typing a label, `Tab` from a
label to “Memenuhi persyaratan”, `Space` toggling it, `Enter` in a label not
submitting the form, `Enter`/`Space` on ↑/↓ reordering with focus following
the moved option, disabled ↑ skipped by `Tab`; on the user page `Space`
selecting, arrow keys moving the single selection within one clause, `Tab`
moving to the next group, the in-clause explanation of a non-qualifying
choice, the dialog (`Enter` opens, `Esc` cancels, `Enter` confirms); at 375 px
no horizontal overflow, option rows and long labels wrap, answer targets
44 px, editor option controls 36 px; at 1280 px no overflow. jsdom (the
`test:ui` suite) has no layout and no native radio arrow-key handling.

## Dependencies

| Package | Use | License |
|---|---|---|
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extension-table`, `@tiptap/extension-text-align` | Visual editor (ProseMirror-based); bundled into `dist/editor.js` | MIT |
| `esbuild` (dev) | Bundles the editor | MIT |
| `jsdom` (dev) | UI tests | MIT |

No Tiptap Pro/paid extensions are used. `dist/` is generated and git-ignored.

## What it models

- **Lifecycle:** draft → published → archived. At most one draft per template.
  Saving a draft bumps its *revision*; only publishing creates a new *version*.
  Published versions are frozen (`Object.freeze`) and never deleted.
- **Editing a published template** opens a copy of the latest version; the
  draft is created on first save.
- **Required fields:** "Nama internal", "Judul dokumen", and "Isi dokumen" must
  each contain non-whitespace text. For "Isi dokumen" that means at least one
  non-whitespace character of text or one catalogue placeholder; empty
  paragraphs, empty tables, formatting marks, and whitespace alone do not count. The same rules apply to saving a draft and to
  publishing. A new editor may start empty; a save attempt with missing fields
  shows an error next to each field plus a focused error summary (`role="alert"`)
  and saves nothing. Length limits, JSON validation, and placeholder rules
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
  version number, title, content, the synthetic values used, and the rendered
  HTML. For a rich-text version the snapshot also records `format`
  (`richtext-json`) and `formatVersion`, and holds a deep-frozen copy of the
  JSON content. Legacy Markdown snapshots keep their original shape (Markdown
  string, no `format`). Reading and accepting always use the snapshot, so later
  edits, publications, conversions, or profile changes never alter it.
- Rich-text snapshots are rendered by the same validated JSON renderer as the
  admin preview; legacy snapshots by the legacy Markdown renderer. Placeholder
  values are escaped plain text in both. Every placeholder in the content is required. If the profile has
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

### Consent clauses (“Klausul persetujuan”)

- A snapshot whose document contains clauses shows each clause inline, at its
  position, as a `<fieldset>` with the title as `<legend>`, the explanatory
  text, a requirement note, and one radio per administrator-defined option
  (in the configured order, explicit `<label for>`, `value` = option ID).
  Each clause has its own radio group (`name="clause-<clauseId>"`); the user
  selects exactly one option and nothing is selected initially.
- Requirement text: a required clause says “Wajib dijawab” and names the
  options that allow acceptance (e.g. “Setuju penuh” atau “Setuju dengan
  catatan”); an optional clause says it may be left unanswered. No meaning is
  inferred from labels: an option labelled “Ya” only allows acceptance if the
  admin marked it “Memenuhi persyaratan”.
- “Setujui Perjanjian” is enabled only when the document is available, every
  required clause has a qualifying option selected, and the consent checkbox
  is checked. Below the button, each blocking clause is named (“belum
  dijawab” or “jawaban saat ini “…” tidak memenuhi persyaratan”, plus the
  options to choose) with a link that focuses it. A non-qualifying choice is
  also explained in text inside the clause (not only by colour). Optional
  clauses never block; any answer, or none, is allowed.
- Choosing an option only changes local page state: it never submits,
  records, or rejects anything, and does not remove access. Answers can be
  changed until the final confirmation. Leaving the document discards them.
- The confirmation dialog lists the answers (by label) to be recorded. The
  document availability, required answers, and the consent checkbox are
  checked again when it opens and when it is confirmed; if the answers
  changed in between (or the page now shows another document), nothing is
  recorded and a new confirmation is required.
- The acceptance record holds `answers`, keyed by clause ID: the selected
  option ID, or `null` for an unanswered optional clause. Labels are never
  identifiers. The record is bound to its user and snapshot. Afterwards the
  page lists the recorded answers next to the original timestamp, using the
  labels frozen in that snapshot, and the clauses show them read-only
  (disabled). A repeated confirmation returns the original record, answers,
  and timestamp.
- Snapshots freeze `clauses` (ID, title, required flag, and `options`: ID,
  label, `qualifies`, in order) together with the full JSON content. Later
  renames, reorders, qualification changes, or publications never change
  them. Documents without clauses, legacy snapshots, and earlier acceptances
  are unchanged: no `answers` are invented and nothing has to be accepted
  again.
- **Fixed “Tidak / Ya” clauses (format version 3)** created before options
  were configurable keep their original behaviour wherever they already
  exist: published versions, snapshots, and acceptances still use the fixed
  options (`"tidak"` / `"ya"`; a required clause needs “Ya”) and render as
  before. They are never converted automatically. Opening the editor on such
  a template offers “Buat draf dengan pilihan yang dapat diatur”, which
  creates a new editable draft (or replaces the content of an existing draft,
  bumping its revision): each clause keeps its ID, text, and required setting
  and gets the options “Tidak” and “Ya” with new option IDs, only “Ya”
  marked “Memenuhi persyaratan”. Nothing is republished, reassigned, or
  requires reacceptance. New content can no longer be saved or published with
  fixed clauses.
- Try it: in the admin console publish “Contoh Profil Perusahaan (fiktif)”,
  then in *Kontrol simulasi* assign it. Its fictional sample clauses are
  “Pernyataan telah membaca profil perusahaan” (required; “Sudah membaca”
  qualifies, “Belum membaca” does not), “Pemahaman ketentuan layanan”
  (required; three options, two qualifying), and “Kesediaan menerima
  informasi lanjutan” (optional; “Bersedia” / “Tidak bersedia”).

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
they do not depend on templates. Drafts, versions, JSON content, conversions,
and the editor's undo history are never written to `localStorage`, files, or a
server; nothing survives a reload.

## Visual editor

The admin editor (“Isi dokumen”) is a Tiptap/ProseMirror editor. Its schema
only contains the supported nodes, so it cannot produce anything else.

| Group | Controls | Keyboard |
|---|---|---|
| Riwayat | Urungkan, Ulangi | `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z` |
| Jenis blok | Paragraf, Judul bagian (H2), Subjudul (H3) | `Ctrl+Alt+0/2/3` |
| Format teks | Tebal, Miring, Garis bawah | `Ctrl+B`, `Ctrl+I`, `Ctrl+U` |
| Perataan | Rata kiri, tengah, kanan | `Ctrl+Shift+L/E/R` |
| Daftar | Daftar berpoin, bernomor | `Ctrl+Shift+8/7`; `Tab`/`Shift+Tab` nest |
| Tabel | Sisipkan tabel (3×2 with header row), + / − baris, + / − kolom, Baris header, Hapus tabel | `Tab` moves between cells |
| Tabel label–nilai | Tabel label–nilai (inserts the preset), Lebar kolom label 20% / 25% / 30% | `Tab` moves between cells |
| Klausul persetujuan | Klausul persetujuan (inserts a clause), Wajib dijawab (toggle, on by default), Hapus klausul | `Enter` in the title moves to the text |
| Placeholder | Sisipkan placeholder (menu) | arrows, `Enter`, `Esc` |

- The toolbar is one tab stop (WAI-ARIA toolbar, roving tabindex): arrow keys,
  `Home`/`End` move inside it; `Esc` returns to the document. `Esc` or
  `Alt+F10` in the document moves to the toolbar, so `Tab` inside tables is
  never a keyboard trap. Toggle buttons expose `aria-pressed`; unavailable
  commands (e.g. row controls outside a table) are `aria-disabled`.
- Headings and tables are not available inside lists or table cells.
- **Klausul persetujuan** inserts a clause block at the top level: an editable
  plain-text title, explanatory text (paragraphs, lists, bold/italic/underline,
  placeholders), the “Wajib dijawab” setting, and an options form below the
  text (“Pilihan jawaban”). A new clause starts with two empty options.
  - Each option has a system-generated ID (`op_` + 10 characters, not shown),
    a plain-text label input (“Pilihan 1” …), and — for required clauses only
    — a “Memenuhi persyaratan” checkbox. For optional clauses the checkbox is
    hidden (stored values are kept and ignored).
  - ↑ / ↓ reorder, “Hapus” removes, “+ Tambah pilihan” adds; 2–5 options
    (buttons are disabled at the limits, focus follows the moved option).
    Every change is one editor transaction (undo/redo works).
  - Labels are validated inline and in the content issues: required, unique
    after trimming and case-insensitively, at most 80 characters, no `<` / `>`
    (HTML), no `{{ }}` (placeholders), no line breaks. Surrounding spaces are
    trimmed when leaving the field. A required clause needs at least one
    qualifying option; several may qualify. `Enter` in a label does nothing
    (it never submits the form).
  - Renaming or reordering keeps clause and option IDs. A pasted copy of a
    clause that already exists in the document gets a fresh clause ID and
    fresh option IDs (labels, order, and settings are kept); missing,
    invalid, or duplicate pasted IDs are replaced.
  - Clauses cannot be placed in clauses, lists, or table cells. In the
    preview and in draft/version views, clauses are labelled “Simulasi
    pratinjau”; their radios use separate IDs and record nothing.
- See [Label–value table preset](#labelvalue-table-preset-tabel-labelnilai) for
  the preset's rules.
- The toolbar wraps on narrow screens; the page never scrolls horizontally.
- Pasted content is parsed against the editor schema: scripts and event
  handlers never run, and images, links, colours/fonts/other styles,
  strikethrough, code, quotes, rules, merged-cell widths, and list styles are
  dropped while their text is kept. Unknown placeholder elements become plain
  text. The resulting JSON is validated again before save and publish.
- The editor instance survives page re-renders, so undo history is kept after
  saving.

### Placeholders

Placeholders are atomic inline nodes `{"type": "variable", "attrs": {"key":
"nama_lengkap"}}`, shown in the editor as a chip labelled with the catalogue
label (“Nama lengkap”). Admins can insert one from the fixed system catalogue or
delete it as a whole; the key cannot be edited, and keys outside the catalogue
are refused by the editor and by validation. The catalogue still holds one
**provisional** placeholder, `nama_lengkap` (sample value only).

Typed text such as `{{nama_lengkap}}` is *not* a placeholder: text containing
`{{` or `}}` is rejected with a hint to use “Sisipkan placeholder”.

Placeholder values are always substituted as escaped plain text inside
`<span class="ph-value">`; they never become HTML, editor nodes, or formatting.

### Label–value table preset (“Tabel label–nilai”)

For profile-style sections (a heading followed by a bordered table of field
labels and values), the toolbar action **Tabel label–nilai** inserts a table
with three empty rows of two cells: a label cell (left) and a value cell
(right). It reuses the same Tiptap table extension as ordinary tables.

- **Rows:** “+ Baris” / “− Baris” (and `Tab` in the last cell) add and remove
  rows; new rows always get a label and a value cell.
- **Width:** the left column is 20%, 25% (default), or 30% of the table,
  chosen with the three width buttons (shown pressed for the current table).
  No other value can be set or stored.
- **Fixed structure:** exactly two columns and no merged cells. “+ / − kolom”
  and “Baris header” are disabled inside the preset; any other change that
  would add a column, merge cells, or change a cell's kind (for example a
  direct editor command or pasting a wider table) is refused as a whole and
  explained in a toast — content is never silently dropped.
- **Cell content:** the usual rich text (bold/italic/underline, alignment,
  several paragraphs, lists) and catalogue placeholders. No HTML or CSS editing.
- **Ordinary tables** keep their own controls (columns, header row) unchanged.
- An empty preset (only empty cells) is not meaningful content, so a document
  containing nothing else still fails “Isi dokumen wajib diisi”.

**Appearance** (same CSS for the editor, admin preview/draft/version views, and
user documents): full available width, thin light-grey borders with rounded
outer corners (corner cells are rounded too, nothing is clipped), label cells
with a very light grey background and muted text, white value cells, left
aligned and vertically centred text, about 18×22 px cell padding on desktop and
10×12 px at ≤720 px. Rows grow with their content; long text and URLs wrap
(no ellipsis, no fixed heights). On narrow screens the label column keeps a
minimum of about 7–8 rem so labels stay legible, and the table always fits the
document width, so it never needs a horizontal scroll region.

## Document format (`richtext-json`, versions 1, 2, and 3)

New drafts and new published versions store content as a versioned JSON
envelope; this JSON is the authoritative content (HTML is only derived output):

```json
{
  "format": "richtext-json",
  "formatVersion": 1,
  "document": {
    "type": "doc",
    "content": [
      { "type": "heading", "attrs": { "level": 2, "textAlign": null },
        "content": [{ "type": "text", "text": "Ketentuan Umum" }] },
      { "type": "paragraph", "attrs": { "textAlign": "center" },
        "content": [
          { "type": "text", "text": "Halo " },
          { "type": "variable", "attrs": { "key": "nama_lengkap" }, "marks": [{ "type": "bold" }] }
        ] }
    ]
  }
}
```

Records also carry `format: "richtext-json"` next to `title`, as the format
discriminator. Records without `format` are legacy Markdown.

Allowed structure (`js/richtext.js`; anything else is rejected, never dropped):

| Node | Children | Attributes |
|---|---|---|
| `doc` | ≥1 of `paragraph`, `heading`, `bulletList`, `orderedList`, `table` | — |
| `paragraph` | `text`, `variable` | `textAlign`: `null`/`left`/`center`/`right` |
| `heading` | `text`, `variable` | `level`: 2 or 3 (required); `textAlign` |
| `bulletList`, `orderedList` | ≥1 `listItem` | `orderedList.start`: integer ≥ 1 |
| `listItem` | `paragraph` first, then `paragraph`/lists | — |
| `table` | ≥1 `tableRow`, all with the same number of cells | `preset`: `null` or `"labelValue"` (v2); `labelWidth`: `null` or 20/25/30 (required for `labelValue`, otherwise `null`) |
| `tableRow` | ≥1 `tableCell`/`tableHeader` | — |
| `tableCell`, `tableHeader` | ≥1 `paragraph`/lists | `colspan` 1, `rowspan` 1, `colwidth` `null` (no merged cells) |
| `text` | — | non-empty `text`; `marks`: `bold`, `italic`, `underline` (no attributes, no duplicates) |
| `variable` | — | `key` from the catalogue (required); may carry marks |

A `labelValue` table additionally needs exactly two cells per row, a
`tableHeader` (label) first and a `tableCell` (value) second, and
`formatVersion` 2. Example:

```json
{ "type": "table", "attrs": { "preset": "labelValue", "labelWidth": 25 },
  "content": [{ "type": "tableRow", "content": [
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Nama Perusahaan" }] }] },
    { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "PT Contoh Sinar Fiktif" }] }] }
  ] }] }
```

A consent clause is a top-level block. Its content is exactly one
`clauseTitle` (plain text, no marks or placeholders, must not be blank)
followed by one `clauseBody` (paragraphs and lists). Attributes:

- `formatVersion` 4 (current): exactly `clauseId` (`/^cl_[a-z0-9]{10}$/`),
  `required` (boolean), and `options`: 2–5 objects with exactly `id`
  (`/^op_[a-z0-9]{10}$/`), `label` (plain-text string, rules above), and
  `qualifies` (boolean). Clause IDs and option IDs are unique within the
  document. A required clause needs at least one option with
  `qualifies: true`. Every clause of a version-4 document has options.
- `formatVersion` 3 (historical, read-only): `clauseId` and `required` only;
  the options are fixed (`tidak` / `ya`, `RT.CLAUSE_ANSWERS`; a required
  clause needs `ya`). Such content stays valid for existing versions and
  snapshots but is refused when saving or publishing a draft.

```json
{ "type": "consentClause",
  "attrs": { "clauseId": "cl_bacaprofil", "required": true, "options": [
    { "id": "op_sudahbaca1", "label": "Sudah membaca", "qualifies": true },
    { "id": "op_belumbaca1", "label": "Belum membaca", "qualifies": false } ] },
  "content": [
    { "type": "clauseTitle", "content": [{ "type": "text", "text": "Pernyataan telah membaca profil perusahaan" }] },
    { "type": "clauseBody", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Nyatakan apakah …" }] }] }
  ] }
```

**Versions.** `formatVersion` 1, 2, 3, and 4 are accepted. Version 2 adds the
table preset; version 3 adds consent clauses with fixed options; version 4
adds administrator-defined options. When content is stored, the
envelope gets the lowest version that can express it, so documents without
these blocks keep their earlier version. Nothing is upgraded or restyled
automatically.

**Layout version.** `RT.RENDER_VERSION` (currently 4; 3 adds the clause
fieldset, 4 adds configurable options and their requirement note; older
blocks, including fixed-option clauses, render as before) names the HTML/CSS layout
rules. It is recorded as `renderVersion` on each newly published rich-text
version and each new rich-text user snapshot. Records created earlier carry no
`renderVersion` and are left unchanged; the preset's styles only target the new
`kv-*` classes, so existing documents and snapshots look exactly as before.

Unknown properties, attributes, marks, or nodes, a wrong `format` /
`formatVersion`, invalid preset structure or width, and nesting deeper than 16
levels are reported with the top-level block number (e.g.
`Blok 3: Lebar kolom label harus 20%, 25%, atau 30%.`).

**Size limit:** `JSON.stringify(envelope.document).length` must be at most
200 000 (JavaScript string length, i.e. UTF-16 code units, of the serialized
document). The editor shows the current size. A larger document is rejected on
save and publish; nothing is truncated and no table cells are discarded.

**Rendering** (`RT.renderDocument`) validates the structure first and refuses
invalid documents. All text is HTML-escaped. Headings render as `<h3>`/`<h4>`
(below the document title `<h2>`); alignment uses `align-center` /
`align-right` classes (no inline styles); a first row of header cells becomes
`<thead>` with `scope="col"`, other header cells `scope="row"`. This single
path is used for the admin preview, draft and version views, and new user
snapshots of rich-text versions. A `labelValue` table renders as
`<div class="kv-wrap"><table class="kv-table kv-w25"><colgroup>…</colgroup><tbody>`
with each label as `<th scope="row">` and each value as `<td>`; the width class
is derived from the validated `labelWidth`, never from stored style text. The admin preview uses synthetic sample values
only.

## Legacy Markdown compatibility

- Existing published Markdown versions and existing user snapshots are kept
  exactly as they were (no `format` field; content is the Markdown string).
- Reading a legacy version (version view, detail page, user document) uses the
  original Markdown renderer (`js/markdown.js`). Nothing is converted
  automatically — not on reading, publishing, assigning, or accepting.
- Assigning a still-published legacy version creates a snapshot in the legacy
  shape, rendered by the legacy renderer.
- **Explicit conversion:** opening “Edit” on a template whose latest version (or
  existing draft) is Markdown shows the original read-only plus the action
  **“Buat draf editor visual”**, which explains that it creates an editable
  JSON copy and leaves the original version unchanged. Confirming creates (or,
  for a legacy Markdown draft, replaces) the draft with the JSON copy: draft
  revision and `lockVersion` go up, the published version is untouched, and the
  draft records `convertedFrom` (e.g. `{ "format": "markdown", "version": 2 }`).
- Conversion supports the legacy subset: `#`–`###` headings (at most two
  distinct levels), paragraphs, `**bold**`/`__bold__`, `*italic*`/`_italic_`,
  `-`/`1.` lists (start number kept), pipe tables (header row becomes header
  cells), and catalogue placeholders (become placeholder nodes, keeping
  surrounding bold/italic). It reuses the legacy inline renderer, validates the
  result, and checks that the rendered text equals the legacy rendering. If
  anything cannot be preserved (three heading levels, unknown placeholders,
  invalid legacy content, any text mismatch), a focused error lists the reasons
  and nothing is saved.
- Legacy Markdown drafts cannot be published (`LEGACY_FORMAT`); convert them
  first. Saving always requires JSON content, so every new draft is JSON.
- Legacy Markdown rules (kept for reading and conversion only): `#`–`###`
  headings, paragraphs, `**bold**`, `*italic*`, `-`/`1.` lists, pipe tables;
  everything else escaped; raw HTML, images, `${…}`, expressions, unknown
  placeholders, and tables with inconsistent column counts are invalid.

### Seed data formats

| Template | Published versions | Draft |
|---|---|---|
| `tpl_1` Persetujuan Layanan Umum | v1, v2 Markdown | JSON, revision 3, converted from Markdown Versi 2 |
| `tpl_2` Ketentuan Program Rujukan | v1 Markdown | — (Edit → conversion offer) |
| `tpl_3` Persetujuan Komunikasi Pemasaran | — | JSON, revision 2 (shows centre alignment, italic, underline) |
| `tpl_4` Pemberitahuan Perubahan Layanan | v1–v3 Markdown | — (Edit → conversion offer) |
| `tpl_5` Ketentuan Dompet (archived) | v1 Markdown | Markdown (read-only; archived) |
| `tpl_6` Contoh Profil Perusahaan (fiktif) | — | JSON v4, revision 1: sample for the label–value preset and consent clauses with custom options |

`tpl_6` is an explicitly labelled, editable sample: headings “Profil
Perusahaan” (8 rows, including a long three-paragraph history and a long URL)
and “Susunan Pengurus Perusahaan” (3 rows). All company details and names are
fictional static text (`.example` domains, “Contoh” names); it uses no
placeholders and no personal-data lookups. Catalogue placeholders can still be
inserted into its cells. After the tables it holds three consent clauses with custom
labels (see [Consent clauses](#consent-clauses-klausul-persetujuan)). No seed
record uses fixed “Tidak / Ya” clauses; `tests/ui-clause.js` injects one to
check historical behaviour and the explicit conversion.

## Files

- `js/richtext.js` — `richtext-json` validator, content rules, renderer, conversion wrapper
- `js/markdown.js` — placeholder catalogue, shared name/title rules, legacy Markdown renderer/validator, Markdown → JSON converter
- `js/store.js` — lifecycle operations (incl. explicit conversion), format discriminator, seed data
- `src/editor.js` — Tiptap editor configuration and placeholder node (bundled to `dist/editor.js`)
- `js/user.js` — simulated user: profile presets, assignments/snapshots, acceptances, seed
- `js/app.js` — UI, routing (`#/`, `#/baru`, `#/t/:id`, `#/t/:id/edit`, `#/t/:id/v/:n`,
  `#/saya`, `#/saya/:assignmentId`)
- `styles.css` — single teal accent, shared document styling
- `tests/dom-harness.js` — shared jsdom setup for the UI tests
- `tests/richtext.test.js`, `tests/ui-editor.js` — JSON format and visual editor tests
- `tests/labelvalue.test.js`, `tests/ui-labelvalue.js` — label–value table preset tests

## Out of scope

Real authentication, personal-data lookup, legally verified acceptance,
assignment management in the admin UI, withdrawal of acceptance, agreement
cancellation, automatic re-acceptance policies, transaction fields, file
upload/export (including PDF), e-signatures, notifications, legal approval,
un-archiving, and permanent deletion.
