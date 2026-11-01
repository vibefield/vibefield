/**
 * Track FG, FG-3b — the field's hold on the Setup Assistant's glass (field-glass.ts; FG-D24; DESIGN.md §8 "The Setup
 * Assistant's glass"): the glass on the live field hands the field its look and its pose, and the browser stands its
 * own layers down only once the field says it draws them. happy-dom computes no CSS and runs no animations, so the
 * rows hand the glass the computed style a browser would, and run its frames by hand. FG-4b: the logo — its filter
 * in the look and its fade in the pose, followed through its fades — and the field's still, which sizes it. FG-6: the
 * field's still where its page asks for it, which the catalog stands the glass on; and FG-6's frozen frame, the glass
 * held off the field and the live field's door for a harness (`window.__vfField`). Its follow-up 3: the field's mark
 * held with it, which the browser's logo wears there.
 */
import { act, createRef, type ReactElement, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FieldHandle, FieldLayer, type VfFieldDoor } from "../src/boot/FieldLayer";
import {
  createFieldGlass,
  FieldGlassContext,
  markDress,
  useFieldStill,
} from "../src/boot/field-glass";
import { type WizardGround, WizardShellView } from "../src/boot/onboarding/wizard-ui";
import { fieldPlan } from "../src/boot/splash/field-door";
import type { GlassState } from "../src/boot/splash/glass-look";
import type { MarkPicture } from "../src/boot/splash/glass-pass";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** FG-6's frozen frame's rows hand FieldLayer a live door of their own; every other row keeps the real one, which
 * happy-dom (no WebGPU) opens as the still. */
const live = vi.hoisted(() => ({
  door: null as null | ReturnType<typeof liveDoor>,
}));

vi.mock("../src/boot/splash/field-door", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/boot/splash/field-door")>();
  return {
    ...real,
    fieldPlan: (env?: Parameters<typeof real.fieldPlan>[0]) =>
      live.door === null ? real.fieldPlan(env) : { gpu: {} as GPU, mainThread: false },
    openFieldDoor: async (...args: Parameters<typeof real.openFieldDoor>) =>
      live.door ?? real.openFieldDoor(...args),
  };
});

/** A live door, its every call recorded; its reveal opens the window. */
function liveDoor() {
  return {
    mode: "worker" as const,
    mark: vi.fn<(to: number, ms: number) => void>(),
    reveal: vi.fn<(options?: object) => Promise<boolean>>(async () => true),
    glass: vi.fn<(glass: GlassState | null) => void>(),
    freeze: vi.fn<() => Promise<boolean>>(async () => true),
    thaw: vi.fn<() => void>(),
    markPicture: vi.fn<() => Promise<MarkPicture | null>>(async () => null),
    destroy: vi.fn<() => void>(),
  };
}

/** The field's door as the hold reaches it: what it is handed, and the field's mark it pictures (none unless a row
 * says). */
function fieldDoor() {
  return {
    glass: vi.fn<(glass: GlassState | null) => void>(),
    markPicture: vi.fn<() => Promise<MarkPicture | null>>(async () => null),
  };
}

/** The field's mark as the held frame holds it (FG-6's follow-up 3): 128 × 77 on a whole px of the 1200 × 800 field,
 * half a px below the logo's box, which the browser centres on the glass. */
