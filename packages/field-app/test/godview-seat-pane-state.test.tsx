// @vitest-environment happy-dom
/**
 * item 42 — A SESSION ANOTHER DEVICE IS DRIVING (DESIGN.md §8), in pieces:
 *
 *   1. the words: the holder by the name fieldd minted ("Another device" when
 *      none) and what it is doing, over the size it holds and what a click
 *      does; the let-go words in the same figure; nothing for a seat this
 *      window holds or never saw held elsewhere
 *   2. the pool's fold: a strictly older revision ignored, an equal or newer
 *      one replacing in arrival order, an identical repeat changing nothing,
 *      and who let an empty seat go
 *   3. the pool itself, through the routed host the runtime is handed: own vs
 *      foreign, ordering, and the seat leaving with its session
 *   4. the pane: the shipping view (the held-edge readout's figure over the
 *      veil, lit in the pane colour), its stylesheet, and the controller over
 *      the real pool — 400ms after the seat goes, at once when this window
 *      takes it, a glance never flashed, the let-go words in place, and no
 *      pointer taken
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhostteaRoutedHost } from "@vibecook/ghosttea-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeSeat, type SeatPaneFace } from "../src/godview/pane-faces";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import {
  foldSessionSeat,
  type SessionSeat,
  type SessionSeatAnnouncement,
} from "../src/terminal/routed/session-seat";
import { CELL, routedTicket } from "./routed-terminal-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The options every runtime was minted with: the routed host rides in them. */
const minted = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: (options: unknown) => {
    minted.options.push(options);
    const events = new EventTarget();
    return {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
      listSessions: () => Promise.resolve([]),
      registerSession: () => undefined,
      applySessionEvent: () => undefined,
      dispose: () => undefined,
      rendererBackend: "test",
    };
  },
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
}));

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");
const { SEAT_VEIL_DELAY_MS, SeatPaneState, SeatPaneStateView } = await import(
  "../src/godview/SeatPaneState"
);

/** The phone holding the seat, named by the face fieldd minted into its grant. */
const PHONE = {
  clientId: "tailnet:me@example.com#node-phone~E1",
  viewId: "phone-view-1",
  holderGeneration: 3,
  face: { kind: "phone", name: "James's iPhone", os: "ios" },
};
/** A window on another desktop, its face from that desktop's roster row. */
const MINI = {
  clientId: "peer-fieldd:dev-mini#p-7~E1",
  viewId: "mini-view-1",
  holderGeneration: 2,
  face: { kind: "peer-window", name: "mini", os: "macos" },
};
/** A holder fieldd could name no device for. */
const NAMELESS = { clientId: "tailnet:me@example.com~E1", viewId: "v-9", holderGeneration: 1 };
/** This window's own view, under the client its ticket names. */
const OWN = { clientId: "renderer-1", viewId: "view-1", holderGeneration: 4 };

function seat(overrides: Partial<SessionSeat> = {}): SessionSeat {
  return { holder: PHONE, mine: false, revision: 4, cols: 45, rows: 22, ...overrides };
}

/** The text a screen reader is handed, in order: every text outside what is
 * hidden from it. */
function spoken(element: Element): string[] {
  return [...element.childNodes].flatMap((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? "";
      return text === "" ? [] : [text];
    }
    if (node instanceof Element && node.getAttribute("aria-hidden") !== "true") {
      return spoken(node);
    }
    return [];
  });
}

describe("the words a driven pane says (DESIGN.md §8, §9)", () => {
  it("names the holder and what it is doing, over the size it holds — cols × rows, the passage's spaced sign — and what a click does", () => {
    expect(describeSeat(seat())).toEqual({
      state: "held",
      name: "James's iPhone",
      verb: "is driving",
      size: "45 × 22",
      caption: "· click the pane to take it back",
    });
    expect(describeSeat(seat({ holder: MINI, cols: 120, rows: 40 }))).toEqual({
      state: "held",
      name: "mini",
      verb: "is driving",
      size: "120 × 40",
      caption: "· click the pane to take it back",
    });
  });

  it("says 'Another device' for a holder fieldd could name no device for — never its client id", () => {
    const face = describeSeat(seat({ holder: NAMELESS }));
    expect(face).toEqual({
      state: "held",
      name: "Another device",
      verb: "is driving",
      size: "45 × 22",
      caption: "· click the pane to take it back",
    });
    expect(JSON.stringify(face)).not.toContain(NAMELESS.clientId);
  });

  it("says the seat is free when another device let it go, in the same figure: its name, 'let go', the size it was left at", () => {
    expect(describeSeat(seat({ holder: null, revision: 5, released: PHONE }))).toEqual({
      state: "let-go",
      name: "James's iPhone",
      verb: "let go",
      size: "45 × 22",
      caption: "· click the pane to take it.",
    });
    expect(describeSeat(seat({ holder: null, released: NAMELESS }))?.name).toBe("Another device");
  });

  it("says nothing for a seat this window holds, an empty seat nobody else let go, or no seat at all", () => {
    expect(describeSeat(seat({ holder: OWN, mine: true }))).toBeUndefined();
    expect(describeSeat(seat({ holder: null }))).toBeUndefined();
    expect(describeSeat(undefined)).toBeUndefined();
  });
});

