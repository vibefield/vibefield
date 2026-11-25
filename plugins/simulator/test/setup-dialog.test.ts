// @vitest-environment happy-dom
// THE SIMULATOR'S SETTINGS, A SHEET ON ITS GLASS (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts"): it rises
// only on the phone in hand — never the window's dialog — from just under the Dynamic Island to the display's foot; its iOS
// version and iPhone model are pills over lists of the bar's rows (the current one checked, walked by the keys, folded
// first by Esc); with several phones it says how many and sets every one up. Every state, message and behaviour of the
// form before it stands.
import type { Entity, ObjectDomHost, SimulatorDevices } from "@vibefield/plugin-sdk/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHONES } from "../src/catalog.gen";
import { MM, modelOf, shapeOf } from "../src/law";
import { mountSimulatorSetup, sheetOn } from "../src/setup-dialog";

const prefix = "com.apple.CoreSimulator.SimRuntime.iOS-";
const thirteen = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-13",
  name: "iPhone 13",
};
const pro = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  name: "iPhone 17 Pro",
};
const recent = { runtime: `${prefix}26-5`, models: [pro, thirteen] };
const old = { runtime: `${prefix}18-6`, models: [thirteen] };

type Hand = ReturnType<ObjectDomHost["hand"]>;

function host(
  configurations: NonNullable<SimulatorDevices["configurations"]>,
  initial = "",
  native?: SimulatorDevices["setup"],
  hand?: ObjectDomHost["hand"],
  phones: readonly number[] = [1],
) {
  const container = document.createElement("div");
  document.body.append(container);
  let key = "phone-a";
  const values = new Map<number, Record<string, unknown>>(
    phones.map((e) => [e, { model: pro.deviceType, binding: initial, finish: "silver" }]),
  );
  const write = vi.fn((entity: number, patch: Record<string, unknown>) => {
    values.set(entity, patch);
  });
  const transactions = vi.fn();
  const store = {
    keyOf: (e: Entity) => ((e as number) === phones[0] ? key : `phone-${e}`),
    transaction: (fn: (tx: unknown) => void) => {
      transactions();
      fn({
        edit: (e: Entity) => ({
          set: (_cell: unknown, patch: Record<string, unknown>) => write(e as number, patch),
        }),
      });
    },
  };
  const frame = { cx: 300, cy: 400, s: 1 };
  const dom = {
    container,
    hand: hand ?? (() => ({ entity: phones[0] as Entity, landing: false, frame }) as Hand),
    world: { get: (e: Entity) => values.get(e as number) },
    object: { propToGroup: { binding: "props" }, groups: [{ name: "props", component: {} }] },
    docs: {
      current: () => ({
        store,
        versionReport: () => ({
          docSchema: 1,
          localSchema: 1,
          newerInDoc: [],
          olderInDoc: [],
          renamedInDoc: {},
        }),
      }),
    },
    wake: () => {},
  } as unknown as ObjectDomHost;
  const setup = mountSimulatorSetup(dom, {
    configurations,
    ...(native && { setup: native }),
    attachable: () => undefined,
  });
  const opened = setup.configure(phones.map((e) => e as Entity));
  const pill = (name: string) =>
    container.querySelector<HTMLButtonElement>(`[data-pill="${name}"]`)!;
  const list = (name: string) => container.querySelector<HTMLElement>(`[data-list="${name}"]`)!;
  const rows = (name: string) =>
    Array.from(list(name).querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const row = (name: string, value: string) => rows(name).find((r) => r.dataset.value === value)!;
  const act = (name: string) => container.querySelector<HTMLButtonElement>(name)!;
  /** A value chosen as a person chooses it: the pill pressed, then its row. */
  const choose = (name: string, value: string) => {
    pill(name).click();
    row(name, value).click();
  };
  return {
    setup,
    opened,
    container,
    dialog: () => container.querySelector<HTMLDialogElement>("dialog")!,
    write,
    transactions,
    pill,
    list,
    rows,
    row,
    act,
    choose,
    values: (e = phones[0] ?? 1) => values.get(e) ?? {},
    replacePhone: () => {
      key = "other";
    },
  };
}
const key = (target: Element, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );

afterEach(() => {
  document.body.replaceChildren();
});

describe("simulator setup", () => {
  it("filters models on version change, creates a dedicated phone, and skips an unchanged config", async () => {
    const h = host(async () => [recent, old]);
    await vi.waitFor(() => expect(h.pill("runtime").disabled).toBe(false));
    expect(h.pill("model").dataset.value).toBe(pro.deviceType);
    h.choose("runtime", old.runtime);
    expect(h.rows("model").map((o) => o.textContent)).toEqual([thirteen.name]);
    expect(h.pill("model").dataset.value).toBe(thirteen.deviceType);
    h.act("[type=submit]").click();
    expect(h.values().model).toBe(thirteen.deviceType);
    expect(h.values().finish).toBe("silver");
    expect(JSON.parse(String(h.values().binding))).toEqual({
      deviceType: thirteen.deviceType,
      runtime: old.runtime,
      dedicated: true,
    });
    expect(h.setup.configure([1 as Entity])).toBe(true);
    await vi.waitFor(() => expect(h.act("[type=submit]").textContent).toBe("Done"));
    h.act("[type=submit]").click();
    expect(h.write).toHaveBeenCalledTimes(1);
    h.setup.dispose();
  });

  it("keeps a missing saved OS visible until a replacement is chosen and refuses a stale target", async () => {
    const h = host(
      async () => [recent],
      JSON.stringify({ deviceType: thirteen.deviceType, runtime: old.runtime, dedicated: true }),
    );
    await vi.waitFor(() => expect(h.pill("runtime").disabled).toBe(false));
    expect(h.pill("runtime").dataset.value).toBe("");
    expect(h.pill("runtime").textContent).toContain("18.6");
    expect(h.pill("runtime").hasAttribute("data-placeholder")).toBe(true);
    expect(h.rows("runtime")[0]?.textContent).toContain("18.6");
    expect(h.rows("runtime")[0]?.getAttribute("aria-disabled")).toBe("true");
    expect(h.act("[type=submit]").disabled).toBe(true);
    // the unavailable row is shown and never taken: the list stays open until a row that can be is
    h.pill("runtime").click();
    h.rows("runtime")[0]?.click();
    expect(h.pill("runtime").dataset.value).toBe("");
    expect(h.list("runtime").hidden).toBe(false);
    h.row("runtime", recent.runtime).click();
    expect(h.list("runtime").hidden).toBe(true);
    expect(h.pill("runtime").dataset.value).toBe(recent.runtime);
    expect(h.pill("runtime").hasAttribute("data-placeholder")).toBe(false);
    h.replacePhone();
    h.act("[type=submit]").click();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.container.querySelector("[role=status]")?.textContent).toContain("no longer editable");
    h.setup.dispose();
  });

  it("distinguishes an empty catalog from a failed read and can refresh after installing a runtime", async () => {
    const read = vi
      .fn<NonNullable<SimulatorDevices["configurations"]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([old]);
    const h = host(read);
    const message = () => h.container.querySelector("[role=status]")?.textContent;
    await vi.waitFor(() => expect(message()).toContain("Couldn't read"));
    h.act("[data-refresh]").click();
    await vi.waitFor(() => expect(message()).toContain("No compatible"));
    expect(h.pill("runtime").disabled).toBe(true);
    h.act("[data-refresh]").click();
    await vi.waitFor(() => expect(h.pill("runtime").dataset.value).toBe(old.runtime));
    expect(h.act("[type=submit]").disabled).toBe(false);
    h.act("[data-cancel]").click();
    expect(h.write).not.toHaveBeenCalled();
    h.setup.dispose();
  });
});

