/*
 * In-memory template store. Lifecycle: draft -> published -> archived.
 * - At most one draft per template; saving a draft bumps its revision only.
 * - Publishing freezes the draft's title and content as the next version.
 * - Content format: every record carries `format`. New drafts and versions are
 *   always 'richtext-json' (validated JSON envelope, deep-frozen). Legacy
 *   records without `format` are Markdown; they are never converted
 *   automatically, only by the explicit convertLegacyDraft action.
 * - Archiving blocks new edits/publications but keeps drafts, versions, history.
 * - Published rich-text versions record `renderVersion` (the layout rules in
 *   force when published). Older records without it are left as they are.
 * - Nothing is ever deleted.
 * - Every template carries a `lockVersion` that increases on each successful
 *   save, publication, and archival. Each mutation must name the lockVersion
 *   the admin reviewed; a stale one is rejected before anything changes. It is
 *   independent of draft revisions (restart per draft) and version numbers.
 */
(function (root) {
  'use strict';

  const node = typeof module === 'object' && module.exports;
  const MD = node ? require('./markdown.js') : root.AgreementMarkdown;
  const RT = node ? require('./richtext.js') : root.AgreementRichText;

  class StoreError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details || null;
    }
  }

  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^TPL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

  function generateCode(state, rand) {
    const random = rand || Math.random;
    const taken = new Set(state.templates.map((t) => t.code));
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = 'TPL-';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
      if (!taken.has(code)) return code;
    }
    throw new StoreError('CODE_EXHAUSTED', 'Tidak dapat membuat kode unik.');
  }

  function statusOf(t) {
    if (t.archived) return 'archived';
    return t.versions.length ? 'published' : 'draft';
  }

  function latestVersion(t) {
    return t.versions[t.versions.length - 1] || null;
  }

  function getTemplate(state, id) {
    return state.templates.find((t) => t.id === id) || null;
  }

  function requireTemplate(state, id) {
    const t = getTemplate(state, id);
    if (!t) throw new StoreError('NOT_FOUND', 'Template tidak ditemukan.');
    return t;
  }

  function conflictDetails(t) {
    const latest = latestVersion(t);
    return {
      lockVersion: t.lockVersion,
      revision: t.draft ? t.draft.revision : null,
      versionCount: t.versions.length,
      by: t.draft ? t.draft.updatedBy : (latest && latest.publishedBy),
      at: t.draft ? t.draft.updatedAt : (latest && latest.publishedAt),
      published: !t.draft && Boolean(latest),
    };
  }

  /** Reject a mutation unless it names the template's current lockVersion. */
  function assertLock(t, expected) {
    if (!Number.isInteger(expected)) {
      throw new StoreError('LOCK_REQUIRED', 'Penanda versi data template (lockVersion) wajib disertakan.');
    }
    if (expected !== t.lockVersion) {
      throw new StoreError('CONFLICT', 'Template telah diubah di tempat lain.', conflictDetails(t));
    }
  }

  function appendVersion(t, version) {
    t.versions = Object.freeze(t.versions.concat(Object.freeze({ ...version })));
  }

  /** Records without a format discriminator are legacy Markdown. */
  function formatOf(record) {
    return (record && record.format) || 'markdown';
  }

  /** Validate a draft or version with the rules of its own format. */
  function validateRecord(internalName, record) {
    const fields = { internalName, title: record.title, content: record.content };
    return formatOf(record) === RT.FORMAT ? RT.validateDraft(fields) : MD.validateDraft(fields);
  }

  function writeDraft(t, prev, fields, actor, now, extra) {
    const latest = latestVersion(t);
    t.draft = {
      title: fields.title,
      format: RT.FORMAT,
      content: RT.freezeCopy(fields.content),
      revision: prev ? prev.revision + 1 : 1,
      basedOnVersion: prev ? prev.basedOnVersion : (latest ? latest.number : null),
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now,
      updatedBy: actor,
      ...(prev && prev.convertedFrom ? { convertedFrom: prev.convertedFrom } : {}),
      ...extra,
    };
    t.updatedAt = now;
    t.lockVersion++;
  }

  /**
   * Save (create or update) the single draft. For an existing template,
   * `input.lockVersion` must equal the template's current lockVersion.
   * Content must be a valid rich-text envelope; Markdown strings are refused.
   */
  function saveDraft(state, input, actor, now) {
    const fields = {
      internalName: String(input.internalName || '').trim(),
      title: String(input.title || '').trim(),
      content: input.content,
    };
    const errors = RT.validateDraft(fields);
    if (errors.length) throw new StoreError('INVALID', 'Draf tidak valid.', { errors });

    let t;
    if (input.templateId == null) {
      if (!CODE_RE.test(input.code)) throw new StoreError('INVALID_CODE', 'Kode template tidak valid.');
      if (state.templates.some((x) => x.code === input.code)) {
        throw new StoreError('DUPLICATE_CODE', 'Kode template sudah dipakai.');
      }
      t = {
        id: 'tpl_' + state.nextId++,
        code: input.code,
        internalName: fields.internalName,
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        archived: null,
        lockVersion: 0,
        versions: Object.freeze([]),
        draft: null,
      };
      state.templates.push(t);
    } else {
      t = requireTemplate(state, input.templateId);
      if (t.archived) throw new StoreError('ARCHIVED', 'Template diarsipkan dan tidak dapat diedit.');
      assertLock(t, input.lockVersion);
    }

    t.internalName = fields.internalName;
    writeDraft(t, t.draft, fields, actor, now);
    return t;
  }

  /**
   * Explicit, admin-initiated conversion of legacy Markdown into a new
   * rich-text draft. Source: the Markdown draft if there is one, otherwise the
   * latest published version (which stays unchanged). Nothing is saved unless
   * the whole document converts faithfully.
   */
  function convertLegacyDraft(state, id, expectedLockVersion, actor, now) {
    const t = requireTemplate(state, id);
    if (t.archived) throw new StoreError('ARCHIVED', 'Template diarsipkan dan tidak dapat diedit.');
    assertLock(t, expectedLockVersion);
    const latest = latestVersion(t);
    const source = t.draft || latest;
    if (!source || formatOf(source) !== 'markdown') {
      throw new StoreError('NOT_LEGACY', 'Tidak ada dokumen Markdown lama untuk dikonversi.');
    }
    const res = RT.convertMarkdown(source.content);
    if (!res.ok) {
      throw new StoreError('CONVERSION_FAILED', 'Dokumen tidak dapat dikonversi tanpa mengubah isinya.', { errors: res.errors });
    }
    const convertedFrom = t.draft
      ? { format: 'markdown', draftRevision: t.draft.revision }
      : { format: 'markdown', version: latest.number };
    writeDraft(t, t.draft, { title: source.title, content: res.content }, actor, now, { convertedFrom });
    return t;
  }

  function publishDraft(state, id, expectedLockVersion, actor, now) {
    const t = requireTemplate(state, id);
    if (t.archived) throw new StoreError('ARCHIVED', 'Template diarsipkan dan tidak dapat diterbitkan.');
    assertLock(t, expectedLockVersion);
    if (!t.draft) throw new StoreError('NO_DRAFT', 'Tidak ada draf untuk diterbitkan.');
    if (formatOf(t.draft) !== RT.FORMAT) {
      throw new StoreError('LEGACY_FORMAT', 'Draf Markdown lama harus dikonversi ke editor visual sebelum diterbitkan.');
    }
    const errors = validateRecord(t.internalName, t.draft);
    if (errors.length) throw new StoreError('INVALID', 'Draf belum dapat diterbitkan.', { errors });

    const version = {
      number: t.versions.length + 1,
      title: t.draft.title,
      format: RT.FORMAT,
      content: RT.freezeCopy(t.draft.content),
      renderVersion: RT.RENDER_VERSION,
      publishedAt: now,
      publishedBy: actor,
      fromRevision: t.draft.revision,
    };
    appendVersion(t, version);
    t.draft = null;
    t.updatedAt = now;
    t.lockVersion++;
    return latestVersion(t);
  }

  function archiveTemplate(state, id, expectedLockVersion, actor, now) {
    const t = requireTemplate(state, id);
    if (t.archived) throw new StoreError('ARCHIVED', 'Template sudah diarsipkan.');
    assertLock(t, expectedLockVersion);
    t.archived = { at: now, by: actor };
    t.updatedAt = now;
    t.lockVersion++;
    return t;
  }

  /**
   * Simulate another administrator, who always sees the latest data, saving
   * the draft (for conflict demos). Bumps lockVersion like any save.
   */
  function simulateExternalEdit(state, id, actor, now) {
    const t = requireTemplate(state, id);
    if (t.archived) throw new StoreError('ARCHIVED', 'Template diarsipkan.');
    const base = t.draft || latestVersion(t);
    if (!base) throw new StoreError('NO_DRAFT', 'Tidak ada dokumen.');
    let content = base.content;
    if (formatOf(base) === 'markdown') {
      const res = RT.convertMarkdown(content);
      if (!res.ok) throw new StoreError('CONVERSION_FAILED', res.errors[0]);
      content = res.content;
    }
    const note = { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf ini ditambahkan oleh admin lain (simulasi).' }] };
    const next = RT.wrap({ type: 'doc', content: content.document.content.concat(note) });
    writeDraft(t, t.draft, { title: base.title, content: next }, actor, now);
    return t;
  }

  const CONTENT = {
    layanan1: [
      '## Ketentuan Umum',
      '',
      'Dokumen ini adalah **contoh teks** untuk menunjukkan format template. Isinya bukan perjanjian yang lengkap.',
      '',
      'Halo {{nama_lengkap}}, berikut ringkasan poin utama layanan.',
      '',
      '1. Layanan tersedia sesuai jam operasional.',
      '2. Pertanyaan dapat diajukan melalui kanal dukungan resmi.',
      '3. Perubahan ketentuan diumumkan terlebih dahulu.',
    ].join('\n'),
    layanan2: [
      '## Ketentuan Umum',
      '',
      'Dokumen ini adalah **contoh teks** untuk menunjukkan format template. Isinya bukan perjanjian yang lengkap.',
      '',
      'Halo {{nama_lengkap}}, berikut ringkasan poin utama layanan.',
      '',
      '### Poin utama',
      '',
      '1. Layanan tersedia sesuai jam operasional.',
      '2. Pertanyaan dapat diajukan melalui kanal dukungan resmi.',
      '3. Perubahan ketentuan diumumkan terlebih dahulu.',
      '',
      '### Ringkasan',
      '',
      '| Bagian | Keterangan |',
      '|---|---|',
      '| Ruang lingkup | Penggunaan layanan secara umum |',
      '| Kontak | Tim dukungan |',
      '',
      '- Baca dokumen ini dengan saksama.',
      '- Simpan salinan untuk referensi *pribadi*.',
    ].join('\n'),
    rujukan1: [
      '## Tentang Program',
      '',
      'Teks contoh ini menjelaskan gambaran umum program rujukan, {{nama_lengkap}}.',
      '',
      '- Program bersifat sukarela.',
      '- Ketentuan rinci dapat berubah sewaktu-waktu.',
      '',
      '*Contoh netral — bukan ketentuan resmi.*',
    ].join('\n'),
    pemasaran: [
      '## Komunikasi',
      '',
      'Kami dapat mengirimkan informasi produk secara berkala. Teks ini hanya **contoh**.',
      '',
      '- Frekuensi pengiriman dibatasi.',
      '- Preferensi dapat diubah kapan saja.',
    ].join('\n'),
    dompet1: [
      '## Ketentuan Dompet',
      '',
      'Contoh teks untuk template lama yang telah diarsipkan.',
      '',
      '1. Poin pertama.',
      '2. Poin kedua.',
    ].join('\n'),
    pengumuman: [
      '## Pemberitahuan',
      '',
      'Halo {{nama_lengkap}}, ini contoh pemberitahuan perubahan layanan.',
      '',
      '| Tanggal berlaku | Ringkasan |',
      '|---|---|',
      '| Akan diumumkan | Penyesuaian tampilan |',
    ].join('\n'),
  };

  /** Seed drafts are rich-text JSON, built from legacy text by the converter. */
  function seedJson(markdown, extraBlocks) {
    const res = RT.convertMarkdown(markdown);
    if (!res.ok) throw new Error('Seed conversion failed: ' + res.errors.join('; '));
    const doc = { type: 'doc', content: res.content.document.content.concat(extraBlocks || []) };
    return RT.freezeCopy(RT.wrap(doc));
  }

  /*
   * Editable sample draft for the label–value table preset. Every company
   * detail and name is fictional static text (no placeholders, no lookups).
   */
  function profileSampleJson() {
    const text = (s, marks) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });
    const para = (s, marks) => ({ type: 'paragraph', content: [text(s, marks)] });
    const heading = (s) => ({ type: 'heading', attrs: { level: 2 }, content: [text(s)] });
    const row = (label, ...values) => ({
      type: 'tableRow',
      content: [
        { type: 'tableHeader', content: [para(label)] },
        { type: 'tableCell', content: values.map((v) => para(v)) },
      ],
    });
    const kv = (...rows) => ({ type: 'table', attrs: { preset: 'labelValue', labelWidth: 25 }, content: rows });
    return RT.freezeCopy(RT.wrap({
      type: 'doc',
      content: [
        para('Contoh fiktif: seluruh nama perusahaan, alamat, kontak, dan nama orang di dokumen ini rekaan dan dapat diedit.', [{ type: 'italic' }]),
        heading('Profil Perusahaan'),
        kv(
          row('Nama Perusahaan', 'PT Contoh Sinar Fiktif'),
          row('Alamat Perusahaan', 'Jl. Contoh Raya No. 123, Kelurahan Rekaan, Kota Fiktif 00000'),
          row('Nomor Telepon', '(000) 1234-5678'),
          row('Nomor Fax', '(000) 1234-5679'),
          row('Alamat Email', 'info@contoh-sinar-fiktif.example'),
          row('Alamat Website', 'https://www.contoh-sinar-fiktif.example/tentang-kami/profil-perusahaan/sejarah-dan-reputasi'),
          row('Tempat dan Tanggal Berdirinya Perusahaan', 'Kota Fiktif, 1 Januari 2001'),
          row('Sejarah dan Reputasi Perusahaan',
            'PT Contoh Sinar Fiktif didirikan sebagai usaha rekaan yang bergerak di bidang layanan administrasi dokumen. Pada tahun-tahun awal, perusahaan fiktif ini melayani pelanggan di satu kota dengan tim kecil yang berfokus pada ketepatan dan kerapian berkas.',
            'Seiring waktu, perusahaan memperluas layanan ke pengelolaan arsip digital, pelatihan internal, dan pendampingan proses persetujuan dokumen. Setiap perluasan dilakukan bertahap agar mutu layanan tetap terjaga dan pelanggan memperoleh informasi yang jelas sebelum perubahan diterapkan.',
            'Reputasi perusahaan dalam contoh ini dibangun melalui komitmen pada keterbukaan informasi, waktu tanggap yang konsisten, dan dokumentasi yang mudah dipahami. Paragraf panjang ini sengaja disertakan untuk menunjukkan bahwa teks membungkus otomatis dan tinggi baris tabel bertambah sesuai isinya tanpa terpotong.'),
        ),
        heading('Susunan Pengurus Perusahaan'),
        kv(
          row('Direktur Utama', 'Andi Contoh'),
          row('Direktur', 'Sari Contoh'),
          row('Komisaris', 'Rudi Contoh'),
        ),
      ],
    }));
  }

  function createSeedState() {
    const state = { nextId: 1, templates: [] };
    const add = (t) => {
      state.templates.push({
        id: 'tpl_' + state.nextId++,
        archived: null,
        draft: null,
        lockVersion: 1,
        ...t,
        versions: Object.freeze((t.versions || []).map((v) => Object.freeze({ ...v }))),
      });
    };

    add({
      code: 'TPL-K7M2QX',
      internalName: 'Persetujuan Layanan Umum',
      createdAt: '2026-09-02T03:15:00Z', createdBy: 'Rahmat Hidayat',
      updatedAt: '2026-11-04T07:42:00Z',
      versions: [
        { number: 1, title: 'Persetujuan Layanan', content: CONTENT.layanan1, publishedAt: '2026-09-10T02:00:00Z', publishedBy: 'Rahmat Hidayat', fromRevision: 4 },
        { number: 2, title: 'Persetujuan Layanan Umum', content: CONTENT.layanan2, publishedAt: '2026-10-21T08:30:00Z', publishedBy: 'Siti Rahayu', fromRevision: 2 },
      ],
      // Draft created with "Buat draf editor visual" from the Markdown Versi 2.
      draft: {
        title: 'Persetujuan Layanan Umum',
        format: RT.FORMAT,
        content: seedJson(CONTENT.layanan2 + '\n- Hubungi tim dukungan bila ada pertanyaan.'),
        convertedFrom: { format: 'markdown', version: 2 },
        revision: 3, basedOnVersion: 2,
        createdAt: '2026-11-01T04:00:00Z', updatedAt: '2026-11-04T07:42:00Z', updatedBy: 'Siti Rahayu',
      },
    });
    add({
      code: 'TPL-R4D8WN',
      internalName: 'Ketentuan Program Rujukan',
      createdAt: '2026-08-11T06:00:00Z', createdBy: 'Siti Rahayu',
      updatedAt: '2026-08-20T09:10:00Z',
      versions: [
        { number: 1, title: 'Ketentuan Program Rujukan', content: CONTENT.rujukan1, publishedAt: '2026-08-20T09:10:00Z', publishedBy: 'Siti Rahayu', fromRevision: 2 },
      ],
    });
    add({
      code: 'TPL-H3P9TA',
      internalName: 'Persetujuan Komunikasi Pemasaran',
      createdAt: '2026-10-28T02:20:00Z', createdBy: 'Rahmat Hidayat',
      updatedAt: '2026-11-03T03:05:00Z',
      draft: {
        title: 'Persetujuan Komunikasi',
        format: RT.FORMAT,
        content: seedJson(CONTENT.pemasaran, [{
          type: 'paragraph', attrs: { textAlign: 'center' },
          content: [{ type: 'text', text: 'Contoh netral — bukan ketentuan resmi.', marks: [{ type: 'italic' }, { type: 'underline' }] }],
        }]),
        revision: 2, basedOnVersion: null,
        createdAt: '2026-10-28T02:20:00Z', updatedAt: '2026-11-03T03:05:00Z', updatedBy: 'Rahmat Hidayat',
      },
    });
    add({
      code: 'TPL-M9C5VG',
      internalName: 'Pemberitahuan Perubahan Layanan',
      createdAt: '2026-07-01T01:00:00Z', createdBy: 'Rahmat Hidayat',
      updatedAt: '2026-10-02T05:45:00Z',
      versions: [
        { number: 1, title: 'Pemberitahuan Perubahan', content: CONTENT.pengumuman, publishedAt: '2026-07-03T01:30:00Z', publishedBy: 'Rahmat Hidayat', fromRevision: 1 },
        { number: 2, title: 'Pemberitahuan Perubahan Layanan', content: CONTENT.pengumuman, publishedAt: '2026-08-14T04:00:00Z', publishedBy: 'Siti Rahayu', fromRevision: 3 },
        { number: 3, title: 'Pemberitahuan Perubahan Layanan', content: CONTENT.pengumuman + '\n\nTerima kasih.', publishedAt: '2026-10-02T05:45:00Z', publishedBy: 'Siti Rahayu', fromRevision: 1 },
      ],
    });
    add({
      code: 'TPL-B6X2KE',
      internalName: 'Ketentuan Dompet (lama)',
      createdAt: '2026-05-05T03:00:00Z', createdBy: 'Siti Rahayu',
      updatedAt: '2026-10-15T09:00:00Z',
      archived: { at: '2026-10-15T09:00:00Z', by: 'Rahmat Hidayat' },
      versions: [
        { number: 1, title: 'Ketentuan Dompet', content: CONTENT.dompet1, publishedAt: '2026-05-12T02:00:00Z', publishedBy: 'Siti Rahayu', fromRevision: 3 },
      ],
      draft: {
        title: 'Ketentuan Dompet', content: CONTENT.dompet1 + '\n3. Poin ketiga (draf).',
        revision: 1, basedOnVersion: 1,
        createdAt: '2026-09-30T02:00:00Z', updatedAt: '2026-09-30T02:00:00Z', updatedBy: 'Siti Rahayu',
      },
    });
    add({
      code: 'TPL-P5F7NC',
      internalName: 'Contoh Profil Perusahaan (fiktif)',
      createdAt: '2026-11-05T02:00:00Z', createdBy: 'Siti Rahayu',
      updatedAt: '2026-11-05T02:00:00Z',
      draft: {
        title: 'Profil Perusahaan (Contoh Fiktif)',
        format: RT.FORMAT,
        content: profileSampleJson(),
        revision: 1, basedOnVersion: null,
        createdAt: '2026-11-05T02:00:00Z', updatedAt: '2026-11-05T02:00:00Z', updatedBy: 'Siti Rahayu',
      },
    });
    return state;
  }

  const api = {
    StoreError, generateCode, statusOf, latestVersion, getTemplate, assertLock, formatOf, validateRecord,
    saveDraft, convertLegacyDraft, publishDraft, archiveTemplate, simulateExternalEdit, createSeedState,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgreementStore = api;
})(this);
