import { VITALS_CAPTURE_CHANNELS } from "@vibefield/contracts/registries";

// VT-5 (track VT, 2026-11-24; DESIGN.md §8 "Vitals", "Captures") — the Vitals window's one way to ask for something:
// a capture armed by hand, the capture's state, and one of the captures' own files shown in Finder. Three invokes and
// one stream, on contracts' channels. Main checks every field against the closed lists (`vitals-capture.ts`) and
// answers this window's main frame alone; nothing here reaches fieldd, which the window holds no key to.

export interface VitalsCaptureIpc {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, raw: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, raw: unknown) => void): unknown;
}

/** What the page is handed. Every answer is parsed by the page, which owns the contracts. */
export interface VitalsCaptureBridge {
  current(): Promise<unknown>;
  arm(kind: string, seconds: number): Promise<unknown>;
  reveal(name: string): Promise<unknown>;
  onState(handler: (state: unknown) => void): () => void;
}

export function vitalsCaptureBridge(ipc: VitalsCaptureIpc): VitalsCaptureBridge {
  return {
    current: () => ipc.invoke(VITALS_CAPTURE_CHANNELS.current),
    // only a string and a number cross; main reads them against its lists
    arm: (kind, seconds) =>
      ipc.invoke(VITALS_CAPTURE_CHANNELS.arm, {
        kind: typeof kind === "string" ? kind : "",
        seconds: typeof seconds === "number" ? seconds : 0,
      }),
    reveal: (name) =>
      ipc.invoke(VITALS_CAPTURE_CHANNELS.reveal, { name: typeof name === "string" ? name : "" }),
    onState: (handler) => {
      const listener = (_event: unknown, raw: unknown): void => handler(raw);
      ipc.on(VITALS_CAPTURE_CHANNELS.state, listener);
      return () => {
        ipc.removeListener(VITALS_CAPTURE_CHANNELS.state, listener);
      };
    },
  };
}
