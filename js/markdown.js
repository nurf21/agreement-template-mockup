/*
 * Safe, deliberately small Markdown subset: headings, paragraphs, bold, italic,
 * ordered/unordered lists, and tables. Everything else is escaped and shown as
 * literal text. Placeholder values are substituted after inline parsing and are
 * always escaped, so they render as plain text, never as Markdown or HTML.
 */
(function (root) {
  'use strict';

  // Fixed, system-defined catalogue. Administrators cannot add variables.
  const PLACEHOLDERS = Object.freeze([
    Object.freeze({
      key: 'nama_lengkap',
      label: 'Nama lengkap',
      description: 'Contoh ilustratif. Katalog final ditetapkan oleh sistem.',
      provisional: true,
      sample: 'Dewi Lestari (contoh)',
    }),
  ]);
  const KNOWN = new Map(PLACEHOLDERS.map((p) => [p.key, p]));
  const SAMPLE_VALUES = Object.freeze(
    Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.sample]))
  );
  const LIMITS = Object.freeze({ internalName: 80, title: 150, content: 20000 });

  const KEY_RE = /^[a-z0-9_]+$/;
  const PH_RE = /\{\{([a-z0-9_]+)\}\}/g;
  const S_OPEN = '';
  const S_CLOSE = '';
  const SLOT_RE = new RegExp(S_OPEN + '(\\d+)' + S_CLOSE, 'g');

  const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
  const UL_RE = /^\s*[-*+]\s+(.*)$/;
  const OL_RE = /^\s*(\d{1,9})[.)]\s+(.*)$/;
  const ROW_RE = /^\s*\|.*\|\s*$/;
  const SEP_RE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function placeholderHtml(key, values) {
    const token = '{{' + key + '}}';
    if (!KNOWN.has(key)) {
      return `<span class="ph-unknown" title="Placeholder tidak dikenal">${escapeHtml(token)}</span>`;
    }
    if (values && Object.prototype.hasOwnProperty.call(values, key)) {
      return `<span class="ph-value" title="Nilai contoh untuk ${escapeHtml(token)}">${escapeHtml(values[key])}</span>`;
    }
    return `<span class="ph-token">${escapeHtml(token)}</span>`;
  }

  function renderInline(text, values) {
    const slots = [];
    let s = String(text).split(S_OPEN).join('').split(S_CLOSE).join('');
    s = s.replace(PH_RE, (_, key) => {
      slots.push(key);
      return S_OPEN + (slots.length - 1) + S_CLOSE;
    });
    s = escapeHtml(s);
    s = s.replace(/\*\*(?=[^\s*])([^<>]*?[^\s*])\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(?=[^\s_])([^<>]*?[^\s_])__/g, '<strong>$1</strong>');
    s = s.replace(/\*(?=[^\s*])([^<>*]*?[^\s*])\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^A-Za-z0-9_])_(?=[^\s_])([^<>_]*?[^\s_])_(?![A-Za-z0-9_])/g, '$1<em>$2</em>');
    return s.replace(SLOT_RE, (_, i) => placeholderHtml(slots[Number(i)], values));
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function startsTable(lines, i) {
    return ROW_RE.test(lines[i]) && i + 1 < lines.length && SEP_RE.test(lines[i + 1]);
  }

  /**
   * Read the table starting at `i` (header, separator, data rows). `bad` lists
   * every row whose column count differs from the header, with 1-based lines.
   * Shared by the renderer and the validator so both see the same tables.
   */
  function readTable(lines, i) {
    const start = i;
    const rows = [splitRow(lines[i]), splitRow(lines[i + 1])];
    i += 2;
    while (i < lines.length && ROW_RE.test(lines[i])) rows.push(splitRow(lines[i++]));
    const cols = rows[0].length;
    const bad = [];
    rows.forEach((r, k) => {
      if (r.length !== cols) bad.push({ line: start + k + 1, count: r.length, separator: k === 1 });
    });
    return { start, end: i, cols, head: rows[0], body: rows.slice(2), bad };
  }

  function toLines(source) {
    return String(source).replace(/\r\n?/g, '\n').split('\n');
  }

  /**
   * Render the supported subset to HTML. The shallowest heading level in the
   * document becomes <h3> so content sits under the document title (<h2>).
   */
  function renderMarkdown(source, values) {
    const lines = toLines(source);
    const levels = lines.map((l) => HEADING_RE.exec(l)).filter(Boolean).map((m) => m[1].length);
    const offset = 3 - (levels.length ? Math.min(...levels) : 1);
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^\s*$/.test(line)) { i++; continue; }

      if ((m = HEADING_RE.exec(line))) {
        const tag = 'h' + (m[1].length + offset);
        out.push(`<${tag}>${renderInline(m[2], values)}</${tag}>`);
        i++;
        continue;
      }

      if (startsTable(lines, i)) {
        const tbl = readTable(lines, i);
        i = tbl.end;
        if (tbl.bad.length) {
          // Never drop cells: show the whole malformed block verbatim instead.
          out.push(
            '<div class="md-invalid" role="note"><p>Tabel pada baris ' + (tbl.start + 1) +
            ' tidak dapat ditampilkan sebagai tabel karena jumlah kolomnya tidak sama (baris ' +
            tbl.bad.map((b) => b.line).join(', ') + '). Teks ditampilkan apa adanya.</p><pre>' +
            escapeHtml(lines.slice(tbl.start, tbl.end).join('\n')) + '</pre></div>'
          );
          continue;
        }
        const cells = (row, tag) => row.map((cell) => {
          const attr = tag === 'th' ? ' scope="col"' : '';
          return `<${tag}${attr}>${renderInline(cell, values)}</${tag}>`;
        }).join('');
        out.push(
          '<div class="table-wrap"><table><thead><tr>' + cells(tbl.head, 'th') + '</tr></thead>' +
          (tbl.body.length ? '<tbody>' + tbl.body.map((r) => '<tr>' + cells(r, 'td') + '</tr>').join('') + '</tbody>' : '') +
          '</table></div>'
        );
        continue;
      }

      if (UL_RE.test(line)) {
        const items = [];
        while (i < lines.length && (m = UL_RE.exec(lines[i]))) { items.push(m[1]); i++; }
        out.push('<ul>' + items.map((t) => `<li>${renderInline(t, values)}</li>`).join('') + '</ul>');
        continue;
      }

      if ((m = OL_RE.exec(line))) {
        const start = Number(m[1]);
        const items = [];
        while (i < lines.length && (m = OL_RE.exec(lines[i]))) { items.push(m[2]); i++; }
        const attr = start !== 1 ? ` start="${start}"` : '';
        out.push(`<ol${attr}>` + items.map((t) => `<li>${renderInline(t, values)}</li>`).join('') + '</ol>');
        continue;
      }

      const para = [];
      while (
        i < lines.length && !/^\s*$/.test(lines[i]) && !HEADING_RE.test(lines[i]) &&
        !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) && !startsTable(lines, i)
      ) {
        para.push(lines[i].trim());
        i++;
      }
      if (!para.length) { i++; continue; }
      out.push(`<p>${renderInline(para.join(' '), values)}</p>`);
    }
    return out.join('\n');
  }

  function shorten(s) {
    return s.length > 30 ? s.slice(0, 30) + '…' : s;
  }

  function contentIssues(content) {
    const issues = [];
    const lines = toLines(content);
    lines.forEach((line, idx) => {
      const n = idx + 1;
      const add = (message) => issues.push({ field: 'content', kind: 'format', line: n, message: `Baris ${n}: ${message}` });
      if (/<\/?[A-Za-z][^>]*>|<!--|<\?/.test(line)) add('HTML mentah tidak diizinkan.');
      if (/!\[[^\]]*\]\(/.test(line)) add('Gambar tidak didukung.');
      if (/\$\{/.test(line)) add('Ekspresi ${…} tidak diizinkan.');
      if (/\{\{\{|\}\}\}/.test(line)) add('Kurung kurawal tiga lapis tidak diizinkan. Gunakan {{nama_placeholder}}.');
      const rest = line.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
        if (KEY_RE.test(inner)) {
          if (!KNOWN.has(inner)) add(`Placeholder {{${inner}}} tidak ada dalam katalog sistem. Variabel kustom tidak didukung.`);
        } else if (KNOWN.has(inner.trim())) {
          add(`Hapus spasi di dalam placeholder: gunakan {{${inner.trim()}}}.`);
        } else {
          add(`Ekspresi {{${shorten(inner)}}} tidak diizinkan. Hanya placeholder dari katalog yang dapat dipakai.`);
        }
        return '';
      });
      if (/\{\{|\}\}/.test(rest)) add('Kurung placeholder tidak lengkap. Gunakan format {{nama_placeholder}}.');
    });

    // Tables: header, separator, and every data row need the same column count.
    for (let i = 0; i < lines.length;) {
      if (!startsTable(lines, i)) { i++; continue; }
      const tbl = readTable(lines, i);
      tbl.bad.forEach((b) => {
        const which = b.separator ? 'Baris pemisah tabel' : 'Baris tabel';
        issues.push({
          field: 'content', kind: 'table', line: b.line,
          message: `Baris ${b.line}: ${which} memiliki ${b.count} kolom, sedangkan header tabel (baris ${tbl.start + 1}) memiliki ${tbl.cols} kolom. Samakan jumlah kolom di setiap baris tabel.`,
        });
      });
      i = tbl.end;
    }
    return issues.sort((a, b) => a.line - b.line);
  }

  /**
   * Internal name and title rules, shared by every content format.
   */
  function validateMeta(draft) {
    const errors = [];
    const name = String(draft.internalName || '').trim();
    const title = String(draft.title || '').trim();
    const err = (field, kind, message) => errors.push({ field, kind, message });

    if (!name) err('internalName', 'required', 'Nama internal wajib diisi.');
    else if (name.length > LIMITS.internalName) {
      err('internalName', 'length', `Nama internal maksimal ${LIMITS.internalName} karakter (saat ini ${name.length}).`);
    }

    if (!title) err('title', 'required', 'Judul dokumen wajib diisi.');
    if (title.length > LIMITS.title) err('title', 'length', `Judul dokumen maksimal ${LIMITS.title} karakter (saat ini ${title.length}).`);
    if (/[<>]/.test(title)) err('title', 'format', 'Judul dokumen harus teks biasa; karakter < dan > tidak diizinkan.');
    if (/\{\{|\}\}/.test(title)) err('title', 'format', 'Judul dokumen tidak boleh berisi placeholder.');
    return errors;
  }

  /**
   * Validate legacy Markdown draft fields. The same rules apply to saving and
   * publishing: internal name, title, and content must all contain text.
   */
  function validateDraft(draft) {
    const errors = validateMeta(draft);
    const content = String(draft.content || '');
    const err = (field, kind, message) => errors.push({ field, kind, message });

    if (!content.trim()) err('content', 'required', 'Isi dokumen wajib diisi.');
    if (content.length > LIMITS.content) {
      err('content', 'length', `Isi dokumen maksimal ${LIMITS.content} karakter (saat ini ${content.length}).`);
    }
    return errors.concat(contentIssues(content));
  }

  /* ---------- Legacy conversion (explicit, admin-initiated only) ---------- */

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  const INLINE_TOKEN_RE = /<(\/?)(strong|em)>|<span class="ph-token">\{\{([a-z0-9_]+)\}\}<\/span>|<[^>]*>|&(amp|lt|gt|quot|#39);|[^<&]+|&/g;
  const MARK_OF = { strong: 'bold', em: 'italic' };

  /**
   * Convert one inline Markdown run to rich-text nodes. It reuses the legacy
   * inline renderer and reads back its small, fixed HTML output, so the result
   * has exactly the formatting the legacy renderer shows. Any other tag (e.g.
   * an unknown placeholder) is reported instead of being dropped.
   */
  function inlineToNodes(text, fail) {
    const nodes = [];
    const open = [];
    const push = (node) => {
      const marks = open.map((type) => ({ type }));
      if (marks.length) node.marks = marks;
      const prev = nodes[nodes.length - 1];
      if (node.type === 'text' && prev && prev.type === 'text' &&
          JSON.stringify(prev.marks || []) === JSON.stringify(node.marks || [])) {
        prev.text += node.text;
      } else nodes.push(node);
    };
    const html = renderInline(text, null);
    for (const m of html.matchAll(INLINE_TOKEN_RE)) {
      const [tok, close, tag, key, entity] = m;
      if (tag) {
        if (!close) open.push(MARK_OF[tag]);
        else if (open[open.length - 1] === MARK_OF[tag]) open.pop();
        else return fail('Format tebal/miring tidak berpasangan dengan benar.');
      } else if (key) {
        if (!KNOWN.has(key)) return fail(`Placeholder {{${key}}} tidak ada dalam katalog sistem.`);
        push({ type: 'variable', attrs: { key } });
      } else if (tok[0] === '<') {
        return fail(/ph-unknown/.test(tok)
          ? 'Placeholder tidak dikenal tidak dapat dikonversi.'
          : 'Bagian teks tidak dapat dikonversi dengan aman.');
      } else if (entity) push({ type: 'text', text: ENTITIES[entity] });
      else push({ type: 'text', text: tok });
    }
    if (open.length) return fail('Format tebal/miring tidak ditutup.');
    return nodes;
  }

  /**
   * Build a rich-text document (`{type: 'doc', ...}`) from the supported
   * Markdown subset. Returns `{ document, errors }`; `document` is null when
   * anything cannot be preserved faithfully. Never returns a partial result.
   */
  function toRichTextDocument(source) {
    const src = String(source || '');
    const errors = [];
    if (!src.trim()) errors.push('Isi dokumen kosong.');
    contentIssues(src).forEach((i) => errors.push(i.message));
    if (src.length > LIMITS.content) errors.push(`Isi dokumen melebihi ${LIMITS.content} karakter.`);
    const lines = toLines(src);
    const levels = Array.from(new Set(lines.map((l) => HEADING_RE.exec(l)).filter(Boolean).map((m) => m[1].length))).sort();
    if (levels.length > 2) {
      errors.push('Dokumen memakai tiga tingkat judul (#, ##, ###). Editor visual hanya mendukung dua tingkat: judul bagian dan subjudul.');
    }
    if (errors.length) return { document: null, errors };

    const content = [];
    let i = 0;
    const fail = (message) => { errors.push(`Baris ${i + 1}: ${message}`); return []; };
    const para = (text) => {
      const inline = inlineToNodes(text, fail);
      return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
    };
    const list = (re, idx) => {
      const items = [];
      let m;
      while (i < lines.length && (m = re.exec(lines[i]))) {
        items.push({ type: 'listItem', content: [para(m[idx])] });
        i++;
      }
      return items;
    };

    while (i < lines.length && !errors.length) {
      const line = lines[i];
      let m;
      if (/^\s*$/.test(line)) { i++; continue; }
      if ((m = HEADING_RE.exec(line))) {
        const inline = inlineToNodes(m[2], fail);
        content.push({ type: 'heading', attrs: { level: levels.indexOf(m[1].length) + 2 }, content: inline });
        i++;
        continue;
      }
      if (startsTable(lines, i)) {
        const tbl = readTable(lines, i);
        const row = (cells, type) => ({ type: 'tableRow', content: cells.map((c) => ({ type, content: [para(c)] })) });
        content.push({ type: 'table', content: [row(tbl.head, 'tableHeader')].concat(tbl.body.map((r) => row(r, 'tableCell'))) });
        i = tbl.end;
        continue;
      }
      if (UL_RE.test(line)) { content.push({ type: 'bulletList', content: list(UL_RE, 1) }); continue; }
      if ((m = OL_RE.exec(line))) {
        const start = Number(m[1]);
        content.push({ type: 'orderedList', attrs: { start }, content: list(OL_RE, 2) });
        continue;
      }
      const buf = [];
      while (
        i < lines.length && !/^\s*$/.test(lines[i]) && !HEADING_RE.test(lines[i]) &&
        !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) && !startsTable(lines, i)
      ) {
        buf.push(lines[i].trim());
        i++;
      }
      if (!buf.length) { i++; continue; }
      content.push(para(buf.join(' ')));
    }
    if (errors.length) return { document: null, errors };
    return { document: { type: 'doc', content }, errors: [] };
  }

  const api = {
    PLACEHOLDERS, SAMPLE_VALUES, LIMITS, escapeHtml, renderMarkdown, validateMeta, validateDraft,
    toRichTextDocument,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgreementMarkdown = api;
})(this);
