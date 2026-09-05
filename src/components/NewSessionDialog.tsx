import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { defaultCwd, pickFolder } from "../lib/api";
import { useSessionStore } from "../store/sessions";

export function NewSessionDialog({
  onCreate,
  onClose,
}: {
  onCreate: (cwd: string, yolo: boolean, modelId?: string) => void;
  onClose: () => void;
}) {
  const modelCatalog = useSessionStore((s) => s.modelCatalog);
  const defaultYolo = useSessionStore((s) => s.defaultYolo);
  const defaultModelId = useSessionStore((s) => s.defaultModelId);
  const lastWorkspace = useSessionStore((s) => s.lastWorkspace);
  const [cwd, setCwd] = useState("");
  const [yolo, setYolo] = useState(defaultYolo);
  const [modelId, setModelId] = useState<string | undefined>(defaultModelId ?? modelCatalog?.currentModelId);

  useEffect(() => {
    if (lastWorkspace) setCwd(lastWorkspace);
    else defaultCwd().then(setCwd);
  }, [lastWorkspace]);

  const models = modelCatalog?.availableModels ?? [];
  const selectedModel = models.find((m) => m.modelId === modelId) ?? models[0];

  async function handleBrowse() {
    const picked = await pickFolder(cwd || undefined);
    if (picked) setCwd(picked);
  }

  return (
    <motion.div
      key="new-session-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 4 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-h-[min(640px,86vh)] overflow-y-auto rounded-[var(--gd-radius-lg)] border p-5"
        style={{
          borderColor: "var(--gd-border)",
          background: "var(--gd-surface)",
          boxShadow:
            "var(--gd-panel-shadow)",
        }}
      >
        <div className="text-[15px] font-semibold mb-4" style={{ color: "var(--gd-text)" }}>
          New Session
        </div>

        <label className="block text-[11px] font-medium mb-1.5" style={{ color: "var(--gd-text-muted)" }}>
          Workspace
        </label>
        <div className="flex gap-2 mb-4">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            className="flex-1 min-w-0 text-[12px] font-mono px-2.5 py-1.5 rounded-[var(--gd-radius-sm)] border outline-none"
            style={{ borderColor: "var(--gd-border-strong)", background: "var(--gd-bg)", color: "var(--gd-text)" }}
          />
          <button
            onClick={handleBrowse}
            className="text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)] shrink-0"
            style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
          >
            Browse…
          </button>
        </div>

        <label className="block text-[11px] font-medium mb-1.5" style={{ color: "var(--gd-text-muted)" }}>
          Permissions
        </label>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setYolo(false)}
            className="flex-1 text-left px-3 py-2 rounded-[var(--gd-radius-sm)] border transition"
            style={{
              borderColor: !yolo ? "var(--gd-accent)" : "var(--gd-border-strong)",
              background: !yolo ? "var(--gd-accent-soft)" : "transparent",
            }}
          >
            <div className="text-[12px] font-medium" style={{ color: !yolo ? "var(--gd-accent)" : "var(--gd-text)" }}>
              Ask
            </div>
            <div className="text-[10.5px] mt-0.5" style={{ color: "var(--gd-text-faint)" }}>
              Confirm edits &amp; commands
            </div>
          </button>
          <button
            onClick={() => setYolo(true)}
            className="flex-1 text-left px-3 py-2 rounded-[var(--gd-radius-sm)] border transition"
            style={{
              borderColor: yolo ? "var(--gd-accent)" : "var(--gd-border-strong)",
              background: yolo ? "var(--gd-accent-soft)" : "transparent",
            }}
          >
            <div className="text-[12px] font-medium" style={{ color: yolo ? "var(--gd-accent)" : "var(--gd-text)" }}>
              Always Allow
            </div>
            <div className="text-[10.5px] mt-0.5" style={{ color: "var(--gd-text-faint)" }}>
              No prompts — trusted workspaces only
            </div>
          </button>
        </div>

        {models.length > 0 && (
          <div className="mb-4">
            <label className="block text-[11px] font-medium mb-1.5" style={{ color: "var(--gd-text-muted)" }}>
              Model
            </label>
            <div className="flex flex-col gap-1">
              {models.map((m) => {
                const active = (selectedModel?.modelId ?? modelId) === m.modelId;
                return (
                  <button
                    key={m.modelId}
                    onClick={() => setModelId(m.modelId)}
                    className="text-left px-3 py-2 rounded-[var(--gd-radius-sm)] border transition"
                    style={{
                      borderColor: active ? "var(--gd-accent)" : "var(--gd-border-strong)",
                      background: active ? "var(--gd-accent-soft)" : "transparent",
                    }}
                  >
                    <div className="text-[12px] font-medium" style={{ color: active ? "var(--gd-accent)" : "var(--gd-text)" }}>
                      {m.name}
                    </div>
                    {m.description && (
                      <div className="text-[10.5px] mt-0.5" style={{ color: "var(--gd-text-faint)" }}>
                        {m.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
            style={{ color: "var(--gd-text-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => cwd && onCreate(cwd, yolo, selectedModel?.modelId ?? modelId)}
            disabled={!cwd}
            className="gd-billet text-[12px] font-semibold px-3.5 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-40 disabled:pointer-events-none"
          >
            Start
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
