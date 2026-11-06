/*
 * Visual editor bundle (built with esbuild into dist/editor.js, global
 * `AgreementEditor`). Tiptap/ProseMirror with only the nodes and marks the
 * richtext-json format allows; the editor schema drops anything else on paste
 * (scripts, images, links, styles, unsupported blocks). The stored JSON is
 * validated again by js/richtext.js before save and publish.
 */
import { Editor, Extension, Node, mergeAttributes, findParentNode } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { OrderedList, ListItem } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

// Only `start` is kept; list style types from pasted HTML are ignored.
const PlainOrderedList = OrderedList.extend({
  addAttributes() {
    return { start: this.parent().start };
  },
});

// No merged-cell widths or per-cell alignment from pasted HTML.
function cellAttributes() {
  const parent = this.parent();
  return {
    colspan: parent.colspan,
    rowspan: parent.rowspan,
    colwidth: { default: null, parseHTML: () => null },
  };
}
// Content models match js/richtext.js: cells and list items hold only
// paragraphs and lists (no headings or nested tables).
const CELL_CONTENT = '(paragraph | bulletList | orderedList)+';
const PlainCell = TableCell.extend({ content: CELL_CONTENT, addAttributes: cellAttributes });
const PlainHeader = TableHeader.extend({ content: CELL_CONTENT, addAttributes: cellAttributes });
const PlainListItem = ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList)*' });

/*
 * Table preset “labelValue” (format version 2): exactly two columns, left
 * cells are row labels (tableHeader), right cells are values (tableCell), no
 * merged cells, and a left-column width from a fixed allowlist. Only the
 * preset identifier and the width number are stored; the look comes from CSS
 * classes derived from them. Ordinary tables keep `preset: null`.
 */
export const LABEL_VALUE = 'labelValue';
export const LABEL_WIDTHS = [20, 25, 30];
const DEFAULT_LABEL_WIDTH = 25;

const PresetTable = Table.extend({
  addOptions() {
    return { ...this.parent(), onRejectPreset: () => {} };
  },

  addAttributes() {
    return {
      preset: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-preset') === LABEL_VALUE ? LABEL_VALUE : null),
        renderHTML: (attrs) => (attrs.preset === LABEL_VALUE ? { 'data-preset': LABEL_VALUE, class: 'kv-table' } : {}),
      },
      labelWidth: {
        default: null,
        parseHTML: (el) => {
          const n = Number(el.getAttribute('data-label-width'));
          return LABEL_WIDTHS.includes(n) ? n : null;
        },
        renderHTML: (attrs) => (LABEL_WIDTHS.includes(attrs.labelWidth)
          ? { 'data-label-width': String(attrs.labelWidth), class: `kv-w${attrs.labelWidth}` } : {}),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent(),
      insertLabelValueTable: () => ({ tr, dispatch, editor }) => {
        const cell = (type) => ({ type, content: [{ type: 'paragraph' }] });
        const row = { type: 'tableRow', content: [cell('tableHeader'), cell('tableCell')] };
        const node = editor.schema.nodeFromJSON({
          type: 'table',
          attrs: { preset: LABEL_VALUE, labelWidth: DEFAULT_LABEL_WIDTH },
          content: [row, row, row],
        });
        if (dispatch) {
          const offset = tr.selection.from + 1;
          tr.replaceSelectionWith(node).scrollIntoView()
            .setSelection(TextSelection.near(tr.doc.resolve(offset)));
        }
        return true;
      },
      setLabelWidth: (width) => ({ state, tr, dispatch }) => {
        if (!LABEL_WIDTHS.includes(width)) return false;
        const found = findParentNode((n) => n.type.name === 'table')(state.selection);
        if (!found || found.node.attrs.preset !== LABEL_VALUE) return false;
        if (dispatch) tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, labelWidth: width });
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const onReject = this.options.onRejectPreset;
    // Refuse any change that would break a label–value table's structure
    // (extra columns, merged cells, changed cell kinds, missing width), e.g.
    // from pasting a wider table into it. Documents that were already invalid
    // are not blocked, so the admin can still repair them.
    const guard = new Plugin({
      key: new PluginKey('labelValueGuard'),
      filterTransaction: (tr, state) => {
        if (!tr.docChanged || !invalidPreset(tr.doc) || invalidPreset(state.doc)) return true;
        setTimeout(onReject, 0);
        return false;
      },
    });
    return [...this.parent(), guard];
  },
});

