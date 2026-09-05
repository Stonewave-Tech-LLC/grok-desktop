import type { AcpEvent } from "../types/acp";

type Tap = (event: AcpEvent) => void;

const taps = new Set<Tap>();

/// Side channel for ACP events that must not land in the visible session
/// store (operator-dream worker sessions). The main `handleAcpEvent` still
/// runs; unknown sessionIds are already dropped there.
export function tapAcpEvents(tap: Tap): () => void {
  taps.add(tap);
  return () => {
    taps.delete(tap);
  };
}

export function emitAcpTap(event: AcpEvent): void {
  for (const tap of taps) tap(event);
}