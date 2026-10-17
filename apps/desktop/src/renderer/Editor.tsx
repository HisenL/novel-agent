import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { restoredCursor } from "./editor-position.js";

export function Editor({
  content,
  onChange,
  onSelection,
  onSave,
  positionKey,
}: {
  content: string;
  onChange: (value: string) => void;
  onSelection: (from: number, to: number) => void;
  onSave: (value: string) => void;
  positionKey: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const callbacks = useRef({ onChange, onSelection, onSave });
  callbacks.current = { onChange, onSelection, onSave };
  useEffect(() => {
    if (!container.current) return;
    let cursor = 0;
    try {
      cursor = restoredCursor(
        localStorage.getItem(positionKey),
        content.length,
      );
    } catch {
      // Position persistence is optional; storage failure must not block editing.
    }
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: content,
        selection: { anchor: cursor },
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          placeholder("从一句话开始，把故事写下去……"),
          keymap.of([
            {
              key: "Mod-s",
              run: (currentView) => {
                callbacks.current.onSave(currentView.state.doc.toString());
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "正文编辑器",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const s = update.state.selection.main;
              callbacks.current.onSelection(s.from, s.to);
              try {
                localStorage.setItem(positionKey, String(s.head));
              } catch {
                // Never persist manuscript text here or interrupt editing.
              }
            }
          }),
        ],
      }),
    });
    editor.current = view;
    if (cursor > 0)
      view.dispatch({
        effects: EditorView.scrollIntoView(cursor, { y: "center" }),
      });
    return () => {
      view.destroy();
      editor.current = undefined;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && content !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
  }, [content]);
  return <div className="editor-mount" ref={container} />;
}
