// @vitest-environment happy-dom
/**
 * BootRoot's click-safety contract (field report 2026-07-22: "all the ui at
 * the top edge are not clickable"): the settle transform must be TEMPORARY.
 * A persistent transform creates a stacking context that flattens the app
 * below the z-40 .app-drag strip, so the pill's no-drag hole stops punching
 * through and the top 52px goes dead. After the settle the wrapper must carry
 * no inline transform, and the splash must be unmounted. createElement (not
 * JSX) keeps this a `.ts` file, panels.test's pattern.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootRoot } from "../src/boot/BootRoot";
import type { BootMachine, BootReady, BootView } from "../src/boot/machine";
import { DAYLIGHT, TEAR } from "../src/boot/splash/field-door";
import { leaveFor, resetSwitchForTests, type SwitchPersona } from "../src/boot/switch";
import { resetAppThemeForTest, setAppTheme } from "../src/theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** FG-2's rows hand the field a live door of their own; every other row keeps the real one, which
 * happy-dom (no WebGPU) opens as the still. */
const field = vi.hoisted(() => ({
  door: null as null | {
    readonly mode: "worker";
    mark(to: number, ms: number): void;
    reveal(options?: object): Promise<boolean>;
    glass(glass: object | null): void;
    destroy(): void;
  },
}));

vi.mock("../src/boot/splash/field-door", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/boot/splash/field-door")>();
  return {
    ...real,
    fieldPlan: (env?: Parameters<typeof real.fieldPlan>[0]) =>
      field.door === null ? real.fieldPlan(env) : { gpu: {} as GPU, mainThread: false },
    openFieldDoor: async (...args: Parameters<typeof real.openFieldDoor>) =>
      field.door ?? real.openFieldDoor(...args),
  };
});

function fakeMachine() {
  let view: BootView = {
    phase: "requesting-bootstrap",
    unavailable: null,
    stage: "waking the daemon",
    progress: null,
    degradedReveal: false,
  };
  const listeners = new Set<() => void>();
  const ready = {
    client: {},
    manager: {},
    mod: {
      FielddProvider: ({ children }: { children?: unknown }) => children,
      FieldView: () => null,
      DocManager: class {},
    },
  } as unknown as BootReady;
  const revealDesk = vi.fn<() => void>();
  const machine: BootMachine = {
    view: () => view,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get ready() {
      return ready;
    },
    get client() {
      return null;
    },
    // UA-3w: this suite is about the reveal, so the wizard never opens here.
    // The layer swap it drives has its own coverage in onboarding-wizard.test.
    get onboarding() {
      return null;
    },
    start: () => {},
    retry: () => {},
    closePlugins: async () => undefined,
    completeOnboarding: () => {},
    revealDesk,
  };
  const set = (patch: Partial<BootView>): void => {
    view = { ...view, ...patch };
    for (const fn of [...listeners]) fn();
  };
  return { machine, set, revealDesk };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSwitchForTests();
  resetAppThemeForTest();
  sessionStorage.clear();
  document.body.innerHTML = "";
  field.door = null;
});

function workspaceWrapper(): HTMLElement | null {
  return (host as HTMLElement).querySelector("div.absolute.inset-0:not(.vf-splash)");
}

describe("BootRoot reveal (the top-edge click contract)", () => {
  it("keeps Design System controls out of the synchronous product face", () => {
    const { machine } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    const toggle = document.querySelector<HTMLButtonElement>("[data-dev-tweak-toggle]");
    expect(toggle).toBeNull();
    expect(document.querySelector("[data-visual-tweak-controls]")).toBeNull();
    expect(host.querySelector(".vf-splash")).not.toBeNull();
  });

  it("carries the settle transform only until settled, then goes inert", () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    act(() => set({ phase: "warming" }));
    expect(workspaceWrapper()?.style.transform).toBe("scale(0.99)"); // composing under the splash

    act(() => set({ phase: "interactive" }));
    expect(workspaceWrapper()?.style.transform).toBe("scale(1)"); // the settle plays

    act(() => {
      vi.advanceTimersByTime(700); // past the 600ms settle hold
    });
    // inert: no inline transform → no stacking context → the app stacks at
    // body level again and no-drag holes beat the z-40 drag strip
    expect(workspaceWrapper()?.style.transform).toBe("");
    expect(workspaceWrapper()?.getAttribute("style") ?? "").toBe("");
  });

  it("unmounts the splash after the reveal fade", () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    expect(host.querySelector(".vf-splash")).not.toBeNull();
    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(500); // past the 400ms fade hold
    });
    expect(host.querySelector(".vf-splash")).toBeNull(); // nothing left to eat clicks
  });
});

