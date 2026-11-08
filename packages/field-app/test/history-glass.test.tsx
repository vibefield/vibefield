// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import type { CatalogPort, HistoryRoomHandle, RoomPorts } from "@vibefield/rosetta-room";
import { act, createElement, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { historyFixturePorts } from "../src/design-system/history-fixtures";
import { HistoryRoomView } from "../src/history/HistoryRoomView";

// HG-2 (track HG; HG-D1…HG-D6 ruled by James 2026-11-08; DESIGN.md §8 "History" — before its past, the room behind
// glass; §5 History's sample; §6 History's motions): while the index waits for consent, the view stands the room
// itself behind the History pane — the package's demo through the shipping by-project adapter, frosted, inert and
// hidden, keeping nothing and asking fieldd nothing — and the pane in the Setup Assistant's glass, centred in the
// room's box. The room's own consent slot holds only a marker: the room unmounts its slot the moment it stops
// waiting, so the view draws the sample and the card in its own layer, and both leave in their own time.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), "utf8");

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function mount(view: ReactElement): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(view));
}

async function rerender(view: ReactElement): Promise<void> {
  await act(async () => root?.render(view));
}

async function until<T>(read: () => T | null | undefined, label: string, ms = 8_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The demo's room behind an index that waits for consent until `grant()`: the catalog's consent state (an empty
 * topology, the ingest phase that says why), then the demo's own status. */
function consentPorts(): { ports: RoomPorts; grant: () => void } {
  const waiting = historyFixturePorts("consent");
  const ready = historyFixturePorts("room");
  let granted = false;
  const catalog: CatalogPort = {
    ...waiting.catalog,
    status: () => (granted ? ready.catalog.status() : waiting.catalog.status()),
  };
  return {
    ports: { ...waiting, catalog },
    grant: () => {
      granted = true;
    },
  };
}

/** What the controller hands the view as its consent: any node; the card's own rows are history-consent's. */
const CARD = createElement("div", { className: "hg-card-probe" }, "the card");

const view = (ports: RoomPorts, extra: Record<string, unknown> = {}): ReactElement =>
  createElement(HistoryRoomView, { ports, storage: null, keys: "mac", consent: CARD, ...extra });

const glass = (): Element | null => host?.querySelector(".vf-history > .vf-history-glass") ?? null;
const sample = (): Element | null => glass()?.querySelector(".vf-history-sample") ?? null;
const nameOf = (row: Element): string | null | undefined =>
  row.querySelector(".ah-project-list-item__header strong")?.textContent;

/** The sample, once its room has drawn the demo's projects and opened at its chosen session. */
async function sampleDrawn(): Promise<Element> {
  await until(
    () => ((sample()?.querySelectorAll(".ah-project-list-item").length ?? 0) >= 8 ? true : null),
    "the sample's projects",
  );
  await until(
    () => sample()?.querySelector('.ah-session-list-item[aria-current="true"]'),
    "the sample's chosen session",
  );
  const found = sample();
  if (found === null) throw new Error("no sample");
  return found;
}

describe("History before its past — the room behind glass (HG-2; HG-D1, HG-D2)", () => {
  it("stands the sample and the card in the view's own layer while the index waits, the room's slot holding only a marker", async () => {
    const { ports } = consentPorts();
    await mount(view(ports));
    const layer = await until(glass, "the view's layer over the room");
    expect(layer.querySelector(".vf-history-sample")).not.toBeNull();
    // the card the controller handed the view stands in the layer's card frame, centred in the room's box
    expect(layer.querySelector(".vf-history-glass-card .hg-card-probe")?.textContent).toBe(
      "the card",
    );
    // the room's own consent slot: a marker, never the card
    const room = await until(
      () => host?.querySelector(".vf-history > .vf-history-room .ah-frame"),
      "the room's frame",
    );
    await until(
      () => room.querySelector(".vf-history-consent-marker"),
      "the room's consent marker",
    );
    expect(room.querySelector(".hg-card-probe")).toBeNull();
    expect(host?.querySelectorAll(".hg-card-probe")).toHaveLength(1);
  }, 20_000);

  it("is the room itself, inert and hidden from assistive tech, opened at the demo's chosen session", async () => {
    const { ports } = consentPorts();
    await mount(view(ports));
    await until(glass, "the layer");
    const found = await sampleDrawn();
    expect(found.hasAttribute("inert")).toBe(true);
    expect(found.getAttribute("aria-hidden")).toBe("true");
    // rosetta's frame on the host surface, its projects VibeField's own names (the shipping by-project adapter)
    expect(found.querySelector('.ah-frame[data-ah-surface="host"]')).not.toBeNull();
    const names = [...found.querySelectorAll(".ah-project-list-item")].map(nameOf);
    expect(names).toEqual(expect.arrayContaining(["vibe-field", "rosetta", "puppeteer"]));
    // the projects plate's host inputs, by the shipping builder: Live now heads ①
    expect(found.querySelector('.ah-section[data-section="live"]')?.textContent).toBe("Live now");
  }, 30_000);

  it("keeps no preferences and asks fieldd nothing", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const calls: string[] = [];
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: async (method: string) => {
        calls.push(`subscribe ${method}`);
        throw new Error("no subscriptions here");
      },
      request: async (method: string) => {
        calls.push(method);
        return {};
      },
    } as unknown as FielddClient;
    const { ports } = consentPorts();
    // the room behind keeps nothing either (storage null), so a write under the room's prefix is the sample's
    await mount(createElement(FielddProvider, { client }, view(ports)));
    await until(glass, "the layer");
    await sampleDrawn();
    await wait(200);
    expect(calls).toEqual([]);
    expect(setItem.mock.calls.filter(([key]) => String(key).startsWith("vf.history."))).toEqual([]);
  }, 30_000);

  it("draws no layer while the index reads, and none for a host that hands no consent", async () => {
    await mount(view(historyFixturePorts("room")));
    await until(
      () =>
        (host?.querySelectorAll(".vf-history > .vf-history-room .ah-project-list-item").length ??
          0) > 0
          ? true
          : null,
      "the room's own projects",
    );
    expect(glass()).toBeNull();
    expect(host?.querySelector(".vf-history-sample")).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    // the catalog's consent plate without a card: the room's own words, no sample
    await mount(
      createElement(HistoryRoomView, {
        ports: historyFixturePorts("consent"),
        storage: null,
        keys: "mac",
      }),
    );
    await until(() => host?.querySelector('[data-face="consent"]'), "the room's own consent words");
    expect(glass()).toBeNull();
  }, 30_000);

  it("requests no animation frames at rest", async () => {
    const { ports } = consentPorts();
    await mount(view(ports));
    await until(glass, "the layer");
    await sampleDrawn();
    await wait(800);
    const frames = vi.spyOn(window, "requestAnimationFrame");
    await wait(600);
    expect(frames).not.toHaveBeenCalled();
  }, 30_000);
});

