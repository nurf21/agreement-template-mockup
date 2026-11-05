# Agreement template admin mockup

Interactive, desktop-first admin mockup (Bahasa Indonesia UI) for managing
personalized user agreement templates. Plain HTML/CSS/JS, no build step, no
backend: all data is in-memory mock data that resets on page reload.

## Run

Open `index.html` in a browser (works from `file://`), or serve the folder:

```bash
python3 -m http.server 8000   # then open http://127.0.0.1:8000
```

## Test

```bash
npm test          # markdown renderer/validator + lifecycle store (node:test, no deps)
npm install       # once, for jsdom
npm run test:ui   # DOM smoke test of the main flows
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
- `js/app.js` — UI, routing (`#/`, `#/baru`, `#/t/:id`, `#/t/:id/edit`, `#/t/:id/v/:n`)
- `styles.css` — single teal accent, shared document styling

## Out of scope

User acceptance, personal-data lookup, user targeting, transaction fields,
file upload/export, e-signatures, notifications, legal approval, un-archiving,
and permanent deletion.
