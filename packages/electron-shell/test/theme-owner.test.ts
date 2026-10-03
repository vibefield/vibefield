import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS, type ThemePreference, type ThemeState } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreloadThemeStateBridge } from "../src/preload/theme";

// The app's ONE theme (One Frame FR-4, FC-D5): three states, one owner — main's —
// Auto following the OS through `nativeTheme`, projected back into it, kept in
// the shell's profile, and told to every window. These pin what the Me menu's
// Theme, Settings → Appearance and Godview all rely on.

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));
const { fileThemeStore, THEME_FILE, ThemeOwner } = await import("../src/main/theme");
const { registerThemeSet } = await import("../src/main/ipc");

/** Electron's `nativeTheme`, faked faithfully: `shouldUseDarkColors` is the OS
 * under "system" and the source itself otherwise, and `updated` fires when
 * either moves. */
function fakeNative(osDark = false) {
  const listeners = new Set<() => void>();
  const fake = {
    osDark,
    source: "system" as "system" | "light" | "dark",
    get themeSource() {
      return fake.source;
    },
    set themeSource(next: "system" | "light" | "dark") {
      fake.source = next;
      for (const fn of listeners) fn();
    },
    get shouldUseDarkColors() {
      return fake.source === "system" ? fake.osDark : fake.source === "dark";
    },
    on: (_event: "updated", fn: () => void) => listeners.add(fn),
    removeListener: (_event: "updated", fn: () => void) => listeners.delete(fn),
    /** The OS changes its appearance. */
    flip(dark: boolean) {
      fake.osDark = dark;
      for (const fn of listeners) fn();
    },
    listeners,
  };
  return fake;
}

function memoryStore(kept: ThemePreference | null = null) {
  const store = {
    kept,
    writes: [] as ThemePreference[],
    read: () => store.kept,
    write: (preference: ThemePreference) => {
      store.kept = preference;
      store.writes.push(preference);
    },
  };
  return store;
}

function fakeContents(id = 1) {
  const fake = {
    id,
    destroyed: false,
    sent: [] as ThemeState[],
    on: new Map<string, () => void>(),
    once: new Map<string, () => void>(),
  };
  const contents = {
    id,
    isDestroyed: () => fake.destroyed,
    send: (channel: string, payload: ThemeState) => {
      if (channel === IPC_CHANNELS.themeState) fake.sent.push(payload);
    },
    on: (event: string, fn: () => void) => fake.on.set(event, fn),
    once: (event: string, fn: () => void) => fake.once.set(event, fn),
  } as unknown as WebContents;
  return { contents, fake };
}

describe("ThemeOwner — one value, three states", () => {
  it("starts on Auto when nothing was chosen — the OS's theme, as the page read it before", () => {
    const native = fakeNative(true);
    const owner = new ThemeOwner(native, memoryStore());
    expect(owner.current()).toEqual({ preference: "auto", resolved: "dark" });
    expect(native.themeSource).toBe("system");
  });

  it("starts from the choice it kept, and projects it into nativeTheme", () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore("dark"));
    expect(owner.current()).toEqual({ preference: "dark", resolved: "dark" });
    // The projection is what makes the page's prefers-color-scheme — and the
    // window's native chrome — agree from the first frame.
    expect(native.themeSource).toBe("dark");
  });

  it("chooses by name: keeps, projects and answers each of the three", () => {
    const native = fakeNative(false);
    const store = memoryStore();
    const owner = new ThemeOwner(native, store);
    expect(owner.set("dark")).toEqual({ preference: "dark", resolved: "dark" });
    expect(native.themeSource).toBe("dark");
    expect(owner.set("light")).toEqual({ preference: "light", resolved: "light" });
    expect(native.themeSource).toBe("light");
    expect(owner.set("auto")).toEqual({ preference: "auto", resolved: "light" });
    expect(native.themeSource).toBe("system");
    expect(store.writes).toEqual(["dark", "light", "auto"]);
    // An unchanged choice is answered, and not written again.
    owner.set("auto");
    expect(store.writes).toHaveLength(3);
  });

  it("follows a flipped nativeTheme on Auto, and tells every window", () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore("auto"));
    const { contents, fake } = fakeContents();
    owner.watch(contents);
    native.flip(true);
    expect(owner.current()).toEqual({ preference: "auto", resolved: "dark" });
    expect(fake.sent).toEqual([{ preference: "auto", resolved: "dark" }]);
    native.flip(false);
    expect(fake.sent.at(-1)).toEqual({ preference: "auto", resolved: "light" });
  });

  it("stays put on an explicit choice when the OS flips — and says nothing", () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore("light"));
    const { contents, fake } = fakeContents();
    owner.watch(contents);
    native.flip(true);
    expect(owner.current()).toEqual({ preference: "light", resolved: "light" });
    expect(fake.sent).toEqual([]);
  });

  it("tells a window on every load (a reload included) and every change — never a destroyed one", () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore());
    const { contents, fake } = fakeContents();
    owner.watch(contents);
    owner.watch(contents); // idempotent
    fake.on.get("did-finish-load")?.();
    expect(fake.sent).toEqual([{ preference: "auto", resolved: "light" }]);
    owner.set("dark");
    expect(fake.sent.at(-1)).toEqual({ preference: "dark", resolved: "dark" });
    expect(fake.sent).toHaveLength(2);
    fake.destroyed = true;
    owner.set("light");
    expect(fake.sent).toHaveLength(2);
    // …and a buried window is forgotten.
    fake.once.get("destroyed")?.();
    fake.destroyed = false;
    owner.set("dark");
    expect(fake.sent).toHaveLength(2);
  });

  it("lets go of nativeTheme when disposed", () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore());
    expect(native.listeners.size).toBe(1);
    owner.dispose();
    expect(native.listeners.size).toBe(0);
  });
});

