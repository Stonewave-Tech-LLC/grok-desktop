// Fixed, pointer-events-none layer that sits behind the entire app shell —
// see the .gd-ambient* rules in theme.css for why this is plain CSS
// (transform/opacity keyframes + a static noise texture) rather than a
// per-frame JS/canvas effect: cheap enough to run continuously inside a
// Tauri WebView, unlike the marketing site's filter:blur() orbs.
export function AmbientBackground() {
  return (
    <div className="gd-ambient" aria-hidden="true">
      <div className="gd-ambient-orb gd-ambient-orb-1" />
      <div className="gd-ambient-orb gd-ambient-orb-2" />
      <div className="gd-ambient-noise" />
    </div>
  );
}
