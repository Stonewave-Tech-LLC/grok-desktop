import { useEffect, useState } from "react";
import { downloadImage } from "../lib/api";

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8M8 10 4.5 6.5M8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ToolbarButton({ onClick, label, children }: { onClick: (e: React.MouseEvent) => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="gd-glow-hover h-8 w-8 rounded-full flex items-center justify-center transition"
      style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
    >
      {children}
    </button>
  );
}

function Lightbox({ src, path, alt, onClose }: { src: string; path?: string; alt?: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (path) await downloadImage(path);
  }

  return (
    // `absolute` (not `fixed`) so this stays clipped by #root's rounded-corner
    // overflow:hidden (see theme.css) instead of painting a plain rectangle
    // straight over the transparent window's corners — `fixed` positions
    // relative to the viewport and escapes that clipping entirely.
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center gd-enter"
      style={{ background: "rgba(6,6,8,0.92)" }}
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {path && (
          <ToolbarButton onClick={handleDownload} label="Download image">
            <DownloadIcon />
          </ToolbarButton>
        )}
        <ToolbarButton onClick={onClose} label="Close">
          <CloseIcon />
        </ToolbarButton>
      </div>
      <div
        className={zoomed ? "w-full h-full overflow-auto flex items-center justify-center p-10" : "flex items-center justify-center"}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          onClick={() => setZoomed((z) => !z)}
          className={zoomed ? "rounded-[var(--gd-radius-md)] shadow-2xl max-w-none" : "max-h-[85vh] max-w-[85vw] rounded-[var(--gd-radius-md)] shadow-2xl"}
          style={{ cursor: zoomed ? "zoom-out" : "zoom-in" }}
        />
      </div>
    </div>
  );
}

// Shared thumbnail + lightbox for every generated/attached image in the app —
// tool-call previews and markdown-embedded images both render through this,
// so it's the one place a future Asset Manager grid would also open into.
export function GeneratedImage({
  src,
  path,
  alt,
  className,
  style,
}: {
  src: string;
  path?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);

  async function handleThumbDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (path) await downloadImage(path);
  }

  return (
    <>
      <div className="relative inline-block group">
        <img
          src={src}
          alt={alt}
          onClick={() => setOpen(true)}
          className={className}
          style={{ cursor: "zoom-in", ...style }}
        />
        <div
          className="absolute inset-0 rounded-[inherit] opacity-0 group-hover:opacity-100 transition flex items-end justify-end p-2 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.45), transparent 45%)" }}
        >
          {path && (
            <button
              onClick={handleThumbDownload}
              aria-label="Download image"
              title="Download image"
              className="gd-glow-hover h-7 w-7 rounded-full flex items-center justify-center transition pointer-events-auto"
              style={{ background: "rgba(10,10,12,0.75)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
            >
              <DownloadIcon />
            </button>
          )}
        </div>
      </div>
      {open && <Lightbox src={src} path={path} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