describe("the sheet rises on the phone in hand alone — never the window's dialog", () => {
  it("opens only where the first phone given is in hand and not landing, and says whether it opened", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    try {
      let hand: Hand;
      const frame = { cx: 300, cy: 400, s: 1 };
      const h = host(
        async () => [recent],
        "",
        undefined,
        () => hand,
      );
      expect(h.opened).toBe(false);
      expect(h.dialog().open).toBe(false);
      hand = { entity: 2 as Entity, landing: false, frame } as Hand;
      expect(h.setup.configure([1 as Entity])).toBe(false);
      hand = { entity: 1 as Entity, landing: true, frame } as Hand;
      expect(h.setup.configure([1 as Entity])).toBe(false);
      expect(h.dialog().open).toBe(false);
      hand = { entity: 1 as Entity, landing: false, frame } as Hand;
      expect(h.setup.configure([1 as Entity])).toBe(true);
      expect(h.dialog().open && h.dialog().hasAttribute("data-held")).toBe(true);
      // open already: a second ask opens nothing
      expect(h.setup.configure([1 as Entity])).toBe(false);
      expect(showModal).not.toHaveBeenCalled();
      h.setup.dispose();
    } finally {
      showModal.mockRestore();
    }
  });

  it("stands from just under the Dynamic Island to the display's foot, at the display's width, its top corners rounded", () => {
    const frame = { cx: 300, cy: 400, s: 1.5 };
    const shape = shapeOf(modelOf(pro.deviceType));
    const r = sheetOn(shape, frame);
    const [hx, hy] = shape.display;
    const pill = shape.housing.pill;
    if (pill === null) throw new Error("the 17 Pro has an island");
    const displayTop = frame.cy - hy * frame.s;
    expect(r.left).toBeCloseTo(frame.cx - hx * frame.s, 9);
    expect(r.width).toBeCloseTo(2 * hx * frame.s, 9);
    expect(r.top).toBeCloseTo(displayTop + (pill.top + 2 * pill.hh + 0.025 * 2 * hy) * frame.s, 9);
    expect(r.top + r.height).toBeCloseTo(frame.cy + hy * frame.s, 9);
    // its top corners 2.6 mm of the phone's display, as the page drew them — about 16 of a 17 Pro's points; its foot the
    // display's own corner
    expect(r.corner).toBeCloseTo(2.6 * MM * frame.s, 9);
    const points = r.corner / ((2 * hy * frame.s) / shape.points[1]);
    expect(points).toBeGreaterThan(15);
    expect(points).toBeLessThan(17);
    // every phone's: 2.6 mm read off its own display's size, whatever its model
    for (const m of PHONES) {
      const s = shapeOf(m);
      expect(sheetOn(s, frame).corner, m.name).toBeCloseTo(
        (2.6 * 2 * s.display[1] * frame.s) / m.screen.mm[1],
        9,
      );
    }
    expect(r.foot).toBeCloseTo(shape.displayCorner.extent * frame.s, 9);
    // a notch phone's sheet stands under its notch; a home-button phone's from the display's top
    const notch = shapeOf(modelOf(thirteen.deviceType));
    const n = sheetOn(notch, frame);
    expect(n.top).toBeCloseTo(
      frame.cy +
        ((notch.housing.notch?.depth ?? Number.NaN) +
          0.025 * 2 * notch.display[1] -
          notch.display[1]) *
          frame.s,
      9,
    );
    const classic = shapeOf(modelOf("com.apple.CoreSimulator.SimDeviceType.iPhone-8"));
    expect(sheetOn(classic, frame).top).toBeCloseTo(
      frame.cy - classic.display[1] * frame.s * (1 - 0.05),
      9,
    );
    expect(sheetOn(classic, frame).foot).toBe(0);
    // the sheet is placed there
    const h = host(
      async () => [recent],
      "",
      undefined,
      () => ({
        entity: 1 as Entity,
        landing: false,
        frame,
      }),
    );
    const style = h.dialog().style;
    expect(Number.parseFloat(style.left)).toBeCloseTo(r.left, 6);
    expect(Number.parseFloat(style.top)).toBeCloseTo(r.top, 6);
    expect(Number.parseFloat(style.width)).toBeCloseTo(r.width, 6);
    expect(Number.parseFloat(style.height)).toBeCloseTo(r.height, 6);
    expect(style.borderRadius.split(" ")).toHaveLength(4);
    h.setup.dispose();
  });
});

