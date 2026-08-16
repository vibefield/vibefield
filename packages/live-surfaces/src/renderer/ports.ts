export interface LiveSurfacePortMessageEvent {
  readonly data: unknown;
}

/** Structural subset shared by a DOM MessagePort and deterministic test ports. */
export interface LiveSurfaceMessagePort {
  onmessage: ((event: LiveSurfacePortMessageEvent) => void) | null;
  onmessageerror?: (() => void) | null;
  postMessage(message: unknown, transfer?: readonly object[]): void;
  start(): void;
  close(): void;
}

export interface LiveSurfaceClosableFrame {
  close(): void;
}

export function isLiveSurfaceClosableFrame(value: unknown): value is LiveSurfaceClosableFrame {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "close" in value &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
