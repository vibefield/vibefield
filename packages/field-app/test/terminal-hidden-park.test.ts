// @vitest-environment happy-dom
// Item 475 — the loop a hidden window made, driven through ghosttea's REAL runtime: a routed
// runtime over this window's real host, with three stand-ins (the render worker, the canvas it
// is handed, and the control leg's socket). The stand-in cell never accepts a leg; it closes one
// with 4004 (LEG_TIMEOUT), as the cell does when no heartbeat came for 15 s. Throttling itself
// cannot be shown here (only a real hidden Chromium page throttles); what is shown is what the
// window does about a 4004 while hidden, by the clock: nothing until the show, then one mint.
import {
  createGhostteaTerminalRuntime,
  type GhostteaTerminalRuntime,
  type TerminalMount,
} from "@vibecook/ghosttea-react";
import type { TerminalOpenTicket } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoutedTerminalHost } from "../src/terminal/routed/host";

const NOW = 1_000_000;
const HOUR = 3_600_000;

/** The page's own `document.hidden`, which `visibility.ts` reads exactly as production does. */
const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
};
const hide = (): void => {
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
};
const show = (): void => {
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
};

/** A ticket good for two hours from NOW, so no renewal falls due unless a test lets it. */
function ticket(): TerminalOpenTicket {
  const cellBootId = "cell-a-boot-1";
  const kid = { cellBootId, keyGeneration: 1 };
  return {
    route: { cellBootId, routeRevision: 3, leaseEpoch: 7 },
    endpoints: {
      controlUrl: "ws://127.0.0.1:43101/control",
      framesUrl: "ws://127.0.0.1:43101/frames",
    },
    transportGrant: {
      protected: { v: 1, typ: "CellTransportGrant", iss: "fieldd", alg: "HS256", kid },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "renderer-1",
        connectionSetId: "connection-1",
        allowedChannels: ["control", "frames"],
        transportGrantGeneration: 2,
        issuedAt: NOW,
        expiresAt: NOW + 2 * HOUR,
        nonce: "nonce-1",
      },
      mac: "bWFj",
    },
    attachGrant: {
      protected: { v: 1, typ: "SessionAttachGrant", iss: "fieldd", alg: "HS256", kid },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "renderer-1",
        sessionId: "sess-1",
        leaseEpoch: 7,
        routeRevision: 3,
        grantGeneration: 5,
        rights: ["input", "read"],
        issuedAt: NOW,
        expiresAt: NOW + 2 * HOUR,
      },
      mac: "bWFj",
    },
  };
}

/** The control leg's socket. The cell's side is `cellCloses`: it never accepts a leg here. */
class StandInSocket extends EventTarget {
  readyState = 0;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }
  /** The cell's receipt deadline ran out (door.rs, LEG_TIMEOUT). */
  cellCloses(code: number): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason: "LEG_TIMEOUT" }));
  }
}

class StandInWorker extends EventTarget {
  postMessage(): void {
    // the render worker's side (frames, drawing) is not what these rows are about
  }
  terminate(): void {
    // nothing runs behind it
  }
}

interface Rig {
  readonly runtime: GhostteaTerminalRuntime;
  readonly sockets: StandInSocket[];
  readonly methods: () => string[];
  readonly mount: TerminalMount;
  readonly done: () => void;
}