describe("fileThemeStore — the shell's profile", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const fresh = (): string => {
    const root = mkdtempSync(join(tmpdir(), "vf-theme-"));
    roots.push(root);
    return join(root, THEME_FILE);
  };

  it("reads nothing as no choice, keeps a choice, and reads it back", () => {
    const path = fresh();
    const store = fileThemeStore(path);
    expect(store.read()).toBeNull();
    store.write("dark");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ preference: "dark" });
    expect(store.read()).toBe("dark");
  });

  it("reads anything it cannot parse as no choice (a tolerant reader)", () => {
    const path = fresh();
    for (const raw of ["not json", "[]", '{"preference":"sepia"}', '{"dark":true}']) {
      writeFileSync(path, raw);
      expect(fileThemeStore(path).read()).toBeNull();
    }
  });
});

describe("the theme door (ipc)", () => {
  it("lets a registered window choose, tells it from then on, and refuses a stranger", async () => {
    const native = fakeNative(false);
    const owner = new ThemeOwner(native, memoryStore());
    const { contents, fake } = fakeContents(5);
    const registry = { owns: (sender: unknown) => sender === contents };
    registerThemeSet(registry as never, owner);
    const handle = handlers.get(IPC_CHANNELS.themeSet);
    expect(await handle?.({ sender: contents }, { preference: "dark" })).toEqual({
      preference: "dark",
      resolved: "dark",
    });
    // Asking watched it: the next change reaches it without a reload.
    native.flip(true);
    owner.set("auto");
    expect(fake.sent.at(-1)).toEqual({ preference: "auto", resolved: "dark" });
    await expect(handle?.({ sender: { id: 9 } }, { preference: "light" })).rejects.toThrow(
      /unregistered sender/,
    );
    // A flip, not a name, is not a request.
    await expect(handle?.({ sender: contents }, { dark: true })).rejects.toThrow();
  });
});

describe("PreloadThemeStateBridge", () => {
  it("keeps the latest valid state for a late subscriber and refuses a malformed one", () => {
    const rejected = vi.fn();
    const bridge = new PreloadThemeStateBridge(rejected);
    bridge.accept({ preference: "auto", resolved: "light" });
    bridge.accept({ preference: "dark", resolved: "dark" });
    bridge.accept({ dark: true });
    expect(rejected).toHaveBeenCalledOnce();
    const handler = vi.fn();
    const stop = bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledWith({ preference: "dark", resolved: "dark" });
    stop();
    bridge.accept({ preference: "light", resolved: "light" });
    expect(handler).toHaveBeenCalledOnce();
  });
});
