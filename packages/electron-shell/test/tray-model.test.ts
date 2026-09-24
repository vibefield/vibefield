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
  it("offers a screenshot when a helper exists, and releases the action while quitting", () => {
    const takeScreenshot = vi.fn();
    const a = { ...actions(), takeScreenshot };
    byId(buildTrayMenu(snapshot(), a, "darwin"), "screenshot").click?.();
    expect(takeScreenshot).toHaveBeenCalledTimes(1);
    expect(
      byId(buildTrayMenu(snapshot({ quitting: true }), a, "darwin"), "screenshot").click,
    ).toBeUndefined();
    expect(
      buildTrayMenu(snapshot(), actions(), "darwin").some((item) => item.id === "screenshot"),
    ).toBe(false);
  });
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

describe("the Switch User submenu (UA-5)", () => {
  const users = [
    { userId: "01AAA", name: "James", attached: true },
    { userId: "01BBB", name: "Work", attached: false },
  ];

  it("renders the roster: attached checked and inert, others clickable, New User last", () => {
    const acts = { ...actions(), switchUser: vi.fn(), newUser: vi.fn() };
    const menu = buildTrayMenu(snapshot({ userName: "James", users }), acts, "darwin");
    const sub = byId(menu, "switch-user").submenu ?? [];
    expect(sub.map((s) => s.id ?? s.type)).toEqual([
      "switch-user-01AAA",
      "switch-user-01BBB",
      "separator",
      "new-user",
    ]);
    expect(sub[0]?.checked).toBe(true);
    expect(sub[0]?.enabled).toBe(false);
    expect(sub[0]?.click).toBeUndefined();
    expect(sub[1]?.checked).toBe(false);
    sub[1]?.click?.();
    expect(acts.switchUser).toHaveBeenCalledWith("01BBB");
    sub[3]?.click?.();
    expect(acts.newUser).toHaveBeenCalledTimes(1);
  });

  it("hides the submenu without a roster or without the action (older callers)", () => {
    const withoutAction = buildTrayMenu(snapshot({ users }), actions(), "darwin");
    expect(withoutAction.some((i) => i.id === "switch-user")).toBe(false);
    const acts = { ...actions(), switchUser: vi.fn() };
    const withoutRoster = buildTrayMenu(snapshot(), acts, "darwin");
    expect(withoutRoster.some((i) => i.id === "switch-user")).toBe(false);
  });

  it("quitting strips every switch click", () => {
    const acts = { ...actions(), switchUser: vi.fn(), newUser: vi.fn() };
    const menu = buildTrayMenu(snapshot({ users, quitting: true }), acts, "darwin");
    const sub = byId(menu, "switch-user").submenu ?? [];
    expect(sub.length).toBeGreaterThan(0);
    expect(sub.every((s) => s.click === undefined)).toBe(true);
  });
});

describe("the face in the tray (UA-7)", () => {
  // DESIGN.md §2.8: the emoji leads the item's label, and the name sits beside
  // it (I-4). A native menu draws no frame, so only the emoji travels.
  const faced = [
    { userId: "01AAA", name: "James", face: "🦊", attached: true },
    { userId: "01BBB", name: "Work", face: "🐙", attached: false },
  ];

  it("leads the user row with the attached user's face", () => {
    const menu = buildTrayMenu(snapshot({ userName: "James", userFace: "🦊" }), actions(), "linux");
    expect(byId(menu, "user")).toMatchObject({ label: "🦊 James", enabled: false });
  });

  it("keeps the old label when no face travels (older callers)", () => {
    const menu = buildTrayMenu(snapshot({ userName: "James" }), actions(), "linux");
    expect(byId(menu, "user").label).toBe("User: James");
  });

  it("a face alone shows no row: the name is what the row is for", () => {
    const menu = buildTrayMenu(snapshot({ userFace: "🦊" }), actions(), "linux");
    expect(menu.some((item) => item.id === "user")).toBe(false);
  });

  it("leads every Switch User row with that user's face", () => {
    const acts = { ...actions(), switchUser: vi.fn(), newUser: vi.fn() };
    const menu = buildTrayMenu(
      snapshot({ userName: "James", userFace: "🦊", users: faced }),
      acts,
      "darwin",
    );
    const sub = byId(menu, "switch-user").submenu ?? [];
    expect(sub.slice(0, 2).map((s) => s.label)).toEqual(["🦊 James", "🐙 Work"]);
    // the face changes the words, never the behaviour
    expect(sub[0]).toMatchObject({ checked: true, enabled: false });
    sub[1]?.click?.();
    expect(acts.switchUser).toHaveBeenCalledWith("01BBB");
  });

  it("a row without a face is the bare name", () => {
    const acts = { ...actions(), switchUser: vi.fn() };
    const menu = buildTrayMenu(
      snapshot({ users: [{ userId: "01CCC", name: "Lab", attached: false }] }),
      acts,
      "darwin",
    );
    expect(byId(menu, "switch-user").submenu?.[0]?.label).toBe("Lab");
  });
});