/** A visible window mounts one pane: one mint, one control socket. */
async function rig(): Promise<Rig> {
  const requests = vi.fn(async (method: string) => {
    if (method === "terminal.openTicket") return ticket();
    throw new Error(`unexpected ${method}`);
  });
  const binding = createRoutedTerminalHost({
    fieldd: { request: requests } as unknown as FielddClient,
  });
  const sockets: StandInSocket[] = [];
  const runtime = createGhostteaTerminalRuntime({
    transport: "routed",
    host: binding.host,
    platform: {
      writeClipboard: async () => undefined,
      forceCanvasFallback: () => false,
      setForceCanvasFallback: () => undefined,
      reload: () => undefined,
    } as never,
    workerFactory: () => new StandInWorker() as unknown as Worker,
    websocketFactory: (url) => {
      const socket = new StandInSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  binding.bind(runtime);
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    transferControlToOffscreen: () => ({}),
  } as unknown as HTMLCanvasElement;
  const mount = runtime.mount("sess-1", "1", "view-1", canvas, { width: 800, height: 400, dpr: 1 });
  await vi.advanceTimersByTimeAsync(10);
  return {
    runtime,
    sockets,
    methods: () => requests.mock.calls.map(([method]) => method),
    mount,
    done: () => {
      runtime.dispose();
      binding.dispose();
    },
  };
}

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("item 475 — a hidden window's terminal, through ghosttea's real runtime", () => {
  it("a 4004 while hidden is one close and no mint for an hour; the show is one mint and one dial", async () => {
    vi.useFakeTimers({ now: NOW });
    setHidden(false);
    const r = await rig();
    try {
      expect(r.methods()).toEqual(["terminal.openTicket"]);
      expect(r.sockets).toHaveLength(1);

      hide();
      r.sockets[0]?.cellCloses(4004);
      await vi.advanceTimersByTimeAsync(HOUR);
      expect(r.methods()).toEqual(["terminal.openTicket"]);
      expect(r.sockets).toHaveLength(1);
      expect(r.runtime.routedActivation("sess-1")?.phase).not.toBe("unavailable");

      show();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.methods()).toEqual(["terminal.openTicket", "terminal.openTicket"]);
      expect(r.sockets).toHaveLength(2);
    } finally {
      r.done();
    }
  });

  it("a parked ask cannot trip the attach deadline: an hour parked, then exactly ONE mint", async () => {
    vi.useFakeTimers({ now: NOW });
    setHidden(false);
    const r = await rig();
    try {
      hide();
      // closed inside the first attach's deadline (DEFAULT_ROUTED_PROTOCOL_LIMITS, 5 s): a
      // deadline left armed would fire while the ask is parked and recover again, and each
      // recovery is one more ask; five would end the pane `unavailable`
      r.sockets[0]?.cellCloses(4004);
      await vi.advanceTimersByTimeAsync(HOUR);
      expect(r.runtime.routedActivation("sess-1")?.phase).not.toBe("unavailable");
      show();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.methods().filter((m) => m === "terminal.openTicket")).toHaveLength(2);
    } finally {
      r.done();
    }
  });

  it("the renewal timer goes with the recovery that parks: no renewAttach while parked", async () => {
    vi.useFakeTimers({ now: NOW });
    setHidden(false);
    const r = await rig();
    try {
      hide();
      r.sockets[0]?.cellCloses(4004);
      // the first ticket's renewal was armed for its expiry less 60 s (two hours from NOW, less
      // a minute); three hours parked pass it. A renewal left armed would ask fieldd for
      // `terminal.renewAttach`, and every ask shows in this rig's record of requests
      await vi.advanceTimersByTimeAsync(3 * HOUR);
      expect(r.methods()).not.toContain("terminal.renewAttach");
      expect(r.methods()).toEqual(["terminal.openTicket"]);
    } finally {
      r.done();
    }
  });

  it("the runtime's own detach withdraws the parked ask: the show mints nothing", async () => {
    vi.useFakeTimers({ now: NOW });
    setHidden(false);
    const r = await rig();
    try {
      hide();
      r.sockets[0]?.cellCloses(4004);
      await vi.advanceTimersByTimeAsync(1_000);
      r.mount.dispose();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(r.runtime.routedActivation("sess-1")).toBeUndefined();
      show();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.methods()).toEqual(["terminal.openTicket"]);
      expect(r.sockets).toHaveLength(1);
    } finally {
      r.done();
    }
  });
});