function invalidPreset(doc) {
  let bad = false;
  doc.descendants((node) => {
    if (bad) return false;
    if (node.type.name !== 'table') return !node.isTextblock;
    const { preset, labelWidth } = node.attrs;
    if (preset === null) { if (labelWidth !== null) bad = true; return true; }
    if (preset !== LABEL_VALUE || !LABEL_WIDTHS.includes(labelWidth)) { bad = true; return false; }
    node.forEach((row) => {
      if (row.childCount !== 2 || row.child(0).type.name !== 'tableHeader' || row.child(1).type.name !== 'tableCell') bad = true;
      row.forEach((c) => { if (c.attrs.colspan !== 1 || c.attrs.rowspan !== 1) bad = true; });
    });
    return false; // cells cannot contain tables
  });
  return bad;
}

/**
 * System-defined placeholder: an atomic inline node whose only attribute is a
 * catalogue key. Shown as a labelled chip; the key cannot be edited.
 */
const Variable = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { catalogue: [] };
  },

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-variable'),
        renderHTML: (attrs) => ({ 'data-variable': attrs.key }),
      },
    };
  },

  parseHTML() {
    const known = (key) => this.options.catalogue.some((p) => p.key === key);
    // Unknown keys do not match, so their text is kept as plain text.
    return [{ tag: 'span[data-variable]', getAttrs: (el) => (known(el.getAttribute('data-variable')) ? null : false) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = labelOf(this.options.catalogue, node.attrs.key);
    return ['span', mergeAttributes(HTMLAttributes, {
      class: 'ph-chip', contenteditable: 'false', title: `Placeholder sistem: ${label}`,
    }), label];
  },

  renderText({ node }) {
    return `[${labelOf(this.options.catalogue, node.attrs.key)}]`;
  },

  addCommands() {
    return {
      insertVariable: (key) => ({ commands }) => {
        if (!this.options.catalogue.some((p) => p.key === key)) return false;
        return commands.insertContent({ type: this.name, attrs: { key } });
      },
    };
  },
});

function labelOf(catalogue, key) {
  const p = catalogue.find((x) => x.key === key);
  return p ? p.label : key;
}

/*
 * Consent clause (“Klausul persetujuan”, format version 5): a top-level block
 * holding exactly a plain-text title and explanatory text (paragraphs and
 * lists). Attributes: a system-generated `clauseId`, `options`: 0–2
 * administrator-defined answers { id (system-generated), label (plain text) },
 * and `qualifyingOptionId`. Behaviour follows the option count: no options =
 * information only (null); one option = it qualifies automatically; two
 * options = the admin picks exactly one (“Pilihan yang memenuhi syarat”).
 * Options are edited in a form below the text (node view); renaming or
 * reordering keeps IDs. The document schema allows clauses only at the top
 * level, so they cannot be nested in clauses, lists, or tables.
 */
