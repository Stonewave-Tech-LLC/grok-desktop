import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const LINES_NO_SESSION = [
  "Heat the metal.",
  "Prompt hard. Review the diff.",
  "From prompt to pull request.",
];

const LINES_EMPTY_SESSION = [
  "Type to begin.",
  "The forge is hot.",
  "Silence where you focus.",
];

const CYCLE_MS = 3200;

export function EmptyCanvas({
  kind,
  onNewSession,
  newSessionDisabled,
}: {
  kind: "no-session" | "empty-session";
  onNewSession?: () => void;
  newSessionDisabled?: boolean;
}) {
  const lines = kind === "no-session" ? LINES_NO_SESSION : LINES_EMPTY_SESSION;
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-0 px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center max-w-sm"
      >
        <div
          className="text-[10px] font-mono tracking-[0.28em] uppercase mb-3"
          style={{ color: "var(--gd-text-faint)" }}
        >
          Stonewave / Grok Build
        </div>
        <div className="gd-splash-wordmark text-[40px] leading-none">ANVIL</div>
        <div className="gd-heat-scan mt-4 mb-5" style={{ width: 140 }} />
        <div className="h-5 min-w-[260px] flex items-center justify-center mb-5">
          <AnimatePresence mode="wait">
            <motion.span
              key={lines[i]}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="text-[13px]"
              style={{ color: "var(--gd-text-muted)" }}
            >
              {lines[i]}
            </motion.span>
          </AnimatePresence>
        </div>
        {kind === "no-session" && onNewSession && (
          <button
            onClick={onNewSession}
            disabled={newSessionDisabled}
            className="gd-billet rounded-[var(--gd-radius-md)] px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:pointer-events-none"
          >
            New Session
          </button>
        )}
      </motion.div>
    </div>
  );
}
