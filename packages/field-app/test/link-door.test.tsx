// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrMatrix } from "../src/account/door/sign-in-qr";
import { TAILSCALE_MARK_MIN, TailscaleMark } from "../src/account/tailscale-mark";
import { type LinkDoor, useLinkDoor } from "../src/account/use-link-door";

// TS-2 (track TS) — the door's machinery and its two kept-exact drawings. What
// these pin is what a person feels: one click reaches the browser and only one
// tab opens (TS-D5); the phone's code and an auth key never open anything; the
// mark is Tailscale's own and never under its floor (TS-D4, DESIGN.md §13).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

const OFFLINE = {
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkState: "offline",
  linkDetail: null,
};

/** Mount the door over a scripted client; `push` moves the subscription. */
async function mountDoor(request: (method: string, params: unknown) => Promise<unknown>) {
  let push: ((status: unknown) => void) | null = null;
  let door: LinkDoor | null = null;
  const opened: string[] = [];
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string, _params: unknown, onEvent?: (e: unknown) => void) => {
      if (method !== "user.link.subscribe") throw new Error(`unexpected subscribe: ${method}`);
      push = (status) => onEvent?.(status);
      return { subId: "link", snapshot: OFFLINE, unsubscribe: () => undefined };
    }),
    request: vi.fn(request),
  } as unknown as FielddClient;
  function Probe(): ReactElement | null {
    door = useLinkDoor((url) => opened.push(url));
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(FielddProvider, { client }, createElement(Probe)));
    await Promise.resolve();
  });
  return {
    door: () => door as unknown as LinkDoor,
    push: async (status: unknown) => act(async () => push?.(status)),
    opened,
    client,
  };
}

const capturing = (authUrl: string | null) => ({
  ...OFFLINE,
  meshEnabled: true,
  authUrl,
  linkState: "capturing",
});

describe("the hand-off (TS-D5)", () => {
  it("opens the address once, the moment it is ready, because the person clicked", async () => {
    const harness = await mountDoor(async () => capturing(null));
    await act(async () => {
      await harness.door().begin();
    });
    expect(harness.opened).toEqual([]); // no address yet: nothing to open
    await harness.push(capturing("https://login.tailscale.com/a/first"));
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/first"]);
    // tsnet rotates the address while it waits: the pane offers Open again,
    // and no second tab opens by itself
    await harness.push(capturing("https://login.tailscale.com/a/second"));
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/first"]);
    act(() => harness.door().openAgain());
    expect(harness.opened).toEqual([
      "https://login.tailscale.com/a/first",
      "https://login.tailscale.com/a/second",
    ]);
  });

  it("opens straight from the answer when the address is already there", async () => {
    const harness = await mountDoor(async () => capturing("https://login.tailscale.com/a/now"));
    await act(async () => {
      await harness.door().begin();
    });
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/now"]);
  });

  it("never opens an address nobody asked for", async () => {
    const harness = await mountDoor(async () => capturing(null));
    // another surface, or a capture the floor carried on: no click here
    await harness.push(capturing("https://login.tailscale.com/a/unasked"));
    expect(harness.opened).toEqual([]);
  });

  it("keeps the address for the phone's code, and signs a key in with nothing opened", async () => {
    const harness = await mountDoor(async () => capturing(null));
    await act(async () => {
      await harness.door().begin({ browser: false });
    });
    await harness.push(capturing("https://login.tailscale.com/a/phone"));
    expect(harness.opened).toEqual([]);
    await act(async () => {
      await harness.door().begin({ authKey: "tskey-auth-kTEST-0" });
    });
    expect(harness.client.request).toHaveBeenLastCalledWith("user.link.begin", {
      authKey: "tskey-auth-kTEST-0",
    });
    expect(harness.opened).toEqual([]);
  });

  it("starts over by unlinking first, then opens the fresh sign-in once", async () => {
    const harness = await mountDoor(async (method) => {
      if (method === "user.link.unlink") return { retired: true };
      return capturing(null);
    });
    // a capture held by approval: the wrong account's network
    await harness.push({ ...capturing(null), linkState: "awaiting_approval" });
    await act(async () => {
      await harness.door().startOver();
    });
    // the identity is archived BEFORE the new capture, or it would come back
    // to the same network
    expect(vi.mocked(harness.client.request).mock.calls.map(([method]) => method)).toEqual([
      "user.link.unlink",
      "user.link.begin",
    ]);
    await harness.push(capturing("https://login.tailscale.com/a/fresh"));
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/fresh"]);
  });

  it("starts nothing when the unlink is refused", async () => {
    const harness = await mountDoor(async (method) => {
      if (method === "user.link.unlink") throw new Error("the floor is not answering");
      return capturing(null);
    });
    let reason: string | null = null;
    await act(async () => {
      reason = await harness.door().startOver();
    });
    expect(reason).toBe("the floor is not answering");
    expect(vi.mocked(harness.client.request).mock.calls.map(([method]) => method)).toEqual([
      "user.link.unlink",
    ]);
    await harness.push(capturing("https://login.tailscale.com/a/unasked"));
    expect(harness.opened).toEqual([]);
  });

  it("renews and opens the new address; cancels without opening; says a refusal in its words", async () => {
    const harness = await mountDoor(async (method) => {
      if (method === "user.link.cancel") return { ...OFFLINE };
      if (method === "user.link.renew") return { ...capturing(null), linkState: "expired" };
      throw new Error("this user is already linked to a tailscale account; unlink first");
    });
    await act(async () => {
      await harness.door().renew();
    });
    await harness.push({
      ...capturing("https://login.tailscale.com/a/renew"),
      linkState: "expired",
    });
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/renew"]);
    let reason: string | null = "unset";
    await act(async () => {
      reason = await harness.door().cancel();
    });
    expect(reason).toBeNull();
    await act(async () => {
      reason = await harness.door().begin();
    });
    expect(reason).toBe("this user is already linked to a tailscale account; unlink first");
    expect(harness.door().step).toEqual({
      kind: "failed",
      reason: "this user is already linked to a tailscale account; unlink first",
    });
  });
});

