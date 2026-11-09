# Agreement template mockup

Interactive agreement-template mockup with a Bahasa Indonesia UI:
**Konsol Admin** (desktop-first) manages templates; **Aplikasi Pengguna**
(mobile-first) lets a simulated user read and accept assigned agreements.
Use the dark bar at the top to switch between them.

Built with HTML/CSS/JavaScript and a Tiptap editor; no backend. All data is
in memory and resets on reload. Authentication, personal-data lookup,
e-signatures, and legally verified acceptance are out of scope.

## Quick start

Requires Node.js 18+ (tested with 24).

```bash
npm install
npm start
```

Open http://127.0.0.1:8000. Keep the terminal open; the editor bundle rebuilds
on each page load.

For static use, run `npm run build`, then open `index.html` directly or serve
the folder with `python3 -m http.server 8000`. Without the bundle, the editor
shows “Editor visual belum dibangun”; other pages still work.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Serve locally on port 8000 and rebuild the editor on demand |
| `npm run build` | Bundle `src/editor.js` into generated, git-ignored `dist/editor.js` |
| `npm test` | Run validation, lifecycle, assignment, and acceptance tests |
| `npm run test:ui` | Build the editor and run UI tests in jsdom (no layout checks) |

Only the editor is bundled; `js/*.js` scripts load directly in the browser.

## Try the mockup

1. In **Konsol Admin** (`#/`), edit a draft, preview it, and publish a version.
   Published versions stay frozen; stale saves are rejected.
2. In **Aplikasi Pengguna** (`#/saya`), open an assigned agreement. Publishing
   alone creates no assignment; use **Kontrol simulasi** to assign a version.
3. Choose qualifying clause answers, check the consent checkbox, and confirm
   acceptance. Assignments preserve their original document snapshots.

## Project structure

| Path | Responsibility |
|---|---|
| `js/app.js`, `styles.css` | UI, routes, and shared document styling |
| `js/store.js`, `js/user.js` | Template lifecycle and simulated user state |
| `js/richtext.js`, `js/markdown.js` | Validation, rendering, placeholders, and legacy conversion |
| `src/editor.js` | Tiptap visual editor |
| `tests/` | Unit and jsdom UI tests |
