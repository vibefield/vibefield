// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AgentProviderSummary, type SparkSummary } from "@vibefield/contracts";
import { lendNight, startNight } from "@vibefield/design-kit/spark-face";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSparkSheet } from "../src/chat/NewSparkSheet";
import type { NewSparkPort } from "../src/chat/new-spark";
import { insetOf, movePortal, PORTAL_MS, type PortalPlaces } from "../src/chat/portal";
import { NewSparkNightPlate } from "../src/design-system/NewSparkPreview";
import { FIXTURE_NATIVE } from "../src/design-system/profiles-fixtures";

// THE PORTAL (track ES, ES-3b; ES-D3 A and ES-D5 A, ruled by James on the ES page, 2026-11-08 04:27:25Z; DESIGN.md §6
// "The night, at rest, under the pointer, and through the portal", the portal, and its ES-3b delta 467764481). Opened
// from Chat's empty night, the sheet's sky is the night's own canvas, lent: panel-sized at the panel's place, over the
// glass, drawn from the night's own moment, and its edge closes onto the sky's place. A window that cannot draw (no
// WebGL2, as here) hands the night back untouched, and the sheet rises as it always has. The choreography itself is
// the builder's read in a real WebGL2 browser (its stills kept in the lane); these rows hold its numbers and its rules.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), "utf8");
const THINKER = AGENT_CATALOG[0];

const PROVIDERS: AgentProviderSummary[] = [
  {
    id: THINKER.id,
    label: THINKER.label,
    available: true,
    resumable: true,
    personas: [],
    offers: { spawn: true, spark: true },
  },
];

function portOf() {
  return {
    providers: vi.fn(async () => PROVIDERS),
    profileSets: vi.fn(async () => [FIXTURE_NATIVE]),
    models: vi.fn(async () => {
      throw new Error("no picker here");
    }),
    hatch: vi.fn(
      async (params: Parameters<NewSparkPort["hatch"]>[0]): Promise<SparkSummary> => ({
        id: `sp-${params.name.toLowerCase()}`,
        name: params.name,
        face: { seed: params.face.seed },
        agent: params.agent,
        profiles: [...params.profiles],
        thinksUnder: params.thinksUnder,
        folder: `/fixture/sparks/${params.name.toLowerCase()}`,
        createdAt: "2026-11-08T08:00:00.000Z",
        updatedAt: "2026-11-08T08:00:00.000Z",
      }),
    ),
  } satisfies NewSparkPort;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const nights: { close(): void }[] = [];
const boxes: HTMLElement[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const night of nights.splice(0)) night.close();
  for (const box of boxes.splice(0)) box.remove();
});

const settle = (ms = 0) => act(async () => new Promise((done) => setTimeout(done, ms)));
const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

