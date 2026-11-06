/*
 * Visual editor bundle (built with esbuild into dist/editor.js, global
 * `AgreementEditor`). Tiptap/ProseMirror with only the nodes and marks the
 * richtext-json format allows; the editor schema drops anything else on paste
 * (scripts, images, links, styles, unsupported blocks). The stored JSON is
 * validated again by js/richtext.js before save and publish.
 */
import { Editor, Extension, Node, mergeAttributes, findParentNode } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
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
      ToolbarFocus.configure({ onFocusToolbar: opts.onFocusToolbar }),
    ],
    editorProps: { attributes: opts.attributes || {} },
    onUpdate: ({ editor }) => opts.onUpdate(editor.getJSON()),
    onTransaction: () => opts.onTransaction && opts.onTransaction(),
  });
}