// ---- the hand-over (FG-2; DESIGN.md §6, §8 "The reveal") -------------------

/** A live door whose reveal the row settles by hand. */
function liveDoor(reveal: () => Promise<boolean>) {
  const door = {
    mode: "worker" as const,
    mark: vi.fn<(to: number, ms: number) => void>(),
    reveal: vi.fn<(options?: object) => Promise<boolean>>(reveal),
    glass: vi.fn<(glass: object | null) => void>(),
    destroy: vi.fn<() => void>(),
  };
  field.door = door;
  return door;
}

/** BootRoot over the fake machine, its field's door opened, the desk mounted under the splash. */
async function mountWarm(machine: BootMachine, set: (patch: Partial<BootView>) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(createElement(BootRoot, { machine })));
  await act(async () => {}); // the field's door opens
  act(() => set({ phase: "stabilizing", stage: "settling", progress: 1 }));
}

const groundStyle = (): string => workspaceWrapper()?.getAttribute("style") ?? "";

/** Lets the tear's promises settle: the door's reveal, its bound, the hand-over. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("BootRoot hands a returning boot's desk over (FG-2)", () => {
  it("keeps the base reveal when the field can't tear: handed over at once, the splash's fade at `interactive`", async () => {
    vi.useFakeTimers();
    const { machine, set, revealDesk } = fakeMachine();
    await mountWarm(machine, set); // happy-dom: no WebGPU, so the field is its still
    expect(host?.querySelector(".vf-field")?.getAttribute("data-field")).toBe("still");

    act(() => set({ phase: "handing-over", stage: "" }));
    expect(revealDesk).toHaveBeenCalledTimes(1);
    expect(host?.querySelector(".vf-splash")?.getAttribute("data-opening")).toBe("fade");
    expect(groundStyle()).not.toContain("brightness");

    act(() => set({ phase: "interactive" }));
    expect(workspaceWrapper()?.style.transform).toBe("scale(1)"); // the base settle
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(host?.querySelector(".vf-splash")).toBeNull();
    expect(revealDesk).toHaveBeenCalledTimes(1); // decided once
  });

  it("tears a live field: the words go, then the field opens in the day's light as the desk settles in, and only then is the desk handed over", async () => {
    vi.useFakeTimers();
    let open: (opened: boolean) => void = () => {};
    const door = liveDoor(
      () =>
        new Promise((resolve) => {
          open = resolve;
        }),
    );
    const { machine, set, revealDesk } = fakeMachine();
    await mountWarm(machine, set);
    expect(host?.querySelector(".vf-field")?.getAttribute("data-field")).toBe("live");

    act(() => set({ phase: "handing-over", stage: "" }));
    // The words' beat (240ms): they go, the ground's own colour with them, and the desk waits
    // under the field, small and bright.
    expect(host?.querySelector(".vf-splash")?.getAttribute("data-opening")).toBe("tear");
    expect(workspaceWrapper()?.style.transform).toBe("scale(0.985)");
    expect(workspaceWrapper()?.style.filter).toBe("brightness(1.16)");
    expect(door.reveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(door.reveal).toHaveBeenCalledTimes(1);
    expect(door.reveal).toHaveBeenCalledWith({ ...TEAR, ink: DAYLIGHT });
    // The desk settles in from .985 (1.9s island) as its exposure comes down (1.5s ease-out).
    expect(workspaceWrapper()?.style.transform).toBe("scale(1)");
    expect(workspaceWrapper()?.style.filter).toBe("brightness(1)");
    expect(workspaceWrapper()?.style.transition).toContain("1900ms");
    expect(workspaceWrapper()?.style.transition).toContain("1500ms");
    expect(revealDesk).not.toHaveBeenCalled(); // `interactive` means revealed

    open(true);
    await settle();
    expect(door.destroy).toHaveBeenCalledTimes(1); // open: the field stops drawing at once
    expect(revealDesk).toHaveBeenCalledTimes(1);

    // Then the click contract as ever: settled, the wrapper carries nothing, and the ground is gone.
    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(groundStyle()).toBe("");
    expect(host?.querySelector(".vf-splash")).toBeNull();
    expect(door.destroy).toHaveBeenCalledTimes(1);
  });

  it("tears in the look's own light by night", async () => {
    vi.useFakeTimers();
    setAppTheme("dark");
    const door = liveDoor(async () => true);
    const { machine, set } = fakeMachine();
    await mountWarm(machine, set);
    act(() => set({ phase: "handing-over", stage: "" }));
    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(door.reveal).toHaveBeenCalledWith({ ...TEAR }); // no ink: the splash keeps its own
  });

  it("bounds the tear: a field that never opens still hands the desk over, 1.9s and a second on, and leaves with the ground's fade", async () => {
    vi.useFakeTimers();
    const door = liveDoor(() => new Promise(() => {}));
    const { machine, set, revealDesk } = fakeMachine();
    await mountWarm(machine, set);
    act(() => set({ phase: "handing-over", stage: "" }));
    act(() => {
      vi.advanceTimersByTime(240 + 2_899);
    });
    await settle();
    expect(revealDesk).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await settle();
    expect(revealDesk).toHaveBeenCalledTimes(1);
    expect(door.destroy).not.toHaveBeenCalled(); // not open: it stays for the fade

    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(500); // past the 400ms fade hold
    });
    expect(host?.querySelector(".vf-splash")).toBeNull();
    expect(door.destroy).toHaveBeenCalledTimes(1);
  });

  it("hands the desk over at once when the tear fails (a lost device), the field left for the fade", async () => {
    vi.useFakeTimers();
    const door = liveDoor(() => Promise.reject(new Error("device lost")));
    const { machine, set, revealDesk } = fakeMachine();
    await mountWarm(machine, set);
    act(() => set({ phase: "handing-over", stage: "" }));
    act(() => {
      vi.advanceTimersByTime(240);
    });
    await settle();
    expect(door.reveal).toHaveBeenCalledTimes(1);
    expect(revealDesk).toHaveBeenCalledTimes(1); // never the bound's 2.9 s
    expect(door.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ["a hidden window", () => vi.spyOn(document, "hidden", "get").mockReturnValue(true)],
    [
      "Reduce Motion",
      () =>
        vi.spyOn(window, "matchMedia").mockImplementation(
          (query: string) =>
            ({
              matches: query === "(prefers-reduced-motion: reduce)",
              media: query,
              addEventListener: () => {},
              removeEventListener: () => {},
            }) as unknown as MediaQueryList,
        ),
    ],
  ])("never tears in %s: the base reveal, handed over at once", async (_, arrange) => {
    vi.useFakeTimers();
    const door = liveDoor(async () => true);
    const { machine, set, revealDesk } = fakeMachine();
    await mountWarm(machine, set);
    arrange();
    act(() => set({ phase: "handing-over", stage: "" }));
    expect(revealDesk).toHaveBeenCalledTimes(1);
    expect(host?.querySelector(".vf-splash")?.getAttribute("data-opening")).toBe("fade");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(door.reveal).not.toHaveBeenCalled();
  });
});

// ---- the switch (DESIGN.md §8 "The switch") --------------------------------

const HANDOFF = "vf:switch-arrival";
const WORK: SwitchPersona = {
  userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7",
  name: "James (work)",
  face: { emoji: "🐙", frame: "coin" },
};

function mountBoot(machine: BootMachine): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(createElement(BootRoot, { machine })));
  return host;
}

/** A Me menu row: a control holding a face, in the document. */
function rowWithFace(): HTMLButtonElement {
  const button = document.createElement("button");
  const face = document.createElement("span");
  face.className = "vf-face";
  button.appendChild(face);
  document.body.appendChild(button);
  return button;
}