describe("its pills open lists of the bar's rows", () => {
  it("each pill names its choice and its value; its list checks the current row, the arrows walk, Return takes, Esc folds the list first", async () => {
    const h = host(async () => [recent, old]);
    await vi.waitFor(() => expect(h.pill("model").disabled).toBe(false));
    const model = h.pill("model");
    expect(model.getAttribute("aria-label")).toBe("iPhone model: iPhone 17 Pro");
    expect(model.getAttribute("aria-haspopup")).toBe("menu");
    expect(h.list("model").getAttribute("role")).toBe("menu");
    expect(h.list("model").hidden).toBe(true);
    expect(model.querySelector("svg")).not.toBeNull();
    // its rows: a check column, the current one checked (menuitemradio, aria-checked)
    expect(
      h.rows("model").map((r) => [r.getAttribute("role"), r.getAttribute("aria-checked")]),
    ).toEqual([
      ["menuitemradio", "true"],
      ["menuitemradio", "false"],
    ]);
    for (const r of h.rows("model")) expect(r.querySelector(".vf-sim-check svg")).not.toBeNull();
    // pressed, it opens, the current row in focus
    model.click();
    expect(h.list("model").hidden).toBe(false);
    expect(model.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(h.row("model", pro.deviceType));
    // ↓ walks to the next row, and round
    key(h.row("model", pro.deviceType), "ArrowDown");
    expect(document.activeElement).toBe(h.row("model", thirteen.deviceType));
    key(h.row("model", thirteen.deviceType), "ArrowDown");
    expect(document.activeElement).toBe(h.row("model", pro.deviceType));
    key(h.row("model", pro.deviceType), "ArrowUp");
    expect(document.activeElement).toBe(h.row("model", thirteen.deviceType));
    // Return takes the row in focus: the list folds, the pill says it
    key(h.row("model", thirteen.deviceType), "Enter");
    expect(h.list("model").hidden).toBe(true);
    expect(model.dataset.value).toBe(thirteen.deviceType);
    expect(model.getAttribute("aria-label")).toBe("iPhone model: iPhone 13");
    expect(h.row("model", thirteen.deviceType).getAttribute("aria-checked")).toBe("true");
    expect(h.row("model", pro.deviceType).getAttribute("aria-checked")).toBe("false");
    // ↓ on the pill opens its list too; Esc folds the list and leaves the sheet open, a second Esc closes it
    key(model, "ArrowDown");
    expect(h.list("model").hidden).toBe(false);
    key(h.row("model", thirteen.deviceType), "Escape");
    expect(h.list("model").hidden).toBe(true);
    expect(h.dialog().open).toBe(true);
    expect(document.activeElement).toBe(model);
    key(model, "Escape");
    expect(h.dialog().open).toBe(false);
    h.setup.dispose();
  });

  it("one list open at a time: a press elsewhere in the sheet folds it", async () => {
    const h = host(async () => [recent, old]);
    await vi.waitFor(() => expect(h.pill("model").disabled).toBe(false));
    h.pill("runtime").click();
    expect(h.list("runtime").hidden).toBe(false);
    h.dialog()
      .querySelector("h2")!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(h.list("runtime").hidden).toBe(true);
    h.pill("runtime").click();
    h.pill("model").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    h.pill("model").click();
    expect(h.list("runtime").hidden).toBe(true);
    expect(h.list("model").hidden).toBe(false);
    // pressed again, the pill folds its own list
    h.pill("model").click();
    expect(h.list("model").hidden).toBe(true);
    h.setup.dispose();
  });

  it("a check of the Mac read again while a list stands open keeps it open, the focus on its row", async () => {
    const read = vi
      .fn<NonNullable<SimulatorDevices["configurations"]>>()
      .mockResolvedValueOnce([recent, old])
      .mockResolvedValue([recent, old, { runtime: `${prefix}26-6`, models: [pro] }]);
    const h = host(read);
    await vi.waitFor(() => expect(h.pill("runtime").disabled).toBe(false));
    h.pill("runtime").click();
    key(h.row("runtime", recent.runtime), "ArrowDown");
    expect(document.activeElement).toBe(h.row("runtime", old.runtime));
    h.act("[data-refresh]").click();
    await vi.waitFor(() => expect(h.rows("runtime")).toHaveLength(3));
    expect(h.list("runtime").hidden).toBe(false);
    expect(document.activeElement).toBe(h.row("runtime", old.runtime));
    // the value is the person's still
    expect(h.pill("runtime").dataset.value).toBe(recent.runtime);
    h.setup.dispose();
  });
});

describe("the focus, given back on every close", () => {
  it("returns to what had it when the sheet opened — after Esc, the close glyph and Create — and is never taken back from elsewhere", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const h = host(async () => [recent, old]);
    const heading = h.dialog().querySelector("h2")!;
    expect(document.activeElement).toBe(heading);
    // Esc
    key(heading, "Escape");
    expect(h.dialog().open).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    // the close glyph
    expect(h.setup.configure([1 as Entity])).toBe(true);
    expect(document.activeElement).toBe(heading);
    h.act("[data-cancel]").click();
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    // Create simulator
    expect(h.setup.configure([1 as Entity])).toBe(true);
    await vi.waitFor(() => expect(h.act("[type=submit]").disabled).toBe(false));
    h.act("[type=submit]").click();
    expect(h.write).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    // the focus put somewhere else while the sheet stood: it stays there
    expect(h.setup.configure([1 as Entity])).toBe(true);
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    h.act("[data-cancel]").click();
    await vi.waitFor(() => expect(h.dialog().open).toBe(false));
    await Promise.resolve();
    expect(document.activeElement).toBe(elsewhere);
    // what had it gone from the page: nothing is focused for it
    opener.focus();
    expect(h.setup.configure([1 as Entity])).toBe(true);
    const focus = vi.spyOn(opener, "focus");
    opener.remove();
    h.act("[data-cancel]").click();
    await vi.waitFor(() => expect(h.dialog().open).toBe(false));
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    h.setup.dispose();
  });
});