describe("the pool's fold of what the cell announces", () => {
  const announced = (
    overrides: Partial<SessionSeatAnnouncement> = {},
  ): SessionSeatAnnouncement => ({
    holder: PHONE,
    mine: false,
    revision: 4,
    cols: 45,
    rows: 22,
    ...overrides,
  });

  it("ignores a strictly older revision, and lets an equal or newer one replace — in arrival order", () => {
    const stored = foldSessionSeat(undefined, announced());
    const stale = announced({ revision: 3, holder: OWN, mine: true });
    expect(foldSessionSeat(stored, stale)).toBe(stored);
    // DS-4d: a finalize on an empty seat resizes the PTY without moving the revision
    const resized = foldSessionSeat(stored, announced({ cols: 80, rows: 24 }));
    expect(resized).toEqual({ holder: PHONE, mine: false, revision: 4, cols: 80, rows: 24 });
    const taken = foldSessionSeat(resized, announced({ revision: 5, holder: OWN, mine: true }));
    expect(taken).toMatchObject({ holder: OWN, mine: true, revision: 5 });
  });

  it("changes nothing for an identical repeat — the cell's announcement on a leg's attach — so nothing republishes", () => {
    const stored = foldSessionSeat(undefined, announced());
    expect(foldSessionSeat(stored, announced())).toBe(stored);
    expect(foldSessionSeat(stored, { ...announced(), holder: { ...PHONE } })).toBe(stored);
  });

  it("remembers who let an empty seat go — another client, never this window — until a holder takes it", () => {
    const held = foldSessionSeat(undefined, announced());
    const free = foldSessionSeat(held, announced({ holder: null }));
    expect(free.released).toEqual(PHONE);
    // the empty seat announced again keeps who let it go, and is the same seat
    expect(foldSessionSeat(free, announced({ holder: null }))).toBe(free);
    // a holder clears it
    expect(foldSessionSeat(free, announced({ revision: 5 })).released).toBeUndefined();
    // this window letting go leaves nobody to name
    const mineHeld = foldSessionSeat(undefined, announced({ holder: OWN, mine: true }));
    expect(foldSessionSeat(mineHeld, announced({ holder: null })).released).toBeUndefined();
    // and an empty seat this window never saw held names nobody either
    expect(foldSessionSeat(undefined, announced({ holder: null })).released).toBeUndefined();
  });
});

// ── the real pool, through the routed host its runtime is handed ─────────────

const SESSION = "pty-1";
const CONTEXT = { cellBootId: CELL, connectionSetId: "connection-1", channel: "control" as const };