export const CLAUSE_ID_RE = /^cl_[a-z0-9]{10}$/;
export const OPTION_ID_RE = /^op_[a-z0-9]{10}$/;
const OPTION_MAX = 2;
const LABEL_MAX = 80;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function newId(prefix, taken) {
  for (;;) {
    const bytes = new Uint8Array(10);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const id = prefix + '_' + Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

function clauseIdsIn(doc) {
  const ids = new Set();
  doc.forEach((n) => { if (n.type.name === 'consentClause' && n.attrs.clauseId) ids.add(n.attrs.clauseId); });
  return ids;
}

function optionIdsIn(doc) {
  const ids = new Set();
  doc.forEach((n) => { if (n.type.name === 'consentClause' && Array.isArray(n.attrs.options)) n.attrs.options.forEach((o) => ids.add(o.id)); });
  return ids;
}

const emptyOption = (taken) => ({ id: newId('op', taken), label: '' });

/**
 * The qualifying option implied by the option count: none without options,
 * the only option with one, otherwise the current choice if it still names
 * one of the options (else null: the admin must choose). Never inferred
 * from labels or order.
 */
export function qualifyingFor(options, current) {
  if (!options.length) return null;
  if (options.length === 1) return options[0].id;
  return options.some((o) => o.id === current) ? current : null;
}

/** Options from pasted/serialized HTML: shape only (validated again on save); null if unusable. */
function parseOptions(raw) {
  let list;
  try { list = JSON.parse(raw || ''); } catch (_) { return null; }
  if (!Array.isArray(list) || list.length > 20) return null;
  return list.map((o) => ({
    id: o && typeof o.id === 'string' ? o.id : '',
    label: o && typeof o.label === 'string' ? o.label.slice(0, 200) : '',
  }));
}

const ClauseTitle = Node.create({
  name: 'clauseTitle',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-clause-title]' }],
  renderHTML: () => ['div', { 'data-clause-title': '', class: 'clause-edit-title' }, 0],
});

const ClauseBody = Node.create({
  name: 'clauseBody',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-clause-body]' }],
  renderHTML: () => ['div', { 'data-clause-body': '', class: 'clause-edit-body' }, 0],
});

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v)); });
  kids.forEach((k) => el.append(k));
  return el;
}

/** Short state shown in the clause head and above the options. */
function clauseState(count) {
  if (!count) return 'Informasi saja';
  if (count === 1) return 'Pilihan ini otomatis memenuhi syarat';
  return 'Pengguna harus memilih pilihan yang memenuhi syarat';
}

/**
 * Editing view of a clause: read-only head (kind, behaviour, ID), the
 * editable title/text (contentDOM), and a form for the answer options:
 * label inputs, move up/down, remove, add (at most two), and — with two or
 * more options — the single-choice “Pilihan yang memenuhi syarat”. Every
 * change is one editor transaction (undoable). `issuesOf(options,
 * qualifyingOptionId)` gives inline messages (the same rules as
 * js/richtext.js).
 */
