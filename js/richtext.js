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
 *   are fixed by the system (CLAUSE_ANSWERS) and never stored in documents.
 *   Clause IDs are unique within a document.
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
  const FORMAT_VERSION = 3; // latest supported
  const FORMAT_VERSIONS = [1, 2, 3];
  // 3: adds the consent-clause fieldset; rules for older nodes are unchanged.
  const RENDER_VERSION = 3;
  // Table presets: identifier -> allowed left-column widths (percent).
  // Visual styles are derived from these values; no style strings are stored.
  const TABLE_PRESETS = Object.freeze({
    labelValue: Object.freeze({ widths: Object.freeze([20, 25, 30]), defaultWidth: 25, since: 2 }),
  });
  const LABEL_VALUE = 'labelValue';
  const CLAUSE_SINCE = 3;
  const CLAUSE_ID_RE = /^cl_[a-z0-9]{10}$/;
  // Fixed answer options, in display order. Not configurable per document.
  const CLAUSE_ANSWERS = Object.freeze([
    Object.freeze({ value: 'tidak', label: 'Tidak' }),
    Object.freeze({ value: 'ya', label: 'Ya' }),
  ]);
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
      attrs: { clauseId: (v) => typeof v === 'string' && CLAUSE_ID_RE.test(v), required: (v) => typeof v === 'boolean' },
      required: ['clauseId', 'required'],
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

  /** Lowest format version able to express the document. */
  function requiredVersion(document) {
    let v = 1;
    walk(document, (n) => {
      if (n.type === 'table' && presetOf(n) !== null) v = Math.max(v, 2);
      if (n.type === 'consentClause') v = Math.max(v, CLAUSE_SINCE);
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
          else if (k === 'required') add(where, 'Pengaturan “Wajib dijawab Ya” harus bernilai benar atau salah.');
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

  /** Concatenated text of a node's text descendants. */
  function inlineText(node) {
    let out = '';
    walk(node, (n) => { if (n.type === 'text' && typeof n.text === 'string') out += n.text; });
    return out;
  }

  /**
   * Consent clauses of a document in order: { id, title, required }. The
   * title is plain text. Used to freeze clause metadata into user snapshots.
   */
  function clausesOf(envelope) {
    const doc = envelope && envelope.document;
    if (!isObj(doc) || !Array.isArray(doc.content)) return [];
    return doc.content.filter((n) => isObj(n) && n.type === 'consentClause').map((n) => ({
      id: n.attrs.clauseId,
      title: inlineText(n.content[0]).trim(),
      required: n.attrs.required === true,
    }));
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
   * Consent clause: a fieldset with a legend, the explanatory text, and the
   * fixed “Tidak / Ya” radio group (unique name per clause, nothing checked).
   * IDs derive from the validated clause ID. `opts.preview` renders a
   * separately-prefixed, clearly labelled simulation for admin views.
   */
  function renderClause(node, kids, opts) {
    const preview = Boolean(opts && opts.preview);
    const id = node.attrs.clauseId;
    const base = (preview ? 'pv-' : '') + 'clause-' + id;
    const required = node.attrs.required === true;
    const describedBy = [base + '-desc'].concat(required ? [base + '-req'] : []).concat(preview ? [base + '-sim'] : []).join(' ');
    const options = CLAUSE_ANSWERS.map((a) => `<label class="clause-option" for="${base}-${a.value}"><input type="radio" id="${base}-${a.value}" name="${base}" value="${a.value}"> <span>${a.label}</span></label>`).join('');
    return `<fieldset class="clause${required ? ' clause-required' : ''}" data-clause-id="${id}" data-required="${required}" aria-describedby="${describedBy}">` +
      `<legend class="clause-title">${esc(inlineText(node.content[0]).trim())}</legend>` +
      (preview ? `<p class="clause-sim" id="${base}-sim">Simulasi pratinjau — pilihan tidak disimpan dan tidak dicatat sebagai jawaban.</p>` : '') +
      `<div class="clause-body" id="${base}-desc">${kids(node.content[1].content)}</div>` +
      (required ? `<p class="clause-req" id="${base}-req">Wajib dijawab Ya</p>` : '') +
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
    FORMAT, FORMAT_VERSION, FORMAT_VERSIONS, RENDER_VERSION, TABLE_PRESETS, LIMITS, CLAUSE_ANSWERS, CLAUSE_ID_RE, clausesOf, requiredVersion, isEnvelope, emptyContent, wrap, structureIssues, contentIssues,
    hasMeaningfulContent, contentSize, placeholderKeys, validateDraft, renderDocument, plainText,
    convertMarkdown, freezeCopy,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgreementRichText = api;
})(this);
