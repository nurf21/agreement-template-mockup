/*
 * Visual editor bundle (built with esbuild into dist/editor.js, global
 * `AgreementEditor`). Tiptap/ProseMirror with only the nodes and marks the
 * richtext-json format allows; the editor schema drops anything else on paste
 * (scripts, images, links, styles, unsupported blocks). The stored JSON is
 * validated again by js/richtext.js before save and publish.
 */
import { Editor, Extension, Node, mergeAttributes } from '@tiptap/core';
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
      Table.configure({ resizable: false }),
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
