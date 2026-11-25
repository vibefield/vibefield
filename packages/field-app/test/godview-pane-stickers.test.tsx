// @vitest-environment happy-dom
/**
 * OB-D16 (2026-11-25; DESIGN.md §8 "At work, in the pane") — THE OBJECTS A PANE'S AGENT HOLDS, AS THEIR STICKERS:
 *
 *   1. the model: a pane's run matched to the at-work feed's rows, its waits from `waiters`, first held first, past
 *      three the first two and a count, the words, its own angle
 *   2. the art: every built-in kind an agent can hold has its own, sound; a plugin's arrives through `plugins.stickers`
 *      (its contracts fixture, parsed here too); the slots painted from the object's props on a parsed copy, drawn
 *      only as an image
 *   3. the view: one button a sticker, its state on it, its words on pointing and on focus, the count, a click that
 *      goes to the desk
 *   4. the door to the desk: Canvas asked for, then the object centred and selected; nothing for a board not mounted
 *   5. its stylesheet: the two loops argued into Godview (GT-D15.1), held still under reduced motion and with Godview's
 *      animations off
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Camera, Position, Size, Viewport } from "@vibecook/ice";
import {
  DESK_KINDS,
  type ObjectPresence,
  PluginStickersResult,
  stickerArtProblems,
} from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPresence, publishPresence } from "../src/field/desk/agent/presence-store";
import { BUILT_IN_STICKERS } from "../src/field/desk/agent-kinds/stickers";
import type { MountedDesk } from "../src/field/desk/desk-door";
import { lookAtObject, showOnDesk } from "../src/field/desk/look-at-object";
import {
  type PaneStickerFace,
  PaneToolStickersView,
} from "../src/godview/pane-stickers/PaneToolStickers";
import {
  paneStickerItems,
  shownStickers,
  stateWords,
  stickerAngle,
} from "../src/godview/pane-stickers/pane-stickers-model";
import {
  connectStickerArt,
  resetStickerArtForTests,
  stickerArtOf,
  stickerArtUrl,
  stickerFills,
} from "../src/godview/pane-stickers/sticker-art";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = "run-claude";

const row = (
  ref: string,
  agents: Array<{
    run: string;
    state: ObjectPresence["agents"][number]["state"];
    since?: number;
    label?: string;
  }>,
  extra: Partial<ObjectPresence> = {},
): ObjectPresence =>
  ({
    ref,
    docId: "doc-1",
    key: `key-${ref}`,
    agents: agents.map((agent) => ({
      run: agent.run,
      handle: agent.run === RUN ? "Claude Code" : "Codex",
      agent: agent.run === RUN ? "claude" : "codex",
      state: agent.state,
      since: agent.since ?? 0,
      ...(agent.label !== undefined ? { lastChange: { label: agent.label } } : {}),
    })),
    ...extra,
  }) as ObjectPresence;

describe("what a pane's stickers say", () => {
  it("matches the pane's run to the feed's rows, its waits from the waiters, first held first", () => {
    const objects = [
      row("vf:obj/note0001", [{ run: RUN, state: "reading", since: 20 }]),
      row("vf:obj/page0001", [
        { run: RUN, state: "needs-you", since: 10 },
        { run: "run-codex", state: "open" },
      ]),
      row("vf:obj/phone001", [{ run: "run-codex", state: "acting" }], {
        holder: "run-codex",
        waiters: [RUN],
      }),
      row("vf:obj/other001", [{ run: "run-codex", state: "open" }]),
    ];
    const items = paneStickerItems(objects, RUN);
    expect(items.map((item) => [item.ref, item.state])).toEqual([
      ["vf:obj/page0001", "needs"],
      ["vf:obj/note0001", "reading"],
      ["vf:obj/phone001", "waiting"],
    ]);
    expect(items[2]?.holder).toBe("run-codex");
    expect(paneStickerItems(objects, undefined)).toEqual([]);
  });

  it("shows three, and past three the first two and a count", () => {
    const items = paneStickerItems(
      ["a", "b", "c", "d"].map((x, i) =>
        row(`vf:obj/${x}0000001`, [{ run: RUN, state: "open", since: i }]),
      ),
      RUN,
    );
    expect(shownStickers(items.slice(0, 3))).toMatchObject({ more: 0 });
    const { shown, more } = shownStickers(items);
    expect(shown).toHaveLength(2);
    expect(more).toBe(2);
  });

  it("says the state in the mat's words, and keeps its own angle within six degrees", () => {
    expect(stateWords("acting")).toBe("changing it");
    expect(stateWords("needs")).toBe("needs you");
    expect(stateWords("waiting", "Codex")).toBe("waiting: Codex has it");
    expect(stateWords("waiting")).toBe("waiting for it");
    for (const ref of ["vf:obj/a", "vf:obj/b", "vf:obj/c"]) {
      const angle = stickerAngle(ref, RUN);
      expect(Math.abs(angle)).toBeLessThanOrEqual(6);
      expect(stickerAngle(ref, RUN)).toBe(angle);
    }
  });

  it("is fed by the desk's applier into the window's store", () => {
    const objects = [row("vf:obj/note0001", [{ run: RUN, state: "open" }])];
    publishPresence(objects);
    expect(getPresence()).toBe(objects);
    publishPresence([]);
    expect(getPresence()).toEqual([]);
  });
});

describe("the art", () => {
  afterEach(() => resetStickerArtForTests());

  it("gives every built-in kind an agent can hold its own sound art", () => {
    for (const kind of DESK_KINDS.filter((k) => k.agent !== undefined)) {
      const sticker = BUILT_IN_STICKERS[kind.type];
      expect(sticker, kind.type).toBeDefined();
      expect(stickerArtProblems(sticker?.svg ?? ""), kind.type).toEqual([]);
      expect(stickerArtOf(kind.type)?.width, kind.type).toBeGreaterThan(0);
    }
  });

  it("takes a plugin's art through plugins.stickers, beside the built-ins", async () => {
    const fixture = JSON.parse(
      readFileSync(join(here, "../../contracts/fixtures/plugins-stickers.valid.json"), "utf8"),
    );
    expect(PluginStickersResult.safeParse(fixture).success).toBe(true);
    const request = vi.fn(async () => fixture);
    connectStickerArt({ request });
    await vi.waitFor(() => expect(stickerArtOf("vibefield.simulator.phone")).toBeDefined());
    expect(request).toHaveBeenCalledWith("plugins.stickers", {});
    expect(stickerArtOf("vibefield.browser-pane.pane")).toMatchObject({
      width: 44,
      height: 32,
      radius: 6,
      name: "url",
    });
    expect(stickerArtOf("desk.note")).toBeDefined();
  });

  it("paints each slot from the object's prop, else its fallback, on the art's root, drawn as an image", async () => {
    const fixture = JSON.parse(
      readFileSync(join(here, "../../contracts/fixtures/plugins-stickers.valid.json"), "utf8"),
    );
    connectStickerArt({ request: async () => fixture });
    await vi.waitFor(() => expect(stickerArtOf("vibefield.simulator.phone")).toBeDefined());
    const phone = stickerArtOf("vibefield.simulator.phone");
    if (phone === undefined) throw new Error("no phone art");
    expect(stickerFills(phone, { finish: "deep-blue" })).toEqual([["--finish", "#2b3c5c"]]);
    expect(stickerFills(phone, { finish: "unknown" })).toEqual([["--finish", "#e0692a"]]);
    const url = stickerArtUrl(phone, { finish: "deep-blue" });
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg).toMatch(/<svg[^>]*style="--finish:#2b3c5c"/);
    expect(stickerArtUrl(phone, { finish: "deep-blue" })).toBe(url);
  });
});

describe("the view", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  const face = (
    ref: string,
    state: PaneStickerFace["item"]["state"],
    extra: Partial<PaneStickerFace> = {},
  ): PaneStickerFace => ({
    item: { ref, docId: "doc-1", key: `key-${ref}`, state, since: 0 },
    url: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    w: 1,
    h: 0.73,
    r: 0.14,
    angle: -3.2,
    kind: "Browser",
    name: "localhost:5173",
    words: stateWords(state),
    ...extra,
  });

  const mount = (faces: PaneStickerFace[], more = 0, onShow = vi.fn()) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<PaneToolStickersView faces={faces} more={more} onShow={onShow} />));
    return onShow;
  };

  it("draws one button a sticker, its state on it, named for a screen reader", () => {
    mount([
      face("vf:obj/page0001", "acting"),
      face("vf:obj/note0001", "waiting", { kind: "Note", name: undefined }),
    ]);
    const buttons = [...(host?.querySelectorAll("button.vf-pane-sticker") ?? [])];
    expect(buttons.map((button) => button.getAttribute("data-state"))).toEqual([
      "acting",
      "waiting",
    ]);
    expect(buttons[0]?.getAttribute("aria-label")).toBe(
      "Browser “localhost:5173”, changing it. Show it on the desk",
    );
    expect(buttons[1]?.getAttribute("aria-label")).toBe(
      "Note, waiting for it. Show it on the desk",
    );
    expect(host?.querySelector("img.vf-pane-sticker__art")?.getAttribute("alt")).toBe("");
  });

  it("says its words when pointed at or focused, and goes to the desk on a click", () => {
    const onShow = mount([face("vf:obj/page0001", "acting")]);
    const button = host?.querySelector<HTMLButtonElement>("button.vf-pane-sticker");
    expect(host?.querySelector(".vf-pane-sticker-chip")).toBeNull();
    act(() => button?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    act(() => button?.focus());
    expect(host?.querySelector(".vf-pane-sticker-chip")?.textContent).toBe(
      "Browser·localhost:5173·changing it↗",
    );
    act(() => button?.click());
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ ref: "vf:obj/page0001" }));
  });

  it("counts what stands behind the first two", () => {
    mount([face("vf:obj/a0000001", "open"), face("vf:obj/b0000001", "open")], 3);
    expect(host?.querySelector(".vf-pane-sticker--more")?.textContent).toBe("+3");
  });

  it("wears its paper alone when no art was served", () => {
    mount([face("vf:obj/a0000001", "open", { url: undefined })]);
    expect(host?.querySelector(".vf-pane-sticker__paper")?.hasAttribute("data-blank")).toBe(true);
    expect(host?.querySelector("img")).toBeNull();
  });
});

describe("the door to the desk", () => {
  const deskWith = (
    docId = "doc-1",
  ): {
    desk: MountedDesk;
    panTo: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
  } => {
    const panTo = vi.fn();
    const setSelection = vi.fn();
    const entity = 7;
    const values = new Map<unknown, unknown>([
      [Position, { x: 100, y: 50 }],
      [Size, { w: 200, h: 100 }],
    ]);
    const resources = new Map<unknown, unknown>([
      [Viewport, { w: 1000, h: 600 }],
      [Camera, { x: 0, y: 0, zoom: 2 }],
    ]);
    const engine = {
      world: {
        isAlive: (e: number) => e === entity,
        get: (e: number, component: unknown) => (e === entity ? values.get(component) : undefined),
        getResource: (resource: unknown) => resources.get(resource),
      },
      docs: {
        current: () => ({
          store: { resolve: (key: string) => (key === "key-a" ? entity : undefined) },
        }),
      },
      ops: { panTo, setSelection },
    };
    return { desk: { engine, docId } as unknown as MountedDesk, panTo, setSelection };
  };

  it("asks for Canvas, then centres the object at the zoom you are at and selects it", async () => {
    const { desk, panTo, setSelection } = deskWith();
    let view = "godview";
    const requestView = vi.fn(async () => {
      view = "canvas";
    });
    const ok = await showOnDesk(
      { docId: "doc-1", key: "key-a" },
      { requestView, activeView: () => view as never, desk: () => desk, settle: async () => {} },
    );
    expect(ok).toBe(true);
    expect(requestView).toHaveBeenCalledWith("canvas");
    // its centre (200, 100) at the view's centre: 1000×600 at zoom 2 is 500×300 of the world
    expect(panTo).toHaveBeenCalledWith(200 - 250, 100 - 150);
    expect(setSelection).toHaveBeenCalledWith([7]);
  });

  it("does nothing for a board this window has not mounted, or an object that is gone", async () => {
    const { desk, panTo } = deskWith("doc-2");
    const deps = { activeView: () => "canvas" as never, desk: () => desk, settle: async () => {} };
    expect(await showOnDesk({ docId: "doc-1", key: "key-a" }, deps)).toBe(false);
    const mounted = deskWith();
    expect(
      await showOnDesk({ docId: "doc-1", key: "key-gone" }, { ...deps, desk: () => mounted.desk }),
    ).toBe(false);
    expect(lookAtObject(mounted.desk, 99 as never)).toBe(false);
    expect(panTo).not.toHaveBeenCalled();
  });
});

describe("its stylesheet", () => {
  const css = readFileSync(join(here, "../src/godview/pane-stickers/pane-stickers.css"), "utf8");
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);

  it("animates two loops alone, each argued into Godview by name", () => {
    expect(keyframes).toEqual(["vf-pane-sticker-sheen", "vf-pane-sticker-ring"]);
  });

  it("holds them still under reduced motion and with Godview's animations off", () => {
    const still = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(still).toMatch(
      /\.vf-pane-sticker\[data-state\] \.vf-pane-sticker__sheen,\s*\.vf-pane-sticker\[data-state\] \.vf-pane-sticker__ring \{\s*animation: none;/,
    );
    expect(css).not.toContain("!important");
    expect(css).toContain('.vf-godview[data-godview-animations="off"] .vf-pane-sticker__sheen,');
    expect(css).toContain('.vf-godview[data-godview-animations="off"] .vf-pane-sticker__ring {');
  });

  it("says no state in a colour: the pane's own colour is the ring's alone", () => {
    expect(css).not.toMatch(/--vf-(orange|red|green|ink-attention)/);
    expect(css).toContain("var(--ghostty-pane-color");
  });
});
