import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startDeviceLogin, onAuthLoginUrl, onAuthLoginResult, type LoginUrlPayload } from "../lib/api";

export function Onboarding({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [status, setStatus] = useState<"idle" | "starting" | "waiting" | "error">("idle");
  const [loginUrl, setLoginUrl] = useState<LoginUrlPayload | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const unlistens = [
      onAuthLoginUrl((payload) => {
        setLoginUrl(payload);
        setStatus("waiting");
        openUrl(payload.url).catch(() => {});
      }),
      onAuthLoginResult((payload) => {
        if (payload.success) {
          onAuthenticated();
        } else {
          setStatus("error");
          setError(payload.message ?? "Login did not complete");
        }
      }),
    ];
    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin() {
    setStatus("starting");
    setError(undefined);
    try {
      await startDeviceLogin();
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "var(--gd-bg)" }}>
      <div className="text-center max-w-sm px-6">
        <div className="text-[18px] font-semibold mb-1" style={{ color: "var(--gd-text)" }}>
          Welcome to Grok Desktop
        </div>
        <div className="text-[13px] mb-6" style={{ color: "var(--gd-text-muted)" }}>
          Sign in to the <code>grok</code> CLI to get started. This opens grok.com in your
          browser — Grok Desktop never sees your credentials.
        </div>

        {status === "waiting" && loginUrl ? (
          <div
            className="rounded-[var(--gd-radius-md)] border p-4 mb-4 text-left"
            style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
          >
            <div className="text-[12px] mb-2" style={{ color: "var(--gd-text-muted)" }}>
              Confirm this code in the browser tab that just opened:
            </div>
            <div
              className="text-[20px] font-mono font-semibold tracking-wider text-center py-2 rounded-[var(--gd-radius-sm)] mb-2"
              style={{ background: "var(--gd-accent-soft)", color: "var(--gd-accent)" }}
            >
              {loginUrl.code ?? "…"}
            </div>
            <button
              onClick={() => openUrl(loginUrl.url).catch(() => {})}
              className="w-full text-[12px] py-1.5 rounded-[var(--gd-radius-sm)]"
              style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-muted)" }}
            >
              Reopen browser
            </button>
            <div className="text-[11px] mt-2" style={{ color: "var(--gd-text-faint)" }}>
              Waiting for confirmation…
            </div>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            disabled={status === "starting"}
            className="rounded-[var(--gd-radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
          >
            {status === "starting" ? "Starting…" : "Log in with grok.com"}
          </button>
        )}

        {error && (
          <div className="text-[12px] mt-3" style={{ color: "var(--gd-danger)" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
