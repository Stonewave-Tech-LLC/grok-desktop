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

const CYCLE_MS = 2800;

const ease = [0.16, 1, 0.3, 1] as const;

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
    <div className="absolute inset-0 flex items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, y: 36, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.85, ease }}
        className="flex flex-col items-center text-center"
      >
        <motion.div
          initial={{ opacity: 0, letterSpacing: "0.4em" }}
          animate={{ opacity: 1, letterSpacing: "0.28em" }}
          transition={{ duration: 1.1, delay: 0.15, ease }}
          className="text-[12px] font-mono uppercase mb-5"
          style={{ color: "var(--gd-text-faint)" }}
        >
          Stonewave / Grok Build
        </motion.div>

        <motion.div
          className="gd-empty-wordmark"
          initial={{ opacity: 0, scale: 0.86, filter: "blur(12px)" }}
          animate={{
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
          }}
          transition={{ duration: 0.9, delay: 0.08, ease }}
        >
          <motion.span
            className="inline-block gd-splash-wordmark"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          >
            ANVIL
          </motion.span>
        </motion.div>

        <motion.div
          className="gd-heat-scan gd-empty-heat mt-7 mb-7"
          initial={{ opacity: 0, scaleX: 0.2 }}
          animate={{ opacity: 0.9, scaleX: 1 }}
          transition={{ duration: 0.8, delay: 0.35, ease }}
        />

        <div className="h-8 min-w-[320px] flex items-center justify-center mb-8">
          <AnimatePresence mode="wait">
            <motion.span
              key={lines[i]}
              initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -18, filter: "blur(6px)" }}
              transition={{ duration: 0.45, ease }}
              className="text-[17px] tracking-[-0.02em]"
              style={{ color: "var(--gd-text-muted)" }}
            >
              {lines[i]}
            </motion.span>
          </AnimatePresence>
        </div>

        {kind === "no-session" && onNewSession && (
          <motion.button
            onClick={onNewSession}
            disabled={newSessionDisabled}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55, ease }}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="gd-billet rounded-[var(--gd-radius-md)] px-5 py-2.5 text-[15px] font-semibold disabled:opacity-40 disabled:pointer-events-none"
          >
            New Session
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
