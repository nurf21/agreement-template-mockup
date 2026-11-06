/* UI for the agreement-template admin mockup. Local state only; no network. */
(function () {
  'use strict';

  const MD = window.AgreementMarkdown;
  const RT = window.AgreementRichText;
  const EditorLib = window.AgreementEditor || null;
  const S = window.AgreementStore;
  const U = window.AgreementUser;
  const esc = MD.escapeHtml;

  const ACTOR = 'Nadia Putri';
  const OTHER_ADMIN = 'Bagas Wirawan';
  const SAMPLE_LABEL = 'Contoh — bukan dokumen pengguna';

  const seedData = S.createSeedState();
  const app = {
    data: seedData,
    // User side: explicit assignments with immutable snapshots (separate from templates).
    user: U.createSeedUserState(seedData),
    simOpen: false,
    // Unconfirmed clause answers on the open user document: { assignmentId, answers }.
    // Never an acceptance; dropped on navigation.
    clauseDraft: null,
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
    if (parts[0] === 'saya') {
      if (parts.length === 1) return { name: 'user-list' };
      if (parts.length === 2) return { name: 'user-doc', id: parts[1] };
    }
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
    return Boolean(e) && !e.legacy && (
      e.internalName !== e.orig.internalName || e.title !== e.orig.title ||
      JSON.stringify(e.content) !== e.orig.content
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
    if (leaving) dropEditor();
    app.clauseDraft = null;
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

  const formatLabel = (rec) => (S.formatOf(rec) === RT.FORMAT
    ? `Editor visual (JSON v${rec.content.formatVersion})${rec.renderVersion ? ` · tata letak v${rec.renderVersion}` : ''}` : 'Markdown lama');

  /**
   * Document renderer for preview, draft view, and version view. Rich-text
   * records use the validated JSON renderer (also used for new user
   * snapshots); legacy Markdown records keep their original renderer.
   */
  function documentHtml(title, rec) {
    const values = app.showValues ? MD.SAMPLE_VALUES : null;
    const empty = '<p class="doc-empty">Belum ada isi dokumen.</p>';
    let body;
    if (S.formatOf(rec) === RT.FORMAT) {
      try {
        // Admin views label consent clauses as a simulation; nothing here records answers.
        body = RT.hasMeaningfulContent(rec.content) ? RT.renderDocument(rec.content, values, { preview: true }) : empty;
      } catch (_) {
        body = '<div class="md-invalid" role="note"><p>Pratinjau tidak dapat ditampilkan karena struktur isi dokumen tidak valid. Lihat daftar masalah isi dokumen.</p></div>';
      }
    } else {
      body = String(rec.content).trim() ? MD.renderMarkdown(rec.content, values) : empty;
    }
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
      const legacyDraft = t.draft && S.formatOf(t.draft) !== RT.FORMAT;
      actions.push(button('Terbitkan draf…', {
        action: 'publish', id: t.id, lock: t.lockVersion,
        allowed: app.perms.publish && Boolean(t.draft) && !legacyDraft,
        reason: !app.perms.publish ? 'Memerlukan izin Terbitkan/Arsipkan'
          : (legacyDraft ? 'Draf Markdown lama harus dikonversi ke editor visual terlebih dahulu' : 'Tidak ada draf untuk diterbitkan'),
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
      meta = `<strong>Versi ${latest.number}</strong> · diterbitkan ${timeTag(latest.publishedAt)} oleh ${esc(latest.publishedBy)} · judul dan isi dibekukan · format ${esc(formatLabel(latest))}`;
      doc = documentHtml(latest.title, latest);
    } else {
      const d = t.draft;
      meta = `<strong>Draf revisi ${d.revision}</strong> · ${d.basedOnVersion ? `disalin dari Versi ${d.basedOnVersion}` : 'belum pernah diterbitkan'} · diperbarui ${timeTag(d.updatedAt)} oleh ${esc(d.updatedBy)} · format ${esc(formatLabel(d))}${d.convertedFrom ? ` · dikonversi dari Markdown ${d.convertedFrom.version ? `Versi ${d.convertedFrom.version}` : `draf revisi ${d.convertedFrom.draftRevision}`}` : ''}`;
      doc = documentHtml(d.title, d);
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
      <div class="callout callout-muted" role="note"><p>Versi terbit bersifat hanya baca. Judul dan isinya dibekukan saat diterbitkan.
        Format: ${esc(formatLabel(v))}.${S.formatOf(v) === 'markdown' ? ' Versi ini ditampilkan dengan renderer Markdown aslinya dan tidak dikonversi otomatis.' : ''}</p></div>
      <section class="doc-panel doc-panel-solo" aria-label="Dokumen Versi ${v.number}">
        <div class="doc-toolbar"><span></span>${valuesToggle()}</div>
        ${documentHtml(v.title, v)}
      </section>`;
  }

  /* ---------- Editor ---------- */

  const contentKey = (c) => JSON.stringify(c);
  const origOf = (f) => ({ internalName: f.internalName, title: f.title, content: contentKey(f.content) });

  function newEditorSession(t) {
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    const common = {
      attempted: false, conflict: null, recovered: null, savedAt: null, showPreview: wide,
      rte: null, legacy: null, convertErrors: null,
    };
    if (!t) {
      const fields = { internalName: '', title: '', content: RT.emptyContent() };
      return {
        ...common, key: 'create', templateId: null, code: S.generateCode(app.data),
        ...fields, orig: origOf(fields), baseRevision: null, basedOnVersion: null, lockVersion: null,
      };
    }
    const latest = S.latestVersion(t);
    const src = t.draft || latest;
    // Legacy Markdown is never opened in the visual editor; the admin converts it explicitly.
    const legacy = src && S.formatOf(src) === 'markdown'
      ? { draft: Boolean(t.draft), label: t.draft ? `Draf revisi ${t.draft.revision}` : `Versi ${latest.number}` }
      : null;
    const fields = {
      internalName: t.internalName,
      title: src ? src.title : '',
      content: src && !legacy ? src.content : RT.emptyContent(),
    };
    return {
      ...common, key: 'edit:' + t.id, templateId: t.id, code: t.code, legacy,
      ...fields, orig: origOf(fields),
      // What this editor loaded. lockVersion guards every mutation; the draft
      // revision and source version are only shown to the admin.
      baseRevision: t.draft ? t.draft.revision : null,
      basedOnVersion: t.draft ? t.draft.basedOnVersion : (latest ? latest.number : null),
      lockVersion: t.lockVersion,
    };
  }

  function dropEditor() {
    if (app.editor && app.editor.rte) app.editor.rte.destroy();
    app.editor = null;
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
    if (!app.editor || app.editor.key !== editorKey(route)) {
      dropEditor();
      app.editor = newEditorSession(t);
    }
    const e = app.editor;
    if (e.legacy) return renderConvert(t, e);
    const isNew = !e.templateId;
    const trail = [{ label: 'Template', href: '#/' }];
    if (t) trail.push({ label: t.internalName, href: `#/t/${t.id}` });
    trail.push({ label: isNew ? 'Buat template' : 'Edit draf' });

    const phItems = MD.PLACEHOLDERS.map((p) => `
      <button type="button" role="menuitem" class="ph-item" data-action="ph-insert" data-key="${esc(p.key)}">
        <span class="ph-item-label"><span class="ph-chip">${esc(p.label)}</span>${p.provisional ? ' <span class="badge badge-warn">Sementara</span>' : ''}</span>
        <span class="ph-item-desc">${esc(p.description)} Kunci sistem: <code>${esc(p.key)}</code></span>
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
          <p class="hint" id="hint-title">Teks biasa, tampil di atas dokumen. Maksimal ${MD.LIMITS.title} karakter. Dibekukan saat versi diterbitkan.</p>
          <p class="field-error" id="err-title"></p>
        </div>

        <div class="editor-grid" id="editor-grid">
          <div class="editor-col">
            <div class="label-row">
              <span class="field-label" id="content-label">Isi dokumen <span class="req">wajib</span></span>
              <span class="char-count" id="char-count"></span>
            </div>
            <div class="rte" id="rte">
              ${toolbarHtml(phItems)}
              <div id="rte-mount"></div>
            </div>
            <div id="err-content" class="content-issues"></div>
            <details class="format-help" id="content-help">
              <summary>Format yang didukung dan pintasan keyboard</summary>
              <ul>
                <li>Paragraf, judul bagian, dan subjudul</li>
                <li>Tebal (<kbd>Ctrl</kbd>+<kbd>B</kbd>), miring (<kbd>Ctrl</kbd>+<kbd>I</kbd>), garis bawah (<kbd>Ctrl</kbd>+<kbd>U</kbd>)</li>
                <li>Rata kiri, tengah, kanan (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>/<kbd>E</kbd>/<kbd>R</kbd>)</li>
                <li>Daftar berpoin dan bernomor; <kbd>Tab</kbd>/<kbd>Shift</kbd>+<kbd>Tab</kbd> mengubah tingkat butir</li>
                <li>Tabel dengan baris header; di dalam tabel <kbd>Tab</kbd> berpindah sel</li>
                <li>Tabel label–nilai: dua kolom tetap (label di kiri, nilai di kanan), baris dapat ditambah/dihapus, lebar kolom label 20%, 25%, atau 30%. Kolom tidak dapat ditambah, dihapus, atau digabung.</li>
                <li>Klausul persetujuan: judul (teks biasa), penjelasan (paragraf dan daftar), dan pengaturan “Wajib dijawab Ya” (aktif secara bawaan). Pilihan jawaban selalu “Tidak” dan “Ya” tanpa jawaban bawaan. ID klausul dibuat otomatis; klausul tidak dapat ditempatkan di dalam klausul, daftar, atau tabel. <kbd>Enter</kbd> pada judul berpindah ke penjelasan.</li>
                <li>Urungkan (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) dan ulangi (<kbd>Ctrl</kbd>+<kbd>Y</kbd>)</li>
                <li>Placeholder hanya dari katalog sistem, tampil sebagai label (mis. “Nama lengkap”). Placeholder dapat disisipkan atau dihapus, tetapi kuncinya tidak dapat diubah.</li>
                <li><kbd>Esc</kbd> atau <kbd>Alt</kbd>+<kbd>F10</kbd>: pindah ke toolbar. Di toolbar, gunakan tombol panah; <kbd>Esc</kbd> kembali ke isi dokumen.</li>
              </ul>
              <p><strong>Tidak didukung:</strong> gambar, tautan, skrip, gaya/warna, dan sel gabungan. Isi tempelan dibatasi ke format di atas. Nilai placeholder selalu tampil sebagai teks biasa.</p>
              <p>Isi disimpan sebagai JSON terstruktur (format <code>${RT.FORMAT}</code> versi ${RT.FORMAT_VERSIONS.join(', ')}; versi 2 bila dokumen memuat tabel label–nilai, versi 3 bila memuat klausul persetujuan). Ukuran maksimal ${RT.LIMITS.contentJson.toLocaleString('id-ID')} karakter JSON; isi tidak pernah dipotong otomatis.</p>
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

  /** Legacy Markdown source: explain, then offer the explicit conversion. */
  function renderConvert(t, e) {
    const src = t.draft || S.latestVersion(t);
    const what = e.legacy.label;
    const errors = e.convertErrors;
    return `
      ${crumbs([{ label: 'Template', href: '#/' }, { label: t.internalName, href: `#/t/${t.id}` }, { label: 'Edit draf' }])}
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">Edit draf</h1>
          <p class="lede">${esc(what)} memakai format Markdown lama.</p>
        </div>
      </div>
      ${permNotice()}
      <section class="callout callout-info convert-panel" aria-labelledby="convert-h">
        <h2 id="convert-h">Lanjutkan di editor visual</h2>
        <p>Editor visual menyimpan isi sebagai JSON terstruktur. “Buat draf editor visual” membuat <strong>salinan JSON yang dapat diedit</strong> dari ${esc(what)}.</p>
        <ul class="checklist">
          <li>${e.legacy.draft
            ? 'Isi draf Markdown diganti dengan salinan JSON yang setara, dan nomor revisi draf bertambah.'
            : `${esc(what)} tetap tersimpan tanpa perubahan dan tetap ditampilkan dengan format aslinya.`}</li>
          <li>Versi terbit serta dokumen yang sudah ditugaskan atau disetujui pengguna tidak diubah.</li>
          <li>Teks, format, tabel, dan placeholder dipertahankan. Jika ada isi yang tidak dapat dipertahankan persis, tidak ada yang disimpan.</li>
        </ul>
        <p><button type="button" class="btn btn-primary" data-action="convert-legacy">Buat draf editor visual</button>
          <a class="btn" href="#/t/${esc(t.id)}">Batal</a></p>
      </section>
      ${errors ? `
        <div class="callout callout-danger" id="convert-error" tabindex="-1" role="alert" aria-labelledby="convert-error-h">
          <h2 id="convert-error-h">Konversi gagal — tidak ada yang disimpan</h2>
          <p>${esc(what)} tidak dapat dikonversi tanpa mengubah isinya:</p>
          <ul>${errors.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
          <p>Dokumen asli tidak berubah dan tetap dapat dibaca. Template ini belum dapat diedit di editor visual.</p>
        </div>` : ''}
      <section class="doc-panel doc-panel-solo" aria-label="Dokumen asli (hanya baca)">
        <p class="doc-meta">Dokumen asli · ${esc(what)} · ${esc(formatLabel(src))} · hanya baca</p>
        ${documentHtml(src.title, src)}
      </section>`;
  }

  function convertLegacy() {
    const e = app.editor;
    if (!e || !e.legacy) return;
    if (!app.perms.edit) { toast('Anda tidak memiliki izin Edit.', 'error'); return; }
    try {
      const t = S.convertLegacyDraft(app.data, e.templateId, e.lockVersion, ACTOR, now());
      app.editor = newEditorSession(t);
      toast(`Draf editor visual dibuat · revisi ${t.draft.revision}. ${e.legacy.draft ? 'Versi terbit' : e.legacy.label} tidak berubah.`);
      render();
    } catch (err) {
      if (err instanceof S.StoreError && err.code === 'CONVERSION_FAILED') {
        e.convertErrors = err.details.errors;
        render();
        const box = $('#convert-error');
        if (box) box.focus();
      } else if (err instanceof S.StoreError && err.code === 'CONFLICT') {
        dropEditor();
        toast('Template telah diubah oleh admin lain. Data terbaru dimuat; tidak ada yang dikonversi.', 'warn');
        render();
      } else handleStoreError(err);
    }
  }

  /* Toolbar: grouped controls, WAI-ARIA toolbar with roving tabindex. */

  const ICONS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    bulletList: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    orderedList: '<path d="M10 6h10M10 12h10M10 18h10M4 4h1.5v4M4 8h3M4 14.5c0-1 2.5-1.5 2.5 0S4 17 4 18h3"/>',
    insertTable: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>',
    insertClause: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8" cy="15" r="2"/><circle cx="16" cy="15" r="2"/><path d="M6 8.5h12"/>',
    insertKvTable: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.5h18M3 15h18M9 4v16"/><path d="M4.5 6.8h3M4.5 12.3h3M4.5 17.6h3" stroke-width="1.4"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

  const inTable = (ed) => ed.isActive('table');
  const inList = (ed) => ed.isActive('listItem');
  const inKv = (ed) => ed.isActive('table', { preset: 'labelValue' });
  const inClause = (ed) => ed.isActive('consentClause');
  const kvWidth = (n) => ({ run: (c) => c.setLabelWidth(n), active: (ed) => ed.isActive('table', { preset: 'labelValue', labelWidth: n }), kv: true });
  // `run` receives a Tiptap chain; `active` (toggle buttons only) sets aria-pressed.
  const COMMANDS = {
    undo: { run: (c) => c.undo() },
    redo: { run: (c) => c.redo() },
    paragraph: { run: (c) => c.setParagraph(), active: (ed) => ed.isActive('paragraph') },
    h2: { run: (c) => c.toggleHeading({ level: 2 }), active: (ed) => ed.isActive('heading', { level: 2 }), block: true },
    h3: { run: (c) => c.toggleHeading({ level: 3 }), active: (ed) => ed.isActive('heading', { level: 3 }), block: true },
    bold: { run: (c) => c.toggleBold(), active: (ed) => ed.isActive('bold') },
    italic: { run: (c) => c.toggleItalic(), active: (ed) => ed.isActive('italic') },
    underline: { run: (c) => c.toggleUnderline(), active: (ed) => ed.isActive('underline') },
    alignLeft: {
      run: (c) => c.setTextAlign('left'),
      active: (ed) => !ed.isActive({ textAlign: 'center' }) && !ed.isActive({ textAlign: 'right' }),
    },
    alignCenter: { run: (c) => c.setTextAlign('center'), active: (ed) => ed.isActive({ textAlign: 'center' }) },
    alignRight: { run: (c) => c.setTextAlign('right'), active: (ed) => ed.isActive({ textAlign: 'right' }) },
    bulletList: { run: (c) => c.toggleBulletList(), active: (ed) => ed.isActive('bulletList') },
    orderedList: { run: (c) => c.toggleOrderedList(), active: (ed) => ed.isActive('orderedList') },
    insertTable: { run: (c) => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }), block: true },
    addRowAfter: { run: (c) => c.addRowAfter(), table: true },
    deleteRow: { run: (c) => c.deleteRow(), table: true },
    // Column and header controls apply to ordinary tables only (`plain`).
    addColumnAfter: { run: (c) => c.addColumnAfter(), table: true, plain: true },
    deleteColumn: { run: (c) => c.deleteColumn(), table: true, plain: true },
    toggleHeaderRow: { run: (c) => c.toggleHeaderRow(), active: (ed) => inTable(ed) && !inKv(ed) && ed.isActive('tableHeader'), table: true, plain: true },
    deleteTable: { run: (c) => c.deleteTable(), table: true },
    insertKvTable: { run: (c) => c.insertLabelValueTable(), block: true },
    kvWidth20: kvWidth(20),
    kvWidth25: kvWidth(25),
    kvWidth30: kvWidth(30),
    insertClause: { run: (c) => c.insertConsentClause(), block: true },
    clauseRequired: { run: (c) => c.toggleClauseRequired(), active: (ed) => ed.isActive('consentClause', { required: true }), clause: true },
    deleteClause: { run: (c) => c.deleteConsentClause(), clause: true },
  };

  function canRun(ed, key) {
    const spec = COMMANDS[key];
    if (spec.block && (inTable(ed) || inList(ed) || inClause(ed))) return false;
    if (spec.clause && !inClause(ed)) return false;
    if (spec.table && !inTable(ed)) return false;
    if (spec.plain && inKv(ed)) return false;
    if (spec.kv && !inKv(ed)) return false;
    return spec.run(ed.can().chain()).run();
  }

  function toolbarHtml(phItems) {
    const tool = (key, label, inner, shortcut) => {
      const toggle = COMMANDS[key].active ? ' aria-pressed="false"' : '';
      const keys = shortcut ? ` aria-keyshortcuts="${shortcut.aria}"` : '';
      const tip = shortcut ? `${label} (${shortcut.text})` : label;
      return `<button type="button" class="tool" tabindex="-1" data-action="fmt" data-fmt="${key}" aria-label="${label}" title="${tip}"${toggle}${keys}>${inner}</button>`;
    };
    const sc = (aria, text) => ({ aria, text });
    const group = (label, items) => `<div class="tool-group" role="group" aria-label="${label}">${items}</div>`;
    return `
      <div class="rte-toolbar" role="toolbar" aria-label="Format dokumen" aria-controls="f-content">
        ${group('Riwayat', tool('undo', 'Urungkan', icon('undo'), sc('Control+Z', 'Ctrl+Z')) + tool('redo', 'Ulangi', icon('redo'), sc('Control+Y', 'Ctrl+Y')))}
        ${group('Jenis blok', tool('paragraph', 'Paragraf', '¶') + tool('h2', 'Judul bagian', 'H2', sc('Control+Alt+2', 'Ctrl+Alt+2')) + tool('h3', 'Subjudul', 'H3', sc('Control+Alt+3', 'Ctrl+Alt+3')))}
        ${group('Format teks', tool('bold', 'Tebal', '<strong>B</strong>', sc('Control+B', 'Ctrl+B')) + tool('italic', 'Miring', '<em>I</em>', sc('Control+I', 'Ctrl+I')) + tool('underline', 'Garis bawah', '<u>U</u>', sc('Control+U', 'Ctrl+U')))}
        ${group('Perataan', tool('alignLeft', 'Rata kiri', icon('alignLeft'), sc('Control+Shift+L', 'Ctrl+Shift+L')) + tool('alignCenter', 'Rata tengah', icon('alignCenter'), sc('Control+Shift+E', 'Ctrl+Shift+E')) + tool('alignRight', 'Rata kanan', icon('alignRight'), sc('Control+Shift+R', 'Ctrl+Shift+R')))}
        ${group('Daftar', tool('bulletList', 'Daftar berpoin', icon('bulletList'), sc('Control+Shift+8', 'Ctrl+Shift+8')) + tool('orderedList', 'Daftar bernomor', icon('orderedList'), sc('Control+Shift+7', 'Ctrl+Shift+7')))}
        ${group('Tabel', tool('insertTable', 'Sisipkan tabel', icon('insertTable')) +
          tool('addRowAfter', 'Tambah baris di bawah', '+ Baris') + tool('deleteRow', 'Hapus baris', '− Baris') +
          tool('addColumnAfter', 'Tambah kolom di kanan', '+ Kolom') + tool('deleteColumn', 'Hapus kolom', '− Kolom') +
          tool('toggleHeaderRow', 'Baris header', 'Header') + tool('deleteTable', 'Hapus tabel', 'Hapus tabel'))}
        ${group('Tabel label–nilai', tool('insertKvTable', 'Tabel label–nilai', icon('insertKvTable') + '<span class="tool-text">Tabel label–nilai</span>') +
          tool('kvWidth20', 'Lebar kolom label 20%', '20%') + tool('kvWidth25', 'Lebar kolom label 25%', '25%') + tool('kvWidth30', 'Lebar kolom label 30%', '30%'))}
        ${group('Klausul persetujuan', tool('insertClause', 'Klausul persetujuan', icon('insertClause') + '<span class="tool-text">Klausul persetujuan</span>') +
          tool('clauseRequired', 'Wajib dijawab Ya', 'Wajib dijawab Ya') + tool('deleteClause', 'Hapus klausul', 'Hapus klausul'))}
        <div class="tool-group" role="group" aria-label="Placeholder">
          <div class="ph-wrap">
            <button type="button" class="tool tool-ph" tabindex="-1" id="ph-btn" data-action="ph-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="ph-menu">Sisipkan placeholder ▾</button>
            <div class="ph-menu" id="ph-menu" role="menu" aria-label="Katalog placeholder sistem" hidden>
              ${phItems}
              <p class="ph-foot">Katalog ditetapkan oleh sistem dan bersifat sementara. Variabel kustom tidak dapat dibuat.</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  const toolbarItems = () => Array.from(document.querySelectorAll('.rte-toolbar .tool'));

  function setRoving(target) {
    toolbarItems().forEach((b) => { b.tabIndex = b === target ? 0 : -1; });
    app.editor.toolFocus = target.dataset.fmt || target.id;
  }

  function focusToolbar() {
    const items = toolbarItems();
    const current = items.find((b) => b.tabIndex === 0) || items[0];
    if (current) current.focus();
  }

  function updateToolbar() {
    const e = app.editor;
    if (!e || !e.rte || !$('.rte-toolbar')) return;
    const ed = e.rte;
    toolbarItems().forEach((b) => {
      const key = b.dataset.fmt;
      if (!key) return;
      const spec = COMMANDS[key];
      const enabled = canRun(ed, key);
      b.setAttribute('aria-disabled', String(!enabled));
      if (spec.active) {
        const on = enabled && spec.active(ed);
        b.setAttribute('aria-pressed', String(on));
      }
    });
    // Keep exactly one toolbar tab stop, remembered across re-renders.
    const items = toolbarItems();
    const keep = items.find((b) => (b.dataset.fmt || b.id) === e.toolFocus) || items[0];
    items.forEach((b) => { b.tabIndex = b === keep ? 0 : -1; });
  }

  function runCommand(key, button) {
    const e = app.editor;
    if (!e || !e.rte || !COMMANDS[key]) return;
    if (button) setRoving(button);
    if (!canRun(e.rte, key)) return;
    COMMANDS[key].run(e.rte.chain().focus()).run();
  }

  function mountRichText(e) {
    const mount = $('#rte-mount');
    if (!mount) return;
    if (!EditorLib) {
      mount.innerHTML = '<div class="callout callout-danger" role="alert"><p>Editor visual belum dibangun. Jalankan <code>npm install</code> dan <code>npm run build</code>, lalu muat ulang halaman.</p></div>';
      return;
    }
    if (!e.rte) {
      const holder = document.createElement('div');
      holder.className = 'rte-holder';
      e.rte = EditorLib.createEditor({
        element: holder,
        content: JSON.parse(JSON.stringify(e.content.document)),
        catalogue: MD.PLACEHOLDERS,
        attributes: {
          id: 'f-content', class: 'rte-content', role: 'textbox', 'aria-multiline': 'true',
          'aria-labelledby': 'content-label', 'aria-describedby': 'content-help err-content', 'aria-required': 'true',
        },
        onUpdate: (json) => {
          if (app.editor !== e) return;
          e.content = RT.wrap(json);
          updateEditorLive();
        },
        onTransaction: () => { if (app.editor === e) updateToolbar(); },
        onFocusToolbar: focusToolbar,
        onRejectPreset: () => toast('Perubahan ditolak: tabel label–nilai harus tetap dua kolom (label dan nilai) tanpa sel gabungan.', 'error'),
      });
      // Adopt the editor's normalized JSON (explicit default attributes) so
      // merely loading a document does not count as an unsaved change.
      const normalized = RT.wrap(e.rte.getJSON());
      if (contentKey(e.content) === e.orig.content) e.orig.content = contentKey(normalized);
      e.content = normalized;
    }
    // The editor instance (and its undo history) survives page re-renders.
    mount.replaceWith(e.rte.options.element);
    const toolbar = $('.rte-toolbar');
    // Keep the editor selection when a toolbar button is clicked with the mouse.
    toolbar.addEventListener('mousedown', (ev) => { if (ev.target.closest('.tool')) ev.preventDefault(); });
    toolbar.addEventListener('focusin', (ev) => { const b = ev.target.closest('.tool'); if (b) setRoving(b); });
  }

  function bindEditor() {
    const e = app.editor;
    const form = $('#editor-form');
    if (!e || !form) return;
    const name = $('#f-name');
    const title = $('#f-title');
    name.value = e.internalName;
    title.value = e.title;
    $('#f-code').value = e.code;
    mountRichText(e);
    name.addEventListener('input', () => { e.internalName = name.value; updateEditorLive(); });
    title.addEventListener('input', () => { e.title = title.value; updateEditorLive(); });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveDraft(); });
    form.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveDraft(); }
    });
    updateEditorLive();
  }

  function editorErrors(e) {
    return RT.validateDraft(e)
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
    const area = $('#f-content');
    if (area) area.setAttribute('aria-invalid', String(contentErrs.length > 0));
    const size = RT.contentSize(e.content);
    const count = $('#char-count');
    count.textContent = `Ukuran isi: ${size.toLocaleString('id-ID')} / ${RT.LIMITS.contentJson.toLocaleString('id-ID')} karakter JSON`;
    count.classList.toggle('is-over', size > RT.LIMITS.contentJson);

    // Error summary (only after a save attempt).
    setHtml($('#error-summary-slot'), e.attempted && errors.length ? `
      <div class="callout callout-danger" id="error-summary" tabindex="-1" role="alert" aria-labelledby="error-summary-h">
        <h2 id="error-summary-h">Draf belum dapat disimpan</h2>
        <p>Nama internal, judul dokumen, dan isi dokumen wajib diisi. Perbaiki ${errors.length} masalah berikut:</p>
        <ul>${errors.slice(0, 8).map((er) => `<li><button type="button" class="link-btn" data-action="focus-field" data-field="${er.field}">${esc(er.message)}</button></li>`).join('')}</ul>
      </div>` : '');

    setHtml($('#conflict-slot'), conflictHtml(e));

    // Preview: the same validated JSON renderer used for user snapshots.
    const grid = $('#editor-grid');
    grid.classList.toggle('with-preview', e.showPreview);
    $('#preview-col').hidden = !e.showPreview;
    $('#btn-preview').setAttribute('aria-pressed', String(e.showPreview));
    if (e.showPreview) setHtml($('#preview-doc'), documentHtml(e.title.trim(), { format: RT.FORMAT, content: e.content }));

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
    updateToolbar();
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
          <p>Muat ulang untuk melanjutkan dari data terbaru. Teks Anda akan tetap ditampilkan agar dapat disalin kembali.</p>
          <p><button type="button" class="btn" data-action="reload-draft">Muat ulang draf terbaru</button></p>
        </div>`;
    }
    if (e.recovered) {
      return `
        <div class="callout callout-info" role="note">
          <h2>Draf terbaru telah dimuat</h2>
          <p>Editor kini berisi data terbaru. Teks Anda sebelum dimuat ulang tersedia di bawah (hanya baca, tanpa format).</p>
          <details>
            <summary>Lihat isi Anda sebelumnya</summary>
            <label for="recovered" class="small">Judul: ${esc(e.recovered.title) || '—'}</label>
            <textarea id="recovered" class="md-input recovered" readonly>\n${esc(e.recovered.text)}</textarea>
          </details>
          <p><button type="button" class="btn btn-ghost" data-action="dismiss-recovered">Tutup</button></p>
        </div>`;
    }
    return '';
  }

  function saveDraft() {
    const e = app.editor;
    if (!e || e.legacy) return;
    if (!app.perms.edit) { toast('Anda tidak memiliki izin Edit.', 'error'); return; }
    if (e.templateId && !isDirty(e)) return;
    e.attempted = true;
    const errors = RT.validateDraft(e);
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
      e.orig = origOf(e);
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
    if (err.code === 'CONFLICT' && app.editor && !app.editor.legacy) {
      app.editor.conflict = err.details;
      render();
      const slot = $('#conflict-slot .callout');
      if (slot) slot.scrollIntoView({ block: 'nearest' });
      toast('Konflik: draf telah diubah oleh admin lain.', 'warn');
    } else if (err.code === 'CONFLICT') {
      toast('Template telah diubah oleh admin lain sejak Anda meninjaunya. Tidak ada yang diubah; tinjau data terbaru lalu coba lagi.', 'warn');
      render();
    } else if (err.code === 'ARCHIVED') {
      dropEditor();
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
    const lost = { title: e.title, text: RT.plainText(e.content) };
    dropEditor();
    app.editor = newEditorSession(t);
    app.editor.showPreview = e.showPreview;
    app.editor.recovered = lost;
    render();
    toast('Draf terbaru dimuat.');
  }

  function insertPlaceholder(key) {
    const e = app.editor;
    closePhMenu();
    if (!e || !e.rte) return;
    e.rte.chain().focus().insertVariable(key).run();
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
    const errors = S.formatOf(d) === RT.FORMAT
      ? S.validateRecord(t.internalName, d)
      : [{ message: 'Draf Markdown lama harus dikonversi ke editor visual terlebih dahulu (Edit draf → Buat draf editor visual).' }];
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
          dropEditor();
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

  /* ---------- User side (simulated user) ---------- */

  const CONSENT_LABEL = 'Saya telah membaca dan menyetujui perjanjian ini.';
  const phLabel = (key) => (MD.PLACEHOLDERS.find((p) => p.key === key) || { label: key }).label;

  function userBadge(acceptance) {
    return acceptance
      ? '<span class="badge badge-success">Sudah disetujui</span>'
      : '<span class="badge badge-warn">Belum disetujui</span>';
  }

  function userNotFound() {
    return `
      <section class="state" aria-labelledby="page-title">
        <h1 id="page-title" tabindex="-1">Perjanjian tidak ditemukan</h1>
        <p>Perjanjian ini tidak ditugaskan kepada Anda.</p>
        <p><a class="btn" href="#/saya">Kembali ke Perjanjian Saya</a></p>
      </section>`;
  }

  function renderUserList() {
    const items = U.listForUser(app.user)
      .slice().sort((a, b) => b.assignment.assignedAt.localeCompare(a.assignment.assignedAt));
    const pending = items.filter((x) => !x.acceptance);
    const done = items.filter((x) => x.acceptance)
      .sort((a, b) => b.acceptance.acceptedAt.localeCompare(a.acceptance.acceptedAt));

    const card = ({ assignment: a, acceptance: acc }) => {
      const s = a.snapshot;
      return `
        <li class="agr-card">
          <a class="agr-link" href="#/saya/${esc(a.id)}">${esc(s.title)}<span class="visually-hidden">, Versi ${s.templateVersion}</span></a>
          <p class="agr-meta"><span>Versi ${s.templateVersion}</span>${userBadge(acc)}</p>
          <p class="agr-sub">${acc ? `Disetujui ${timeTag(acc.acceptedAt)}` : `Ditugaskan ${timeTag(a.assignedAt)}`}</p>
          ${!acc && s.missing.length ? '<p class="agr-warn">Dokumen tidak tersedia: data profil belum lengkap.</p>' : ''}
        </li>`;
    };
    const group = (id, title, list, empty) => `
      <section class="agr-group" aria-labelledby="${id}">
        <h2 id="${id}">${title} <span class="count">(${list.length})</span></h2>
        ${list.length ? `<ul class="agr-list">${list.map(card).join('')}</ul>` : `<p class="muted">${empty}</p>`}
      </section>`;

    return `
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">Perjanjian Saya</h1>
          <p class="lede">Perjanjian yang ditugaskan kepada Anda.</p>
        </div>
      </div>
      ${items.length
        ? group('pending-h', 'Belum disetujui', pending, 'Tidak ada perjanjian yang menunggu persetujuan.') +
          group('done-h', 'Sudah disetujui', done, 'Belum ada perjanjian yang disetujui.')
        : `<section class="state" aria-labelledby="empty-h">
             <div class="state-icon" aria-hidden="true">${ICON_DOC}</div>
             <h2 id="empty-h">Belum ada perjanjian</h2>
             <p>Belum ada perjanjian yang ditugaskan kepada Anda.</p>
           </section>`}
      ${simPanel()}`;
  }

  /** Clearly labelled simulation controls. Not part of the admin product UI. */
  function simPanel() {
    const profile = app.user.profile;
    const radios = Object.entries(U.PROFILE_PRESETS).map(([key, p]) => `
      <label class="check"><input type="radio" name="sim-profile" id="sim-profile-${key}" value="${key}"${profile.preset === key ? ' checked' : ''}>
        ${esc(p.label)} <span class="muted">(${p.values.nama_lengkap ? esc(p.values.nama_lengkap) : 'kosong'})</span></label>`).join('');
    const options = app.data.templates
      .filter((t) => !t.archived && t.versions.length)
      .map((t) => {
        const v = S.latestVersion(t);
        return `<option value="${esc(t.id)}">${esc(v.title)} — Versi ${v.number}</option>`;
      }).join('');
    return `
      <details class="sim-panel" id="sim-panel"${app.simOpen ? ' open' : ''}>
        <summary>Kontrol simulasi</summary>
        <p class="hint">Hanya untuk demonstrasi. Identitas pengguna tetap sama dan nilai di dalam perjanjian tidak dapat diubah oleh pengguna.</p>
        <fieldset class="sim-fieldset">
          <legend>Data profil sintetis (pengguna ${esc(profile.userId)})</legend>
          ${radios}
          <p class="hint">Perubahan profil hanya memengaruhi penugasan baru. Dokumen yang sudah ditugaskan tidak berubah.</p>
        </fieldset>
        <div class="sim-fieldset">
          <label for="sim-assign-tpl" class="sim-legend">Tugaskan versi terbit terbaru</label>
          <div class="sim-assign">
            <select id="sim-assign-tpl"${options ? '' : ' disabled'}>${options || '<option>Tidak ada template terbit yang aktif</option>'}</select>
            <button type="button" class="btn btn-small" data-action="sim-assign"${options ? '' : ' disabled'}>Tugaskan (simulasi)</button>
          </div>
          <p class="hint">Draf dan template yang diarsipkan tidak dapat ditugaskan. Menerbitkan versi di Konsol Admin tidak menugaskan apa pun.</p>
        </div>
      </details>`;
  }

  /** Make rendered table scrollers keyboard-focusable and labelled. Presentation only. */
  const a11yTables = (html) => html.replace(/<div class="table-wrap">/g,
    '<div class="table-wrap" tabindex="0" role="region" aria-label="Tabel, geser untuk melihat semua kolom">');

  const answerLabel = (v) => (v == null ? 'Tidak dijawab' : (RT.CLAUSE_ANSWERS.find((x) => x.value === v) || { label: v }).label);
  const clausesOf = (s) => s.clauses || [];

  /** Unconfirmed answers for this assignment (empty when first opened). */
  function draftAnswers(a) {
    if (!app.clauseDraft || app.clauseDraft.assignmentId !== a.id) app.clauseDraft = { assignmentId: a.id, answers: {} };
    return app.clauseDraft.answers;
  }

  /** Recorded answers next to the acceptance (read-only). */
  function recordedAnswersHtml(s, acc) {
    const clauses = clausesOf(s);
    if (!clauses.length) return '';
    if (!acc.answers) return '<p>Jawaban klausul tidak tercatat untuk persetujuan ini.</p>';
    return `
      <h3 class="recorded-h">Jawaban klausul yang dicatat</h3>
      <dl class="dl dl-compact recorded-answers">${clauses.map((c) => `<dt>${esc(c.title)}</dt><dd data-clause-answer="${esc(c.id)}">${esc(answerLabel(acc.answers[c.id]))}</dd>`).join('')}</dl>`;
  }

  function renderUserDoc(route) {
    const a = U.getAssignment(app.user, route.id);
    if (!a) return userNotFound();
    const s = a.snapshot;
    const acc = U.acceptanceFor(app.user, a);
    const unavailable = s.missing.length > 0;
    const hasClauses = clausesOf(s).length > 0 && !unavailable;

    const accepted = acc ? `
      <section class="callout callout-success" id="accept-result" tabindex="-1" role="status" aria-labelledby="accepted-h">
        <h2 id="accepted-h">Perjanjian telah disetujui</h2>
        <dl class="dl dl-compact">
          <dt>Versi disetujui</dt><dd>Versi ${s.templateVersion}</dd>
          <dt>Waktu persetujuan</dt><dd>${timeTag(acc.acceptedAt)}</dd>
        </dl>
        ${recordedAnswersHtml(s, acc)}
        <p>Dokumen di bawah ini hanya baca dan sama persis dengan yang Anda setujui.</p>
      </section>` : '';

    const doc = unavailable ? `
      <section class="callout callout-danger" id="doc-unavailable" aria-labelledby="unavail-h">
        <h2 id="unavail-h">Dokumen tidak tersedia</h2>
        <p>Data berikut belum ada di profil Anda saat dokumen ini dibuat:
        <strong>${s.missing.map((k) => esc(phLabel(k))).join(', ')}</strong>.
        Isi dokumen tidak ditampilkan dan perjanjian belum dapat disetujui.</p>
      </section>` : `
      <article class="doc doc-user" aria-labelledby="doc-title">
        <p class="doc-sample-label">Dokumen simulasi · data sintetis</p>
        <h2 class="doc-title" id="doc-title">${esc(s.title)}</h2>
        <p class="doc-version">Versi ${s.templateVersion}</p>
        <div class="doc-body">${a11yTables(s.html)}</div>
      </article>`;

    const acceptPanel = acc ? '' : `
      <section class="accept-panel" aria-labelledby="accept-h">
        <h2 id="accept-h">Persetujuan</h2>
        <label class="consent">
          <input type="checkbox" id="consent"${unavailable ? ' disabled' : ''} aria-describedby="accept-hint">
          <span>${CONSENT_LABEL}</span>
        </label>
        <button type="button" class="btn btn-primary btn-block" id="btn-accept" data-action="user-accept" data-id="${esc(a.id)}" disabled aria-describedby="accept-hint${hasClauses ? ' clause-issues' : ''}">Setujui Perjanjian</button>
        ${hasClauses ? '<div id="clause-issues" class="clause-issues" aria-live="polite"></div>' : ''}
        <p id="accept-hint" class="hint">${unavailable
          ? 'Persetujuan tidak tersedia karena dokumen tidak dapat ditampilkan.'
          : `${hasClauses ? 'Jawab klausul persetujuan dan c' : 'C'}entang kotak di atas untuk mengaktifkan tombol. Persetujuan baru dicatat setelah Anda mengonfirmasi.`}</p>
      </section>`;

    return `
      ${crumbs([{ label: 'Perjanjian Saya', href: '#/saya' }, { label: s.title }])}
      <div class="page-head">
        <div>
          <h1 id="page-title" tabindex="-1">${esc(s.title)}</h1>
          <p class="lede"><span>Versi ${s.templateVersion}</span>${userBadge(acc)}</p>
        </div>
      </div>
      <div class="user-doc">
        ${accepted}
        ${doc}
        ${acceptPanel}
      </div>`;
  }

  /** Clause fieldsets in the user document, keyed by clause ID. */
  const clauseSets = () => Array.from(document.querySelectorAll('.doc-user fieldset.clause'));
  const radiosOf = (fs) => Array.from(fs.querySelectorAll('input[type="radio"]'));

  /** Enable “Setujui Perjanjian” only when consent is checked and every required clause is “Ya”. */
  function updateAcceptState(a) {
    const btn = $('#btn-accept');
    const consent = $('#consent');
    if (!btn || !consent) return;
    const issues = U.clauseIssues(a.snapshot, draftAnswers(a));
    btn.disabled = !consent.checked || consent.disabled || issues.length > 0;
    const box = $('#clause-issues');
    if (box) {
      setHtml(box, issues.length ? `
        <p><strong>Belum dapat disetujui:</strong></p>
        <ul>${issues.map((i) => `<li><button type="button" class="link-btn" data-action="focus-clause" data-clause="${esc(i.clauseId)}">${esc(i.message)}</button></li>`).join('')}</ul>` : '');
    }
    clauseSets().forEach((fs) => {
      fs.classList.toggle('is-blocking', issues.some((i) => i.clauseId === fs.dataset.clauseId && i.answer === 'tidak'));
    });
  }

  function bindClauses(a, acc) {
    const sets = clauseSets();
    if (!sets.length) return;
    if (acc) {
      // Read-only: show the recorded answers; nothing can change them.
      sets.forEach((fs) => {
        const v = acc.answers ? acc.answers[fs.dataset.clauseId] : undefined;
        radiosOf(fs).forEach((r) => { r.checked = v != null && r.value === v; });
        fs.disabled = true;
        const note = document.createElement('p');
        note.className = 'clause-recorded';
        note.textContent = acc.answers ? `Jawaban tercatat: ${answerLabel(v)}` : 'Jawaban tidak tercatat.';
        fs.appendChild(note);
      });
      return;
    }
    const answers = draftAnswers(a);
    sets.forEach((fs) => {
      radiosOf(fs).forEach((r) => {
        r.checked = answers[fs.dataset.clauseId] === r.value;
        // Choosing an answer only updates local state; it never submits or records anything.
        r.addEventListener('change', () => {
          if (r.checked) answers[fs.dataset.clauseId] = r.value;
          updateAcceptState(a);
        });
      });
    });
  }

  function bindUser() {
    const route = parseRoute();
    const a = route.name === 'user-doc' ? U.getAssignment(app.user, route.id) : null;
    if (a && !a.snapshot.missing.length) bindClauses(a, U.acceptanceFor(app.user, a));
    const consent = $('#consent');
    if (consent && a) {
      consent.addEventListener('change', () => updateAcceptState(a));
      updateAcceptState(a);
    }
    const panel = $('#sim-panel');
    if (panel) {
      panel.addEventListener('toggle', () => { app.simOpen = panel.open; });
      panel.querySelectorAll('input[name="sim-profile"]').forEach((r) => r.addEventListener('change', () => {
        U.setProfile(app.user, r.value);
        toast('Simulasi: profil diperbarui. Dokumen yang sudah ditugaskan tidak berubah.');
        render();
      }));
    }
  }

  function simAssign() {
    const sel = $('#sim-assign-tpl');
    const t = sel && S.getTemplate(app.data, sel.value);
    if (!t) return;
    const v = S.latestVersion(t);
    try {
      const a = U.assignVersion(app.user, app.data, t.id, v && v.number, now());
      toast(`Simulasi: “${a.snapshot.title}” Versi ${a.snapshot.templateVersion} ditugaskan.`);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /** The page the dialog was opened from must still be showing, with consent checked. */
  function consentGivenFor(id) {
    const btn = $('#btn-accept');
    const box = $('#consent');
    return Boolean(btn && box && btn.dataset.id === id && box.checked && !box.disabled);
  }

  /** The exact snapshot and clause answers currently shown, or null if not acceptable now. */
  function currentReview(a) {
    if (a.snapshot.missing.length || !consentGivenFor(a.id)) return null;
    const answers = U.normalizeAnswers(a.snapshot, draftAnswers(a));
    if (U.clauseIssues(a.snapshot, answers).length) return null;
    return { snapshotId: a.snapshot.id, answers };
  }

  function openAcceptModal(id) {
    const a = U.getAssignment(app.user, id);
    if (!a) return;
    if (U.acceptanceFor(app.user, a)) { render(); return; }
    const review = currentReview(a);
    if (!review) { updateAcceptState(a); return; }
    const s = a.snapshot;
    const clauses = clausesOf(s);
    openModal({
      title: 'Setujui perjanjian?',
      body: `
        <p>Anda akan menyetujui <strong>${esc(s.title)}</strong>, <strong>Versi ${s.templateVersion}</strong>.</p>
        ${clauses.length ? `
          <p>Jawaban klausul yang akan dicatat:</p>
          <dl class="dl dl-compact">${clauses.map((c) => `<dt>${esc(c.title)}</dt><dd>${esc(answerLabel(review.answers[c.id]))}</dd>`).join('')}</dl>` : ''}
        <p>Persetujuan dicatat untuk dokumen persis seperti yang ditampilkan${clauses.length ? ', bersama jawaban di atas' : ''}.</p>
        <p class="hint">Simulasi: dicatat di memori untuk pengguna sintetis, tanpa tanda tangan elektronik atau kekuatan hukum.</p>`,
      confirmLabel: 'Ya, setujui',
      onConfirm: () => confirmAccept(id, review),
    });
  }

  /**
   * Re-checks everything on every confirmation (repeated or stale dialogs):
   * the record must not exist yet, the page must still show this document with
   * consent checked, and the answers must equal those reviewed in the dialog.
   */
  function confirmAccept(id, reviewed) {
    const a = U.getAssignment(app.user, id);
    if (!a) return;
    const existing = U.acceptanceFor(app.user, a);
    if (existing) {
      toast(`Perjanjian ini sudah disetujui pada ${fmt(existing.acceptedAt)}. Tidak ada perubahan.`, 'warn');
      if (parseRoute().id === id) render();
      return;
    }
    // Leaving the page or unchecking consent means no acceptance.
    if (!consentGivenFor(id)) return;
    const current = currentReview(a);
    if (!current || current.snapshotId !== reviewed.snapshotId || JSON.stringify(current.answers) !== JSON.stringify(reviewed.answers)) {
      toast('Jawaban klausul berubah setelah konfirmasi dibuka. Tidak ada yang dicatat; tinjau lalu setujui kembali.', 'warn');
      updateAcceptState(a);
      return;
    }
    try {
      U.acceptAssignment(app.user, id, now(), reviewed);
    } catch (err) {
      toast(err.message, 'error');
      render();
      return;
    }
    render();
    const result = $('#accept-result');
    if (result) result.focus();
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

  const isUserRoute = (route) => route.name === 'user-list' || route.name === 'user-doc';

  function view(route) {
    // The user side is not governed by the admin permission simulation.
    if (route.name === 'user-list') return `<div class="user-page">${renderUserList()}</div>`;
    if (route.name === 'user-doc') return `<div class="user-page">${renderUserDoc(route)}</div>`;
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
    const side = isUserRoute(route) ? 'user' : 'admin';
    document.querySelectorAll('[data-side]').forEach((el) => { el.hidden = el.dataset.side !== side; });
    document.querySelectorAll('[data-view]').forEach((el) => {
      if (el.dataset.view === side) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    main.innerHTML = view(route);
    bindList();
    bindEditor();
    bindUser();

    const heading = $('#page-title');
    const suffix = side === 'user' ? 'Perjanjian Saya (Mockup)' : 'Template Perjanjian (Mockup)';
    document.title = (heading ? heading.textContent + ' · ' : '') + suffix;
    if (opts && opts.nav) {
      window.scrollTo(0, 0);
      if (heading) heading.focus({ preventScroll: true });
    } else if (activeId === 'f-content' && app.editor && app.editor.rte) {
      app.editor.rte.commands.focus();
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
      case 'fmt': runCommand(el.dataset.fmt, el); break;
      case 'convert-legacy': convertLegacy(); break;
      case 'ph-toggle':
        if ($('#ph-menu').hidden) openPhMenu(); else closePhMenu(true);
        break;
      case 'ph-insert': insertPlaceholder(el.dataset.key); break;
      case 'focus-field': {
        const field = el.dataset.field;
        if (field === 'content') { if (app.editor && app.editor.rte) app.editor.rte.commands.focus(); }
        else if (field === 'internalName' || field === 'title') $(field === 'title' ? '#f-title' : '#f-name').focus();
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
      case 'user-accept': openAcceptModal(id); break;
      case 'focus-clause': {
        const fs = clauseSets().find((x) => x.dataset.clauseId === el.dataset.clause);
        const target = fs && (fs.querySelector('input:checked') || fs.querySelector('input'));
        if (target) { fs.scrollIntoView({ block: 'center' }); target.focus(); }
        break;
      }
      case 'sim-assign': simAssign(); break;
      case 'reload-draft': reloadDraft(); break;
      case 'dismiss-recovered': app.editor.recovered = null; updateEditorLive(); break;
      case 'reset-data':
      case 'clear-data':
        if (isDirty(app.editor) && !window.confirm('Perubahan draf belum disimpan akan hilang. Lanjutkan?')) break;
        dropEditor();
        app.clauseDraft = null;
        app.data = action === 'reset-data' ? S.createSeedState() : { nextId: 1, templates: [] };
        // Clearing templates leaves user snapshots alone: they never depend on templates.
        if (action === 'reset-data') app.user = U.createSeedUserState(app.data);
        app.detailView = {};
        app.list = { q: '', status: 'all', draftOnly: false };
        toast(action === 'reset-data' ? 'Data contoh dimuat ulang.' : 'Semua template contoh dikosongkan.');
        navigate('#/');
        break;
      default: break;
    }
  });

  // Toolbar keyboard: arrows/Home/End move between controls; Esc returns to the document.
  document.addEventListener('keydown', (ev) => {
    const btn = ev.target.closest && ev.target.closest('.rte-toolbar .tool');
    if (!btn) return;
    const items = toolbarItems();
    const idx = items.indexOf(btn);
    let next = null;
    if (ev.key === 'ArrowRight') next = items[(idx + 1) % items.length];
    else if (ev.key === 'ArrowLeft') next = items[(idx - 1 + items.length) % items.length];
    else if (ev.key === 'Home') next = items[0];
    else if (ev.key === 'End') next = items[items.length - 1];
    else if (ev.key === 'Escape' && app.editor && app.editor.rte) { ev.preventDefault(); app.editor.rte.commands.focus(); return; }
    if (next) { ev.preventDefault(); setRoving(next); next.focus(); }
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
