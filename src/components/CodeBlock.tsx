import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

const LANGUAGE_EXTENSIONS: Record<string, () => Extension> = {
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  py: () => python(),
  python: () => python(),
  rs: () => rust(),
  rust: () => rust(),
  json: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
};

export function CodeBlock({ language, code }: { language?: string; code: string }) {
  const extensionFactory = language ? LANGUAGE_EXTENSIONS[language.toLowerCase()] : undefined;

  if (!extensionFactory) {
    // No highlighter registered for this language — plain but still legible.
    return (
      <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed font-mono" style={{ background: "var(--gd-bg)", margin: 0 }}>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <CodeMirror
      value={code}
      editable={false}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      extensions={[extensionFactory()]}
      theme={oneDark}
      style={{ fontSize: 13 }}
    />
  );
}
