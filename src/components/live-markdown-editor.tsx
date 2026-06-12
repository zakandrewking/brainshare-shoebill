"use client";

import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { AttributionSegment } from "@/lib/attribution";
import type { CrosslinkRange } from "@/lib/crosslinks";
import { cn } from "@/lib/utils";

// The answer is edited as markdown in one always-live surface: CodeMirror
// styles the markdown as you type, while attribution (user-authored ranges)
// and [[crosslink]] resolution are overlaid as decorations that follow edits.

const setMarks = StateEffect.define<DecorationSet>();

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) {
        next = effect.value;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const userMark = Decoration.mark({ class: "cm-user-text" });
const resolvedLinkMark = Decoration.mark({
  class: "cm-crosslink",
  attributes: { title: "⌘/Ctrl-click to open" },
});
const unresolvedLinkMark = Decoration.mark({
  class: "cm-crosslink-unresolved",
  attributes: { title: "No entry yet — ⌘/Ctrl-click to ask about this" },
});

// Overlapping marks are fine (Decoration.set sorts); ranges are clamped to the
// doc so a momentary desync between props and the editor can't throw.
function buildMarks(
  segments: AttributionSegment[],
  crosslinks: CrosslinkRange[],
  docLength: number,
): DecorationSet {
  const ranges = [];
  let offset = 0;
  for (const segment of segments) {
    const end = Math.min(offset + segment.text.length, docLength);
    if (segment.source === "user" && end > offset) {
      ranges.push(userMark.range(offset, end));
    }
    offset += segment.text.length;
  }
  for (const link of crosslinks) {
    const from = Math.min(link.start, docLength);
    const to = Math.min(link.end, docLength);
    if (to > from) {
      ranges.push(
        (link.resolved ? resolvedLinkMark : unresolvedLinkMark).range(from, to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

// Live markdown styling. Sizes echo .literary-prose; syntax markers recede.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.55em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading4, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted-foreground)" },
  { tag: tags.quote, fontStyle: "italic", color: "var(--muted-foreground)" },
  {
    tag: tags.monospace,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: "0.9em",
  },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
  { tag: tags.contentSeparator, color: "var(--muted-foreground)" },
]);

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  // CodeMirror's base theme forces monospace on the scroller; "inherit" on
  // .cm-content resolves against it, not our wrapper. Re-inherit here so the
  // editor keeps the .literary-prose serif the streamed view used.
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    padding: "1.25rem",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(14 165 233 / 0.3)",
  },
  ".cm-user-text": {
    backgroundColor: "rgb(14 165 233 / 0.15)",
    borderRadius: "2px",
    boxShadow: "0 0 0 1px rgb(14 165 233 / 0.2)",
  },
  ".cm-crosslink": {
    color: "var(--primary)",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  ".cm-crosslink-unresolved": {
    color: "var(--muted-foreground)",
    textDecorationLine: "underline",
    textDecorationStyle: "dashed",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
});

export function LiveMarkdownEditor({
  value,
  segments,
  crosslinks,
  onChange,
  onOpenCrosslink,
  onCreateCrosslink,
  className,
}: {
  value: string;
  segments: AttributionSegment[];
  crosslinks: CrosslinkRange[];
  onChange: (value: string) => void;
  /** ⌘/Ctrl-click on a resolved [[crosslink]] opens that submission. */
  onOpenCrosslink?: (id: string) => void;
  /** ⌘/Ctrl-click on an unresolved [[topic]] starts a new entry for it. */
  onCreateCrosslink?: (topic: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest props for CodeMirror callbacks without recreating the editor.
  const liveRef = useRef({
    onChange,
    onOpenCrosslink,
    onCreateCrosslink,
    crosslinks,
  });
  useEffect(() => {
    liveRef.current = { onChange, onOpenCrosslink, onCreateCrosslink, crosslinks };
  });

  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(markdownHighlight),
          marksField,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              liveRef.current.onChange(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            mousedown: (event, view) => {
              if (!event.metaKey && !event.ctrlKey) {
                return false;
              }
              const pos = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              });
              if (pos === null) {
                return false;
              }
              const link = liveRef.current.crosslinks.find(
                (range) => pos >= range.start && pos < range.end,
              );
              if (!link) {
                return false;
              }
              if (link.targetId && liveRef.current.onOpenCrosslink) {
                liveRef.current.onOpenCrosslink(link.targetId);
                return true;
              }
              if (!link.targetId && liveRef.current.onCreateCrosslink) {
                liveRef.current.onCreateCrosslink(link.target);
                return true;
              }
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The editor is created once; value/marks sync through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (switching submissions, regenerate) replace the
  // doc; user typing round-trips through onChange and matches, so no loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setMarks.of(
        buildMarks(segments, crosslinks, view.state.doc.length),
      ),
    });
  }, [segments, crosslinks]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "retro-sunken literary-prose min-h-72 overflow-y-auto",
        className,
      )}
    />
  );
}