/** Where the sheet is drawn (the product's body, a plate in the catalog): the night it borrows stands inside it. */
function aHost(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

/** A night standing in Chat's panel, over a stand-in engine (the kit's core, `startNight`), inside the sheet's own
 * container (a sheet borrows only the night in its own: the catalog's plates each hold theirs). */
function aNight(within: HTMLElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "vf-spark-night";
  within.appendChild(box);
  boxes.push(box);
  nights.push(startNight({ render: () => undefined, clear: () => undefined }, box, true));
  return box;
}

async function open(): Promise<void> {
  const at = host ?? aHost();
  root = createRoot(at);
  await act(async () =>
    root?.render(<NewSparkSheet open port={portOf()} onClose={() => undefined} container={at} />),
  );
  await settle();
}

describe("the portal's window (DESIGN.md §6, the portal; \"The window is the night's own canvas, lent\")", () => {
  it("closes the night's edge from the panel's place onto the sky's place in the sheet, as clip insets of the panel", () => {
    const panel = { x: 8, y: 52, w: 1164, h: 640 };
    const sky = { x: 330, y: 146, w: 520, h: 300 };
    expect(insetOf(panel, panel, 22)).toBe("inset(0px 0px 0px 0px round 22px)");
    expect(insetOf(sky, panel, 30)).toBe("inset(94px 322px 246px 322px round 30px)");
  });

  it("moves by §6's numbers", () => {
    expect(PORTAL_MS).toEqual({
      close: 600,
      wordsLeave: 180,
      formAt: 270,
      form: 330,
      back: 240,
      faceLeave: 450,
      wordsBackAt: 300,
      wordsBack: 240,
      leave: 240,
      reducedOut: 150,
      reducedBack: 120,
      windowIn: 180,
      nightOut: 180,
    });
    const design = read("../../../DESIGN.md").replace(/\s+/gu, " ");
    for (const said of [
      "onto the sheet's sky (520 × 300, corners 30), 600ms on the island curve",
      "fade and recede to 0.98 in 180ms on the retract curve",
      "foot come in from 45% (330ms on the island curve, 270ms in)",
      "open it back in 240ms on the retract curve",
      "the engine's leave, 450ms",
      "the words returning 300ms in (240ms, island)",
      "down 16 at 0.97 in 240ms on the retract curve",
      "the night fades out in 150ms",
      "backwards at 120ms each",
      // ES-3c: the window comes in over the night as the words leave, and the night goes under it once it is whole
      "comes in over the night in 180ms on the retract curve as the words leave",
      "fade out under it in 180ms on the same curve",
    ])
      expect(design, said).toContain(said);
  });

  it("rises as before where no night stands to be lent", async () => {
    await open();
    expect($(".vf-new-spark")?.dataset.portal).toBeUndefined();
    expect($(".vf-new-spark-window")).toBeNull();
  });

  it("hands the night back untouched where the window cannot draw (no WebGL2), and rises as before", async () => {
    const box = aNight(aHost());
    await open();
    // the night never stepped aside: the window never drew
    expect(box.dataset.lent).toBeUndefined();
    for (let tries = 0; tries < 50 && $(".vf-new-spark-window") !== null; tries += 1)
      await settle(10);
    expect($(".vf-new-spark-window")).toBeNull();
    expect($(".vf-new-spark")?.dataset.portal).toBeUndefined();
    expect(box.dataset.lent).toBeUndefined();
    // and nothing still holds it: the night is the panel's, and can be lent again
    const lend = lendNight();
    expect(lend).not.toBeNull();
    lend?.cancel();
  });

  it("lets Chat's words and the hush leave while the night is lent, and come back 300ms into its return (the window's 240ms, then 60)", () => {
    const css = read("../src/chat/chat-empty.css");
    const back =
      css.match(/^\.vf-chat-empty-column,\s*\.vf-chat-empty-hush \{([^}]*)\}/mu)?.[1] ?? "";
    expect(back).toMatch(/opacity 240ms var\(--vf-ease-island\) 60ms/u);
    expect(back).toMatch(/transform 240ms var\(--vf-ease-island\) 60ms/u);
    const lent =
      css.match(
        /^\.vf-chat-empty:has\(\.vf-spark-night\[data-lent="true"\]\) \.vf-chat-empty-column,\s*\.vf-chat-empty:has\(\.vf-spark-night\[data-lent="true"\]\) \.vf-chat-empty-hush \{([^}]*)\}/mu,
      )?.[1] ?? "";
    expect(lent).toMatch(/opacity: 0;/u);
    expect(lent).toMatch(/transform: scale\(0\.98\);/u);
    expect(lent).toMatch(/opacity 180ms cubic-bezier\(0\.4, 0, 1, 1\)/u);
  });

  it("draws the window over the glass in the sheet's own layer, its sky slot clear, and its canvases the night's and the face's", () => {
    const css = read("../src/chat/new-spark-sheet.css");
    const window = css.match(/^\.vf-new-spark-window \{([^}]*)\}/mu)?.[1] ?? "";
    expect(window).toMatch(/position: absolute;/u);
    expect(window).toMatch(/pointer-events: none;/u);
    // over the glass: after the sheet in the layer, above it
    expect(window).toMatch(/z-index: 1;/u);
    // opened through the portal the sheet does not rise: its glass forms around the window where it stands
    expect(css).toMatch(
      /^\.vf-new-spark\[data-portal\] \.vf-new-spark-sheet \{[^}]*animation: none;/mu,
    );
    // its sky slot is clear, so the window over it is the sky
    const kit = read("../../design-kit/src/spark-face/spark-face.css");
    expect(kit).toMatch(/^\.vf-spark-hatch\[data-sky="lent"\] \{\s*background: transparent;/mu);
  });
});

describe("the catalog's night plate (docs/UI_SYSTEM.md: the plate mounts the shipping views)", () => {
  it("opens the shipping sheet from the shipping night's New spark", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewSparkNightPlate />));
    expect($(".vf-chat-empty")).not.toBeNull();
    expect($(".vf-new-spark")).toBeNull();
    await act(async () => $<HTMLButtonElement>(".vf-chat-empty-new")?.click());
    await settle();
    expect($(".vf-new-spark")).not.toBeNull();
  });
});

