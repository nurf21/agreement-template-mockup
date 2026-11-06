/*
 * Structured rich-text documents ("richtext-json", formatVersion 1).
 *
 * The JSON envelope is the authoritative stored content:
 *   { format: 'richtext-json', formatVersion: 1 | 2, document: { type: 'doc', content: [...] } }
 *
 * Format versions (all stay readable; nothing is upgraded automatically):
 * - 1: paragraphs, headings, lists, ordinary tables, placeholders.
 * - 2: adds the table preset “labelValue” (`table.attrs.preset`, with an
 *   allowlisted `labelWidth` of 20, 25, or 30 percent).
 * - 3: adds the top-level block “consentClause” (Klausul persetujuan):
 *   `attrs: { clauseId, required }`, content exactly
 *   [clauseTitle (plain text), clauseBody (paragraphs/lists)]. Answer options
 *   are fixed by the system (CLAUSE_ANSWERS: “Tidak”, “Ya”; a required clause
 *   needs “Ya”) and never stored. Kept readable for historical records only;
 *   new drafts cannot be saved with these clauses.
 * - 4: consent clauses carry administrator-defined options:
 *   `attrs.options: [{ id, label, qualifies }]` (2–5 options; `id` system-
 *   generated, `label` plain text, `qualifies` = “Memenuhi persyaratan”).
 *   A required clause needs at least one qualifying option. No meaning is
 *   inferred from labels. Every clause of a version-4 document has options.
 *   Clause and option IDs are unique within a document. Kept readable for
 *   historical records; new content cannot be saved with these clauses.
 * - 5 (current): consent clauses carry `attrs: { clauseId, options,
 *   qualifyingOptionId }` and no `required` flag. `options`: 0–2
 *   `{ id, label }`. Behaviour follows the option count: 0 = information
 *   only (`qualifyingOptionId` null), 1 = that option qualifies
 *   (`qualifyingOptionId` equals its ID), 2 = `qualifyingOptionId` names
 *   exactly one of them. Nothing is inferred from labels.
 * `wrap()` picks the lowest version that can express a document, so older
 * documents keep their version.
 * RENDER_VERSION names the HTML layout rules; it is recorded on published
 * versions and user snapshots created with these rules.
 *
 * This module is the single, dependency-free path for:
 * - validating structure (allowed nodes, marks, attributes, placeholder keys),
 * - content rules (meaningful content, size limit, no {{...}} text),
 * - rendering to HTML for the admin preview and new user snapshots.
 * Rendering refuses any document that fails structural validation, escapes all
 * text, and substitutes placeholder values as escaped plain text only.
 */