describe("several phones", () => {
  it("says how many, and sets every one up in one transaction", async () => {
    const h = host(async () => [recent, old], "", undefined, undefined, [1, 2, 3]);
    expect(h.opened).toBe(true);
    expect(h.dialog().querySelector("h2")?.textContent).toBe("Set up 3 simulators");
    await vi.waitFor(() => expect(h.pill("runtime").disabled).toBe(false));
    expect(h.act("[type=submit]").textContent).toBe("Create simulators");
    h.choose("runtime", old.runtime);
    h.act("[type=submit]").click();
    expect(h.transactions).toHaveBeenCalledTimes(1);
    expect(h.write.mock.calls.map(([e]) => e)).toEqual([1, 2, 3]);
    for (const e of [1, 2, 3])
      expect(JSON.parse(String(h.values(e).binding))).toEqual({
        deviceType: thirteen.deviceType,
        runtime: old.runtime,
        dedicated: true,
      });
    // set up now: its settings, switching every one
    expect(h.setup.configure([1, 2, 3].map((e) => e as Entity))).toBe(true);
    expect(h.dialog().querySelector("h2")?.textContent).toBe("Settings for 3 simulators");
    await vi.waitFor(() => expect(h.pill("runtime").dataset.value).toBe(old.runtime));
    h.choose("runtime", recent.runtime);
    expect(h.act("[type=submit]").textContent).toBe("Switch simulators");
    expect(h.container.querySelector("[role=status]")?.textContent).toBe(
      "Each configuration keeps its own apps and data.",
    );
    h.setup.dispose();
  });
});