const fieldd = {
  request: (method: string, params?: unknown) => {
    if (method === "terminal.openTicket") {
      return Promise.resolve(routedTicket((params as { sessionId: string }).sessionId));
    }
    if (method === "terminal.terminate") return Promise.resolve({ terminated: true });
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
} as unknown as Parameters<typeof pool.openTerminalPool>[0];

async function settle(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

/** The pool open on SESSION, its ticket taken (this window's client is the
 * fixture's `renderer-1`), and the routed host the runtime was handed. */
async function openSession(): Promise<GhostteaRoutedHost> {
  pool.openTerminalPool(fieldd, { sessionIds: [SESSION] });
  await settle();
  const host = (minted.options.at(-1) as { host: GhostteaRoutedHost }).host;
  await host.openTicket(SESSION);
  return host;
}

function announce(
  host: GhostteaRoutedHost,
  holder: unknown,
  geometryRevision: number,
  size: { cols: number; rows: number } = { cols: 45, rows: 22 },
): void {
  host.onExtensionMessage?.(
    { type: "GeometryState", sessionId: SESSION, holder, geometryRevision, ...size },
    CONTEXT,
  );
}

beforeEach(() => {
  minted.options = [];
  pool.disposeTerminalPool();
  pool.configureTerminalPool({
    transport: "routed",
    defaultShell: "/bin/zsh",
    home: "/Users/test",
  });
  setHost({
    logger: {
      child: () => ({ info: () => undefined, error: () => undefined, debug: () => undefined }),
    },
  } as unknown as FieldHost);
});

afterEach(() => pool.disposeTerminalPool());

describe("the pool's seat map", () => {
  it("keeps each session's seat as its cell announced it — foreign or this window's — and the newest only", async () => {
    const host = await openSession();
    expect(pool.terminalPoolSnapshot().sessionSeats.size).toBe(0);

    announce(host, PHONE, 4);
    expect(pool.terminalPoolSnapshot().sessionSeats.get(SESSION)).toEqual({
      holder: PHONE,
      mine: false,
      revision: 4,
      cols: 45,
      rows: 22,
    });
    // an equal revision with a new size replaces; an older one is ignored
    announce(host, PHONE, 4, { cols: 80, rows: 24 });
    expect(pool.terminalPoolSnapshot().sessionSeats.get(SESSION)).toMatchObject({
      cols: 80,
      rows: 24,
    });
    announce(host, OWN, 3);
    expect(pool.terminalPoolSnapshot().sessionSeats.get(SESSION)?.holder).toEqual(PHONE);
    // this window's own client takes it
    announce(host, OWN, 5);
    expect(pool.terminalPoolSnapshot().sessionSeats.get(SESSION)).toMatchObject({
      holder: OWN,
      mine: true,
      revision: 5,
    });
  });

  it("publishes only a seat that moved: an identical repeat leaves the snapshot as it was", async () => {
    const host = await openSession();
    announce(host, PHONE, 4);
    const before = pool.terminalPoolSnapshot();
    const published = vi.fn();
    const stop = pool.subscribeTerminalPool(published);
    announce(host, PHONE, 4);
    announce(host, OWN, 2);
    stop();
    expect(published).not.toHaveBeenCalled();
    expect(pool.terminalPoolSnapshot()).toBe(before);
  });

  it("lets the seat go with its session, as the remote state does", async () => {
    const host = await openSession();
    announce(host, PHONE, 4);
    expect(pool.terminalPoolSnapshot().sessionSeats.has(SESSION)).toBe(true);
    await host.terminate?.(SESSION, "user");
    expect(pool.terminalPoolSnapshot().sessionSeats.has(SESSION)).toBe(false);
  });
});

// ── the pane ──────────────────────────────────────────────────────────────

describe("the driven pane (the shipping view, and its controller over the real pool)", () => {
  let root: Root | null = null;
  let paneElement: HTMLElement | null = null;

  /** Mount the controller into a pane element, as the deck's frame slot does. */
  async function mountPane(): Promise<HTMLElement> {
    const pane = document.createElement("div");
    const container = document.createElement("div");
    document.body.append(pane, container);
    paneElement = pane;
    root = createRoot(container);
    const mounted = root;
    await act(async () => {
      mounted.render(<SeatPaneState pane={pane} sessionId={SESSION} />);
    });
    return pane;
  }

  /** Mount the shipping view alone, for one face. */
  async function mountView(face: SeatPaneFace): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    paneElement = container;
    root = createRoot(container);
    const mounted = root;
    await act(async () => mounted.render(<SeatPaneStateView face={face} />));
    return container;
  }

  /** Hand the mounted view another face, as the controller does in place. */
  async function redraw(face: SeatPaneFace): Promise<void> {
    const mounted = root;
    if (mounted === null) throw new Error("a view is mounted");
    await act(async () => mounted.render(<SeatPaneStateView face={face} />));
  }

  /** The phone's face for a seat, which every seat drawn here has. */
  function faceOf(overrides: Partial<SessionSeat> = {}): SeatPaneFace {
    const face = describeSeat(seat(overrides));
    if (face === undefined) throw new Error("the phone's seat has a face");
    return face;
  }

  afterEach(async () => {
    const mounted = root;
    root = null;
    if (mounted !== null) await act(async () => mounted.unmount());
    paneElement?.remove();
    paneElement = null;
    vi.useRealTimers();
  });

  const readout = (pane: HTMLElement) => pane.querySelector(".vf-godview-seat-state");
  const letters = (pane: HTMLElement) => [
    ...pane.querySelectorAll<HTMLElement>(".vf-godview-seat-state-name > span"),
  ];
  const wait = async (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("is a status region: the veil, the bloom and the glow for the eye, the name and its verb, one caption with the size in mono", async () => {
    const view = await mountView(faceOf());
    const state = readout(view);
    expect(state?.getAttribute("role")).toBe("status");
    expect(state?.getAttribute("data-seat-state")).toBe("held");
    for (const light of ["veil", "bloom", "glow"]) {
      expect(
        state?.querySelector(`.vf-godview-seat-state-${light}`)?.getAttribute("aria-hidden"),
      ).toBe("true");
    }
    expect(view.querySelector(".vf-godview-seat-state-verb")?.textContent).toBe("is driving");
    expect(view.querySelector(".vf-godview-seat-state-caption")?.textContent).toBe(
      "45 × 22 · click the pane to take it back",
    );
    expect(
      view.querySelector(".vf-godview-seat-state-caption > .vf-godview-seat-state-size")
        ?.textContent,
    ).toBe("45 × 22");
  });

  it("draws the name one box per letter for the pop, and hands a screen reader the words whole", async () => {
    const view = await mountView(faceOf());
    // a space is a no-break one, or its own box would drop it
    expect(letters(view).map((letter) => letter.textContent)).toEqual([..."James's\u00a0iPhone"]);
    expect(view.querySelector(".vf-godview-seat-state-name")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(spoken(view)).toEqual([
      "James's iPhone",
      "is driving",
      "45 × 22",
      "· click the pane to take it back",
    ]);
  });

  it("pops the letters in 140ms behind the veil and 26ms apart, the whole stagger never more than 400ms (§6)", async () => {
    const delays = (view: HTMLElement) =>
      letters(view).map((letter) => letter.style.transitionDelay);
    const face = faceOf();
    const view = await mountView(face);
    expect(delays(view)).toEqual(Array.from({ length: 14 }, (_, at) => `${140 + at * 26}ms`));
    // a long name's later letters start together: 26ms apart until the stagger reaches its 400ms cap
    await redraw({ ...face, name: "studio-mac-mini-north" });
    expect(delays(view)).toEqual(
      Array.from({ length: 21 }, (_, at) => `${140 + Math.min(at * 26, 400)}ms`),
    );
    // a letter is a grapheme: an emoji and its joiner are one box, never split
    const coder = "\u{1F469}\u200d\u{1F4BB}";
    await redraw({ ...face, name: `${coder} mini` });
    expect(letters(view).map((letter) => letter.textContent)).toEqual([
      coder,
      "\u00a0",
      "m",
      "i",
      "n",
      "i",
    ]);
  });

  it("appears 400ms after the seat goes to another device — and goes at once when this window takes it", async () => {
    const host = await openSession();
    const pane = await mountPane();
    vi.useFakeTimers();
    await act(async () => announce(host, PHONE, 4));
    expect(readout(pane)).toBeNull();
    await wait(SEAT_VEIL_DELAY_MS - 1);
    expect(readout(pane)).toBeNull();
    await wait(1);
    expect(readout(pane)?.getAttribute("data-seat-state")).toBe("held");
    expect(spoken(pane)).toEqual([
      "James's iPhone",
      "is driving",
      "45 × 22",
      "· click the pane to take it back",
    ]);
    // this window's press took it back: gone in the same turn, no timer
    await act(async () => announce(host, OWN, 5));
    expect(readout(pane)).toBeNull();
  });

  it("never flashes for a glance at the phone, and never shows for this window's own seat", async () => {
    const host = await openSession();
    const pane = await mountPane();
    vi.useFakeTimers();
    await act(async () => announce(host, OWN, 4));
    await wait(1_000);
    expect(readout(pane)).toBeNull();
    // the phone takes the seat and gives it back inside the wait
    await act(async () => announce(host, PHONE, 5));
    await wait(SEAT_VEIL_DELAY_MS / 2);
    await act(async () => announce(host, OWN, 6));
    await wait(1_000);
    expect(readout(pane)).toBeNull();
  });

  it("says the seat is free when the phone lets go, in place: no second wait, and no second entrance", async () => {
    const host = await openSession();
    const pane = await mountPane();
    vi.useFakeTimers();
    await act(async () => announce(host, PHONE, 4));
    await wait(SEAT_VEIL_DELAY_MS);
    const held = readout(pane);
    const heldLetters = letters(pane);
    expect(held?.getAttribute("data-seat-state")).toBe("held");
    await act(async () => announce(host, null, 5));
    expect(readout(pane)?.getAttribute("data-seat-state")).toBe("let-go");
    expect(spoken(pane)).toEqual([
      "James's iPhone",
      "let go",
      "45 × 22",
      "· click the pane to take it.",
    ]);
    // the same elements, so no starting style is met again: the entrance played once
    expect(readout(pane)).toBe(held);
    const letGoLetters = letters(pane);
    expect(letGoLetters).toHaveLength(heldLetters.length);
    expect(letGoLetters.every((letter, at) => letter === heldLetters[at])).toBe(true);
  });

  // vitest loads no CSS: the rules are held here, as ui-system-boundaries holds
  // them, from the item's own block of the sheet
  const sheet = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/godview/godview.css"),
    "utf8",
  );
  // the item's block ends where the next state's begins (ST-D4 (a), the stopping pane)
  const seatSheet = sheet.slice(
    sheet.indexOf("/* item 42 — A SESSION ANOTHER DEVICE IS DRIVING"),
    sheet.indexOf("/* ST-D4 (a) — A RUN A STOP HAS NOT STOPPED"),
  );
  /** A rule's body, by its whole selector at a line's start (a starting style,
   * indented in its block, is never it). */
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped} \\{([^}]*)\\}`, "m").exec(seatSheet)?.[1] ?? "";
  };
  /** An at-rule's whole block, its braces counted. */
  const block = (head: string): string => {
    const start = seatSheet.indexOf(head);
    if (start < 0) return "";
    let depth = 0;
    for (let at = start; at < seatSheet.length; at += 1) {
      const char = seatSheet[at];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (char === "}" && depth === 0) return seatSheet.slice(start, at + 1);
    }
    return "";
  };

  it("takes no pointer, under the pane's frame: a click goes through to the pane, whose press takes the seat back", () => {
    // the item's block, found whole: from its own head to the next item's
    expect(seatSheet.startsWith("/* item 42")).toBe(true);
    expect(seatSheet).not.toContain("M49");
    expect(seatSheet).not.toContain("ST-D4");
    const state = rule(".vf-godview-seat-state");
    expect(state).toContain("pointer-events: none;");
    expect(state).toContain("z-index: 5;");
  });

  it("draws the held-edge readout's figure over the veil, lit in the pane colour, and no ring of its own", () => {
    // the veil: the terminal's ground at 62%, the held-edge readout's
    expect(rule(".vf-godview-seat-state-veil")).toContain(
      "background: color-mix(in srgb, var(--deck-ground) 62%, transparent);",
    );
    // the words: 800 at 64px/1, −0.04em, Godview's text main, haloed in the
    // terminal's ground (40 and 18); the verb at 40%
    const words = rule(".vf-godview-seat-state-words");
    expect(words).toContain("font: 800 64px / 1 var(--vf-font-sans);");
    expect(words).toContain("letter-spacing: -0.04em;");
    expect(words).toContain("color: var(--text-main);");
    expect(words).toMatch(
      /text-shadow:\s*0 0 40px var\(--deck-ground\),\s*0 0 18px var\(--deck-ground\);/,
    );
    expect(rule(".vf-godview-seat-state-verb")).toContain(
      "color: color-mix(in srgb, var(--text-main) 40%, transparent);",
    );
    // one caption line: 11px 600 at the terminal's ink's 72%, the size in mono
    const caption = rule(".vf-godview-seat-state-caption");
    expect(caption).toContain("font-size: 11px;");
    expect(caption).toContain("font-weight: 600;");
    expect(caption).toContain(
      "color: color-mix(in srgb, var(--vf-godview-terminal-ink, currentcolor) 72%, transparent);",
    );
    expect(rule(".vf-godview-seat-state-size")).toContain("font-family: var(--vf-font-mono);");
    // the pane colour as the frame reads it: Ghosttea's, else the terminal's ink
    expect(rule(".vf-godview-seat-state")).toMatch(
      /--pane-color: var\(\s*--ghostty-pane-color,\s*color-mix\(in srgb, var\(--vf-godview-terminal-ink, currentcolor\) 70%, transparent\)\s*\);/,
    );
    expect(rule(".vf-godview-seat-state-glow")).toMatch(
      /box-shadow:\s*inset 0 0 30px 2px color-mix\(in srgb, var\(--pane-color\) 74%, transparent\),\s*inset 0 0 130px 18px color-mix\(in srgb, var\(--pane-color\) 30%, transparent\);/,
    );
    const bloom = rule(".vf-godview-seat-state-bloom");
    expect(bloom).toContain("width: 600px;");
    expect(bloom).toContain("height: 380px;");
    expect(bloom).toMatch(
      /radial-gradient\(\s*closest-side,\s*color-mix\(in srgb, var\(--pane-color\) 50%, transparent\),\s*color-mix\(in srgb, var\(--pane-color\) 16%, transparent\) 52%,\s*transparent\s*\)/,
    );
    // the pane's line stays the frame's own 1px: nothing here draws a ring
    expect(seatSheet).not.toMatch(/1\.5px/);
    expect(seatSheet).not.toMatch(/(^|[\s;{])(border|outline)(-width|-color|-style)?\s*:/m);
  });

  it("plays its entrance once from starting styles on §6's curves, never a keyframe, and under reduced motion fades the whole in 100ms", () => {
    // M3 and GT-D15.1's audit: transitions from starting styles, no keyframe, no loop
    expect(seatSheet).not.toMatch(/@keyframes|animation(-name)?\s*:/);
    expect(rule(".vf-godview-seat-state-veil")).toContain("transition: opacity 200ms ease;");
    expect(rule(".vf-godview-seat-state-glow")).toContain(
      "transition: opacity 600ms var(--vf-ease-island);",
    );
    expect(rule(".vf-godview-seat-state-bloom")).toMatch(
      /opacity 600ms var\(--vf-ease-island\) 140ms,\s*transform 600ms var\(--vf-ease-island\) 140ms;/,
    );
    expect(rule(".vf-godview-seat-state-name > span")).toMatch(
      /opacity 280ms var\(--vf-ease-pop\),\s*transform 280ms var\(--vf-ease-pop\);/,
    );
    expect(rule(".vf-godview-seat-state-verb")).toMatch(
      /opacity 560ms var\(--vf-ease-island\) 340ms,\s*letter-spacing 560ms var\(--vf-ease-island\) 340ms;/,
    );
    expect(rule(".vf-godview-seat-state-caption")).toMatch(
      /opacity 240ms var\(--vf-ease-island\) 540ms,\s*transform 240ms var\(--vf-ease-island\) 540ms;/,
    );
    const entrance = block("@starting-style {");
    expect(entrance).toMatch(
      /\.vf-godview-seat-state-veil,\s*\.vf-godview-seat-state-glow \{\s*opacity: 0;\s*\}/,
    );
    expect(entrance).toMatch(
      /\.vf-godview-seat-state-bloom \{\s*opacity: 0;\s*transform: scale\(0\.4\);\s*\}/,
    );
    expect(entrance).toMatch(
      /\.vf-godview-seat-state-name > span \{\s*opacity: 0;\s*transform: translateY\(0\.5em\);\s*\}/,
    );
    expect(entrance).toMatch(
      /\.vf-godview-seat-state-verb \{\s*opacity: 0;\s*letter-spacing: 0\.34em;\s*\}/,
    );
    expect(entrance).toMatch(
      /\.vf-godview-seat-state-caption \{\s*opacity: 0;\s*transform: translateY\(8px\);\s*\}/,
    );
    // with Godview's animations off, none of it moves
    expect(seatSheet).toMatch(
      /\.vf-godview\[data-godview-animations="off"\] \.vf-godview-seat-state,\s*\.vf-godview\[data-godview-animations="off"\] \.vf-godview-seat-state \* \{\s*transition: none;\s*\}/,
    );
    // M6: the whole of it fades in over 100ms, with no travel and no stagger
    const reduced = block("@media (prefers-reduced-motion: reduce) {");
    expect(reduced).toMatch(/\.vf-godview-seat-state \{\s*transition: opacity 100ms ease;\s*\}/);
    expect(reduced).toMatch(
      /@starting-style \{\s*\.vf-godview-seat-state \{\s*opacity: 0;\s*\}\s*\}/,
    );
    expect(reduced).toMatch(
      /\.vf-godview-seat-state-veil,\s*\.vf-godview-seat-state-bloom,\s*\.vf-godview-seat-state-glow,\s*\.vf-godview-seat-state-name > span,\s*\.vf-godview-seat-state-verb,\s*\.vf-godview-seat-state-caption \{\s*transition: none;\s*\}/,
    );
  });
});
