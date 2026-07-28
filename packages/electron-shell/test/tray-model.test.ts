import { describe, expect, it, vi } from "vitest";
import {
  buildTrayMenu,
  type TrayActions,
  type TraySnapshot,
  type TrayUpdateState,
} from "../src/main/tray-model";

const snapshot = (patch: Partial<TraySnapshot> = {}): TraySnapshot => ({
  link: "ready",
  evidence: "healthy",
  update: { kind: "idle" },
  backgroundShell: true,
  showTray: true,
  windowOpen: true,
  quitting: false,
  ...patch,
});

function actions(): TrayActions {
  return {
    openPrimaryWindow: vi.fn(),
    openSettings: vi.fn(),
    openDiagnostics: vi.fn(),
    checkForUpdates: vi.fn(),
    restartToUpdate: vi.fn(),
    setBackgroundShell: vi.fn(),
    setTrayVisible: vi.fn(),
    quit: vi.fn(),
  };
}

const byId = (items: ReturnType<typeof buildTrayMenu>, id: string) => {
  const item = items.find((candidate) => candidate.id === id);
  expect(item, `missing tray item ${id}`).toBeDefined();
  if (item === undefined) throw new Error(`missing tray item ${id}`);
  return item;
};

describe("buildTrayMenu", () => {
  it("projects the exact Windows/Linux ordering and check states", () => {
    const menu = buildTrayMenu(snapshot(), actions(), "win32");
    expect(menu.map((item) => item.id ?? item.type)).toEqual([
      "open",
      "status",
      "settings",
      "diagnostics",
      "update",
      "separator",
      "background-shell",
      "show-tray",
      "separator",
      "quit",
    ]);
    expect(byId(menu, "background-shell").checked).toBe(true);
    expect(byId(menu, "show-tray").checked).toBe(true);
  });

  it("omits the inapplicable background toggle on macOS", () => {
    const menu = buildTrayMenu(snapshot(), actions(), "darwin");
    expect(menu.some((item) => item.id === "background-shell")).toBe(false);
    expect(menu.some((item) => item.id === "show-tray")).toBe(true);
    for (const item of menu) expect(item.enabled).toBeUndefined();
    expect(byId(menu, "status").click).toBeUndefined();
  });

  it.each([
    ["starting", "healthy", "Field service: Starting…"],
    ["ready", "healthy", "Field service: Ready"],
    ["ready", "degraded", "Field service: Ready — diagnostics need attention"],
    ["reconnecting", "healthy", "Field service: Reconnecting…"],
    ["unavailable", "healthy", "Field service: Unavailable"],
  ] as const)("renders %s/%s as %s", (link, evidence, expected) => {
    const menu = buildTrayMenu(snapshot({ link, evidence }), actions(), "linux");
    expect(byId(menu, "status")).toMatchObject({ label: expected, enabled: false });
  });

  it.each([
    [{ kind: "idle" }, "Check for Updates…", true],
    [{ kind: "checking" }, "Checking for Updates…", false],
    [{ kind: "downloading", percent: 41.6 }, "Downloading Update… 42%", false],
    [{ kind: "ready", version: "2.0.0" }, "Restart to Update", true],
    [{ kind: "failed" }, "Update Check Failed", false],
  ] satisfies readonly (readonly [TrayUpdateState, string, boolean])[])(
    "projects update state $kind",
    (update, label, enabled) => {
      const menu = buildTrayMenu(snapshot({ update }), actions(), "linux");
      expect(byId(menu, "update")).toMatchObject({ label, enabled });
    },
  );

  it("honestly disables the idle update item when no updater capability exists", () => {
    const a = actions();
    delete a.checkForUpdates;
    const menu = buildTrayMenu(snapshot(), a, "linux");
    expect(byId(menu, "update")).toMatchObject({
      label: "Check for Updates…",
      enabled: false,
    });
  });

  it("disables every actionable item while quitting", () => {
    const menu = buildTrayMenu(snapshot({ quitting: true }), actions(), "win32");
    for (const item of menu) {
      if (item.type !== "separator") expect(item.enabled).toBe(false);
    }
  });

  it("removes every macOS click handler while quitting instead of relying on enabled", () => {
    const menu = buildTrayMenu(snapshot({ quitting: true }), actions(), "darwin");
    for (const item of menu) {
      expect(item.enabled).toBeUndefined();
      expect(item.click).toBeUndefined();
    }
  });

  it("inverts preference actions from the rendered snapshot", () => {
    const a = actions();
    const menu = buildTrayMenu(snapshot({ backgroundShell: false, showTray: true }), a, "linux");
    byId(menu, "background-shell").click?.();
    byId(menu, "show-tray").click?.();
    expect(a.setBackgroundShell).toHaveBeenCalledWith(true);
    expect(a.setTrayVisible).toHaveBeenCalledWith(false);
  });
});