class ClauseView {
  constructor(node, getPos, editor, issuesOf) {
    this.node = node;
    this.getPos = getPos;
    this.editor = editor;
    this.issuesOf = issuesOf;
    this.key = null;
    this.focusAfter = null;
    this.tagEl = h('span', { class: 'clause-edit-tag' }, 'Klausul persetujuan');
    this.reqEl = h('span', { class: 'clause-edit-req' });
    this.idEl = h('span', { class: 'clause-edit-id' });
    this.head = h('div', { class: 'clause-edit-head', contenteditable: 'false' }, this.tagEl, this.reqEl, this.idEl);
    this.contentDOM = h('div', { class: 'clause-edit-content' });
    this.list = h('ol', { class: 'clause-opts' });
    this.qualSet = h('fieldset', { class: 'clause-qual' });
    this.addBtn = h('button', { type: 'button', class: 'clause-opt-add', 'data-role': 'add' }, '+ Tambah pilihan');
    this.state = h('p', { class: 'clause-opts-state' });
    this.hint = h('p', { class: 'clause-opts-hint' });
    this.clauseErr = h('p', { class: 'clause-opts-err' });
    this.legend = h('p', { class: 'clause-opts-h' }, 'Pilihan jawaban');
    this.panel = h('div', { class: 'clause-edit-options', contenteditable: 'false', role: 'group' },
      this.legend, this.state, this.hint, this.list, this.qualSet, this.addBtn, this.clauseErr);
    this.dom = h('section', { class: 'clause-edit' }, this.head, this.contentDOM, this.panel);
    this.panel.addEventListener('input', (ev) => this.onInput(ev));
    this.panel.addEventListener('change', (ev) => this.onChange(ev));
    this.panel.addEventListener('click', (ev) => this.onClick(ev));
    // Enter in a label must not submit the surrounding form.
    this.panel.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('input')) ev.preventDefault(); });
    this.render();
  }

  get options() { return Array.isArray(this.node.attrs.options) ? this.node.attrs.options : []; }

  /** One transaction: new options and the qualifying option they imply (`choice` = admin's pick). */
  setOptions(next, focusAfter, choice) {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.focusAfter = focusAfter || null;
    const qualifyingOptionId = qualifyingFor(next, choice === undefined ? this.node.attrs.qualifyingOptionId : choice);
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, options: next, qualifyingOptionId }));
  }

  rowOf(el) {
    const li = el.closest('li[data-option-id]');
    const index = li ? this.options.findIndex((o) => o.id === li.dataset.optionId) : -1;
    return index < 0 ? null : index;
  }

  onInput(ev) {
    const i = this.rowOf(ev.target);
    if (i == null || ev.target.dataset.role !== 'label') return;
    const next = this.options.map((o, j) => (j === i ? { ...o, label: ev.target.value } : o));
    this.setOptions(next);
  }

  onChange(ev) {
    if (ev.target.dataset.role === 'qualifying') {
      if (ev.target.checked && ev.target.value !== this.node.attrs.qualifyingOptionId) {
        this.setOptions(this.options, { id: ev.target.value, role: 'qualifying' }, ev.target.value);
      }
      return;
    }
    const i = this.rowOf(ev.target);
    if (i == null) return;
    if (ev.target.dataset.role === 'label' && ev.target.value.trim() !== ev.target.value) {
      this.setOptions(this.options.map((x, j) => (j === i ? { ...x, label: ev.target.value.trim() } : x)));
    }
  }

  onClick(ev) {
    const btn = ev.target.closest('button');
    if (!btn || btn.disabled) return;
    const opts = this.options.slice();
    const role = btn.dataset.role;
    if (role === 'add') {
      if (opts.length >= OPTION_MAX) return;
      const o = emptyOption(optionIdsIn(this.editor.state.doc));
      this.setOptions(opts.concat(o), { id: o.id, role: 'label' });
      return;
    }
    const i = this.rowOf(btn);
    if (i == null) return;
    const id = opts[i].id;
    if (role === 'remove') {
      opts.splice(i, 1);
      const next = opts[i] || opts[i - 1];
      this.setOptions(opts, next ? { id: next.id, role: 'remove', fallback: 'label' } : { add: true });
    } else if (role === 'up' && i > 0) {
      [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]];
      this.setOptions(opts, { id, role: 'up', fallback: 'down' });
    } else if (role === 'down' && i < opts.length - 1) {
      [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]];
      this.setOptions(opts, { id, role: 'down', fallback: 'up' });
    }
  }

  render() {
    const { clauseId, qualifyingOptionId } = this.node.attrs;
    const opts = this.options;
    const base = 'ed-' + (clauseId || 'baru');
    this.dom.className = 'clause-edit' + (opts.length ? ' clause-required' : ' clause-info-edit');
    this.reqEl.textContent = opts.length ? 'Wajib dijawab' : 'Informasi saja';
    this.idEl.textContent = `ID ${clauseId || '(baru)'}`;
    this.legend.id = base + '-opts-h';
    this.state.id = base + '-opts-state';
    this.hint.id = base + '-opts-hint';
    this.panel.setAttribute('aria-labelledby', this.legend.id);
    this.panel.setAttribute('aria-describedby', `${this.state.id} ${this.hint.id}`);
    this.state.textContent = clauseState(opts.length);
    this.hint.textContent = !opts.length
      ? 'Tanpa pilihan jawaban, klausul tampil sebagai informasi biasa dan tidak menghalangi persetujuan. Tambahkan 1–2 pilihan bila pengguna harus menjawab.'
      : opts.length === 1
        ? 'Pengguna tetap harus memilihnya sendiri sebelum menyetujui; tidak ada pilihan bawaan.'
        : `Maksimal ${OPTION_MAX} pilihan. Tentukan tepat satu pilihan yang memenuhi syarat; arti pilihan tidak ditentukan dari label atau urutannya. Pengguna memilih sendiri, tanpa pilihan bawaan.`;

    const key = JSON.stringify([clauseId, opts.map((o) => o.id)]);
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...opts.map((o, i) => {
        const id = `${base}-${o.id}`;
        const n = i + 1;
        const btn = (role, label, text) => h('button', { type: 'button', class: 'clause-opt-btn', 'data-role': role, 'aria-label': `${label} pilihan ${n}`, title: `${label} pilihan ${n}` }, text);
        return h('li', { class: 'clause-opt', 'data-option-id': o.id },
          h('label', { class: 'clause-opt-lab', for: id + '-label' }, `Pilihan ${n}`),
          h('input', { type: 'text', id: id + '-label', class: 'clause-opt-input', 'data-role': 'label', maxlength: String(LABEL_MAX + 20), autocomplete: 'off', 'aria-describedby': id + '-err' }),
          h('span', { class: 'clause-opt-actions' },
            btn('up', 'Naikkan', '↑'), btn('down', 'Turunkan', '↓'), btn('remove', 'Hapus', 'Hapus')),
          h('p', { class: 'clause-opt-err', id: id + '-err' }));
      }));
      // Single choice of the qualifying option (only with two or more options).
      const legendId = base + '-qual-h';
      this.qualSet.replaceChildren(...(opts.length >= 2 ? [
        h('legend', { id: legendId }, 'Pilihan yang memenuhi syarat'),
        ...opts.map((o) => h('label', { class: 'clause-qual-opt', for: `${base}-${o.id}-q` },
          h('input', { type: 'radio', id: `${base}-${o.id}-q`, name: `${base}-qualifying`, value: o.id, 'data-role': 'qualifying' }),
          h('span', {}))),
      ] : []));
      this.qualSet.hidden = opts.length < 2;
    }
    // Sync values in place, so typing never loses focus.
    const issues = this.issuesOf(opts, qualifyingOptionId === undefined ? null : qualifyingOptionId) || [];
    this.list.querySelectorAll('li[data-option-id]').forEach((li, i) => {
      const o = opts[i];
      const input = li.querySelector('[data-role="label"]');
      if (input.value !== o.label && input.ownerDocument.activeElement !== input) input.value = o.label;
      const msgs = issues.filter((x) => x.index === i && x.message).map((x) => x.message);
      li.querySelector('.clause-opt-err').textContent = msgs.join(' ');
      input.setAttribute('aria-invalid', String(msgs.length > 0));
      li.querySelector('[data-role="up"]').disabled = i === 0;
      li.querySelector('[data-role="down"]').disabled = i === opts.length - 1;
    });
    this.qualSet.querySelectorAll('input[data-role="qualifying"]').forEach((r, i) => {
      r.checked = r.value === qualifyingOptionId;
      const label = (opts[i].label || '').trim();
      r.nextElementSibling.textContent = label ? `Pilihan ${i + 1}: ${label}` : `Pilihan ${i + 1} (belum diberi label)`;
    });
    const full = opts.length >= OPTION_MAX;
    this.addBtn.disabled = full;
    this.addBtn.textContent = full ? `Maksimal ${OPTION_MAX} pilihan` : '+ Tambah pilihan';
    this.clauseErr.textContent = issues.filter((x) => x.index == null && x.message).map((x) => x.message).join(' ');
    this.restoreFocus();
  }

  restoreFocus() {
    const f = this.focusAfter;
    this.focusAfter = null;
    if (!f) return;
    if (f.add) { this.addBtn.focus(); return; }
    const li = this.list.querySelector(`li[data-option-id="${f.id}"]`);
    const pick = (role) => (role === 'qualifying'
      ? this.qualSet.querySelector(`input[value="${f.id}"]`)
      : li ? li.querySelector(`[data-role="${role}"]`) : null);
    let el = pick(f.role);
    if (!el || el.disabled) el = pick(f.fallback);
    if (!el || el.disabled) el = pick('label') || this.addBtn;
    el.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  // Events in the head and the options form belong to the form controls, not ProseMirror.
  stopEvent(ev) { return !this.contentDOM.contains(ev.target); }

  ignoreMutation(m) { return !this.contentDOM.contains(m.target); }
}