describe("History's motions before its past (HG-2; HG-D5, HG-D6; DESIGN.md §6)", () => {
  it("develops once each time History shows, never on a render of its own", async () => {
    const { ports } = consentPorts();
    await mount(view(ports, { shown: true }));
    const layer = await until(glass, "the layer");
    expect(layer.getAttribute("data-showing")).toBe("a");
    await rerender(view(ports, { shown: true }));
    expect(glass()?.getAttribute("data-showing")).toBe("a");
    // ⌘3 out: nothing replays while History is hidden
    await rerender(view(ports, { shown: false }));
    expect(glass()?.getAttribute("data-showing")).toBe("a");
    // and back: it develops again, by the other of its two names, so the animation restarts
    await rerender(view(ports, { shown: true }));
    expect(glass()?.getAttribute("data-showing")).toBe("b");
    await rerender(view(ports, { shown: false }));
    await rerender(view(ports, { shown: true }));
    expect(glass()?.getAttribute("data-showing")).toBe("a");
  }, 20_000);

  it("waits for History to show before it develops, when the room is drawn hidden", async () => {
    const { ports } = consentPorts();
    await mount(view(ports, { shown: false }));
    const layer = await until(glass, "the layer");
    expect(layer.hasAttribute("data-showing")).toBe(false);
    await rerender(view(ports, { shown: true }));
    expect(glass()?.getAttribute("data-showing")).toBe("a");
  }, 20_000);

  it("leaves at once when the room stops waiting: the card and the sample go in their own time, the card's words whole", async () => {
    const { ports, grant } = consentPorts();
    const room = createRef<HistoryRoomHandle>();
    await mount(view(ports, { roomRef: room }));
    await until(glass, "the layer");
    grant();
    await act(async () => room.current?.refreshStatus());
    const leaving = await until(
      () => host?.querySelector('.vf-history-glass[data-phase="leave"]'),
      "the leave",
      4_000,
    );
    const left = Date.now();
    // the card leaves with its words, never cut away mid-fade
    expect(leaving.querySelector(".hg-card-probe")).not.toBeNull();
    expect(leaving.querySelector(".vf-history-sample")).not.toBeNull();
    await until(() => (glass() === null ? true : null), "the layer gone", 4_000);
    // the sample's 480ms fade is the leave's length
    expect(Date.now() - left).toBeGreaterThanOrEqual(400);
  }, 20_000);

  it("leaves in one 120ms fade under reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const { ports, grant } = consentPorts();
    const room = createRef<HistoryRoomHandle>();
    await mount(view(ports, { roomRef: room }));
    await until(glass, "the layer");
    grant();
    await act(async () => room.current?.refreshStatus());
    await until(
      () => host?.querySelector('.vf-history-glass[data-phase="leave"]'),
      "the leave",
      4_000,
    );
    const left = Date.now();
    await until(() => (glass() === null ? true : null), "the layer gone", 4_000);
    expect(Date.now() - left).toBeLessThan(400);
  }, 20_000);
});