(function (root) {
  'use strict';

  const MD = (typeof module === 'object' && module.exports)
    ? require('./markdown.js')
    : root.AgreementMarkdown;

  const FORMAT = 'richtext-json';
  const FORMAT_VERSION = 5; // latest supported
  const FORMAT_VERSIONS = [1, 2, 3, 4, 5];
  // 3: adds the consent-clause fieldset; 4: configurable clause options;
  // 5: information-only clauses and a single qualifying option.
  // Rules for older nodes (including format-3/4 clauses) are unchanged.
  const RENDER_VERSION = 5;
  // Table presets: identifier -> allowed left-column widths (percent).
  // Visual styles are derived from these values; no style strings are stored.
  const TABLE_PRESETS = Object.freeze({
    labelValue: Object.freeze({ widths: Object.freeze([20, 25, 30]), defaultWidth: 25, since: 2 }),
  });
  const LABEL_VALUE = 'labelValue';
  const CLAUSE_SINCE = 3;
  const CLAUSE_ID_RE = /^cl_[a-z0-9]{10}$/;
  // Format version 3 only: fixed answer options, in display order.
  const CLAUSE_ANSWERS = Object.freeze([
    Object.freeze({ value: 'tidak', label: 'Tidak' }),
    Object.freeze({ value: 'ya', label: 'Ya' }),
  ]);
  // The same fixed options in the version-4 option shape: in historical
  // version-3 records, “Ya” is the only answer that satisfies a required clause.
  const FIXED_OPTIONS = Object.freeze(CLAUSE_ANSWERS.map((a) => Object.freeze({ id: a.value, label: a.label, qualifies: a.value === 'ya' })));
  const OPTIONS_SINCE = 4;
  const OPTION_ID_RE = /^op_[a-z0-9]{10}$/;
  const OPTION_LIMITS = Object.freeze({ min: 2, max: 5, label: 80 }); // format 4 (historical)
  const QUALIFYING_SINCE = 5;
  const CLAUSE_OPTION_MAX = 2; // format 5
  const KNOWN = new Map(MD.PLACEHOLDERS.map((p) => [p.key, p]));

  // Size limit: length of JSON.stringify(envelope.document), in UTF-16 code
  // units (JavaScript string length). Checked on save and publish; content is
  // never truncated.
  const LIMITS = Object.freeze({ contentJson: 200000, depth: 16 });

  const ALIGN = (v) => v === null || v === 'left' || v === 'center' || v === 'right';
  const ONE = (v) => v === 1;
  // consentClause is allowed only directly in the document, so clauses can
  // never be nested (in other clauses, lists, or table cells).
  const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'consentClause'];
  const INLINE = ['text', 'variable'];
  const CELL_CONTENT = ['paragraph', 'bulletList', 'orderedList'];
  const CELL = {
    content: CELL_CONTENT, min: 1,
    attrs: { colspan: ONE, rowspan: ONE, colwidth: (v) => v === null },
  };

  /**
   * Allowed nodes. `attrs` maps every allowed attribute to a value check;
   * `required` lists attributes that must be present. Anything else is rejected.
   */
  const NODES = {
    doc: { content: BLOCKS, min: 1 },
    paragraph: { content: INLINE, attrs: { textAlign: ALIGN } },
    heading: { content: INLINE, attrs: { level: (v) => v === 2 || v === 3, textAlign: ALIGN }, required: ['level'] },
    bulletList: { content: ['listItem'], min: 1 },
    orderedList: { content: ['listItem'], min: 1, attrs: { start: (v) => Number.isInteger(v) && v >= 1 && v <= 999999999 } },
    listItem: { content: ['paragraph', 'bulletList', 'orderedList'], min: 1, first: 'paragraph' },
    table: {
      content: ['tableRow'], min: 1,
      attrs: {
        preset: (v) => v === null || Object.prototype.hasOwnProperty.call(TABLE_PRESETS, v),
        labelWidth: (v) => v === null || TABLE_PRESETS.labelValue.widths.includes(v),
      },
    },
    tableRow: { content: ['tableCell', 'tableHeader'], min: 1 },
    tableCell: CELL,
    tableHeader: CELL,
    consentClause: {
      content: ['clauseTitle', 'clauseBody'], min: 2,
      attrs: {
        clauseId: (v) => typeof v === 'string' && CLAUSE_ID_RE.test(v),
        required: (v) => typeof v === 'boolean', // formats 3–4 only
        options: Array.isArray, // details: optionIssues() / clauseOptionIssues()
        qualifyingOptionId: (v) => v === null || typeof v === 'string', // format 5 only
      },
      required: ['clauseId'],
    },
    clauseTitle: { content: ['text'] },
    clauseBody: { content: CELL_CONTENT, min: 1 },
    text: { leaf: true },
    variable: { leaf: true, attrs: { key: (v) => KNOWN.has(v) }, required: ['key'] },
  };
  const MARKS = new Set(['bold', 'italic', 'underline']);
  const NODE_KEYS = new Set(['type', 'attrs', 'content', 'marks', 'text']);

  const NAMES = {
    paragraph: 'paragraf', heading: 'judul', bulletList: 'daftar berpoin', orderedList: 'daftar bernomor',
    listItem: 'butir daftar', table: 'tabel', tableRow: 'baris tabel', tableCell: 'sel tabel',
    tableHeader: 'sel header', text: 'teks', variable: 'placeholder',
    consentClause: 'klausul persetujuan', clauseTitle: 'judul klausul', clauseBody: 'penjelasan klausul',
  };
  const nameOf = (type) => NAMES[type] || `“${String(type).slice(0, 40)}”`;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function isEnvelope(value) {
    return isObj(value) && value.format === FORMAT;
  }

  function emptyContent() {
    return { format: FORMAT, formatVersion: 1, document: { type: 'doc', content: [{ type: 'paragraph' }] } };
  }

  const presetOf = (node) => (isObj(node) && isObj(node.attrs) && node.attrs.preset != null ? node.attrs.preset : null);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

  /** Format version a clause node (or its attrs) was written for: 3, 4, or 5. */
  function clauseFormat(nodeOrAttrs) {
    const attrs = isObj(nodeOrAttrs) && isObj(nodeOrAttrs.attrs) ? nodeOrAttrs.attrs : nodeOrAttrs;
    if (has(attrs, 'qualifyingOptionId')) return QUALIFYING_SINCE;
    return has(attrs, 'options') ? OPTIONS_SINCE : CLAUSE_SINCE;
  }

  /** Lowest format version able to express the document. */
  function requiredVersion(document) {
    let v = 1;
    walk(document, (n) => {
      if (n.type === 'table' && presetOf(n) !== null) v = Math.max(v, 2);
      if (n.type === 'consentClause') v = Math.max(v, clauseFormat(n));
    });
    return v;
  }

  function wrap(document) {
    return { format: FORMAT, formatVersion: requiredVersion(document), document };
  }

  /**
   * Structural validation. Returns a list of issues; an empty list means the
   * document only uses the supported nodes, marks, and attributes.
   */
  function structureIssues(envelope) {
    const issues = [];
    const add = (where, message) => issues.push({
      field: 'content', kind: 'structure', message: (where ? where + ': ' : '') + message,
    });

    if (!isObj(envelope)) { add('', 'Isi dokumen harus berupa JSON terstruktur.'); return issues; }
    const extra = Object.keys(envelope).filter((k) => !['format', 'formatVersion', 'document'].includes(k));
    if (envelope.format !== FORMAT) add('', `Format isi tidak didukung (diharapkan “${FORMAT}”).`);
    if (!FORMAT_VERSIONS.includes(envelope.formatVersion)) add('', `Versi format tidak didukung (didukung: ${FORMAT_VERSIONS.join(', ')}).`);
    if (extra.length) add('', 'Properti tidak dikenal pada isi dokumen: ' + extra.join(', ') + '.');
    if (!isObj(envelope.document) || envelope.document.type !== 'doc') {
      add('', 'Dokumen harus berupa node “doc”.');
      return issues;
    }

    // Rules for table presets (attribute values are checked separately).
    const presetIssues = (node, rows, where) => {
      const preset = presetOf(node);
      const width = isObj(node.attrs) ? node.attrs.labelWidth : undefined;
      if (preset === null) {
        if (width != null) add(where, 'Lebar kolom label hanya berlaku untuk tabel label–nilai.');
        return;
      }
      if (preset !== LABEL_VALUE) return;
      if (envelope.formatVersion < TABLE_PRESETS.labelValue.since) {
        add(where, `Tabel label–nilai memerlukan format versi ${TABLE_PRESETS.labelValue.since}.`);
      }
      if (width == null) add(where, 'Tabel label–nilai wajib memiliki lebar kolom label (20%, 25%, atau 30%).');
      rows.forEach((r, i) => {
        const cells = isObj(r) && Array.isArray(r.content) ? r.content : [];
        if (cells.length !== 2) { add(where, `Tabel label–nilai harus tepat dua kolom (baris ${i + 1} memiliki ${cells.length} sel).`); return; }
        if (!isObj(cells[0]) || cells[0].type !== 'tableHeader') add(where, `Kolom kiri tabel label–nilai harus berupa sel label (baris ${i + 1}).`);
        if (!isObj(cells[1]) || cells[1].type !== 'tableCell') add(where, `Kolom kanan tabel label–nilai harus berupa sel nilai (baris ${i + 1}).`);
      });
    };

    // Rules for consent clauses (attribute values are checked separately).
    const clauseIds = new Set();
    const optionIds = new Set();
    const clauseIssues = (node, kids, where) => {
      if (envelope.formatVersion < CLAUSE_SINCE) add(where, `Klausul persetujuan memerlukan format versi ${CLAUSE_SINCE}.`);
      if (kids.length !== 2 || !isObj(kids[0]) || kids[0].type !== 'clauseTitle' || !isObj(kids[1]) || kids[1].type !== 'clauseBody') {
        add(where, 'Klausul persetujuan harus berisi tepat satu judul diikuti satu penjelasan.');
      }
      const id = isObj(node.attrs) ? node.attrs.clauseId : undefined;
      if (typeof id === 'string' && CLAUSE_ID_RE.test(id)) {
        if (clauseIds.has(id)) add(where, `ID klausul “${id}” dipakai lebih dari sekali dalam dokumen.`);
        clauseIds.add(id);
      }
      const title = isObj(kids[0]) && kids[0].type === 'clauseTitle' ? kids[0] : null;
      if (title && !/\S/.test(inlineText(title))) add(where, 'Judul klausul persetujuan wajib diisi.');
      const attrs = isObj(node.attrs) ? node.attrs : {};
      const label = title && /\S/.test(inlineText(title)) ? `Klausul “${inlineText(title).trim().slice(0, 60)}”` : 'Klausul persetujuan';
      const collect = (i) => {
        if (i.id) {
          if (optionIds.has(i.id)) add(where, `${label}: ID pilihan “${i.id}” dipakai lebih dari sekali dalam dokumen.`);
          optionIds.add(i.id);
        }
        if (i.message) add(where, `${label}${i.index != null ? `, pilihan ${i.index + 1}` : ''}: ${i.message}`);
      };
      const fmt = clauseFormat(attrs);
      if (fmt === QUALIFYING_SINCE) {
        if (envelope.formatVersion < QUALIFYING_SINCE) add(where, `Pilihan yang memenuhi syarat memerlukan format versi ${QUALIFYING_SINCE}.`);
        if (has(attrs, 'required')) add(where, `${label}: pengaturan “Wajib dijawab” tidak dipakai lagi; perilaku klausul mengikuti jumlah pilihan.`);
        clauseOptionIssues(attrs.options, attrs.qualifyingOptionId).forEach(collect);
        return;
      }
      // Historical clauses (formats 3 and 4).
      if (typeof attrs.required !== 'boolean') add(where, 'Atribut “required” wajib pada klausul persetujuan format lama.');
      if (envelope.formatVersion >= QUALIFYING_SINCE) {
        add(where, `${label} memakai aturan klausul lama (format ${fmt}). Sesuaikan dengan aturan pilihan baru (0–${CLAUSE_OPTION_MAX} pilihan dan satu pilihan yang memenuhi syarat).`);
      }
      if (envelope.formatVersion < OPTIONS_SINCE) {
        if (attrs.options !== undefined) add(where, `Pilihan jawaban yang dapat diatur memerlukan format versi ${OPTIONS_SINCE}.`);
        return;
      }
      if (!Array.isArray(attrs.options)) { add(where, `${label} wajib memiliki ${OPTION_LIMITS.min}–${OPTION_LIMITS.max} pilihan jawaban.`); return; }
      optionIssues(attrs.options, attrs.required === true).forEach(collect);
    };

    const visit = (node, parentType, where, depth) => {
      if (issues.length >= 50) return;
      if (!isObj(node) || typeof node.type !== 'string') { add(where, 'Elemen tidak valid.'); return; }
      const spec = NODES[node.type];
      if (!spec || node.type === 'doc' && parentType) { add(where, `Jenis elemen ${nameOf(node.type)} tidak didukung.`); return; }
      if (depth > LIMITS.depth) { add(where, 'Struktur terlalu dalam.'); return; }
      const parent = NODES[parentType];
      if (parent && !parent.content.includes(node.type)) {
        add(where, `${nameOf(node.type)} tidak diizinkan di dalam ${parentType === 'doc' ? 'dokumen' : nameOf(parentType)}.`);
        return;
      }
      const unknownKeys = Object.keys(node).filter((k) => !NODE_KEYS.has(k));
      if (unknownKeys.length) add(where, `Properti tidak dikenal pada ${nameOf(node.type)}: ${unknownKeys.join(', ')}.`);

      // Attributes.
      if (node.attrs !== undefined && !isObj(node.attrs)) add(where, `Atribut ${nameOf(node.type)} tidak valid.`);
      const attrs = isObj(node.attrs) ? node.attrs : {};
      const allowed = spec.attrs || {};
      Object.keys(attrs).forEach((k) => {
        if (!allowed[k]) add(where, `Atribut “${String(k).slice(0, 40)}” tidak didukung pada ${nameOf(node.type)}.`);
        else if (!allowed[k](attrs[k])) {
          if (node.type === 'variable' && k === 'key') add(where, `Placeholder “${String(attrs[k]).slice(0, 40)}” tidak ada dalam katalog sistem.`);
          else if (k === 'colspan' || k === 'rowspan') add(where, 'Sel tabel gabungan tidak didukung.');
          else if (k === 'preset') add(where, `Jenis tabel “${String(attrs[k]).slice(0, 40)}” tidak didukung.`);
          else if (k === 'labelWidth') add(where, 'Lebar kolom label harus 20%, 25%, atau 30%.');
          else if (k === 'clauseId') add(where, 'ID klausul tidak valid (dibuat otomatis oleh sistem).');
          else if (k === 'required') add(where, 'Pengaturan “Wajib dijawab” harus bernilai benar atau salah.');
          else if (k === 'options') add(where, 'Pilihan jawaban klausul harus berupa daftar.');
          else add(where, `Nilai atribut “${k}” tidak didukung pada ${nameOf(node.type)}.`);
        }
      });
      (spec.required || []).forEach((k) => { if (!(k in attrs)) add(where, `Atribut “${k}” wajib pada ${nameOf(node.type)}.`); });

      // Marks (inline nodes only).
      if (node.marks !== undefined) {
        if (!INLINE.includes(node.type) || !Array.isArray(node.marks)) add(where, `Format teks tidak valid pada ${nameOf(node.type)}.`);
        else {
          const seen = new Set();
          node.marks.forEach((mk) => {
            const ok = isObj(mk) && MARKS.has(mk.type) && Object.keys(mk).every((k) => k === 'type' || (k === 'attrs' && isObj(mk.attrs) && !Object.keys(mk.attrs).length));
            if (!ok) add(where, `Format teks ${isObj(mk) && typeof mk.type === 'string' ? `“${mk.type.slice(0, 40)}” ` : ''}tidak didukung.`);
            else if (seen.has(mk.type)) add(where, `Format teks “${mk.type}” ganda.`);
            else seen.add(mk.type);
          });
          if (parentType === 'clauseTitle' && node.marks.length) add(where, 'Judul klausul hanya berupa teks biasa tanpa format.');
        }
      }

      if (node.type === 'text') {
        if (typeof node.text !== 'string' || !node.text.length) add(where, 'Teks kosong atau tidak valid.');
        if (node.content !== undefined) add(where, 'Teks tidak boleh memiliki isi turunan.');
        return;
      }
      if (node.text !== undefined) add(where, `${nameOf(node.type)} tidak boleh memiliki properti teks.`);
      if (spec.leaf) {
        if (node.content !== undefined) add(where, `${nameOf(node.type)} tidak boleh memiliki isi turunan.`);
        return;
      }

      // Children.
      if (node.content !== undefined && !Array.isArray(node.content)) { add(where, `Isi ${nameOf(node.type)} tidak valid.`); return; }
      const kids = node.content || [];
      if (kids.length < (spec.min || 0)) add(where, `${node.type === 'doc' ? 'Dokumen' : nameOf(node.type)} tidak boleh kosong.`);
      if (spec.first && kids.length && isObj(kids[0]) && kids[0].type !== spec.first) {
        add(where, `${nameOf(node.type)} harus diawali paragraf.`);
      }
      if (node.type === 'consentClause') clauseIssues(node, kids, where);
      if (node.type === 'table') {
        const widths = kids.map((r) => (isObj(r) && Array.isArray(r.content) ? r.content.length : 0));
        if (widths.some((w) => w !== widths[0])) add(where, 'Setiap baris tabel harus memiliki jumlah sel yang sama.');
        presetIssues(node, kids, where);
      }
      kids.forEach((child, idx) => {
        const here = node.type === 'doc' ? `Blok ${idx + 1}` : where;
        visit(child, node.type, here, depth + 1);
      });
    };
    visit(envelope.document, null, '', 0);
    return issues;
  }

  const labelKey = (label) => label.trim().toLocaleLowerCase('id-ID');

  /**
   * Issues of one clause's option list (format version 4), shared with the
   * editor for inline messages. Each issue: { index, id, message }. Entries
   * with only `id` report a valid option ID (the caller checks uniqueness).
   * Labels: required, plain text (no HTML tags or < >, no {{ }}), at most
   * OPTION_LIMITS.label characters, unique after trimming, case-insensitive.
   */
  function optionIssues(options, required) {
    const out = [];
    if (!Array.isArray(options)) return [{ index: null, message: 'Pilihan jawaban harus berupa daftar.' }];
    if (options.length < OPTION_LIMITS.min || options.length > OPTION_LIMITS.max) {
      out.push({ index: null, message: `Jumlah pilihan jawaban harus ${OPTION_LIMITS.min}–${OPTION_LIMITS.max} (saat ini ${options.length}).` });
    }
    eachOptionIssues(options, ['id', 'label', 'qualifies'], out, (o, msg) => {
      if (typeof o.qualifies !== 'boolean') msg('Pengaturan “Memenuhi persyaratan” harus bernilai benar atau salah.');
    });
    if (required && !options.some((o) => isObj(o) && o.qualifies === true)) {
      out.push({ index: null, message: 'Klausul wajib dijawab harus memiliki minimal satu pilihan yang “Memenuhi persyaratan”.' });
    }
    return out;
  }

  /**
   * Issues of one format-5 clause: 0–2 options `{ id, label }` (label rules as
   * above) and `qualifyingOptionId`: null without options, the only option's
   * ID with one option, one of the two IDs with two options. Same issue shape
   * as optionIssues(); shared with the editor. Nothing is ever removed here:
   * more than two options is reported, never truncated.
   */
  function clauseOptionIssues(options, qualifyingOptionId) {
    if (!Array.isArray(options)) return [{ index: null, message: 'Pilihan jawaban harus berupa daftar.' }];
    const out = [];
    if (options.length > CLAUSE_OPTION_MAX) {
      out.push({ index: null, message: `Maksimal ${CLAUSE_OPTION_MAX} pilihan jawaban (saat ini ${options.length}). Hapus pilihan hingga tersisa paling banyak dua; tidak ada pilihan yang dihapus otomatis.` });
    }
    eachOptionIssues(options, ['id', 'label'], out);
    const ids = options.map((o) => (isObj(o) ? o.id : undefined));
    const q = qualifyingOptionId;
    const msg = (message) => out.push({ index: null, message });
    if (q !== null && typeof q !== 'string') msg('“Pilihan yang memenuhi syarat” tidak valid.');
    else if (!options.length) { if (q !== null) msg('Klausul tanpa pilihan (informasi saja) tidak boleh memiliki pilihan yang memenuhi syarat.'); }
    else if (options.length === 1) { if (q !== ids[0]) msg('Satu-satunya pilihan harus menjadi pilihan yang memenuhi syarat.'); }
    else if (q === null) msg('Tentukan satu “Pilihan yang memenuhi syarat”.');
    else if (!ids.includes(q)) msg('“Pilihan yang memenuhi syarat” harus merujuk ke salah satu pilihan klausul ini.');
    return out;
  }

  /** Per-option checks shared by formats 4 and 5 (ID, allowed keys, label rules, unique labels). */
  function eachOptionIssues(options, keys, out, more) {
    const seen = new Map();
    options.forEach((o, index) => {
      const msg = (message) => out.push({ index, message });
      if (!isObj(o)) { msg('Pilihan tidak valid.'); return; }
      const extra = Object.keys(o).filter((k) => !keys.includes(k));
      if (extra.length) msg('Properti tidak dikenal: ' + extra.map((k) => k.slice(0, 40)).join(', ') + '.');
      if (typeof o.id === 'string' && OPTION_ID_RE.test(o.id)) out.push({ index, id: o.id });
      else msg('ID pilihan tidak valid (dibuat otomatis oleh sistem).');
      if (more) more(o, msg);
      if (typeof o.label !== 'string') { msg('Label pilihan wajib berupa teks.'); return; }
      const label = o.label.trim();
      if (!label) { msg('Label pilihan wajib diisi.'); return; }
      if (label.length > OPTION_LIMITS.label) msg(`Label pilihan maksimal ${OPTION_LIMITS.label} karakter.`);
      if (/[<>]/.test(label)) msg('Label pilihan hanya berupa teks biasa (tanpa HTML atau tanda < >).');
      if (/\{\{|\}\}/.test(label)) msg('Label pilihan tidak boleh berisi placeholder atau kurung kurawal ganda {{ }}.');
      if (/[\u0000-\u001f\u007f]/.test(o.label)) msg('Label pilihan tidak boleh berisi baris baru atau karakter kontrol.');
      const key = labelKey(label);
      if (seen.has(key)) msg(`Label “${label.slice(0, 40)}” sama dengan pilihan ${seen.get(key) + 1} (huruf besar/kecil dan spasi di tepi diabaikan).`);
      else seen.set(key, index);
    });
  }

  /** Concatenated text of a node's text descendants. */
  function inlineText(node) {
    let out = '';
    walk(node, (n) => { if (n.type === 'text' && typeof n.text === 'string') out += n.text; });
    return out;
  }

  /**
   * Consent clauses of a document in order: { id, title, required } plus, for
   * format version 4, `options` ({ id, label, qualifies } in order, labels
   * trimmed). Version-3 clauses keep the original shape (fixed options).
   * Used to freeze clause metadata into user snapshots.
   */
  function clausesOf(envelope) {
    const doc = envelope && envelope.document;
    if (!isObj(doc) || !Array.isArray(doc.content)) return [];
    return doc.content.filter((n) => isObj(n) && n.type === 'consentClause').map((n) => {
      const base = { id: n.attrs.clauseId, title: inlineText(n.content[0]).trim() };
      if (clauseFormat(n) === QUALIFYING_SINCE) {
        return {
          ...base,
          options: n.attrs.options.map((o) => ({ id: o.id, label: o.label.trim() })),
          qualifyingOptionId: n.attrs.qualifyingOptionId,
        };
      }
      return {
        ...base,
        required: n.attrs.required === true,
        ...(Array.isArray(n.attrs.options) ? {
          options: n.attrs.options.map((o) => ({ id: o.id, label: o.label.trim(), qualifies: o.qualifies === true })),
        } : {}),
      };
    });
  }

  /** Options of a clause (node attrs or snapshot clause): its own, or the fixed version-3 options. */
  function clauseOptions(clause) {
    return clause && Array.isArray(clause.options) ? clause.options : FIXED_OPTIONS;
  }

  /**
   * Answer rule of a snapshot clause (any format):
   * { options, answerable, required, qualifying: [option IDs] }.
   * Format 5: a clause with options is answerable and required, and only
   * `qualifyingOptionId` qualifies; without options it takes no answer.
   * Formats 3–4 keep their rules (every clause answerable, `required` flag,
   * per-option `qualifies`; format 3 has the fixed “Tidak / Ya”).
   */
  function clauseRule(clause) {
    if (has(clause, 'qualifyingOptionId')) {
      const answerable = clause.options.length > 0;
      return { options: clause.options, answerable, required: answerable, qualifying: clause.qualifyingOptionId == null ? [] : [clause.qualifyingOptionId] };
    }
    const options = clauseOptions(clause);
    return { options, answerable: true, required: clause.required === true, qualifying: options.filter((o) => o.qualifies).map((o) => o.id) };
  }

  const countClauses = (envelope, test) => {
    let n = 0;
    walk(envelope && envelope.document, (x) => { if (x.type === 'consentClause' && test(x)) n++; });
    return n;
  };

  /** Number of fixed-option (format version 3) clauses. Such content is read-only history. */
  function fixedClauseCount(envelope) {
    return countClauses(envelope, (x) => clauseFormat(x) === CLAUSE_SINCE);
  }

  /** Number of clauses written for format 3 or 4. Readable history; never saved or published again. */
  function legacyClauseCount(envelope) {
    return countClauses(envelope, (x) => clauseFormat(x) < QUALIFYING_SINCE);
  }

  /**
   * For explicitly editing a draft or version in the editor: maps format-4
   * clauses to the format-5 shape. Every option is kept (ID and label, in
   * order, even beyond two). `qualifyingOptionId` is only carried over when it
   * is unambiguous (a required clause with exactly one qualifying option);
   * otherwise it is null and the admin must decide. The result may therefore
   * be invalid until corrected; nothing is saved by this function. Format-3
   * clauses are left alone (they need the explicit conversion). Returns
   * { content, migrated } with a new envelope; the source is not modified.
   */
  function editableClauses(envelope) {
    const doc = JSON.parse(JSON.stringify(envelope.document));
    let migrated = 0;
    doc.content.forEach((n) => {
      if (!isObj(n) || n.type !== 'consentClause' || clauseFormat(n) !== OPTIONS_SINCE || !Array.isArray(n.attrs.options)) return;
      const qualifying = n.attrs.options.filter((o) => isObj(o) && o.qualifies === true);
      n.attrs = {
        clauseId: n.attrs.clauseId,
        options: n.attrs.options.map((o) => (isObj(o) ? { id: o.id, label: o.label } : o)),
        qualifyingOptionId: n.attrs.required === true && qualifying.length === 1 ? qualifying[0].id : null,
      };
      migrated++;
    });
    return { content: migrated ? wrap(doc) : envelope, migrated };
  }

  /** Quoted option labels joined with “atau”, e.g. “A” atau “B”. */
  function labelList(labels) {
    const q = labels.map((l) => `“${l}”`);
    return q.length > 1 ? q.slice(0, -1).join(', ') + ' atau ' + q[q.length - 1] : (q[0] || '');
  }

  /**
   * Explicit conversion of fixed “Tidak / Ya” clauses into configurable
   * options, for a new editable draft only. Clause IDs and text stay; each
   * clause gets the options “Tidak” and “Ya” (new option IDs from `newId`),
   * with “Ya” qualifying, exactly matching the original rule. Returns a new
   * envelope; the source is not modified.
   */
  function convertFixedClauses(envelope, newId) {
    const doc = JSON.parse(JSON.stringify(envelope.document));
    doc.content.forEach((n) => {
      if (n.type !== 'consentClause' || n.attrs.options !== undefined) return;
      n.attrs = { ...n.attrs, options: FIXED_OPTIONS.map((o) => ({ id: newId(), label: o.label, qualifies: o.qualifies })) };
    });
    return wrap(doc);
  }

  function walk(node, fn) {
    if (!isObj(node)) return;
    fn(node);
    if (Array.isArray(node.content)) node.content.forEach((c) => walk(c, fn));
  }

  /** Text or an approved placeholder; empty paragraphs/tables, marks, and whitespace do not count. */
  function hasMeaningfulContent(envelope) {
    let found = false;
    walk(envelope && envelope.document, (n) => {
      if (n.type === 'text' && typeof n.text === 'string' && /\S/.test(n.text)) found = true;
      if (n.type === 'variable' && n.attrs && KNOWN.has(n.attrs.key)) found = true;
    });
    return found;
  }

  function contentSize(envelope) {
    return JSON.stringify(isObj(envelope) ? envelope.document : envelope ?? null).length;
  }

  function placeholderKeys(envelope) {
    const keys = [];
    walk(envelope && envelope.document, (n) => {
      if (n.type === 'variable' && n.attrs && !keys.includes(n.attrs.key)) keys.push(n.attrs.key);
    });
    return keys;
  }

  /** All content issues: structure first, then the content rules. */
  function contentIssues(envelope) {
    if (typeof envelope === 'string') {
      return [{ field: 'content', kind: 'format', message: 'Isi dokumen harus memakai format editor visual (richtext-json). Markdown hanya didukung untuk versi lama.' }];
    }
    const issues = structureIssues(envelope);
    const size = contentSize(envelope);
    if (size > LIMITS.contentJson) {
      issues.push({
        field: 'content', kind: 'length',
        message: `Ukuran isi dokumen maksimal ${LIMITS.contentJson.toLocaleString('id-ID')} karakter JSON (saat ini ${size.toLocaleString('id-ID')}). Kurangi isi dokumen; tidak ada teks yang dipotong otomatis.`,
      });
    }
    if (issues.length) return issues;
    if (!hasMeaningfulContent(envelope)) {
      issues.push({ field: 'content', kind: 'required', message: 'Isi dokumen wajib diisi.' });
    }
    let braces = 0;
    walk(envelope.document, (n) => { if (n.type === 'text' && /\{\{|\}\}/.test(n.text)) braces++; });
    if (braces) {
      issues.push({
        field: 'content', kind: 'format',
        message: 'Teks tidak boleh berisi kurung kurawal ganda {{ atau }}. Gunakan tombol “Sisipkan placeholder” untuk menyisipkan placeholder dari katalog.',
      });
    }
    return issues;
  }

  /** Validate a draft whose content is a rich-text envelope. Same rules for save and publish. */
  function validateDraft(draft) {
    return MD.validateMeta(draft).concat(contentIssues(draft.content));
  }

  /* ---------- Rendering ---------- */

  const esc = MD.escapeHtml;
  const MARK_TAGS = [['bold', 'strong'], ['italic', 'em'], ['underline', 'u']];

  function withMarks(html, marks) {
    const set = new Set((marks || []).map((m) => m.type));
    return MARK_TAGS.reduceRight((acc, [type, tag]) => (set.has(type) ? `<${tag}>${acc}</${tag}>` : acc), html);
  }

  const alignAttr = (attrs) => (attrs && (attrs.textAlign === 'center' || attrs.textAlign === 'right')
    ? ` class="align-${attrs.textAlign}"` : '');

  /**
   * Consent clause: a fieldset with a legend, the explanatory text, and one
   * radio group (unique name per clause, nothing checked). Version-3 clauses
   * keep their original fixed “Tidak / Ya” markup. Version-4 clauses list the
   * stored options in order (value = option ID) and state the requirement in
   * text: which options qualify, or that the clause is optional. Format-5
   * clauses without options render as a plain information block (no
   * controls); with options they always state the single qualifying option.
   * IDs derive
   * from validated clause/option IDs. `opts.preview` renders a separately-
   * prefixed, clearly labelled simulation for admin views.
   */
  function renderClause(node, kids, opts) {
    const preview = Boolean(opts && opts.preview);
    const id = node.attrs.clauseId;
    const base = (preview ? 'pv-' : '') + 'clause-' + id;
    const title = esc(inlineText(node.content[0]).trim());
    const body = `<div class="clause-body" id="${base}-desc">${kids(node.content[1].content)}</div>`;
    const v5 = clauseFormat(node) === QUALIFYING_SINCE;
    // Format 5 without options: an ordinary information block, no controls.
    if (v5 && !node.attrs.options.length) {
      return `<section class="clause clause-info" data-clause-id="${id}" aria-labelledby="${base}-title">` +
        `<p class="clause-title" id="${base}-title">${title}</p>${body}</section>`;
    }
    const required = v5 || node.attrs.required === true;
    const configurable = Array.isArray(node.attrs.options);
    const describedBy = [base + '-desc'].concat(required || configurable ? [base + '-req'] : []).concat(preview ? [base + '-sim'] : []).join(' ');
    const radio = (value, label) => `<label class="clause-option" for="${base}-${value}"><input type="radio" id="${base}-${value}" name="${base}" value="${value}"> <span>${esc(label)}</span></label>`;
    let req = '';
    let options;
    if (v5) {
      const list = node.attrs.options.map((o) => ({ ...o, label: o.label.trim() }));
      const q = list.find((o) => o.id === node.attrs.qualifyingOptionId);
      options = list.map((o) => radio(o.id, o.label)).join('');
      req = `<p class="clause-req" id="${base}-req"><strong>Wajib dijawab.</strong> Perjanjian hanya dapat disetujui dengan pilihan ${esc(labelList(q ? [q.label] : []))}.</p>`;
    } else if (configurable) {
      const list = node.attrs.options.map((o) => ({ ...o, label: o.label.trim() }));
      options = list.map((o) => radio(o.id, o.label)).join('');
      req = required
        ? `<p class="clause-req" id="${base}-req"><strong>Wajib dijawab.</strong> Perjanjian hanya dapat disetujui dengan pilihan ${esc(labelList(list.filter((o) => o.qualifies).map((o) => o.label)))}.</p>`
        : `<p class="clause-req clause-optional" id="${base}-req">Opsional — boleh tidak dijawab. Pilihan apa pun tidak menghalangi persetujuan.</p>`;
    } else {
      options = CLAUSE_ANSWERS.map((a) => radio(a.value, a.label)).join('');
      if (required) req = `<p class="clause-req" id="${base}-req">Wajib dijawab Ya</p>`;
    }
    return `<fieldset class="clause${required ? ' clause-required' : ''}" data-clause-id="${id}" data-required="${required}" aria-describedby="${describedBy}">` +
      `<legend class="clause-title">${title}</legend>` +
      (preview ? `<p class="clause-sim" id="${base}-sim">Simulasi pratinjau — pilihan tidak disimpan dan tidak dicatat sebagai jawaban.</p>` : '') +
      body +
      req +
      `<div class="clause-options">${options}</div></fieldset>`;
  }

  function renderNode(node, values, opts) {
    const kids = (list) => (list || []).map((c) => renderNode(c, values, opts)).join('');
    switch (node.type) {
      case 'text': return withMarks(esc(node.text), node.marks);
      case 'variable': {
        const key = node.attrs.key;
        const token = '{{' + key + '}}';
        const html = values && Object.prototype.hasOwnProperty.call(values, key)
          ? `<span class="ph-value" title="Nilai contoh untuk ${esc(token)}">${esc(String(values[key]))}</span>`
          : `<span class="ph-token">${esc(token)}</span>`;
        return withMarks(html, node.marks);
      }
      case 'paragraph': return `<p${alignAttr(node.attrs)}>${kids(node.content)}</p>`;
      // The document title is <h2>, so section headings start at <h3>.
      case 'heading': {
        const tag = 'h' + (node.attrs.level + 1);
        return `<${tag}${alignAttr(node.attrs)}>${kids(node.content)}</${tag}>`;
      }
      case 'bulletList': return `<ul>${kids(node.content)}</ul>`;
      case 'orderedList': {
        const start = node.attrs && node.attrs.start;
        return `<ol${start && start !== 1 ? ` start="${start}"` : ''}>${kids(node.content)}</ol>`;
      }
      case 'listItem': return `<li>${kids(node.content)}</li>`;
      case 'table': {
        const rows = node.content;
        if (presetOf(node) === LABEL_VALUE) {
          // Width class comes from the validated allowlist (20/25/30), never from stored CSS.
          const body = rows.map((r) => `<tr><th scope="row">${kids(r.content[0].content)}</th><td>${kids(r.content[1].content)}</td></tr>`).join('');
          return `<div class="kv-wrap"><table class="kv-table kv-w${node.attrs.labelWidth}"><colgroup><col class="kv-col-label"><col></colgroup><tbody>${body}</tbody></table></div>`;
        }
        const headRow = rows[0].content.every((c) => c.type === 'tableHeader');
        const row = (r, inHead) => '<tr>' + r.content.map((c) => {
          if (c.type === 'tableHeader') return `<th scope="${inHead ? 'col' : 'row'}">${kids(c.content)}</th>`;
          return `<td>${kids(c.content)}</td>`;
        }).join('') + '</tr>';
        const body = (headRow ? rows.slice(1) : rows).map((r) => row(r, false)).join('');
        return '<div class="table-wrap"><table>' +
          (headRow ? `<thead>${row(rows[0], true)}</thead>` : '') +
          (body ? `<tbody>${body}</tbody>` : '') + '</table></div>';
      }
      case 'consentClause': return renderClause(node, kids, opts);
      default: throw new Error('Unsupported node: ' + node.type);
    }
  }

  /**
   * Render a validated envelope to HTML. Throws if the structure is invalid.
   * `values` (optional) maps placeholder keys to plain-text values.
   * `opts.preview` (admin views) labels consent clauses as a simulation.
   */
  function renderDocument(envelope, values, opts) {
    const issues = structureIssues(envelope);
    if (issues.length) {
      const err = new Error('Dokumen tidak valid: ' + issues[0].message);
      err.issues = issues;
      throw err;
    }
    return envelope.document.content.map((n) => renderNode(n, values, opts)).join('\n');
  }

  /** Plain-text view (e.g. to show an admin's unsaved text after a conflict). */
  function plainText(envelope) {
    const out = [];
    const inline = (n) => (n.content || []).map((c) => {
      if (c.type === 'text') return c.text;
      if (c.type === 'variable') return '[' + ((KNOWN.get(c.attrs && c.attrs.key) || {}).label || '?') + ']';
      return inline(c);
    }).join('');
    const block = (n) => {
      if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'clauseTitle') out.push(inline(n));
      else if (n.type === 'tableRow') out.push((n.content || []).map((c) => (c.content || []).map(inline).join(' ')).join(' | '));
      else (n.content || []).forEach(block);
    };
    if (envelope && isObj(envelope.document)) block(envelope.document);
    return out.join('\n');
  }

  /* ---------- Legacy Markdown conversion ---------- */

  const textOf = (html) => html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e])
    .replace(/\s+/g, ' ').trim();

  /**
   * Convert supported legacy Markdown to a new envelope. Returns
   * `{ ok: true, content }` or `{ ok: false, errors }`. The result is checked
   * by the same validator, and its rendered text must equal the legacy
   * rendering; otherwise nothing is returned (no partial conversion).
   */
  function convertMarkdown(source) {
    const res = MD.toRichTextDocument(source);
    if (!res.document) return { ok: false, errors: res.errors };
    const content = wrap(res.document);
    const issues = contentIssues(content);
    if (issues.length) return { ok: false, errors: issues.map((i) => i.message) };
    if (textOf(renderDocument(content, null)) !== textOf(MD.renderMarkdown(source, null))) {
      return { ok: false, errors: ['Hasil konversi tidak sama persis dengan teks aslinya.'] };
    }
    return { ok: true, content };
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  /** Detached, frozen copy for storage. */
  function freezeCopy(envelope) {
    return deepFreeze(JSON.parse(JSON.stringify(envelope)));
  }

  const api = {
    FORMAT, FORMAT_VERSION, FORMAT_VERSIONS, RENDER_VERSION, TABLE_PRESETS, LIMITS, CLAUSE_ANSWERS, CLAUSE_ID_RE,
    OPTION_ID_RE, OPTION_LIMITS, CLAUSE_OPTION_MAX, optionIssues, clauseOptionIssues, clauseOptions, clauseRule, clauseFormat,
    fixedClauseCount, legacyClauseCount, editableClauses, convertFixedClauses, labelList, clausesOf, requiredVersion, isEnvelope, emptyContent, wrap, structureIssues, contentIssues,
    hasMeaningfulContent, contentSize, placeholderKeys, validateDraft, renderDocument, plainText,
    convertMarkdown, freezeCopy,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgreementRichText = api;
})(this);
