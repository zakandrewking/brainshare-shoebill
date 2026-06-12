"use client";

import { useEffect, useRef } from "react";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import DiffMatchPatch from "diff-match-patch";

import { WIKILINK, matchCrosslinkTarget } from "@/lib/crosslinks";
import type { SerializedAnswer } from "@/lib/types";

type LinkTarget = Pick<SerializedAnswer, "id" | "question">;

const dmp = new DiffMatchPatch();

// External data the decorations need, swapped in from React as props change.
type EditorMeta = {
  // The stored AI baseline; attribution diffs this against the live doc.
  aiText: string;
  // Only show attribution (highlights + deletion marks) in the final editable
  // state — never while a fresh answer is still streaming in.
  attribute: boolean;
  links: LinkTarget[];
  excludeId?: string;
};

const setMeta = StateEffect.define<EditorMeta>();

const metaField = StateField.define<EditorMeta>({
  create: () => ({ aiText: "", attribute: false, links: [] }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMeta)) return effect.value;
    }
    return value;
  },
});

// A small struck-through ghost showing text the user removed from the baseline.
class DeletionWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletionWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-deletion";
    const collapsed = this.text.replace(/\s+/g, " ").trim();
    const shown =
      collapsed.length > 30 ? `${collapsed.slice(0, 30)}…` : collapsed;
    span.textContent = shown || "⌫";
    span.title = `Removed from the AI baseline: ${collapsed}`;
    span.contentEditable = "false";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const userMark = Decoration.mark({ class: "cm-user-edit" });

function buildDecorations(state: EditorState): DecorationSet {
  const meta = state.field(metaField);
  const doc = state.doc.toString();
  const ranges: Range<Decoration>[] = [];

  // Attribution: diff the live doc against the AI baseline. Inserts are the
  // user's additions (highlighted); deletes mark where baseline text was cut.
  if (meta.attribute && meta.aiText) {
    const diffs = dmp.diff_main(meta.aiText, doc);
    dmp.diff_cleanupSemantic(diffs);
    let pos = 0;
    for (const [op, text] of diffs) {
      if (op === DiffMatchPatch.DIFF_EQUAL) {
        pos += text.length;
      } else if (op === DiffMatchPatch.DIFF_INSERT) {
        if (text.length > 0) ranges.push(userMark.range(pos, pos + text.length));
        pos += text.length;
      } else {
        // DIFF_DELETE: baseline text removed at this point in the live doc.
        ranges.push(
          Decoration.widget({
            widget: new DeletionWidget(text),
            side: 1,
          }).range(pos),
        );
      }
    }
  }

  // Crosslinks: any [[Topic]] that resolves to another submission becomes a
  // clickable link; unresolved ones are left as plain text.
  for (const match of doc.matchAll(WIKILINK)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const id = matchCrosslinkTarget(match[1], meta.links, {
      excludeId: meta.excludeId,
    });
    if (id) {
      ranges.push(
        Decoration.mark({
          class: "cm-crosslink",
          attributes: { "data-answer-id": id },
        }).range(from, to),
      );
    }
  }

  return Decoration.set(ranges, true);
}

const decorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((effect) => effect.is(setMeta))) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Live markdown styling — Bear/Obsidian flavored: headings scale up, emphasis
// renders, links/code restyle, and the syntax markers (## ** etc.) dim back so
// the prose reads as rendered while the raw markdown stays editable.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "600" },
  { tag: tags.heading3, fontSize: "1.12em", fontWeight: "600" },
  {
    tag: [tags.heading4, tags.heading5, tags.heading6],
    fontWeight: "600",
  },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted-foreground)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: tags.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--foreground)" },
  // Markdown punctuation (heading hashes, emphasis stars, link brackets, …).
  { tag: [tags.processingInstruction, tags.meta], color: "var(--muted-foreground)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    height: "auto",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "1rem",
    lineHeight: "1.55",
    overflow: "visible",
  },
  ".cm-content": {
    padding: "1rem",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0" },
  "&.cm-editor .cm-selectionBackground, & .cm-selectionBackground": {
    backgroundColor: "rgb(14 165 233 / 0.3)",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
});

const editableState = new Compartment();

export function MarkdownEditor({
  value,
  aiText,
  editable,
  submissions,
  excludeId,
  onChange,
  onOpenCrosslink,
  placeholder,
  className,
}: {
  value: string;
  aiText: string;
  editable: boolean;
  submissions: LinkTarget[];
  excludeId?: string;
  onChange?: (value: string) => void;
  onOpenCrosslink?: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenCrosslink);

  // Keep the latest callbacks reachable from the editor's long-lived handlers
  // without rebuilding it.
  useEffect(() => {
    onChangeRef.current = onChange;
    onOpenRef.current = onOpenCrosslink;
  });

  // Create the editor once; props are pushed in via effects below.
  useEffect(() => {
    if (!parentRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownHighlight),
        EditorView.lineWrapping,
        metaField,
        decorationField,
        editableState.of(EditorView.editable.of(editable)),
        editorTheme,
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // Only echo genuine user edits — never our programmatic doc syncs.
          const fromUser = update.transactions.some(
            (tr) => tr.annotation(Transaction.userEvent) !== undefined,
          );
          if (fromUser) onChangeRef.current?.(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          mousedown(event) {
            const target = event.target as HTMLElement | null;
            const link = target?.closest<HTMLElement>("[data-answer-id]");
            const id = link?.getAttribute("data-answer-id");
            if (id && onOpenRef.current) {
              event.preventDefault();
              onOpenRef.current(id);
              return true;
            }
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: parentRef.current });
    view.dispatch({
      effects: setMeta.of({ aiText, attribute: editable, links: submissions, excludeId }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally run once; subsequent prop changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the doc in sync with the controlled value (external loads + streaming).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    // Streaming appends are a pure suffix — apply just the delta so the live
    // render grows smoothly instead of re-laying-out the whole document.
    if (value.startsWith(current)) {
      view.dispatch({
        changes: { from: current.length, insert: value.slice(current.length) },
      });
    } else {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Recompute decorations when the baseline / link set / mode changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setMeta.of({ aiText, attribute: editable, links: submissions, excludeId }),
    });
  }, [aiText, editable, submissions, excludeId]);

  // Toggle editability (read-only while streaming, editable once saved).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableState.reconfigure(EditorView.editable.of(editable)),
    });
  }, [editable]);

  return <div ref={parentRef} className={className} />;
}
