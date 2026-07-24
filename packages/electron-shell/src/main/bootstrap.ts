import type { WindowConnection } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { WebContents } from "electron";

// The bootstrap mint, PURE (ESR §6.2–6.3): the sender policy plus the
// once-per-generation cache the contract table promises ("once per webContents
// generation, retry only after failure"). Until the 2026-07-23 review, every
// invoke minted a fresh token — StrictMode's dev double-invoke minted two per
// boot, and every stale token stayed valid until daemon restart (EL7 surface
// growth). The cache keys on the webContents id; a main-frame cross-document
// navigation or destruction ends the generation; a failed mint clears so the
// renderer's retry is honest.

/** The slice of WebContents the generation cache listens to — tests fake it
 * structurally (the pattern of window-policy's fakes). */
interface SenderLike {
  readonly id: number;
  once(event: "destroyed", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): unknown;
}

export function createBootstrapHandler(deps: {
  owns: (sender: WebContents) => boolean;
  ensure: FielddSupervisor["ensure"];
}): (event: { sender: WebContents }) => Promise<WindowConnection> {
  const inflight = new Map<number, Promise<WindowConnection>>();
  const hooked = new Set<number>();

  return (event) => {
    const sender = event.sender;
    if (!deps.owns(sender)) {
      return Promise.reject(new Error("window bootstrap refused: unregistered sender"));
    }
    const cached = inflight.get(sender.id);
    if (cached) return cached;

    if (!hooked.has(sender.id)) {
      hooked.add(sender.id);
      const s = sender as unknown as SenderLike;
      s.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        // a new main-frame document is a NEW generation — the old page's token
        // dies with its JS; the next invoke mints fresh
        if (isMainFrame && !isInPlace) inflight.delete(sender.id);
      });
      s.once("destroyed", () => {
        inflight.delete(sender.id);
        hooked.delete(sender.id);
      });
    }

    const attempt: Promise<WindowConnection> = mint(deps.ensure, sender.id).then(
      (conn) => conn,
      (error: unknown) => {
        // failure ends the cached attempt — retry re-mints for real
        if (inflight.get(sender.id) === attempt) inflight.delete(sender.id);
        throw error;
      },
    );
    inflight.set(sender.id, attempt);
    return attempt;
  };
}

async function mint(
  ensure: FielddSupervisor["ensure"],
  senderId: number,
): Promise<WindowConnection> {
  const handle = await ensure();
  const minted = (await handle.client.request("system.mintWindowToken", {
    // B3: the renderer owns the board doc — doc.* is scope-gated (EL7), and
    // the doc lane itself is entered through doc.open's one-shot ticket.
    // C4: workspace.read lets the Settings mesh section read the device roster.
    // P2: plugins.read feeds the registry snapshot; plugins.manage backs the
    // Settings plugin toggles (both local-only scopes — never in the tailnet preset).
    // LOG-L5: the host-owned Settings diagnostics surface reads records and
    // manages time-bounded leases. Plugin-bound tokens never receive either.
    scopes: [
      "doc.read",
      "doc.write",
      "workspace.read",
      "plugins.read",
      "plugins.manage",
      "diagnostics.read",
      "diagnostics.manage",
    ],
    label: `window-${senderId}`,
  })) as { token: string };
  return { port: handle.info.port, token: minted.token };
}
