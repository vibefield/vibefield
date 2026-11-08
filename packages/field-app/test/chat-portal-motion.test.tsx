// @vitest-environment happy-dom

import { AGENT_CATALOG, type AgentProviderSummary, type SparkSummary } from "@vibefield/contracts";
import { type SparkHatchProps, startNight } from "@vibefield/design-kit/spark-face";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSparkSheet } from "../src/chat/NewSparkSheet";
import type { NewSparkPort } from "../src/chat/new-spark";
import { PORTAL_MS } from "../src/chat/portal";
import { FIXTURE_NATIVE } from "../src/design-system/profiles-fixtures";

// THE PORTAL'S PHASES FOLLOW ITS MOTION (track ES, ES-3d; DESIGN.md §6, the portal: the night takes the window back
// "once Cancel, Esc or the dim has opened it again"). ES-3c's proof (lanes/es/proof/es3c-0909Z-retry) showed the phases
// riding clocks while the motion rode frames. On a real GPU the night came back a frame before the fold had opened: a
// one-frame pop at the end of every Cancel. Here the hatch stands in and draws at once (happy-dom has no WebGL2), so
// the portal engages. With the page's Web Animations recorded and finished by hand, a phase moves on only when its
// motion has. With none (happy-dom has no `animate`), the phase's own time bounds it.

vi.mock("@vibefield/design-kit/spark-face", async (importOriginal) => {
  const kit = await importOriginal<typeof import("@vibefield/design-kit/spark-face")>();
  const React = await import("react");
  /** The hatch, standing in: a lent sky "draws" at once, and its clock reads the night's moment and a second on. */
  function DrawnHatch({ sky, className, ref }: SparkHatchProps) {
    React.useImperativeHandle(
      ref,
      () => ({
        fly: async () => undefined,
        now: () => (sky === undefined ? null : sky.t + 1),
        leave: () => undefined,
      }),
      [sky],
    );
    React.useEffect(() => {
      sky?.onDrawn?.();
    }, [sky]);
    return React.createElement("div", {
      className: className === undefined ? "vf-spark-hatch" : `vf-spark-hatch ${className}`,
      ...(sky === undefined ? {} : { "data-sky": "lent" }),
    });
  }
  return { ...kit, SparkHatch: DrawnHatch };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
        createdAt: "2026-11-08T09:20:00.000Z",
        updatedAt: "2026-11-08T09:20:00.000Z",
      }),
    ),
  } satisfies NewSparkPort;
}

/** One of the page's Web Animations, recorded: what it moves and how, and its finish, given by hand. */
interface Recorded {
  readonly frames: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  finish(): void;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** Where React's root stands: never the sheet's container, which its first commit would clear of the night. */
let mount: HTMLDivElement | null = null;
const nights: { close(): void }[] = [];
const recorded: Recorded[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  mount?.remove();
  mount = null;
  for (const night of nights.splice(0)) night.close();
  recorded.splice(0);
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

const settle = (ms = 0) => act(async () => new Promise((done) => setTimeout(done, ms)));
const layer = (): HTMLElement | null => document.querySelector<HTMLElement>(".vf-new-spark");

/** The page's Web Animations, recorded: each finishes only when the test says so. */
function recordAnimations(): void {
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value(frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
      let finish = (): void => undefined;
      const animation = { cancel: vi.fn(), commitStyles: vi.fn() } as unknown as Animation;
      const finished = new Promise<Animation>((done) => {
        finish = () => done(animation);
      });
      Object.assign(animation, { finished });
      recorded.push({ frames, options, finish: () => finish() });
      return animation;
    },
  });
}

/** Every recorded animation so far finishes, and what follows from it is drawn. */
async function finishRecorded(): Promise<void> {
  await act(async () => {
    for (const animation of recorded.splice(0)) animation.finish();
    await new Promise((done) => setTimeout(done, 0));
  });
}

/** A night standing in the sheet's own container, over a stand-in engine that notes each moment it is drawn at. */
function aNight(within: HTMLElement): { box: HTMLElement; drawnAt: number[] } {
  const box = document.createElement("div");
  box.className = "vf-spark-night";
  within.appendChild(box);
  const drawnAt: number[] = [];
  nights.push(startNight({ render: (t) => drawnAt.push(t), clear: () => undefined }, box, true));
  return { box, drawnAt };
}

async function sheet(open: boolean, port = portOf()): Promise<void> {
  if (host === null) throw new Error("no host");
  const at = host;
  if (mount === null) {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  }
  root ??= createRoot(mount);
  await act(async () =>
    root?.render(
      <NewSparkSheet open={open} port={port} onClose={() => undefined} container={at} />,
    ),
  );
  await settle();
}

describe('the portal\'s phases follow its motion (DESIGN.md §6, the portal: the night comes back "once … opened it again")', () => {
  it("closes, and hands the night back, only once its motion has finished, however long the clock says", async () => {
    recordAnimations();
    host = document.createElement("div");
    document.body.appendChild(host);
    const night = aNight(host);
    const port = portOf();
    await sheet(true, port);
    // the stand-in hatch draws at once: the night is given, and the edge closes
    expect(layer()?.dataset.portal).toBe("closing");
    expect(night.box.dataset.lent).toBe("true");
    // the close's own time passes three times over; its motion has not finished, so it is still closing
    await settle(PORTAL_MS.close + 60);
    expect(layer()?.dataset.portal).toBe("closing");
    await finishRecorded();
    expect(layer()?.dataset.portal).toBe("open");
    // Cancel: the fold
    await sheet(false, port);
    expect(layer()?.dataset.portal).toBe("folding");
    await settle(PORTAL_MS.back + 60);
    // the clock alone hands nothing back: the window has not opened again
    expect(night.box.dataset.lent).toBe("true");
    expect(layer()?.dataset.portal).toBe("folding");
    await finishRecorded();
    expect(night.box.dataset.lent).toBeUndefined();
    expect(layer()?.dataset.portal).toBe("folded");
  });

  it("where nothing animates, the phase's own time bounds it: the close at 600ms, the fold at 240ms", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const night = aNight(host);
    // the night has drawn before New spark is pressed, as Chat's has
    await settle(20);
    const port = portOf();
    await sheet(true, port);
    expect(layer()?.dataset.portal).toBe("closing");
    await settle(PORTAL_MS.close + 60);
    expect(layer()?.dataset.portal).toBe("open");
    await sheet(false, port);
    expect(layer()?.dataset.portal).toBe("folding");
    expect(night.box.dataset.lent).toBe("true");
    await settle(PORTAL_MS.back + 60);
    expect(night.box.dataset.lent).toBeUndefined();
    expect(layer()?.dataset.portal).toBe("folded");
    // handed back at the window's own moment, the stand-in hatch's clock (the night's moment and a second on): the
    // night's one jump of a whole second, where its own frames never step more than 0.05
    const jumps = night.drawnAt.filter(
      (t, at) => at > 0 && Math.abs(t - (night.drawnAt[at - 1] ?? t) - 1) < 1e-6,
    );
    expect(jumps).toHaveLength(1);
  });
});