function scene(): HTMLElement | null {
  return (host as HTMLElement).querySelector<HTMLElement>(".vf-switch");
}

/** The scene's frame as markup. Dropped: the face's inline style, which
 * carries only where a LEAVING face came from (no held frame draws it), and
 * React's per-root id suffix on the coin's legend path (a name, not a mark). */
function frameOf(element: HTMLElement | null): string {
  const clone = element?.cloneNode(true) as HTMLElement | undefined;
  clone?.querySelector(".vf-switch-face")?.removeAttribute("style");
  return (clone?.outerHTML ?? "").replace(/vf-face-legend-[A-Za-z0-9_-]+/g, "vf-face-legend-ID");
}

describe("BootRoot and the switch (DESIGN.md §8)", () => {
  it("opens an arriving window on the held frame, and sends the face home at the reveal", () => {
    vi.useFakeTimers();
    sessionStorage.setItem(HANDOFF, JSON.stringify({ v: 1, at: Date.now(), persona: WORK }));
    const { machine, set } = fakeMachine();
    mountBoot(machine);

    // The first render IS the held frame: the face, its name, the real stages.
    expect(scene()?.getAttribute("data-step")).toBe("held");
    expect(scene()?.querySelector(".vf-switch-name")?.textContent).toBe("James (work)");
    expect(scene()?.textContent).toContain("Switching to");
    expect(scene()?.textContent).toContain("waking the daemon");
    // The plain splash stands down while the switch's scene is this boot's splash,
    expect(host?.querySelector(".vf-splash")).toBeNull();
    expect(host?.textContent).not.toContain("VibeField");
    // and the corner hides its own face until the traveller lands on it.
    expect(document.documentElement.hasAttribute("data-vf-switch-landing")).toBe(true);

    act(() => set({ phase: "warming", stage: "opening doc", progress: 0.5 }));
    expect(scene()?.textContent).toContain("opening doc");
    expect(scene()?.getAttribute("data-step")).toBe("held");

    act(() => set({ phase: "interactive", stage: "" }));
    expect(scene()?.getAttribute("data-step")).toBe("reveal");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(scene()).toBeNull();
    // Nothing is left over the field: no plain splash comes back after it.
    expect(host?.textContent).not.toContain("VibeField");
    expect(host?.querySelector(".vf-splash")).toBeNull();
    expect(document.documentElement.hasAttribute("data-vf-switch-landing")).toBe(false);
  });

  it("leaves under the scene: the stage recedes and goes inert, and main is asked once it has converged", async () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    mountBoot(machine);
    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(700); // settled: the wrapper is inert chrome again
    });
    expect(workspaceWrapper()?.getAttribute("style") ?? "").toBe("");

    const row = rowWithFace();
    const main = vi.fn(async () => undefined);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = leaveFor(WORK, row, main);
    });
    expect(scene()?.getAttribute("data-step")).toBe("to");
    expect(workspaceWrapper()?.hasAttribute("inert")).toBe(true);
    expect(workspaceWrapper()?.style.transform).toBe("scale(0.98)");
    // The row's face went with the traveller (M1).
    expect(row.querySelector(".vf-face")?.hasAttribute("data-vf-switch-origin")).toBe(true);
    expect(main).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await done;
    });
    expect(scene()?.getAttribute("data-step")).toBe("held");
    expect(main).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(HANDOFF) ?? "null")?.persona).toEqual(WORK);
  });

  it("plays a refused switch backwards and hands the field back", async () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    mountBoot(machine);
    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(700);
    });

    const row = rowWithFace();
    const refusal = new Error("a user switch is already in flight");
    let refused: Promise<void> = Promise.resolve();
    act(() => {
      // Heard at once, as the callers hear it: the refusal is theirs to say.
      refused = expect(
        leaveFor(WORK, row, async () => {
          throw refusal;
        }),
      ).rejects.toBe(refusal);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await refused;
    });
    expect(scene()?.getAttribute("data-step")).toBe("return");
    // The field is reachable again, and comes forward while the scene falls.
    expect(workspaceWrapper()?.hasAttribute("inert")).toBe(false);
    expect(workspaceWrapper()?.style.transform).toBe("scale(1)");
    expect(sessionStorage.getItem(HANDOFF)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(scene()).toBeNull();
    expect(workspaceWrapper()?.getAttribute("style") ?? "").toBe("");
    expect(row.querySelector(".vf-face")?.hasAttribute("data-vf-switch-origin")).toBe(false);
  });

  it("converges on exactly the frame the arriving window paints first (the seam)", async () => {
    vi.useFakeTimers();
    // The window being left: converge, and main is reloading it (never answers).
    const leaving = fakeMachine();
    mountBoot(leaving.machine);
    act(() => leaving.set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => {
      void leaveFor(WORK, rowWithFace(), () => new Promise(() => undefined));
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(scene()?.getAttribute("data-step")).toBe("held");
    const leavingFrame = frameOf(scene());

    // The reload: a fresh page with only what the leaving one handed across.
    act(() => root?.unmount());
    host?.remove();
    resetSwitchForTests();
    expect(sessionStorage.getItem(HANDOFF)).not.toBeNull();
    mountBoot(fakeMachine().machine);
    const arrivingFrame = frameOf(scene());

    expect(arrivingFrame).toContain("James (work)");
    expect(arrivingFrame).toBe(leavingFrame);
  });
});