const PICTURE: MarkPicture = {
  png: new Blob(["png"], { type: "image/png" }),
  box: { x: 536, y: 362, width: 128, height: 77 },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Chrome's serialization of `--vf-shadow-wizard-field` (DESIGN.md §5). */
const FIELD_SHADOW =
  "rgba(4, 5, 15, 0.55) 0px 40px 120px 0px, rgba(4, 5, 15, 0.28) 0px 12px 32px 0px";
const DAY = [1, 1, 1, 0.55];
const NIGHT = [28 / 255, 28 / 255, 30 / 255, 0.55];

let host: HTMLDivElement | null = null;
let root: Root | null = null;
/** The frames the glass asked for, by id, run by hand (`runFrame`). */
const frames = new Map<number, FrameRequestCallback>();
let lastFrame = 0;
/** The glass's forming (and its clearing) as a browser computes it this frame, and the logo's fade. */
const forming = { frost: "1", edge: "1", rise: "1", logo: "0", running: false };

function computed(
  props: Partial<
    Record<"backgroundColor" | "borderTopLeftRadius" | "boxShadow" | "filter", string>
  >,
  custom: Record<string, string> = {},
): CSSStyleDeclaration {
  return {
    backgroundColor: "",
    borderTopLeftRadius: "",
    boxShadow: "",
    filter: "none",
    ...props,
    getPropertyValue: (name: string) => custom[name] ?? "",
  } as unknown as CSSStyleDeclaration;
}

beforeEach(() => {
  frames.clear();
  Object.assign(forming, { frost: "1", edge: "1", rise: "1", logo: "0", running: false });
  const real = globalThis.getComputedStyle;
  // the glass's style as wizard-ui.css and the tokens compute it, by the theme on the root
  vi.stubGlobal("getComputedStyle", (element: Element, pseudo?: string | null) => {
    const is = (name: string) => element.classList.contains(name);
    const night = document.documentElement.getAttribute("data-theme") === "dark";
    if (is("vf-wizard-shell"))
      return computed(
        { borderTopLeftRadius: "32px" },
        {
          "--vf-wizard-blur": "32px",
          "--vf-wizard-saturate": "1.12",
          "--vf-wizard-grain": "0.03",
          "--vf-glass-frost": forming.frost,
          "--vf-glass-edge": forming.edge,
          "--vf-glass-rise": forming.rise,
          "--vf-glass-logo": forming.logo,
        },
      );
    if (is("vf-wizard-glass-shadow")) return computed({ boxShadow: FIELD_SHADOW });
    // §5's logo filter: inverted on milk, as it is by day
    if (is("vf-wizard-logo"))
      return computed({ filter: night ? "none" : "invert(1) hue-rotate(180deg)" });
    if (is("vf-wizard-glass-frost") && pseudo === "::after")
      return computed({
        backgroundColor: night ? "rgba(28, 28, 30, 0.55)" : "rgba(255, 255, 255, 0.55)",
      });
    return real(element, pseudo);
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++lastFrame, callback);
    return lastFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  // laid out at 880 × 640, fitted at 0.75 and centred in a 1200 × 800 field, its logo's box (128 × 77) at its centre
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(880);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("vf-wizard-logo")) return new DOMRect(536, 361.5, 128, 77);
    return this.classList.contains("vf-wizard-shell")
      ? new DOMRect(270, 160, 660, 480)
      : new DOMRect(0, 0, 1200, 800);
  });
  (HTMLElement.prototype as unknown as { getAnimations: () => object[] }).getAnimations = () =>
    forming.running ? [{ playState: "running" }] : [{ playState: "finished" }];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  live.door = null;
  delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The field's hold, its door open: what the door was handed, in order. */
function heldField() {
  const field = document.createElement("div");
  const hold = createFieldGlass(() => field);
  const door = fieldDoor();
  hold.attach(door);
  door.glass.mockClear();
  return { hold, door, last: () => door.glass.mock.calls.at(-1)?.[0] };
}

function mount(element: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => created.render(element));
  const shell = host.querySelector<HTMLElement>(".vf-wizard-shell");
  if (shell === null) throw new Error("no glass");
  return shell;
}

function glassOn(ground: WizardGround, hold: ReturnType<typeof heldField>["hold"] | null) {
  const glass = (
    <WizardShellView dark={false} onToggleTheme={() => {}} ground={ground}>
      <p>a pane</p>
    </WizardShellView>
  );
  return hold === null ? (
    glass
  ) : (
    <FieldGlassContext.Provider value={hold}>{glass}</FieldGlassContext.Provider>
  );
}

/** The next frame the glass asked for. */
const runFrame = (): void => {
  const [id, frame] = frames.entries().next().value ?? [];
  if (id === undefined || frame === undefined) throw new Error("no frame asked for");
  frames.delete(id);
  act(() => frame(performance.now()));
};

