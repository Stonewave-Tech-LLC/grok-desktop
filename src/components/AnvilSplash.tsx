import { AnimatePresence, motion } from "framer-motion";

export type BootStatus = "initializing" | "importing" | "reattaching" | "ready" | "error";

const STATUS_COPY: Partial<Record<BootStatus, string>> = {
  initializing: "Initializing grok CLI…",
  importing: "Importing sessions…",
  reattaching: "Heating the forge…",
};

/// Full-window boot gate — nothing of the shell (titlebar, sidebar, chat) is
/// meant to be usable underneath this while it's up, mirroring Forge's
/// ConnectGateView on macOS. Anvil's own metal/white-glow treatment though,
/// not Forge's cyan: gradient wordmark + a heat-scan line, no spinner.
///
/// The caller (App.tsx) owns the actual boot sequence and only hands this
/// component a status to render — this component has no API calls of its
/// own, so it can't itself decide the shell is ready.
export function AnvilSplash({ status, errorMessage, onRetry }: { status: BootStatus; errorMessage?: string; onRetry: () => void }) {
  const danger = status === "error";
  const statusLine = danger ? errorMessage || "Something went wrong starting grok." : STATUS_COPY[status] ?? "";

  return (
    <AnimatePresence>
      {status !== "ready" && (
        <motion.div
          key="anvil-splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(10, 10, 12, 0.92)" }}
        >
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className="text-[10.5px] font-mono tracking-[0.3em] uppercase" style={{ color: "var(--gd-text-faint)" }}>
              Stonewave / Grok Build
            </div>
            <div className="gd-splash-wordmark text-[44px] leading-none">ANVIL</div>
            <div className="h-4 min-w-[240px] flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.span
                  key={statusLine}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="text-[12px] font-mono"
                  style={{ color: danger ? "var(--gd-danger)" : "var(--gd-text-muted)" }}
                >
                  {statusLine}
                </motion.span>
              </AnimatePresence>
            </div>
            {danger ? (
              <button
                onClick={onRetry}
                className="gd-billet rounded-[var(--gd-radius-md)] px-4 py-1.5 text-[13px] font-semibold mt-1"
              >
                Retry
              </button>
            ) : (
              <div className="gd-heat-scan" style={{ width: 160 }} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
