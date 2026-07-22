// FieldHost (ESR §5.4.1): the runtime-neutral capability seam between the
// field app and whatever hosts it. The Electron renderer-host adapter is one
// implementation (wrapping the preload bridge); browser harnesses and tests
// provide fakes. Product code NEVER touches window.vibefield — that global is
// the adapter's business (wall R1 keeps Electron out of this package).
//
// Slice 4 evolves getConnection into getBootstrap (the WindowBootstrap
// envelope with controlUrl); until that wire exists this mirrors today's
// bridge exactly.

export interface FieldHost {
  getConnection(): Promise<{ port: number; token: string }>;
  onPrepareClose(handler: (requestId: string) => void): () => void;
  completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
}

let current: FieldHost | null = null;

/** Wired once by mountFieldApp before anything else runs. */
export function setHost(host: FieldHost): void {
  current = host;
}

export function getHost(): FieldHost {
  if (current === null) throw new Error("FieldHost not set — mountFieldApp wires it first");
  return current;
}