describe("the field's hold on the glass", () => {
  it("keeps what the glass asks until the field's door opens, then hands it on", () => {
    const field = document.createElement("div");
    const hold = createFieldGlass(() => field);
    const state = { look: {}, pose: {} } as unknown as GlassState;
    hold.set(state);
    const door = fieldDoor();
    hold.attach(door);
    expect(door.glass.mock.calls).toEqual([[state]]);
    hold.set(null);
    expect(door.glass.mock.calls).toEqual([[state], [null]]);
  });

  it("says whether the field draws it, once each time it turns, and nothing a door already gone says", () => {
    const { hold } = heldField();
    const heard = vi.fn();
    hold.subscribe(heard);
    hold.report(true);
    hold.report(true);
    expect(hold.drawn()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    // the door goes: the field draws nothing, whatever a late message says
    hold.attach(null);
    expect(hold.drawn()).toBe(false);
    hold.report(true);
    expect(hold.drawn()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("holds the glass off the field: the door is handed none, and once it lets go what the glass set meanwhile (FG-6's frozen frame)", () => {
    const { hold, door, last } = heldField();
    const state = { look: {}, pose: {} } as unknown as GlassState;
    hold.set(state);
    hold.hold(true);
    expect(last()).toBeNull();
    const moved = { look: {}, pose: { x: 1 } } as unknown as GlassState;
    hold.set(moved);
    expect(last()).toBeNull();
    hold.hold(true);
    expect(door.glass).toHaveBeenCalledTimes(3);
    hold.hold(false);
    expect(last()).toBe(moved);
    expect(door.glass).toHaveBeenCalledTimes(4);

    // a door that opens while the glass is held off is handed none
    hold.hold(true);
    const next = fieldDoor();
    hold.attach(next);
    expect(next.glass.mock.calls).toEqual([[null]]);
  });

  it("holds the field's mark while the glass is held off it: the door's picture, its URL made once and revoked when the glass is let go (FG-6's follow-up 3)", async () => {
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mark");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { hold, door } = heldField();
    door.markPicture.mockResolvedValue(PICTURE);
    const heard = vi.fn();
    hold.subscribe(heard);
    expect(hold.heldMark()).toBeNull();
    hold.hold(true);
    expect(door.markPicture).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(hold.heldMark()).toEqual({ url: "blob:mark", box: PICTURE.box }));
    expect(made.mock.calls).toEqual([[PICTURE.png]]);
    expect(heard).toHaveBeenCalledTimes(1);
    // held again, nothing is asked again
    hold.hold(true);
    expect(door.markPicture).toHaveBeenCalledTimes(1);
    hold.hold(false);
    expect(hold.heldMark()).toBeNull();
    expect(revoked.mock.calls).toEqual([["blob:mark"]]);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("drops a picture that comes after the glass was let go or its door went, holds none the door has not, and lets one go with its door", async () => {
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mark");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { hold, door } = heldField();
    let give: (picture: MarkPicture | null) => void = () => {};
    door.markPicture.mockImplementation(
      () =>
        new Promise((resolve) => {
          give = resolve;
        }),
    );
    // let go before its picture comes
    hold.hold(true);
    hold.hold(false);
    give(PICTURE);
    await settle();
    expect(hold.heldMark()).toBeNull();
    // the door gone before it comes
    hold.hold(true);
    hold.attach(null);
    give(PICTURE);
    await settle();
    expect(hold.heldMark()).toBeNull();
    expect(made).not.toHaveBeenCalled();
    // a door with no mark to picture
    hold.hold(false);
    const next = fieldDoor();
    hold.attach(next);
    hold.hold(true);
    await settle();
    expect(next.markPicture).toHaveBeenCalledTimes(1);
    expect(hold.heldMark()).toBeNull();
    // a door that goes takes its mark with it
    hold.hold(false);
    next.markPicture.mockResolvedValue(PICTURE);
    hold.hold(true);
    await vi.waitFor(() => expect(hold.heldMark()).not.toBeNull());
    hold.attach(null);
    expect(hold.heldMark()).toBeNull();
    expect(revoked.mock.calls).toEqual([["blob:mark"]]);
  });

  it("measures the glass from the field's own box", () => {
    const field = document.createElement("div");
    let held: Element | null = field;
    const hold = createFieldGlass(() => held);
    const box = hold.box();
    expect([box?.x, box?.y, box?.width, box?.height]).toEqual([0, 0, 1200, 800]);
    held = null;
    expect(hold.box()).toBeNull();
  });
});

describe("the field's still (FG-4b)", () => {
  it("says when the field becomes its still, once each time it turns", () => {
    const { hold } = heldField();
    const heard = vi.fn();
    hold.subscribe(heard);
    expect(hold.still()).toBe(false);
    hold.stillness(true);
    hold.stillness(true);
    expect(hold.still()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    hold.stillness(false);
    expect(hold.still()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("is read by what stands on the field, and is never the still off it", () => {
    const { hold } = heldField();
    const seen: boolean[] = [];
    function Reader(): ReactElement {
      const still = useFieldStill();
      seen.push(still);
      return <p>{String(still)}</p>;
    }
    mount(
      <FieldGlassContext.Provider value={hold}>
        <WizardShellView dark={false} onToggleTheme={() => {}} ground="field">
          <Reader />
        </WizardShellView>
      </FieldGlassContext.Provider>,
    );
    expect(seen.at(-1)).toBe(false);
    act(() => hold.stillness(true));
    expect(seen.at(-1)).toBe(true);
    act(() => root?.unmount());
    root = null;
    host?.remove();

    hold.stillness(true);
    mount(
      <WizardShellView dark={false} onToggleTheme={() => {}} ground="field">
        <Reader />
      </WizardShellView>,
    );
    expect(seen.at(-1)).toBe(false);
  });

  it("sizes the logo: the field's mark on the live field, the still's own mark over its still", () => {
    const { hold } = heldField();
    // a 1800 × 900 ground, laid out; the glass at its own size there (fit 1)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    mount(
      <FieldGlassContext.Provider value={hold}>
        <WizardShellView dark={false} onToggleTheme={() => {}} ground="field">
          <p>a pane</p>
        </WizardShellView>
      </FieldGlassContext.Provider>,
    );
    const ground = host?.querySelector<HTMLElement>(".vf-wizard-ground");
    expect(ground?.style.getPropertyValue("--vf-glass-fit")).toBe("1");
    expect(ground?.style.getPropertyValue("--vf-wizard-logo-width")).toBe("128px");
    expect(ground?.style.getPropertyValue("--vf-wizard-logo-height")).toBe("77px");
    // the wide still, cover-fitted by width at 1.25×: its own mark, 160 × 96.25
    act(() => hold.stillness(true));
    expect(ground?.style.getPropertyValue("--vf-wizard-logo-width")).toBe("160px");
    expect(ground?.style.getPropertyValue("--vf-wizard-logo-height")).toBe("96.25px");
  });

  it("is the still from the first frame where its page asks for it, though the page has WebGPU: no door, the browser's glass over it (FG-6, the catalog)", () => {
    const seen: boolean[] = [];
    function Reader(): ReactElement {
      const still = useFieldStill();
      seen.push(still);
      return <p>{String(still)}</p>;
    }
    // a page with WebGPU, where the field would wake and open its door but for its page's word
    Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
    try {
      expect("still" in fieldPlan()).toBe(false);
      const glass = mount(
        <FieldLayer mark={false} page={{ search: "?field=still" }}>
          <WizardShellView dark={false} onToggleTheme={() => {}} ground="field">
            <Reader />
          </WizardShellView>
        </FieldLayer>,
      );
      const field = host?.querySelector(".vf-field");
      expect(field?.getAttribute("data-field")).toBe("still");
      expect(field?.getAttribute("data-mark")).toBe("hidden");
      expect(field?.querySelector(".vf-field-canvas")).toBeNull();
      // the logo takes the still's own mark, and the browser draws the whole glass
      expect(seen.at(-1)).toBe(true);
      expect(glass.hasAttribute("data-glass")).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, "gpu");
    }
  });
});

describe("the glass on the field", () => {
  it("hands the field its look and its pose, and stands the browser's layers down once the field draws them", () => {
    const { hold, last } = heldField();
    const shell = mount(glassOn("field", hold));
    expect(last()).toEqual({
      look: {
        tint: DAY,
        blur: 32,
        saturate: 1.12,
        grain: 0.03,
        radius: 32,
        shadows: [
          { color: [4 / 255, 5 / 255, 15 / 255, 0.55], x: 0, y: 40, blur: 120, spread: 0 },
          { color: [4 / 255, 5 / 255, 15 / 255, 0.28], x: 0, y: 12, blur: 32, spread: 0 },
        ],
        logoInvert: true,
      },
      pose: { x: 600, y: 400, w: 880, h: 640, fit: 0.75, frost: 1, edge: 1, rise: 1, logo: 0 },
    });
    // until the field says it draws the glass, the browser does
    expect(shell.hasAttribute("data-glass")).toBe(false);
    act(() => hold.report(true));
    expect(shell.getAttribute("data-glass")).toBe("field");
    act(() => hold.report(false));
    expect(shell.hasAttribute("data-glass")).toBe(false);
  });

  it("follows the glass's forming frame by frame, and rests two frames after it has", () => {
    Object.assign(forming, { frost: "0", edge: "0", rise: "0.985", running: true });
    const { hold, door, last } = heldField();
    mount(glassOn("field", hold));
    expect(last()?.pose).toMatchObject({ frost: 0, edge: 0, rise: 0.985 });
    Object.assign(forming, { frost: "0.5", edge: "0.5", rise: "0.99" });
    runFrame();
    expect(last()?.pose).toMatchObject({ frost: 0.5, edge: 0.5, rise: 0.99 });
    Object.assign(forming, { frost: "1", edge: "1", rise: "1", running: false });
    runFrame();
    expect(last()?.pose).toMatchObject({ frost: 1, edge: 1, rise: 1 });
    const handed = door.glass.mock.calls.length;
    runFrame();
    runFrame();
    expect(frames.size).toBe(0);
    expect(door.glass.mock.calls).toHaveLength(handed);

    // a resize wakes it, for the fit that follows
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(frames.size).toBe(1);
  });

  it("follows the theme: by night the field reads the night's tint, and the logo is never inverted", async () => {
    const { hold, last } = heldField();
    mount(glassOn("field", hold));
    expect(last()?.look.tint).toEqual(DAY);
    expect(last()?.look.logoInvert).toBe(true);
    document.documentElement.setAttribute("data-theme", "dark");
    await vi.waitFor(() => expect(last()?.look.tint).toEqual(NIGHT));
    expect(last()?.look.logoInvert).toBe(false);
  });

  it("follows the logo's fades on the glass, long after its forming has rested (FG-4b)", () => {
    const { hold, door, last } = heldField();
    const shell = mount(glassOn("field", hold));
    runFrame();
    runFrame();
    expect(frames.size).toBe(0);
    // the logo begins to fade in: the glass's own transition wakes the pose
    Object.assign(forming, { logo: "0.3", running: true });
    act(() => {
      shell.dispatchEvent(new Event("transitionrun"));
    });
    expect(frames.size).toBe(1);
    runFrame();
    expect(last()?.pose.logo).toBe(0.3);
    Object.assign(forming, { logo: "1", running: false });
    runFrame();
    expect(last()?.pose.logo).toBe(1);
    runFrame();
    runFrame();
    expect(frames.size).toBe(0);
    // a transition inside the glass (a button's) is not the glass's, and wakes nothing
    const handed = door.glass.mock.calls.length;
    act(() => {
      shell
        .querySelector(".vf-wizard-frame")
        ?.dispatchEvent(new Event("transitionrun", { bubbles: true }));
    });
    expect(frames.size).toBe(0);
    expect(door.glass.mock.calls).toHaveLength(handed);
  });

  it("follows the glass's clearing at the hand-over, begun long after its forming has rested (FG-5)", () => {
    Object.assign(forming, { logo: "1" });
    const { hold, door, last } = heldField();
    const shell = mount(glassOn("field", hold));
    runFrame();
    runFrame();
    expect(frames.size).toBe(0);
    // the clearing's animations begin on the glass itself, and wake the pose
    Object.assign(forming, { running: true });
    act(() => {
      shell.dispatchEvent(new Event("animationstart"));
    });
    expect(frames.size).toBe(1);
    // its 360th ms: the frost all but gone, the logo going, the edge and its shadow whole
    Object.assign(forming, { frost: "0.03", edge: "1", logo: "0.4" });
    runFrame();
    expect(last()?.pose).toMatchObject({ frost: 0.03, edge: 1, logo: 0.4 });
    Object.assign(forming, { frost: "0", edge: "0", logo: "0", running: false });
    runFrame();
    expect(last()?.pose).toMatchObject({ frost: 0, edge: 0, logo: 0 });
    runFrame();
    runFrame();
    expect(frames.size).toBe(0);
    // an animation inside the glass (a line's crossfade) is not the glass's, and wakes nothing
    const handed = door.glass.mock.calls.length;
    act(() => {
      shell
        .querySelector(".vf-wizard-frame")
        ?.dispatchEvent(new Event("animationstart", { bubbles: true }));
    });
    expect(frames.size).toBe(0);
    expect(door.glass.mock.calls).toHaveLength(handed);
  });

  it("hands the field nothing without its logo layer: the sheet's glass has none", () => {
    const { hold, door } = heldField();
    mount(
      <FieldGlassContext.Provider value={hold}>
        <WizardShellView dark={false} onToggleTheme={() => {}} ground="field" size="sheet">
          <p>a pane</p>
        </WizardShellView>
      </FieldGlassContext.Provider>,
    );
    expect(door.glass).not.toHaveBeenCalled();
  });

  it("lets the field go when the glass goes", async () => {
    const { hold, door, last } = heldField();
    mount(glassOn("field", hold));
    expect(last()).not.toBeNull();
    await act(async () => root?.unmount());
    root = null;
    expect(last()).toBeNull();
    expect(door.glass).toHaveBeenCalled();
  });

  it("is never the field's over the app (Finish setting up's sheet), nor with no field under it", () => {
    const { hold, door } = heldField();
    const overApp = mount(glassOn("app", hold));
    expect(door.glass).not.toHaveBeenCalled();
    act(() => hold.report(true));
    expect(overApp.hasAttribute("data-glass")).toBe(false);
    act(() => root?.unmount());
    host?.remove();

    const alone = mount(glassOn("field", null));
    expect(alone.hasAttribute("data-glass")).toBe(false);
  });
});

describe("the logo in the field's held mark (FG-6's follow-up 3)", () => {
  it("places the mark's picture where the field draws it, in the logo's own px: the logo moved onto the mark's corner, the picture at its size there", () => {
    // the field at the window's corner, the glass fitted at 0.75: the logo's box half a px above the field's mark
    const logo = new DOMRect(536, 361.5, 128, 77);
    expect(markDress(PICTURE.box, new DOMRect(0, 0, 1200, 800), logo, 0.75)).toEqual({
      x: 0,
      y: 0.5 / 0.75,
      width: 128 / 0.75,
      height: 77 / 0.75,
    });
    // a field away from the window's corner, the glass at its own size
    expect(markDress(PICTURE.box, new DOMRect(10, 20, 1200, 800), logo, 1)).toEqual({
      x: 10,
      y: 20.5,
      width: 128,
      height: 77,
    });
  });

  it("wears it while the glass is held off the field, at the mark's own spot in the glass's fit, and the brand's again once let go or gone", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mark");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { hold, door } = heldField();
    door.markPicture.mockResolvedValue(PICTURE);
    const shell = mount(glassOn("field", hold));
    const logo = shell.querySelector<HTMLElement>(".vf-wizard-logo");
    expect(logo?.hasAttribute("data-mark")).toBe(false);
    act(() => hold.hold(true));
    await vi.waitFor(() => expect(logo?.getAttribute("data-mark")).toBe("field"));
    expect(logo?.style.backgroundImage).toBe('url("blob:mark")');
    expect(logo?.style.backgroundSize).toBe(`${128 / 0.75}px ${77 / 0.75}px`);
    expect(logo?.style.backgroundPosition).toBe("0px 0px");
    expect(logo?.style.getPropertyValue("translate")).toBe(`0px ${0.5 / 0.75}px`);
    // let go, the logo is the stylesheet's again
    act(() => hold.hold(false));
    expect(logo?.hasAttribute("data-mark")).toBe(false);
    expect(logo?.getAttribute("style") ?? "").toBe("");
    // the glass gone while it wears the field's mark takes it off
    act(() => hold.hold(true));
    await vi.waitFor(() => expect(logo?.getAttribute("data-mark")).toBe("field"));
    await act(async () => root?.unmount());
    root = null;
    expect(logo?.hasAttribute("data-mark")).toBe(false);
    expect(logo?.getAttribute("style") ?? "").toBe("");
  });

  it("keeps the brand's mark while the field's door has none to picture", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mark");
    const { hold, door } = heldField();
    const shell = mount(glassOn("field", hold));
    act(() => hold.hold(true));
    await settle();
    expect(door.markPicture).toHaveBeenCalledTimes(1);
    expect(shell.querySelector(".vf-wizard-logo")?.hasAttribute("data-mark")).toBe(false);
  });
});

describe("the live field's door for a harness (FG-6's frozen frame)", () => {
  const scope = globalThis as { __vfField?: VfFieldDoor };
  const layer = (handleRef: Ref<FieldHandle> = null) => (
    <FieldLayer mark={false} handleRef={handleRef}>
      <WizardShellView dark={false} onToggleTheme={() => {}} ground="field">
        <p>a pane</p>
      </WizardShellView>
    </FieldLayer>
  );

  it("is window.__vfField while the live field's door is open: it holds the field and the glass off it, and goes with the tear", async () => {
    const door = liveDoor();
    live.door = door;
    const handle = createRef<FieldHandle>();
    mount(layer(handle));
    expect(scope.__vfField).toBeUndefined();
    await act(async () => {}); // the field's door opens
    const field = scope.__vfField;
    expect(field?.mode).toBe("worker");
    const kept = door.glass.mock.calls.at(-1)?.[0];
    expect(kept?.pose).toMatchObject({ x: 600, y: 400 });
    expect(await field?.freeze()).toBe(true);
    expect(door.freeze).toHaveBeenCalledTimes(1);
    // the glass held off the field: the door handed none, then the glass it had
    field?.glass(false);
    expect(door.glass.mock.calls.at(-1)).toEqual([null]);
    field?.glass(true);
    expect(door.glass.mock.calls.at(-1)).toEqual([kept]);
    field?.thaw();
    expect(door.thaw).toHaveBeenCalledTimes(1);
    // the tear open, the door goes, and the harness's door with it
    await act(async () => {
      await handle.current?.tear(false);
    });
    expect(door.destroy).toHaveBeenCalledTimes(1);
    expect(scope.__vfField).toBeUndefined();
  });

  it("is never there over the field's still, and goes when the layer does", async () => {
    mount(layer());
    await act(async () => {});
    expect(host?.querySelector(".vf-field")?.getAttribute("data-field")).toBe("still");
    expect(scope.__vfField).toBeUndefined();
    await act(async () => root?.unmount());
    root = null;
    host?.remove();

    const door = liveDoor();
    live.door = door;
    mount(layer());
    await act(async () => {});
    expect(scope.__vfField).toBeDefined();
    await act(async () => root?.unmount());
    root = null;
    expect(door.destroy).toHaveBeenCalledTimes(1);
    expect(scope.__vfField).toBeUndefined();
  });
});