// THE HAND-OFF (track ES, ES-3c; DESIGN.md §6, the portal, "The night gives way only once the window has drawn, and is
// whole", corrected at its source 2026-11-08 by ES-3b's proof, lanes/es/proof/es3b-0852Z): nothing of the sheet shows
// before the window's first frame, its dim included; drawn, the window comes in over the night in 180ms on the retract
// curve as the words leave, so their fade shows through it; whole, it has Chat's night fade out under it in 180ms.

const RETRACT = "cubic-bezier(0.4, 0, 1, 1)";

/** Where the portal moves, as `NewSparkSheetView` measures it: the panel, the sky's place, the sheet, the night's edge
 * as it stood (leaning, the pointer on New spark). */
const PLACES: PortalPlaces = {
  panel: { x: 8, y: 52, w: 1164, h: 640 },
  sky: { x: 330, y: 146, w: 520, h: 300 },
  sheet: { x: 320, y: 136, w: 540, h: 520 },
  clip: "inset(6px round 16px)",
};

/** A part of the portal whose own animations are recorded (the page's Web Animations are a real browser's). */
function aPart(): HTMLElement & { animate: ReturnType<typeof vi.fn> } {
  const part = document.createElement("div");
  const animate = vi.fn(() => ({ cancel: vi.fn(), commitStyles: vi.fn() }) as unknown as Animation);
  Object.assign(part, { animate });
  return part as HTMLElement & { animate: ReturnType<typeof vi.fn> };
}

describe('the hand-off (DESIGN.md §6, the portal; "The night gives way only once the window has drawn, and is whole")', () => {
  it("shows nothing of the sheet until the window has drawn: its form is gone at once, and its dim waits for the close", () => {
    const css = read("../src/chat/new-spark-sheet.css");
    const form =
      css.match(
        /^\.vf-new-spark\[data-portal="drawing"\] \.vf-new-spark-sheet > :not\(\.vf-new-spark-sky\) \{([^}]*)\}/mu,
      )?.[1] ?? "";
    expect(form).toMatch(/opacity: 0;/u);
    // the sheet's first render knows no portal yet, so the form must leave without the close's delayed fade
    expect(form).toMatch(/transition: none;/u);
    const dim =
      css.match(
        /^\.vf-new-spark\[data-portal="drawing"\] \.vf-new-spark-scrim \{([^}]*)\}/mu,
      )?.[1] ?? "";
    expect(dim).toMatch(/opacity: 0;/u);
    expect(dim).toMatch(/animation: none;/u);
  });

  it("brings the window in over the night in 180ms on the retract curve as its edge closes from the night's own", () => {
    const parts = { window: aPart(), glass: aPart() };
    movePortal("closing", parts, PLACES, false);
    expect(parts.window.animate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: PORTAL_MS.windowIn, easing: RETRACT, fill: "both" }),
    );
    expect(parts.window.animate).toHaveBeenCalledWith(
      [{ clipPath: "inset(6px round 16px)", offset: 0 }],
      expect.objectContaining({ duration: PORTAL_MS.close }),
    );
    // where it comes to is its own style, the sky's place in the panel
    expect(parts.window.style.clipPath).toBe(insetOf(PLACES.sky, PLACES.panel, 30));
  });

  it("under reduced motion fades the window in after the night has faded out, and never twice", () => {
    const parts = { window: aPart(), glass: aPart() };
    movePortal("closing", parts, PLACES, true);
    const fades = parts.window.animate.mock.calls.filter(([frames]) =>
      JSON.stringify(frames).includes("opacity"),
    );
    expect(fades).toHaveLength(1);
    expect(fades[0]?.[1]).toEqual(
      expect.objectContaining({ duration: PORTAL_MS.reducedOut, delay: PORTAL_MS.reducedOut }),
    );
  });

  it("lets Chat's night go under the window once it is whole: out in 180ms on the retract curve, 180ms in", () => {
    const kit = read("../../design-kit/src/spark-face/spark-face.css");
    const lent = kit.match(/^\.vf-spark-night\[data-lent="true"\] \{([^}]*)\}/mu)?.[1] ?? "";
    expect(lent).toMatch(/visibility: hidden;/u);
    expect(lent).toMatch(/opacity: 0;/u);
    expect(lent).toMatch(/opacity 180ms cubic-bezier\(0\.4, 0, 1, 1\) 180ms/u);
    // hidden only once its fade is done
    expect(lent).toMatch(/visibility 0s linear 360ms/u);
  });
});