const ConsentClause = Node.create({
  name: 'consentClause',
  group: 'block',
  content: 'clauseTitle clauseBody',
  isolating: true,
  defining: true,
  draggable: false,

  addOptions() {
    return { optionIssues: () => [] };
  },

  addAttributes() {
    return {
      clauseId: {
        default: null,
        parseHTML: (el) => {
          const id = el.getAttribute('data-clause-id');
          return CLAUSE_ID_RE.test(id || '') ? id : null;
        },
        renderHTML: (attrs) => ({ 'data-clause-id': attrs.clauseId }),
      },
      options: {
        default: null,
        parseHTML: (el) => parseOptions(el.getAttribute('data-options')),
        renderHTML: (attrs) => (Array.isArray(attrs.options) ? { 'data-options': JSON.stringify(attrs.options) } : {}),
      },
      qualifyingOptionId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-qualifying') || null,
        renderHTML: (attrs) => (attrs.qualifyingOptionId ? { 'data-qualifying': attrs.qualifyingOptionId } : {}),
      },
    };
  },

  parseHTML: () => [{ tag: 'section[data-clause-id]', contentElement: '.clause-edit-content' }],

  // Serialized form (clipboard); the editor itself shows ClauseView.
  renderHTML({ node, HTMLAttributes }) {
    const opts = Array.isArray(node.attrs.options) ? node.attrs.options : [];
    return ['section', mergeAttributes(HTMLAttributes, { class: 'clause-edit' }),
      ['div', { class: 'clause-edit-head', contenteditable: 'false' },
        ['span', { class: 'clause-edit-tag' }, 'Klausul persetujuan'],
        ['span', { class: 'clause-edit-req' }, opts.length ? 'Wajib dijawab' : 'Informasi saja']],
      ['div', { class: 'clause-edit-content' }, 0],
      ['ul', { class: 'clause-edit-options', contenteditable: 'false' }, ...opts.map((o) => ['li', {}, o.label])]];
  },

  addNodeView() {
    const issuesOf = this.options.optionIssues;
    return ({ node, getPos, editor }) => new ClauseView(node, getPos, editor, issuesOf);
  },

  addCommands() {
    const current = (state) => findParentNode((n) => n.type.name === 'consentClause')(state.selection);
    return {
      // A new clause starts as information only; options are added in its form.
      insertConsentClause: () => ({ tr, dispatch, editor, state }) => {
        if (current(state)) return false;
        const node = editor.schema.nodeFromJSON({
          type: 'consentClause',
          attrs: { clauseId: newId('cl', clauseIdsIn(state.doc)), options: [], qualifyingOptionId: null },
          content: [{ type: 'clauseTitle' }, { type: 'clauseBody', content: [{ type: 'paragraph' }] }],
        });
        if (dispatch) {
          const offset = tr.selection.from + 1;
          tr.replaceSelectionWith(node).scrollIntoView()
            .setSelection(TextSelection.near(tr.doc.resolve(offset)));
        }
        return true;
      },
      // Inserts a copy below; the ID plugin gives it a fresh clause ID and fresh option IDs.
      duplicateConsentClause: () => ({ state, tr, dispatch }) => {
        const found = current(state);
        if (!found) return false;
        if (dispatch) {
          const end = found.pos + found.node.nodeSize;
          tr.insert(end, found.node.copy(found.node.content));
          tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2))).scrollIntoView();
        }
        return true;
      },
      deleteConsentClause: () => ({ state, tr, dispatch }) => {
        const found = current(state);
        if (!found) return false;
        if (dispatch) tr.delete(found.pos, found.pos + found.node.nodeSize);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      // Stable, unique IDs: a clause keeps its ID unless another clause in the
      // document already owns it (e.g. after duplication or copy-paste), in
      // which case the newcomer gets a fresh clause ID and fresh option IDs
      // (its qualifying option follows to the new ID). Missing, invalid, or
      // duplicate option IDs are replaced; missing options become none. The
      // qualifying option always matches the option count (qualifyingFor).
      // Renaming or reordering keeps IDs.
      new Plugin({
        key: new PluginKey('clauseIds'),
        appendTransaction: (trs, oldState, newState) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const owners = new Map(); // id -> position of the clause that already had it
          oldState.doc.forEach((n, offset) => {
            if (n.type.name !== 'consentClause' || !CLAUSE_ID_RE.test(n.attrs.clauseId || '')) return;
            let pos = offset;
            let gone = false;
            trs.forEach((t) => { const r = t.mapping.mapResult(pos, 1); gone = gone || r.deleted; pos = r.pos; });
            if (!gone) owners.set(n.attrs.clauseId, pos);
          });
          const taken = clauseIdsIn(newState.doc);
          const takenOpts = optionIdsIn(newState.doc);
          const seen = new Set();
          const seenOpts = new Set();
          const fixes = [];
          newState.doc.forEach((n, pos) => {
            if (n.type.name !== 'consentClause') return;
            const id = n.attrs.clauseId;
            const owner = owners.get(id);
            const ownedElsewhere = owner !== undefined && owner !== pos && newState.doc.nodeAt(owner)?.attrs.clauseId === id;
            const fresh = !CLAUSE_ID_RE.test(id || '') || seen.has(id) || ownedElsewhere;
            if (!fresh) seen.add(id);
            const attrs = { ...n.attrs };
            let changed = false;
            if (fresh) { attrs.clauseId = newId('cl', taken); changed = true; }
            let q = attrs.qualifyingOptionId;
            if (!Array.isArray(attrs.options)) {
              attrs.options = [];
              changed = true;
            } else {
              attrs.options = attrs.options.map((o) => {
                if (!fresh && OPTION_ID_RE.test(o.id || '') && !seenOpts.has(o.id)) { seenOpts.add(o.id); return o; }
                changed = true;
                const copy = { ...o, id: newId('op', takenOpts) };
                if (q === o.id) q = copy.id;
                seenOpts.add(copy.id);
                return copy;
              });
            }
            q = qualifyingFor(attrs.options, q);
            if (q !== attrs.qualifyingOptionId) { attrs.qualifyingOptionId = q; changed = true; }
            if (changed) fixes.push([pos, attrs]);
          });
          if (!fixes.length) return null;
          const tr = newState.tr;
          fixes.forEach(([pos, attrs]) => tr.setNodeMarkup(pos, undefined, attrs));
          return tr.setMeta('addToHistory', false);
        },
      }),
      // Hint text for an empty clause title.
      new Plugin({
        key: new PluginKey('clauseTitleHint'),
        props: {
          decorations: (state) => {
            const decos = [];
            state.doc.forEach((n, pos) => {
              if (n.type.name === 'consentClause' && n.firstChild.content.size === 0) {
                decos.push(Decoration.node(pos + 1, pos + 1 + n.firstChild.nodeSize, { class: 'is-empty', 'data-hint': 'Judul klausul' }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/**
 * Enter in a clause title moves to the explanatory text instead of splitting.
 * A separate high-priority extension so it runs before the default Enter
 * handling (raising the node's own priority would reorder the schema).
 */
const ClauseTitleEnter = Extension.create({
  name: 'clauseTitleEnter',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== 'clauseTitle') return false;
        return editor.commands.setTextSelection($from.after() + 2);
      },
    };
  },
});

/** Escape / Alt+F10 move focus to the toolbar, so Tab in tables is never a trap. */
const ToolbarFocus = Extension.create({
  name: 'toolbarFocus',
  addOptions() {
    return { onFocusToolbar: () => {} };
  },
  addKeyboardShortcuts() {
    const go = () => { this.options.onFocusToolbar(); return true; };
    return { Escape: go, 'Alt-F10': go };
  },
});

export function createEditor(opts) {
  return new Editor({
    element: opts.element,
    content: opts.content,
    extensions: [
      StarterKit.configure({
        blockquote: false, code: false, codeBlock: false, hardBreak: false, horizontalRule: false,
        link: false, strike: false, orderedList: false, listItem: false, heading: { levels: [2, 3] },
      }),
      PlainOrderedList,
      PlainListItem,
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
      PresetTable.configure({ resizable: false, onRejectPreset: opts.onRejectPreset || (() => {}) }),
      TableRow,
      PlainHeader,
      PlainCell,
      Variable.configure({ catalogue: opts.catalogue }),
      ConsentClause.configure({ optionIssues: opts.optionIssues || (() => []) }),
      ClauseTitle,
      ClauseBody,
      ClauseTitleEnter,
      ToolbarFocus.configure({ onFocusToolbar: opts.onFocusToolbar }),
    ],
    editorProps: { attributes: opts.attributes || {} },
    onUpdate: ({ editor }) => opts.onUpdate(editor.getJSON()),
    onTransaction: () => opts.onTransaction && opts.onTransaction(),
  });
}
