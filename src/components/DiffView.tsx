import CodeMirror from "@uiw/react-codemirror";
import { unifiedMergeView } from "@codemirror/merge";
import { oneDark } from "@codemirror/theme-one-dark";

export function DiffView({ path, oldText, newText }: { path?: string; oldText: string; newText: string }) {
  return (
    <div className="rounded-[var(--gd-radius-md)] overflow-hidden border" style={{ borderColor: "var(--gd-border)" }}>
      {path && (
        <div
          className="px-3 py-1 text-[11px] font-mono truncate"
          style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-faint)" }}
        >
          {path}
        </div>
      )}
      <CodeMirror
        value={newText}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
        extensions={[unifiedMergeView({ original: oldText, mergeControls: false })]}
        theme={oneDark}
        style={{ fontSize: 12.5 }}
      />
    </div>
  );
}