describe("Tailscale's logomark, kept exact (TS-D4, DESIGN.md §13)", () => {
  const draw = async (size?: number) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(TailscaleMark, size === undefined ? {} : { size }));
    });
    return container.querySelector("svg") as SVGSVGElement;
  };

  it("is nine dots, the middle row and the bottom centre solid, the rest at 40%", async () => {
    const svg = await draw();
    const dots = [...svg.querySelectorAll("circle")];
    expect(dots).toHaveLength(9);
    const faint = dots.filter((dot) => dot.getAttribute("fill-opacity") === "0.4");
    expect(faint).toHaveLength(5);
    const solid = dots
      .filter((dot) => dot.getAttribute("fill-opacity") === null)
      .map((dot) => `${dot.getAttribute("cx")},${dot.getAttribute("cy")}`);
    expect(solid.sort()).toEqual(["138.5,84.5", "30.5,84.5", "84.5,138.5", "84.5,84.5"].sort());
    expect(svg.getAttribute("aria-label")).toBe("Tailscale");
    expect(svg.getAttribute("width")).toBe("56"); // the dots themselves span 48
  });

  it("is never drawn under the toolkit's 48 px floor", async () => {
    const svg = await draw(16);
    expect(TAILSCALE_MARK_MIN).toBe(48);
    expect(svg.getAttribute("width")).toBe("48");
    expect(svg.getAttribute("height")).toBe("48");
  });
});

describe("the phone's code (TS-D6)", () => {
  it("encodes the address locally as a square code with its quiet border", () => {
    const matrix = qrMatrix("https://login.tailscale.com/a/1a2b3c4d5e6f");
    const size = matrix.length;
    expect(size).toBeGreaterThanOrEqual(21 + 4);
    for (const row of matrix) expect(row).toHaveLength(size);
    // the two-module border is light all round
    expect(matrix[0]?.every((cell) => cell === false)).toBe(true);
    expect(matrix[1]?.every((cell) => cell === false)).toBe(true);
    // a finder pattern's dark corner sits just inside it
    expect(matrix[2]?.[2]).toBe(true);
    // the same address, the same code
    expect(qrMatrix("https://login.tailscale.com/a/1a2b3c4d5e6f")).toEqual(matrix);
  });
});
