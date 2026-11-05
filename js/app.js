/* UI for the agreement-template admin mockup. Local state only; no network. */
(function () {
  'use strict';

  const MD = window.AgreementMarkdown;
  const S = window.AgreementStore;
  const esc = MD.escapeHtml;

  const ACTOR = 'Nadia Putri';
  const OTHER_ADMIN = 'Bagas Wirawan';
  const SAMPLE_LABEL = 'Contoh — bukan dokumen pengguna';

  const app = {
    data: S.createSeedState(),
    perms: { read: true, edit: true, publish: true },
    list: { q: '', status: 'all', draftOnly: false },
    editor: null,
    detailView: {},
    showValues: true,
    ignoreHash: false,
    currentHash: location.hash,
  };

  const main = document.getElementById('main');
  const toasts = document.getElementById('toasts');
  const dialog = document.getElementById('dialog');
  const $ = (sel) => document.querySelector(sel);
  // Replace markup only when it changed, so open <details> and focus survive typing.
  const setHtml = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

  const dateFmt = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  });
  const timeFmt = new Intl.DateTimeFormat('id-ID', { timeStyle: 'short', timeZone: 'Asia/Jakarta' });
  const fmt = (iso) => dateFmt.format(new Date(iso)) + ' WIB';
  const fmtTime = (iso) => timeFmt.format(new Date(iso)) + ' WIB';
  const now = () => new Date().toISOString();
  const timeTag = (iso) => `<time datetime="${esc(iso)}">${esc(fmt(iso))}</time>`;

  /* ---------- Routing ---------- */

  function parseRoute() {
    let parts;
    try {
      parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch (_) {
      return { name: 'notfound' };
    }
    if (parts.length === 0) return { name: 'list' };
    if (parts[0] === 'baru' && parts.length === 1) return { name: 'create' };
    if (parts[0] === 't' && parts[1]) {
      if (parts.length === 2) return { name: 'detail', id: parts[1] };
      if (parts.length === 3 && parts[2] === 'edit') return { name: 'edit', id: parts[1] };
      if (parts.length === 4 && parts[2] === 'v' && /^\d+$/.test(parts[3])) {
        return { name: 'version', id: parts[1], number: Number(parts[3]) };
      }
    }
    return { name: 'notfound' };
  }

  function editorKey(route) {
    if (route.name === 'create') return 'create';
    if (route.name === 'edit') return 'edit:' + route.id;
    return null;
  }

  function navigate(hash) {
    if (location.hash === hash) render({ nav: true });
    else location.hash = hash;
  }

  function isDirty(e) {
    return Boolean(e) && (
      e.internalName !== e.orig.internalName || e.title !== e.orig.title || e.content !== e.orig.content
    );
  }

  window.addEventListener('hashchange', () => {
    if (app.ignoreHash) { app.ignoreHash = false; return; }
    const route = parseRoute();
    const e = app.editor;
    const leaving = e && editorKey(route) !== e.key;
    if (leaving && isDirty(e) &&
        !window.confirm('Perubahan draf belum disimpan dan akan hilang. Tinggalkan halaman ini?')) {
      app.ignoreHash = true;
      location.hash = app.currentHash;
      return;
    }
    if (leaving) app.editor = null;
    app.currentHash = location.hash;
    render({ nav: true });
  });

  window.addEventListener('beforeunload', (ev) => {
    if (isDirty(app.editor)) { ev.preventDefault(); ev.returnValue = ''; }
  });

  /* ---------- Shared fragments ---------- */

  const STATUS = {
    draft: ['Belum diterbitkan', 'badge-neutral'],
    published: ['Diterbitkan', 'badge-accent'],
    archived: ['Diarsipkan', 'badge-muted'],
  };

  function statusBadge(t) {
    const [label, cls] = STATUS[S.statusOf(t)];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function titleOf(t) {
    const src = t.draft || S.latestVersion(t);
    return src ? src.title : '';
  }

  function crumbs(items) {
    const parts = items.map((it, i) => (i === items.length - 1
      ? `<span aria-current="page">${esc(it.label)}</span>`
      : `<a href="${it.href}">${esc(it.label)}</a>`));
    return `<nav class="crumbs" aria-label="Breadcrumb">${parts.join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
  }

  function permNotice() {
    const missing = [];
    if (!app.perms.edit) missing.push('membuat atau mengedit draf (izin <strong>Edit</strong>)');
    if (!app.perms.publish) missing.push('menerbitkan atau mengarsipkan (izin <strong>Terbitkan/Arsipkan</strong>)');
    if (!missing.length) return '';
    return `<div class="callout callout-info"><p><strong>Akses terbatas.</strong> Anda tidak dapat ${missing.join(' maupun ')}.</p></div>`;
  }

  function deniedState(permName, action) {
    return `
      <section class="state" aria-labelledby="page-title">
        <div class="state-icon" aria-hidden="true">${ICON_LOCK}</div>
        <h1 id="page-title" tabindex="-1">Akses ditolak</h1>
        <p>Anda memerlukan izin <strong>${esc(permName)}</strong> untuk ${esc(action)}.</p>
        <p class="muted">Ini simulasi izin. Ubah izin melalui bilah “Mode simulasi” di atas.</p>
        ${app.perms.read ? '<p><a class="btn" href="#/">Kembali ke daftar template</a></p>' : ''}
      </section>`;
  }

  function notFound(message) {
    return `
      <section class="state" aria-labelledby="page-title">
        <h1 id="page-title" tabindex="-1">Tidak ditemukan</h1>
        <p>${esc(message)}</p>
        <p><a class="btn" href="#/">Kembali ke daftar template</a></p>
      </section>`;
  }

  function valuesToggle() {
    const seg = (val, label) => {
      const on = (val === '1') === app.showValues;
      return `<button type="button" class="seg${on ? ' is-on' : ''}" aria-pressed="${on}" data-action="show-values" data-val="${val}">${label}</button>`;
    };
    return `<div class="segmented-buttons" role="group" aria-label="Tampilan placeholder">${seg('1', 'Nilai contoh')}${seg('0', 'Kode placeholder')}</div>`;
  }

  /** The one document renderer used by preview, draft view, and version view. */
  function documentHtml(title, content) {
    const body = String(content).trim()
      ? MD.renderMarkdown(content, app.showValues ? MD.SAMPLE_VALUES : null)
      : '<p class="doc-empty">Belum ada isi dokumen.</p>';
    return `
      <article class="doc" aria-label="${esc(SAMPLE_LABEL)}">
        <p class="doc-sample-label">${esc(SAMPLE_LABEL)}</p>
        <h2 class="doc-title">${title ? esc(title) : '<span class="doc-empty">Judul dokumen belum diisi</span>'}</h2>
        <div class="doc-body">${body}</div>
      </article>`;
  }

  function button(label, opts) {
    const allowed = opts.allowed !== false;
    const cls = 'btn' + (opts.primary ? ' btn-primary' : '') + (opts.danger ? ' btn-danger-outline' : '');
    if (allowed && opts.href) return `<a class="${cls}" href="${opts.href}">${esc(label)}</a>`;
    const data = opts.action
      ? ` data-action="${opts.action}" data-id="${esc(opts.id || '')}"${opts.lock != null ? ` data-lock="${opts.lock}"` : ''}`
      : '';
    const title = !allowed && opts.reason ? ` title="${esc(opts.reason)}"` : '';
    return `<button type="button" class="${cls}"${data}${title}${allowed ? '' : ' disabled'}>${esc(label)}</button>`;
  }

  const ICON_LOCK = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const ICON_DOC = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';

  /* ---------- List ---------- */

  function filteredTemplates() {
    const q = app.list.q.trim().toLowerCase();
    return app.data.templates
      .filter((t) => !q || t.internalName.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) || titleOf(t).toLowerCase().includes(q))
      .filter((t) => app.list.status === 'all' || S.statusOf(t) === app.list.status)
      .filter((t) => !app.list.draftOnly || t.draft)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function renderList() {
    const all = app.data.templates;
    const createBtn = button('Buat Template', {
      href: '#/baru', primary: true, allowed: app.perms.edit, reason: 'Memerlukan izin Edit',
    });
    const head = `
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">Template Perjanjian</h1>
          <p class="lede">Kelola template perjanjian yang dipersonalisasi beserta versinya.</p>
        </div>
        <div class="page-actions">${createBtn}</div>
      </div>
      ${permNotice()}`;

    if (!all.length) {
      return head + `
        <section class="state" aria-labelledby="empty-h">
          <div class="state-icon" aria-hidden="true">${ICON_DOC}</div>
          <h2 id="empty-h">Belum ada template</h2>
          <p>Buat template pertama untuk mulai menyusun dokumen perjanjian.</p>
          ${app.perms.edit ? '<p><a class="btn btn-primary" href="#/baru">Buat Template</a></p>' : '<p class="muted">Anda memerlukan izin Edit untuk membuat template.</p>'}
        </section>`;
    }

    const count = (s) => (s === 'all' ? all.length : all.filter((t) => S.statusOf(t) === s).length);
    const opt = (value, label) => `
      <label class="seg-radio">
        <input type="radio" name="status" value="${value}"${app.list.status === value ? ' checked' : ''}>
        <span>${label} <span class="count">${count(value)}</span></span>
      </label>`;

    return head + `
      <div class="filters">
        <div class="search">
          <label for="q" class="visually-hidden">Cari template</label>
          <input id="q" type="search" placeholder="Cari nama, kode, atau judul…" value="${esc(app.list.q)}" autocomplete="off">
        </div>
        <fieldset class="seg-group">
          <legend class="visually-hidden">Filter status</legend>
          ${opt('all', 'Semua')}${opt('draft', 'Belum diterbitkan')}${opt('published', 'Diterbitkan')}${opt('archived', 'Diarsipkan')}
        </fieldset>
        <label class="check"><input type="checkbox" id="draft-only"${app.list.draftOnly ? ' checked' : ''}> Hanya yang memiliki draf</label>
      </div>
      <p id="result-count" class="result-count" aria-live="polite"></p>
      <div id="results"></div>`;
  }

  function renderResults() {
    const rows = filteredTemplates();
    const counter = $('#result-count');
    if (counter) counter.textContent = `${rows.length} dari ${app.data.templates.length} template`;
    if (!rows.length) {
      return `
        <section class="state state-inline" aria-labelledby="nores-h">
          <h2 id="nores-h">Tidak ada template yang cocok</h2>
          <p>Coba kata kunci lain atau ubah filter status.</p>
          <p><button type="button" class="btn" data-action="clear-filters">Hapus pencarian &amp; filter</button></p>
        </section>`;
    }
    const body = rows.map((t) => {
      const latest = S.latestVersion(t);
      return `
        <tr>
          <th scope="row">
            <a class="row-link" href="#/t/${esc(t.id)}">${esc(t.internalName)}</a>
            <div class="cell-sub">${esc(titleOf(t)) || '<span class="muted">Tanpa judul</span>'}</div>
          </th>
          <td><code class="code">${esc(t.code)}</code></td>
          <td>${latest ? `Versi ${latest.number}` : '<span class="muted">Belum ada</span>'}</td>
          <td>${t.draft ? `<span class="pill">Ada · revisi ${t.draft.revision}</span>` : '<span class="muted">Tidak ada</span>'}</td>
          <td>${statusBadge(t)}</td>
          <td class="nowrap">${timeTag(t.updatedAt)}</td>
        </tr>`;
    }).join('');
    return `
      <div class="table-scroll">
        <table class="data-table">
          <caption class="visually-hidden">Daftar template perjanjian</caption>
          <thead><tr>
            <th scope="col">Nama internal</th><th scope="col">Kode</th><th scope="col">Versi terbit</th>
            <th scope="col">Draf</th><th scope="col">Status</th><th scope="col">Terakhir diperbarui</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function bindList() {
    const results = $('#results');
    if (!results) return;
    const refresh = () => { results.innerHTML = renderResults(); };
    $('#q').addEventListener('input', (ev) => { app.list.q = ev.target.value; refresh(); });
    document.querySelectorAll('input[name="status"]').forEach((r) => r.addEventListener('change', (ev) => {
      app.list.status = ev.target.value; refresh();
    }));
    $('#draft-only').addEventListener('change', (ev) => { app.list.draftOnly = ev.target.checked; refresh(); });
    refresh();
  }

  /* ---------- Detail ---------- */

  function renderDetail(route) {
    const t = S.getTemplate(app.data, route.id);
    if (!t) return notFound('Template tidak ditemukan.');
    const latest = S.latestVersion(t);
    let sel = app.detailView[t.id] || (latest ? 'published' : 'draft');
    if (sel === 'draft' && !t.draft) sel = 'published';
    if (sel === 'published' && !latest) sel = 'draft';

    const actions = [];
    if (!t.archived) {
      const editLabel = t.draft ? 'Lanjutkan edit draf'
        : (latest ? `Edit (buat draf dari Versi ${latest.number})` : 'Edit draf');
      actions.push(button(editLabel, { href: `#/t/${t.id}/edit`, primary: true, allowed: app.perms.edit, reason: 'Memerlukan izin Edit' }));
      actions.push(button('Terbitkan draf…', {
        action: 'publish', id: t.id, lock: t.lockVersion, allowed: app.perms.publish && Boolean(t.draft),
        reason: !app.perms.publish ? 'Memerlukan izin Terbitkan/Arsipkan' : 'Tidak ada draf untuk diterbitkan',
      }));
      actions.push(button('Arsipkan…', { action: 'archive', id: t.id, lock: t.lockVersion, allowed: app.perms.publish, danger: true, reason: 'Memerlukan izin Terbitkan/Arsipkan' }));
    }

    const archivedBanner = t.archived ? `
      <div class="callout callout-muted" role="note">
        <p><strong>Diarsipkan</strong> pada ${timeTag(t.archived.at)} oleh ${esc(t.archived.by)}.
        Template tidak dapat dipakai untuk penggunaan baru dan tidak dapat diedit atau diterbitkan.
        Draf, versi terbit, dan riwayat tetap tersimpan.</p>
      </div>` : '';

    const tab = (key, label, enabled) => (enabled
      ? `<button type="button" class="seg${sel === key ? ' is-on' : ''}" aria-pressed="${sel === key}" data-action="detail-view" data-id="${t.id}" data-val="${key}">${label}</button>`
      : '');
    const tabs = `<div class="segmented-buttons" role="group" aria-label="Pilih dokumen">
      ${tab('published', latest ? `Versi terbit (Versi ${latest.number})` : '', Boolean(latest))}
      ${tab('draft', t.draft ? `Draf (revisi ${t.draft.revision})` : '', Boolean(t.draft))}
    </div>`;

    let meta;
    let doc;
    if (sel === 'published') {
      meta = `<strong>Versi ${latest.number}</strong> · diterbitkan ${timeTag(latest.publishedAt)} oleh ${esc(latest.publishedBy)} · judul dan isi dibekukan`;
      doc = documentHtml(latest.title, latest.content);
    } else {
      const d = t.draft;
      meta = `<strong>Draf revisi ${d.revision}</strong> · ${d.basedOnVersion ? `disalin dari Versi ${d.basedOnVersion}` : 'belum pernah diterbitkan'} · diperbarui ${timeTag(d.updatedAt)} oleh ${esc(d.updatedBy)}`;
      doc = documentHtml(d.title, d.content);
    }

    return `
      ${crumbs([{ label: 'Template', href: '#/' }, { label: t.internalName }])}
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">${esc(t.internalName)}</h1>
          <p class="lede"><code class="code">${esc(t.code)}</code> ${statusBadge(t)} <span class="muted">Diperbarui ${timeTag(t.updatedAt)}</span></p>
        </div>
        <div class="page-actions">${actions.join('')}</div>
      </div>
      ${permNotice()}
      ${archivedBanner}
      <div class="detail-grid">
        <section class="doc-panel" aria-labelledby="doc-h">
          <h2 id="doc-h" class="visually-hidden">Dokumen</h2>
          <div class="doc-toolbar">${tabs}${valuesToggle()}</div>
          <p class="doc-meta">${meta}</p>
          ${sel === 'draft' ? '<p class="doc-note">Menyimpan draf hanya menambah nomor revisi draf. Versi dokumen baru dibuat saat diterbitkan.</p>' : ''}
          ${doc}
        </section>
        <aside class="side">
          ${infoPanel(t)}
          ${historyPanel(t)}
        </aside>
      </div>`;
  }

  function infoPanel(t) {
    const latest = S.latestVersion(t);
    return `
      <section class="panel" aria-labelledby="info-h">
        <h2 id="info-h">Informasi</h2>
        <dl class="dl">
          <dt>Kode template</dt><dd><code class="code">${esc(t.code)}</code><br><span class="muted small">Permanen, tidak dapat diubah</span></dd>
          <dt>Status</dt><dd>${statusBadge(t)}</dd>
          <dt>Versi terbit terbaru</dt><dd>${latest ? `Versi ${latest.number}` : 'Belum ada'}</dd>
          <dt>Draf</dt><dd>${t.draft ? `Revisi ${t.draft.revision}${t.draft.basedOnVersion ? ` · dari Versi ${t.draft.basedOnVersion}` : ''}` : 'Tidak ada'}</dd>
          <dt>Dibuat</dt><dd>${timeTag(t.createdAt)}<br>oleh ${esc(t.createdBy)}</dd>
          ${t.archived ? `<dt>Diarsipkan</dt><dd>${timeTag(t.archived.at)}<br>oleh ${esc(t.archived.by)}</dd>` : ''}
        </dl>
      </section>`;
  }

  function historyPanel(t) {
    const items = t.versions.slice().reverse().map((v, i) => `
      <li>
        <div class="hist-top"><strong>Versi ${v.number}</strong>${i === 0 ? ' <span class="badge badge-accent">Terbaru</span>' : ''}</div>
        <div class="hist-meta">Diterbitkan ${timeTag(v.publishedAt)}<br>oleh ${esc(v.publishedBy)} · dari draf revisi ${v.fromRevision}</div>
        <a href="#/t/${esc(t.id)}/v/${v.number}">Lihat Versi ${v.number}</a>
      </li>`).join('');
    return `
      <section class="panel" aria-labelledby="hist-h">
        <h2 id="hist-h">Riwayat versi</h2>
        <p class="panel-note">Hanya baca. Versi terbit tidak dapat diubah atau dihapus.</p>
        ${items ? `<ul class="history">${items}</ul>` : '<p class="muted">Belum ada versi terbit.</p>'}
      </section>`;
  }

  /* ---------- Version view ---------- */

  function renderVersion(route) {
    const t = S.getTemplate(app.data, route.id);
    if (!t) return notFound('Template tidak ditemukan.');
    const v = t.versions.find((x) => x.number === route.number);
    if (!v) return notFound(`Versi ${route.number} tidak ditemukan untuk template ini.`);
    const prev = t.versions.find((x) => x.number === v.number - 1);
    const next = t.versions.find((x) => x.number === v.number + 1);
    return `
      ${crumbs([{ label: 'Template', href: '#/' }, { label: t.internalName, href: `#/t/${t.id}` }, { label: `Versi ${v.number}` }])}
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">${esc(t.internalName)} — Versi ${v.number}</h1>
          <p class="lede">Diterbitkan ${timeTag(v.publishedAt)} oleh ${esc(v.publishedBy)} · dari draf revisi ${v.fromRevision}</p>
        </div>
        <div class="page-actions">
          ${prev ? `<a class="btn" href="#/t/${t.id}/v/${prev.number}">← Versi ${prev.number}</a>` : ''}
          ${next ? `<a class="btn" href="#/t/${t.id}/v/${next.number}">Versi ${next.number} →</a>` : ''}
        </div>
      </div>
      <div class="callout callout-muted" role="note"><p>Versi terbit bersifat hanya baca. Judul dan isinya dibekukan saat diterbitkan.</p></div>
      <section class="doc-panel doc-panel-solo" aria-label="Dokumen Versi ${v.number}">
        <div class="doc-toolbar"><span></span>${valuesToggle()}</div>
        ${documentHtml(v.title, v.content)}
      </section>`;
  }

  /* ---------- Editor ---------- */

  function newEditorSession(t) {
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    if (!t) {
      const fields = { internalName: '', title: '', content: '' };
      return {
        key: 'create', templateId: null, code: S.generateCode(app.data),
        ...fields, orig: { ...fields }, baseRevision: null, basedOnVersion: null, lockVersion: null,
        attempted: false, conflict: null, recovered: null, savedAt: null, showPreview: wide,
      };
    }
    const latest = S.latestVersion(t);
    const src = t.draft || latest || { title: '', content: '' };
    const fields = { internalName: t.internalName, title: src.title, content: src.content };
    return {
      key: 'edit:' + t.id, templateId: t.id, code: t.code,
      ...fields, orig: { ...fields },
      // What this editor loaded. lockVersion guards every mutation; the draft
      // revision and source version are only shown to the admin.
      baseRevision: t.draft ? t.draft.revision : null,
      basedOnVersion: t.draft ? t.draft.basedOnVersion : (latest ? latest.number : null),
      lockVersion: t.lockVersion,
      attempted: false, conflict: null, recovered: null, savedAt: null, showPreview: wide,
    };
  }

  function renderEditor(route) {
    let t = null;
    if (route.name === 'edit') {
      t = S.getTemplate(app.data, route.id);
      if (!t) return notFound('Template tidak ditemukan.');
      if (t.archived) {
        return `
          ${crumbs([{ label: 'Template', href: '#/' }, { label: t.internalName, href: `#/t/${t.id}` }, { label: 'Edit' }])}
          <section class="state" aria-labelledby="page-title">
            <h1 id="page-title" tabindex="-1">Template diarsipkan</h1>
            <p>Template yang diarsipkan tidak dapat diedit. Draf dan riwayatnya tetap dapat dilihat.</p>
            <p><a class="btn" href="#/t/${esc(t.id)}">Lihat template</a></p>
          </section>`;
      }
    }
    if (!app.editor || app.editor.key !== editorKey(route)) app.editor = newEditorSession(t);
    const e = app.editor;
    const isNew = !e.templateId;
    const trail = [{ label: 'Template', href: '#/' }];
    if (t) trail.push({ label: t.internalName, href: `#/t/${t.id}` });
    trail.push({ label: isNew ? 'Buat template' : 'Edit draf' });

    const tool = (fmtKey, label, text) =>
      `<button type="button" class="tool" data-action="fmt" data-fmt="${fmtKey}" aria-label="${label}" title="${label}">${text}</button>`;
    const phItems = MD.PLACEHOLDERS.map((p) => `
      <button type="button" role="menuitem" class="ph-item" data-action="ph-insert" data-key="${esc(p.key)}">
        <code>{{${esc(p.key)}}}</code>
        <span class="ph-item-label">${esc(p.label)}${p.provisional ? ' <span class="badge badge-warn">Sementara</span>' : ''}</span>
        <span class="ph-item-desc">${esc(p.description)}</span>
      </button>`).join('');

    return `
      ${crumbs(trail)}
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">${isNew ? 'Buat Template' : 'Edit draf'}</h1>
          <p class="lede" id="draft-status"></p>
        </div>
        <div id="save-state" class="save-state" role="status"></div>
      </div>
      ${permNotice()}
      <div id="conflict-slot"></div>
      <div id="error-summary-slot"></div>
      <form id="editor-form" class="editor-form" novalidate>
        <div class="field-row">
          <div class="field">
            <label for="f-name">Nama internal <span class="req">wajib</span></label>
            <input id="f-name" type="text" autocomplete="off" aria-required="true" aria-describedby="hint-name err-internalName">
            <p class="hint" id="hint-name">Hanya terlihat oleh admin. Maksimal ${MD.LIMITS.internalName} karakter.</p>
            <p class="field-error" id="err-internalName"></p>
          </div>
          <div class="field field-code">
            <label for="f-code">Kode template</label>
            <input id="f-code" type="text" class="mono" readonly aria-describedby="hint-code">
            <p class="hint" id="hint-code">${isNew ? 'Dibuat otomatis saat pembuatan. Tidak dapat diubah.' : 'Kode unik permanen. Tidak dapat diubah.'}</p>
          </div>
        </div>
        <div class="field">
          <label for="f-title">Judul dokumen <span class="req">wajib</span></label>
          <input id="f-title" type="text" autocomplete="off" aria-required="true" aria-describedby="hint-title err-title">
          <p class="hint" id="hint-title">Teks biasa, tampil di atas dokumen. Dibekukan saat versi diterbitkan.</p>
          <p class="field-error" id="err-title"></p>
        </div>

        <div class="editor-grid" id="editor-grid">
          <div class="editor-col">
            <div class="label-row">
              <label for="f-content">Isi dokumen (Markdown) <span class="req">wajib</span></label>
              <span class="char-count" id="char-count"></span>
            </div>
            <div class="md-toolbar" role="toolbar" aria-label="Format Markdown">
              ${tool('h2', 'Judul bagian', 'H2')}${tool('h3', 'Subjudul', 'H3')}
              <span class="tool-sep" aria-hidden="true"></span>
              ${tool('bold', 'Tebal', '<strong>B</strong>')}${tool('italic', 'Miring', '<em>I</em>')}
              <span class="tool-sep" aria-hidden="true"></span>
              ${tool('ul', 'Daftar berpoin', '• Daftar')}${tool('ol', 'Daftar bernomor', '1. Daftar')}${tool('table', 'Tabel', 'Tabel')}
              <span class="tool-sep" aria-hidden="true"></span>
              <div class="ph-wrap">
                <button type="button" class="tool tool-ph" id="ph-btn" data-action="ph-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="ph-menu">Sisipkan Placeholder ▾</button>
                <div class="ph-menu" id="ph-menu" role="menu" aria-label="Katalog placeholder sistem" hidden>
                  ${phItems}
                  <p class="ph-foot">Katalog ditetapkan oleh sistem dan bersifat sementara. Variabel kustom tidak dapat dibuat.</p>
                </div>
              </div>
            </div>
            <textarea id="f-content" class="md-input" spellcheck="true" aria-required="true" placeholder="Tulis isi dokumen di sini. Contoh:&#10;&#10;## Ketentuan Umum&#10;&#10;Halo {{nama_lengkap}}, …" aria-describedby="content-help err-content"></textarea>
            <div id="err-content" class="content-issues"></div>
            <details class="format-help" id="content-help">
              <summary>Format yang didukung</summary>
              <ul>
                <li><code>## Judul</code>, <code>### Subjudul</code>, paragraf (pisahkan dengan baris kosong)</li>
                <li><code>**tebal**</code>, <code>*miring*</code></li>
                <li>Daftar <code>- item</code> dan daftar bernomor <code>1. item</code></li>
                <li>Tabel: baris diawali dan diakhiri <code>|</code>, baris kedua <code>|---|---|</code>; setiap baris harus memiliki jumlah kolom yang sama</li>
                <li>Placeholder hanya dari katalog sistem, mis. <code>{{nama_lengkap}}</code></li>
              </ul>
              <p><strong>Tidak didukung:</strong> HTML mentah, gambar, skrip, dan ekspresi. Nilai placeholder selalu tampil sebagai teks biasa.</p>
            </details>
          </div>
          <section class="preview-col" id="preview-col" aria-labelledby="preview-h">
            <div class="preview-head">
              <h2 id="preview-h">Pratinjau</h2>
              ${valuesToggle()}
            </div>
            <div id="preview-doc"></div>
          </section>
        </div>

        <div class="action-bar">
          <button type="submit" class="btn btn-primary" id="btn-save">Simpan Draft</button>
          <button type="button" class="btn" id="btn-preview" data-action="toggle-preview" aria-controls="preview-col">Pratinjau</button>
          <button type="button" class="btn" id="btn-publish" data-action="publish-from-editor" aria-describedby="publish-hint">Terbitkan…</button>
          <span class="action-hint" id="publish-hint"></span>
          <span class="spacer"></span>
          ${isNew ? '' : '<button type="button" class="btn btn-ghost" data-action="sim-conflict" title="Simulasi untuk mendemonstrasikan konflik edit bersamaan">Simulasi: admin lain menyimpan draf</button>'}
        </div>
      </form>`;
  }

  function bindEditor() {
    const e = app.editor;
    const form = $('#editor-form');
    if (!e || !form) return;
    const name = $('#f-name');
    const title = $('#f-title');
    const content = $('#f-content');
    name.value = e.internalName;
    title.value = e.title;
    content.value = e.content;
    $('#f-code').value = e.code;
    name.addEventListener('input', () => { e.internalName = name.value; updateEditorLive(); });
    title.addEventListener('input', () => { e.title = title.value; updateEditorLive(); });
    content.addEventListener('input', () => { e.content = content.value; updateEditorLive(); });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveDraft(); });
    form.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveDraft(); }
    });
    updateEditorLive();
  }

  function editorErrors(e) {
    return MD.validateDraft(e)
      .filter((er) => e.attempted || er.kind !== 'required');
  }

  function updateEditorLive() {
    const e = app.editor;
    if (!e || !$('#editor-form')) return;
    const t = e.templateId ? S.getTemplate(app.data, e.templateId) : null;
    const dirty = isDirty(e);
    const errors = editorErrors(e);

    // Status line: draft revision vs. document version.
    let status;
    if (!t) status = 'Template baru · belum disimpan';
    else if (e.baseRevision != null) {
      status = `Draf revisi ${e.baseRevision} · ${e.basedOnVersion ? `disalin dari Versi ${e.basedOnVersion}` : 'belum pernah diterbitkan'}`;
    } else if (e.basedOnVersion) {
      status = `Draf baru disalin dari Versi ${e.basedOnVersion} · dibuat saat pertama disimpan`;
    } else status = 'Draf';
    $('#draft-status').textContent = status + '. Menyimpan draf tidak membuat versi baru.';

    const saveState = $('#save-state');
    if (e.conflict) { saveState.className = 'save-state is-warn'; saveState.textContent = 'Konflik: draf berubah di tempat lain'; }
    else if (dirty) { saveState.className = 'save-state is-dirty'; saveState.textContent = '● Perubahan belum disimpan'; }
    else if (e.savedAt) { saveState.className = 'save-state is-saved'; saveState.textContent = `✓ Tersimpan pukul ${fmtTime(e.savedAt)} · revisi ${e.baseRevision}`; }
    else if (t && t.draft) { saveState.className = 'save-state'; saveState.textContent = `Tersimpan · revisi ${t.draft.revision}`; }
    else { saveState.className = 'save-state'; saveState.textContent = 'Belum disimpan'; }

    // Field errors.
    ['internalName', 'title'].forEach((field) => {
      const msgs = errors.filter((er) => er.field === field).map((er) => er.message);
      const el = $('#err-' + field);
      el.textContent = msgs.join(' ');
      $(field === 'internalName' ? '#f-name' : '#f-title').setAttribute('aria-invalid', String(msgs.length > 0));
    });
    const contentErrs = errors.filter((er) => er.field === 'content');
    const shown = contentErrs.slice(0, 8);
    setHtml($('#err-content'), contentErrs.length ? `
      <div class="issues" role="group" aria-label="Masalah isi dokumen">
        <ul>${shown.map((er) => `<li>${esc(er.message)}</li>`).join('')}</ul>
        ${contentErrs.length > shown.length ? `<p>+${contentErrs.length - shown.length} masalah lainnya</p>` : ''}
      </div>` : '');
    $('#f-content').setAttribute('aria-invalid', String(contentErrs.length > 0));
    $('#char-count').textContent = `${e.content.length.toLocaleString('id-ID')} / ${MD.LIMITS.content.toLocaleString('id-ID')} karakter`;

    // Error summary (only after a save attempt).
    setHtml($('#error-summary-slot'), e.attempted && errors.length ? `
      <div class="callout callout-danger" id="error-summary" tabindex="-1" role="alert" aria-labelledby="error-summary-h">
        <h2 id="error-summary-h">Draf belum dapat disimpan</h2>
        <p>Nama internal, judul dokumen, dan isi dokumen wajib diisi. Perbaiki ${errors.length} masalah berikut:</p>
        <ul>${errors.slice(0, 8).map((er) => `<li><button type="button" class="link-btn" data-action="focus-field" data-field="${er.field}">${esc(er.message)}</button></li>`).join('')}</ul>
      </div>` : '');

    setHtml($('#conflict-slot'), conflictHtml(e));

    // Preview.
    const grid = $('#editor-grid');
    grid.classList.toggle('with-preview', e.showPreview);
    $('#preview-col').hidden = !e.showPreview;
    $('#btn-preview').setAttribute('aria-pressed', String(e.showPreview));
    if (e.showPreview) $('#preview-doc').innerHTML = documentHtml(e.title.trim(), e.content);

    // Buttons.
    const saveBtn = $('#btn-save');
    saveBtn.disabled = !(dirty || !e.templateId) || Boolean(e.conflict);
    let reason = '';
    if (!app.perms.publish) reason = 'Memerlukan izin Terbitkan/Arsipkan.';
    else if (!t || !t.draft) reason = 'Simpan draf terlebih dahulu.';
    else if (dirty) reason = 'Simpan perubahan sebelum menerbitkan.';
    else if (e.conflict) reason = 'Selesaikan konflik terlebih dahulu.';
    $('#btn-publish').disabled = Boolean(reason);
    $('#publish-hint').textContent = reason;
  }

  function conflictHtml(e) {
    if (e.conflict) {
      const c = e.conflict;
      const what = c.published
        ? `${esc(c.by)} menerbitkan Versi ${c.versionCount} pada ${esc(fmt(c.at))}.`
        : `${esc(c.by)} menyimpan draf revisi ${c.revision} pada ${esc(fmt(c.at))}.`;
      return `
        <div class="callout callout-warn" role="alert">
          <h2>Draf telah diubah oleh admin lain</h2>
          <p>${what} Perubahan Anda belum disimpan.</p>
          <p>Muat ulang untuk melanjutkan dari data terbaru. Salinan isi Anda akan tetap ditampilkan agar dapat disalin kembali.</p>
          <p><button type="button" class="btn" data-action="reload-draft">Muat ulang draf terbaru</button></p>
        </div>`;
    }
    if (e.recovered) {
      return `
        <div class="callout callout-info" role="note">
          <h2>Draf terbaru telah dimuat</h2>
          <p>Editor kini berisi data terbaru. Isi Anda sebelum dimuat ulang tersedia di bawah (hanya baca).</p>
          <details>
            <summary>Lihat isi Anda sebelumnya</summary>
            <label for="recovered" class="small">Judul: ${esc(e.recovered.title) || '—'}</label>
            <textarea id="recovered" class="md-input recovered" readonly>\n${esc(e.recovered.content)}</textarea>
          </details>
          <p><button type="button" class="btn btn-ghost" data-action="dismiss-recovered">Tutup</button></p>
        </div>`;
    }
    return '';
  }

  function saveDraft() {
    const e = app.editor;
    if (!e) return;
    if (!app.perms.edit) { toast('Anda tidak memiliki izin Edit.', 'error'); return; }
    if (e.templateId && !isDirty(e)) return;
    e.attempted = true;
    const errors = MD.validateDraft(e);
    if (errors.length) {
      updateEditorLive();
      const summary = $('#error-summary');
      if (summary) summary.focus();
      return;
    }
    try {
      const t = S.saveDraft(app.data, {
        templateId: e.templateId, code: e.code, internalName: e.internalName,
        title: e.title, content: e.content,
        lockVersion: e.lockVersion,
      }, ACTOR, now());
      const wasNew = !e.templateId;
      e.templateId = t.id;
      e.key = 'edit:' + t.id;
      e.baseRevision = t.draft.revision;
      e.basedOnVersion = t.draft.basedOnVersion;
      e.lockVersion = t.lockVersion;
      e.internalName = t.internalName;
      e.title = t.draft.title;
      e.orig = { internalName: e.internalName, title: e.title, content: e.content };
      e.attempted = false;
      e.savedAt = t.draft.updatedAt;
      toast(`Draf tersimpan · revisi ${t.draft.revision}. Belum ada versi baru yang diterbitkan.`);
      if (wasNew) navigate(`#/t/${t.id}/edit`);
      else render();
    } catch (err) {
      handleStoreError(err);
    }
  }

  function handleStoreError(err) {
    if (!(err instanceof S.StoreError)) throw err;
    if (err.code === 'CONFLICT' && app.editor) {
      app.editor.conflict = err.details;
      render();
      const slot = $('#conflict-slot .callout');
      if (slot) slot.scrollIntoView({ block: 'nearest' });
      toast('Konflik: draf telah diubah oleh admin lain.', 'warn');
    } else if (err.code === 'CONFLICT') {
      toast('Template telah diubah oleh admin lain sejak Anda meninjaunya. Tidak ada yang diubah; tinjau data terbaru lalu coba lagi.', 'warn');
      render();
    } else if (err.code === 'ARCHIVED') {
      app.editor = null;
      toast(err.message, 'error');
      render();
    } else {
      toast(err.message, 'error');
    }
  }

  function reloadDraft() {
    const e = app.editor;
    const t = e && S.getTemplate(app.data, e.templateId);
    if (!t) return;
    const lost = { title: e.title, content: e.content };
    app.editor = newEditorSession(t);
    app.editor.showPreview = e.showPreview;
    app.editor.recovered = lost;
    render();
    toast('Draf terbaru dimuat.');
  }

  function applyFormat(kind) {
    const ta = $('#f-content');
    if (!ta) return;
    const { selectionStart: s, selectionEnd: end, value } = ta;
    const sel = value.slice(s, end);
    const wrap = (mark, fallback) => {
      const text = sel || fallback;
      ta.setRangeText(mark + text + mark, s, end, 'end');
      ta.setSelectionRange(s + mark.length, s + mark.length + text.length);
    };
    const prefixLines = (fn) => {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      let le = value.indexOf('\n', end);
      if (le === -1) le = value.length;
      const lines = value.slice(ls, le).split('\n')
        .map((l, i) => fn(l.replace(/^(#{1,6}\s+|\s*[-*+]\s+|\s*\d+[.)]\s+)/, ''), i));
      ta.setRangeText(lines.join('\n'), ls, le, 'end');
    };
    const block = (text) => {
      const before = value.slice(0, s);
      const pre = !before || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
      ta.setRangeText(pre + text + '\n', s, end, 'end');
    };
    switch (kind) {
      case 'bold': wrap('**', 'teks tebal'); break;
      case 'italic': wrap('*', 'teks miring'); break;
      case 'h2': prefixLines((l) => '## ' + (l || 'Judul bagian')); break;
      case 'h3': prefixLines((l) => '### ' + (l || 'Subjudul')); break;
      case 'ul': prefixLines((l) => '- ' + (l || 'Butir')); break;
      case 'ol': prefixLines((l, i) => `${i + 1}. ` + (l || 'Butir')); break;
      case 'table': block('| Kolom 1 | Kolom 2 |\n|---|---|\n| Isi | Isi |'); break;
      default: return;
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertPlaceholder(key) {
    const ta = $('#f-content');
    if (!ta) return;
    ta.setRangeText(`{{${key}}}`, ta.selectionStart, ta.selectionEnd, 'end');
    closePhMenu();
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openPhMenu() {
    const menu = $('#ph-menu');
    menu.hidden = false;
    $('#ph-btn').setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('[role="menuitem"]');
    if (first) first.focus();
  }

  function closePhMenu(returnFocus) {
    const menu = $('#ph-menu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    $('#ph-btn').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('#ph-btn').focus();
  }

  /* ---------- Publish / archive ---------- */

  function openModal({ title, body, confirmLabel, confirmClass, confirmDisabled, onConfirm }) {
    dialog.innerHTML = `
      <form method="dialog" class="modal">
        <h2 id="dlg-title">${esc(title)}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button value="cancel" class="btn">Batal</button>
          <button value="confirm" class="btn ${confirmClass || 'btn-primary'}"${confirmDisabled ? ' disabled' : ''}>${esc(confirmLabel)}</button>
        </div>
      </form>`;
    dialog.setAttribute('aria-labelledby', 'dlg-title');
    dialog.returnValue = '';
    dialog.onclose = () => { if (dialog.returnValue === 'confirm') onConfirm(); };
    dialog.showModal();
  }

  /**
   * `expectedLock` is the lockVersion the admin reviewed (editor or detail
   * page). It is checked now and again by the store when the admin confirms.
   */
  function openPublishModal(id, expectedLock) {
    const t = S.getTemplate(app.data, id);
    if (!t) return;
    if (!app.perms.publish) { toast('Anda tidak memiliki izin Terbitkan/Arsipkan.', 'error'); return; }
    try { S.assertLock(t, expectedLock); } catch (err) { handleStoreError(err); return; }
    if (!t.draft) return;
    const d = t.draft;
    const n = t.versions.length + 1;
    const errors = MD.validateDraft({ internalName: t.internalName, title: d.title, content: d.content });
    const previous = n === 1 ? 'Ini akan menjadi versi terbit pertama.'
      : `${n === 2 ? 'Versi 1' : `Versi 1–${n - 1}`} tetap tersimpan di riwayat.`;
    const body = `
      <p>Draf revisi ${d.revision} dari <strong>${esc(t.internalName)}</strong> (<code class="code">${esc(t.code)}</code>) akan diterbitkan sebagai <strong>Versi ${n}</strong>.</p>
      <div class="callout callout-accent">
        <p><strong>Penting:</strong> Menerbitkan hanya membuat versi ini tersedia untuk integrasi mendatang.
        Tindakan ini <strong>tidak</strong> menugaskan perjanjian kepada pengguna mana pun secara otomatis.</p>
      </div>
      <ul class="checklist">
        <li>Judul dan isi Versi ${n} dibekukan dan tidak dapat diubah.</li>
        <li>${previous}</li>
        <li>Draf ditutup. Edit berikutnya membuat draf baru yang disalin dari Versi ${n}.</li>
      </ul>
      <dl class="dl dl-compact"><dt>Judul dokumen</dt><dd>${d.title ? esc(d.title) : '—'}</dd></dl>
      ${errors.length ? `
        <div class="callout callout-danger" role="alert">
          <h3>Draf belum dapat diterbitkan</h3>
          <ul>${errors.slice(0, 8).map((er) => `<li>${esc(er.message)}</li>`).join('')}</ul>
          <p>Perbaiki di editor, simpan draf, lalu terbitkan kembali.</p>
        </div>` : ''}`;
    openModal({
      title: `Terbitkan Versi ${n}?`, body, confirmLabel: `Terbitkan Versi ${n}`,
      confirmDisabled: errors.length > 0,
      onConfirm: () => {
        try {
          const v = S.publishDraft(app.data, id, expectedLock, ACTOR, now());
          app.editor = null;
          app.detailView[id] = 'published';
          toast(`Versi ${v.number} diterbitkan dan tersedia untuk integrasi mendatang.`);
          navigate(`#/t/${id}`);
        } catch (err) {
          handleStoreError(err);
        }
      },
    });
  }

  function openArchiveModal(id, expectedLock) {
    const t = S.getTemplate(app.data, id);
    if (!t || t.archived) return;
    if (!app.perms.publish) { toast('Anda tidak memiliki izin Terbitkan/Arsipkan.', 'error'); return; }
    try { S.assertLock(t, expectedLock); } catch (err) { handleStoreError(err); return; }
    openModal({
      title: 'Arsipkan template?',
      body: `
        <p><strong>${esc(t.internalName)}</strong> (<code class="code">${esc(t.code)}</code>) akan diarsipkan.</p>
        <ul class="checklist">
          <li>Template tidak dapat dipakai untuk penggunaan baru.</li>
          <li>Template tidak dapat diedit atau diterbitkan lagi.</li>
          <li>Draf, semua versi terbit, dan riwayat tetap tersimpan dan dapat dilihat.</li>
          <li>Tidak ada data yang dihapus.</li>
        </ul>`,
      confirmLabel: 'Arsipkan', confirmClass: 'btn-danger',
      onConfirm: () => {
        try {
          S.archiveTemplate(app.data, id, expectedLock, ACTOR, now());
          toast('Template diarsipkan. Draf dan riwayat tetap tersimpan.');
          render();
        } catch (err) {
          handleStoreError(err);
        }
      },
    });
  }

  /* ---------- Toasts ---------- */

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'success');
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  /* ---------- Render ---------- */

  function view(route) {
    if (!app.perms.read) return deniedState('Baca', 'melihat template perjanjian');
    switch (route.name) {
      case 'list': return renderList();
      case 'detail': return renderDetail(route);
      case 'version': return renderVersion(route);
      case 'create': return app.perms.edit ? renderEditor(route) : deniedState('Edit', 'membuat template baru');
      case 'edit': return app.perms.edit ? renderEditor(route) : deniedState('Edit', 'mengedit draf');
      default: return notFound('Halaman tidak ditemukan.');
    }
  }

  function render(opts) {
    const active = document.activeElement;
    const activeId = active && active.id;
    let selection = null;
    try {
      if (active && typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd];
    } catch (_) { /* not a text control */ }

    const route = parseRoute();
    main.innerHTML = view(route);
    bindList();
    bindEditor();

    const heading = $('#page-title');
    document.title = (heading ? heading.textContent + ' · ' : '') + 'Template Perjanjian (Mockup)';
    if (opts && opts.nav) {
      window.scrollTo(0, 0);
      if (heading) heading.focus({ preventScroll: true });
    } else if (activeId) {
      const el = document.getElementById(activeId);
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        if (selection && el.setSelectionRange) {
          try { el.setSelectionRange(selection[0], selection[1]); } catch (_) { /* ignore */ }
        }
      }
    }
  }

  /* ---------- Global events ---------- */

  document.addEventListener('click', (ev) => {
    const wrap = ev.target.closest('.ph-wrap');
    if (!wrap) closePhMenu();
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const { action, id, val } = el.dataset;
    switch (action) {
      case 'skip': main.focus(); break;
      case 'clear-filters':
        app.list = { q: '', status: 'all', draftOnly: false };
        render();
        break;
      case 'detail-view': app.detailView[id] = val; render(); break;
      case 'show-values':
        app.showValues = val === '1';
        if (app.editor && $('#editor-form')) {
          document.querySelectorAll('[data-action="show-values"]').forEach((b) => {
            const on = (b.dataset.val === '1') === app.showValues;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', String(on));
          });
          updateEditorLive();
        } else render();
        break;
      case 'publish': openPublishModal(id, Number(el.dataset.lock)); break;
      case 'archive': openArchiveModal(id, Number(el.dataset.lock)); break;
      case 'publish-from-editor':
        if (app.editor) openPublishModal(app.editor.templateId, app.editor.lockVersion);
        break;
      case 'toggle-preview':
        app.editor.showPreview = !app.editor.showPreview;
        updateEditorLive();
        if (app.editor.showPreview && !window.matchMedia('(min-width: 1024px)').matches) {
          $('#preview-col').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      case 'fmt': applyFormat(el.dataset.fmt); break;
      case 'ph-toggle':
        if ($('#ph-menu').hidden) openPhMenu(); else closePhMenu(true);
        break;
      case 'ph-insert': insertPlaceholder(el.dataset.key); break;
      case 'focus-field': {
        const target = { internalName: '#f-name', title: '#f-title', content: '#f-content' }[el.dataset.field];
        if (target) $(target).focus();
        break;
      }
      case 'sim-conflict': {
        const e = app.editor;
        if (!e || !e.templateId) break;
        try {
          const t = S.simulateExternalEdit(app.data, e.templateId, OTHER_ADMIN, now());
          toast(`Simulasi: ${OTHER_ADMIN} menyimpan draf revisi ${t.draft.revision}. Ubah sesuatu lalu Simpan Draft untuk melihat konflik.`, 'warn');
          updateEditorLive();
        } catch (err) { handleStoreError(err); }
        break;
      }
      case 'reload-draft': reloadDraft(); break;
      case 'dismiss-recovered': app.editor.recovered = null; updateEditorLive(); break;
      case 'reset-data':
      case 'clear-data':
        if (isDirty(app.editor) && !window.confirm('Perubahan draf belum disimpan akan hilang. Lanjutkan?')) break;
        app.data = action === 'reset-data' ? S.createSeedState() : { nextId: 1, templates: [] };
        app.editor = null;
        app.detailView = {};
        app.list = { q: '', status: 'all', draftOnly: false };
        toast(action === 'reset-data' ? 'Data contoh dimuat ulang.' : 'Semua template contoh dikosongkan.');
        navigate('#/');
        break;
      default: break;
    }
  });

  document.addEventListener('keydown', (ev) => {
    const menu = $('#ph-menu');
    if (!menu || menu.hidden || !menu.contains(document.activeElement)) return;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const idx = items.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); closePhMenu(true); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    else if (ev.key === 'Tab') closePhMenu();
  });

  document.querySelectorAll('[data-perm]').forEach((box) => {
    box.checked = app.perms[box.dataset.perm];
    box.addEventListener('change', () => {
      app.perms[box.dataset.perm] = box.checked;
      render();
    });
  });

  render({ nav: false });
})();
