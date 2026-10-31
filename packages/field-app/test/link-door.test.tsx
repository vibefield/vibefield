// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrMatrix } from "../src/account/door/sign-in-qr";
import { TAILSCALE_MARK_MIN, TailscaleMark } from "../src/account/tailscale-mark";
import { copyText, type LinkDoor, useLinkDoor } from "../src/account/use-link-door";
import { cardsStore } from "../src/frame/cards/cards-store";
import { COPY_PLACES } from "../src/frame/cards/cards-words";
import { type FieldHost, setHost } from "../src/host";

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

describe("Send logs on this network (TS-D16)", () => {
  const LOGS_REQUIRED = { ...OFFLINE, meshEnabled: true, linkState: "logs_required" };

  it("keeps a standing link's opt-in through user.link.logs, and opens nothing", async () => {
    const harness = await mountDoor(async () => ({ ok: true }));
    await harness.push({
      ...LOGS_REQUIRED,
      link: { login: "james@example.com", linkedAt: "2026-08-05T09:00:00.000Z" },
    });
    await act(async () => {
      await harness.door().sendLogs(true);
    });
    expect(harness.client.request).toHaveBeenLastCalledWith("user.link.logs", { send: true });
    await act(async () => {
      await harness.door().sendLogs(false);
    });
    expect(harness.client.request).toHaveBeenLastCalledWith("user.link.logs", { send: false });
    expect(harness.opened).toEqual([]);
  });

  it("begins a capture the network refused again, sending logs, and opens its new address once", async () => {
    const harness = await mountDoor(async () => capturing(null));
    await harness.push(LOGS_REQUIRED);
    await act(async () => {
      await harness.door().sendLogs(true);
    });
    expect(harness.client.request).toHaveBeenLastCalledWith("user.link.begin", { sendLogs: true });
    await harness.push(capturing("https://login.tailscale.com/a/with-logs"));
    expect(harness.opened).toEqual(["https://login.tailscale.com/a/with-logs"]);
  });
});

describe("the link's copies deal cards (HN-5)", () => {
  afterEach(() => {
    for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  });

  function copyHost(takes = true): string[] {
    const copied: string[] = [];
    setHost({
      logger: {},
      diagnostics: {
        copyText: async (text: string) => {
          copied.push(text);
          if (!takes) throw new Error("clipboard text is invalid or too large");
        },
      },
    } as unknown as FieldHost);
    return copied;
  }

  it("copies the live address from the button's box, named by the door's place", async () => {
    const copied = copyHost();
    const harness = await mountDoor(async () => capturing(null));
    await harness.push(capturing("https://login.tailscale.com/a/copy"));
    const from = { left: 40, top: 500, width: 80, height: 28 };
    let ok: boolean | null = null;
    await act(async () => {
      ok = await harness.door().copyLink(from);
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(["https://login.tailscale.com/a/copy"]);
    const card = cardsStore.snapshot().cards.at(-1);
    expect(card).toMatchObject({
      kind: "text",
      paste: "https://login.tailscale.com/a/copy",
      origin: { view: "canvas", place: COPY_PLACES.settings, how: "copy" },
    });
    expect(cardsStore.snapshot().arriving.get(card?.id ?? "")).toEqual(from);
  });

  it("copies nothing with no address, and deals nothing the clipboard refused", async () => {
    copyHost(false);
    const harness = await mountDoor(async () => capturing(null));
    let ok: boolean | null = null;
    await act(async () => {
      ok = await harness.door().copyLink();
    });
    expect(ok).toBe(false);
    await harness.push(capturing("https://login.tailscale.com/a/refused"));
    await act(async () => {
      ok = await harness.door().copyLink();
    });
    expect(ok).toBe(false);
    expect(cardsStore.snapshot().cards).toEqual([]);
  });

  it("names the Setup Assistant on a word's card, dealt from the button's box", async () => {
    copyHost();
    const from = { left: 300, top: 420, width: 48, height: 28 };
    const copied = copyText("truffle-vibefield-studio", COPY_PLACES.setup, from);
    await expect(copied).resolves.toBe(true);
    const card = cardsStore.snapshot().cards.at(-1);
    expect(card).toMatchObject({
      paste: "truffle-vibefield-studio",
      origin: { place: "Setup Assistant", how: "copy" },
    });
    expect(cardsStore.snapshot().arriving.get(card?.id ?? "")).toEqual(from);
  });
});
