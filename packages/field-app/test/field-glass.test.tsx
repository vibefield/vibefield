/**
 * Track FG, FG-3b — the field's hold on the Setup Assistant's glass (field-glass.ts; FG-D24; DESIGN.md §8 "The Setup
 * Assistant's glass"): the glass on the live field hands the field its look and its pose, and the browser stands its
 * own layers down only once the field says it draws them. happy-dom computes no CSS and runs no animations, so the
 * rows hand the glass the computed style a browser would, and run its frames by hand. FG-4b: the logo — its filter
 * in the look and its fade in the pose, followed through its fades — and the field's still, which sizes it.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFieldGlass, FieldGlassContext, useFieldStill } from "../src/boot/field-glass";
import { type WizardGround, WizardShellView } from "../src/boot/onboarding/wizard-ui";
import type { GlassState } from "../src/boot/splash/glass-look";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // laid out at 880 × 640, fitted at 0.75 and centred in a 1200 × 800 field
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(880);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
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
  delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The field's hold, its door open: what the door was handed, in order. */
function heldField() {
  const field = document.createElement("div");
  const hold = createFieldGlass(() => field);
  const door = { glass: vi.fn<(glass: GlassState | null) => void>() };
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
    const door = { glass: vi.fn<(glass: GlassState | null) => void>() };
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

  it("is never the field's over the app (Finish setting up's sheet), nor with no field under it (the catalog)", () => {
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
