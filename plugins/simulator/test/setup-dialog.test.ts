// @vitest-environment happy-dom
import type { Entity, ObjectDomHost, SimulatorDevices } from "@vibefield/plugin-sdk/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountSimulatorSetup } from "../src/setup-dialog";

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

function host(
  configurations: NonNullable<SimulatorDevices["configurations"]>,
  initial = "",
  native?: SimulatorDevices["setup"],
  hand?: ObjectDomHost["hand"],
) {
  const container = document.createElement("div");
  document.body.append(container);
  let key = "phone-a";
  let values: Record<string, unknown> = {
    model: pro.deviceType,
    binding: initial,
    finish: "silver",
  };
  const write = vi.fn((_cell: unknown, patch: typeof values) => {
    values = patch;
  });
  const store = {
    keyOf: () => key,
    transaction: (fn: (tx: unknown) => void) => fn({ edit: () => ({ set: write }) }),
  };
  const dom = {
    container,
    hand: hand ?? (() => undefined),
    world: { get: () => values },
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
  setup.configure([1 as Entity]);
  const field = (name: string) =>
    container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const act = (name: string) => container.querySelector<HTMLButtonElement>(name)!;
  const choose = (name: string, value: string) => {
    field(name).value = value;
    field(name).dispatchEvent(new Event("change"));
  };
  return {
    setup,
    container,
    write,
    field,
    act,
    choose,
    values: () => values,
    replacePhone: () => {
      key = "other";
    },
  };
}
afterEach(() => {
  document.body.replaceChildren();
});
describe("simulator setup", () => {
  it("filters models on version change, creates a dedicated phone, and skips an unchanged config", async () => {
    const h = host(async () => [recent, old]);
    await vi.waitFor(() => expect(h.field("runtime").disabled).toBe(false));
    expect(h.field("model").value).toBe(pro.deviceType);
    h.choose("runtime", old.runtime);
    expect(Array.from(h.field("model").options).map((o) => o.text)).toEqual([thirteen.name]);
    h.act("[type=submit]").click();
    expect(h.values().model).toBe(thirteen.deviceType);
    expect(h.values().finish).toBe("silver");
    expect(JSON.parse(String(h.values().binding))).toEqual({
      deviceType: thirteen.deviceType,
      runtime: old.runtime,
      dedicated: true,
    });
    h.setup.configure([1 as Entity]);
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
    await vi.waitFor(() => expect(h.field("runtime").disabled).toBe(false));
    expect(h.field("runtime").value).toBe("");
    expect(h.field("runtime").options[0]?.text).toContain("18.6");
    expect(h.act("[type=submit]").disabled).toBe(true);
    h.choose("runtime", recent.runtime);
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
    h.act("[data-refresh]").click();
    await vi.waitFor(() => expect(h.field("runtime").value).toBe(old.runtime));
    expect(h.act("[type=submit]").disabled).toBe(false);
    h.act("[data-cancel]").click();
    expect(h.write).not.toHaveBeenCalled();
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
      expect(native.open).not.toHaveBeenCalled();
      h.act("[data-primary]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(native.open).toHaveBeenCalledWith("app-store");
      state = { stage: "install-runtime", xcodeVersion: "26.6" };
      await vi.advanceTimersByTimeAsync(2100);
      expect(step()).toBe("Install an iOS runtime");
      expect(h.container.querySelector('[data-state="complete"]')?.textContent).toContain(
        "Xcode 26.6",
      );
      expect(h.act("[data-primary]").textContent).toBe("Open Xcode");
      h.act("[data-primary]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(native.open).toHaveBeenCalledWith("xcode");
      state = { stage: "ready", configurations: [recent, old], xcodeVersion: "26.6" };
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.field("runtime").value).toBe(recent.runtime);
      expect(h.act("[type=submit]").textContent).toBe("Create simulator");
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