/** One rule's body in a sheet, by its exact selector at the start of a line. */
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
};

describe("the glass's sheets (HG-2; DESIGN.md §5 History's sample, §6, §8; vitest loads no CSS)", () => {
  // read as the file is collected, and a sheet not written yet reads as empty, so each rule fails on its own
  const sheet = (path: string): string => {
    try {
      return read(path);
    } catch {
      return "";
    }
  };
  const layer = sheet("../src/history/history-glass.css");
  const card = sheet("../src/history/history-consent-slot.css");

  it("frosts the sample with ONE filter on its own layer — never a backdrop filter — and lets no pointer reach it", () => {
    const body = rule(layer, ".vf-history-sample");
    expect(body).toContain(
      "filter: blur(var(--vf-history-sample-blur)) saturate(var(--vf-history-sample-saturate));",
    );
    expect(body).toContain("opacity: var(--vf-history-sample-opacity);");
    expect(body).toContain("pointer-events: none;");
    expect(layer).not.toContain("backdrop-filter");
    // every motion inside the sample is stopped: it waits on nothing (§6 keeps loops for a wait on a fact)
    expect(layer).toMatch(
      /\.vf-history-sample \*,\n\.vf-history-sample \*::before,\n\.vf-history-sample \*::after \{[^}]*animation: none !important;[^}]*transition: none !important;/u,
    );
  });

  it("centres the card in the room's box, under the head band and above the reserve", () => {
    const frame = rule(layer, ".vf-history-glass-card");
    expect(frame).toContain("inset: var(--vf-history-head) 0 var(--vf-history-reserve) 0;");
    expect(frame).toContain("place-items: center;");
    expect(frame).toContain("pointer-events: none;");
    expect(rule(layer, ".vf-history-glass-card > *")).toContain("pointer-events: auto;");
  });

  it("develops from a 24px blur at nothing over 640ms on the island curve, the card 160ms behind it", () => {
    for (const name of ["a", "b"] as const) {
      expect(rule(layer, `.vf-history-glass[data-showing="${name}"] .vf-history-sample`)).toContain(
        `animation: vf-history-develop-${name} 640ms var(--vf-ease-island) both;`,
      );
      expect(layer).toContain(
        `@keyframes vf-history-develop-${name} {\n  from {\n    opacity: 0;\n    filter: blur(24px) saturate(var(--vf-history-sample-saturate));\n  }\n}`,
      );
      expect(
        rule(layer, `.vf-history-glass[data-showing="${name}"] .vf-history-glass-card > *`),
      ).toContain(`animation: vf-history-form-${name} 560ms var(--vf-ease-island) 160ms both;`);
      expect(layer).toContain(
        `@keyframes vf-history-form-${name} {\n  from {\n    opacity: 0;\n    transform: scale(0.985);\n  }\n}`,
      );
    }
  });

  it("leaves with the card in 240ms on the retract curve and the sample over 480ms, each one 120ms fade reduced", () => {
    expect(
      rule(layer, '.vf-history-glass[data-phase="leave"] .vf-history-glass-card > *'),
    ).toContain("animation: vf-history-card-out 240ms cubic-bezier(0.4, 0, 1, 1) both;");
    expect(layer).toContain(
      "@keyframes vf-history-card-out {\n  to {\n    opacity: 0;\n    transform: scale(0.985);\n  }\n}",
    );
    expect(rule(layer, '.vf-history-glass[data-phase="leave"] .vf-history-sample')).toContain(
      "animation: vf-history-sample-out 480ms ease both;",
    );
    // reduced motion: one 120ms `ease` fade each, no blur or scale — over the room's own floor (M6), which would
    // cut every motion in the view to nothing
    const reduced = layer.slice(layer.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of ["a", "b"] as const) {
      expect(reduced).toContain(`animation: vf-history-fade-${name} 120ms ease both !important;`);
      expect(layer).toContain(
        `@keyframes vf-history-fade-${name} {\n  from {\n    opacity: 0;\n  }\n}`,
      );
    }
    expect(reduced).toContain("animation: vf-history-fade-out 120ms ease both !important;");
    expect(layer).toContain("@keyframes vf-history-fade-out {\n  to {\n    opacity: 0;\n  }\n}");
  });

  it("frames the pane in the Setup Assistant's glass, 496 wide, padded 32 32 26", () => {
    const glassCard = rule(card, ".vf-history-consent");
    expect(glassCard).toContain("width: min(100%, 496px);");
    expect(glassCard).toContain("padding: 32px 32px 26px;");
    expect(glassCard).toContain("border-radius: var(--vf-radius-island);");
    expect(glassCard).toContain("background: var(--vf-wizard-surface);");
    expect(glassCard).toContain(
      "backdrop-filter: blur(var(--vf-wizard-blur)) saturate(var(--vf-wizard-saturate));",
    );
    expect(glassCard).toContain(
      "box-shadow:\n    var(--vf-shadow-island),\n    inset 0 0 0 1px var(--vf-wizard-edge),\n    inset 0 1px 0 var(--vf-wizard-edge-light);",
    );
    // the sample line under the act: 12px in t3
    const line = rule(card, ".vf-history-consent-sample");
    expect(line).toContain("font-size: 12px;");
    expect(line).toContain("color: var(--vf-text-tertiary);");
  });
});

describe("History's sample in tokens.css (HG-2; DESIGN.md §5, projected)", () => {
  const tokens = read("../../design-kit/src/tokens.css");
  const value = (theme: ":root" | ".dark", name: string): string | undefined => {
    const start = tokens.indexOf(`\n${theme} {`);
    const block = tokens.slice(start, tokens.indexOf("\n}", start));
    return new RegExp(`\\s${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  };

  it("names the frost once and its opacity by theme: 7px, 0.9, 62% by day and 56% by night", () => {
    expect(value(":root", "--vf-history-sample-blur")).toBe("7px");
    expect(value(":root", "--vf-history-sample-saturate")).toBe("0.9");
    expect(value(":root", "--vf-history-sample-opacity")).toBe("62%");
    expect(value(".dark", "--vf-history-sample-opacity")).toBe("56%");
    // one value in both themes: the night block names no blur or saturation of its own
    expect(value(".dark", "--vf-history-sample-blur")).toBeUndefined();
    expect(value(".dark", "--vf-history-sample-saturate")).toBeUndefined();
  });
});