describe("native simulator setup", () => {
  it("guides installation, opens only the selected destination, and advances automatically to Create simulator", async () => {
    vi.useFakeTimers();
    try {
      let state: Awaited<ReturnType<NonNullable<SimulatorDevices["setup"]>["check"]>> = {
        stage: "install-xcode",
      };
      const native = { check: vi.fn(async () => state), open: vi.fn(async () => {}) };
      const h = host(async () => [], "", native);
      await vi.advanceTimersByTimeAsync(0);
      const step = () => h.container.querySelector('[aria-current="step"] strong')?.textContent;
      expect(step()).toBe("Install Xcode");
      expect(h.act("[type=submit]").hidden).toBe(true);
      expect(h.act("[data-xcode]").hidden).toBe(true);
      expect(native.open).not.toHaveBeenCalled();
      h.act("[data-primary]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(native.open).toHaveBeenCalledWith("app-store");
      state = { stage: "install-runtime", xcodeVersion: "26.6" };
      await vi.advanceTimersByTimeAsync(2100);
      expect(step()).toBe("Install an iOS runtime");
      const complete = h.container.querySelector('[data-state="complete"]');
      expect(complete?.textContent).toContain("Xcode 26.6");
      // a step done wears the kit's check
      expect(complete?.querySelector("[data-marker] svg")).not.toBeNull();
      expect(h.act("[data-primary]").textContent).toBe("Open Xcode");
      h.act("[data-primary]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(native.open).toHaveBeenCalledWith("xcode");
      state = { stage: "ready", configurations: [recent, old], xcodeVersion: "26.6" };
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.pill("runtime").dataset.value).toBe(recent.runtime);
      expect(h.act("[type=submit]").textContent).toBe("Create simulator");
      // the sub line: the Xcode on this Mac
      expect(h.act("[data-xcode]").hidden).toBe(false);
      expect(h.act("[data-xcode]").textContent).toBe("Xcode 26.6");
      expect(h.write).not.toHaveBeenCalled();
      const reads = native.check.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120000);
      expect(native.check).toHaveBeenCalledTimes(reads);
      h.setup.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mounts inside the held phone, follows it, and dismisses a pending check on release", async () => {
    const entity = 1 as Entity;
    const frame = { cx: 300, cy: 320, s: 1.2 };
    let finish!: (status: { stage: "install-xcode" }) => void;
    const native = {
      check: vi.fn(
        () =>
          new Promise<{ stage: "install-xcode" }>((resolve) => {
            finish = resolve;
          }),
      ),
      open: vi.fn(),
    };
    const h = host(
      async () => [],
      "",
      native,
      () => ({ entity, landing: false, frame }),
    );
    const dialog = h.container.querySelector("dialog")!;
    expect(dialog.open && dialog.hasAttribute("data-held")).toBe(true);
    const left = Number.parseFloat(dialog.style.left);
    frame.cx += 40;
    h.setup.follow(entity);
    expect(Number.parseFloat(dialog.style.left)).toBeCloseTo(left + 40);
    h.setup.follow(undefined);
    finish({ stage: "install-xcode" });
    await Promise.resolve();
    expect(dialog.open).toBe(false);
    expect(native.open).not.toHaveBeenCalled();
    h.setup.dispose();
  });

  it("gives an actionable repair for license or selection, and no install action on unsupported hosts", async () => {
    const native = {
      check: vi
        .fn<NonNullable<SimulatorDevices["setup"]>["check"]>()
        .mockResolvedValueOnce({ stage: "select-xcode" })
        .mockResolvedValueOnce({ stage: "accept-license" })
        .mockResolvedValueOnce({ stage: "unsupported" }),
      open: vi.fn(),
    };
    const h = host(async () => [], "", native);
    await vi.waitFor(() =>
      expect(h.container.querySelector('[aria-current="step"]')?.textContent).toContain(
        "Command Line Tools",
      ),
    );
    h.act("[data-refresh]").click();
    await vi.waitFor(() =>
      expect(h.container.querySelector('[aria-current="step"]')?.textContent).toContain("license"),
    );
    h.act("[data-refresh]").click();
    await vi.waitFor(() => expect(h.act("[data-primary]").hidden).toBe(true));
    expect(h.container.querySelector("[role=status]")?.textContent).toContain("on a Mac");
    h.setup.dispose();
  });
});
