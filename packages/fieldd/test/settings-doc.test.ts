import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsDocService } from "../src/settings-doc";

// PLUG-P7 — the D29′ system settings doc: fieldd's first live Loro doc.
// This suite pins the three D29′ laws mechanically (design-03 §7.2):
// coverage honesty is the settings suite's (secrets/device never enter);
// law 2 (undo never re-escalates) and law 3 (honest horizon) are here,
// plus migration and restart durability.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const ID = "vibefield.fixture.docs";

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-sdoc-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function make(dataDir: string): SettingsDocService {
  const svc = new SettingsDocService({ dataDir });
  cleanup.push(() => svc.dispose());
  return svc;
}

describe("the system settings doc (D29′)", () => {
  it("persists writes durably and reloads them in a fresh instance (history intact)", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    await a.setUserValue(ID, "greeting", "howdy", "test");
    await a.setAppValue("theme", "dark", "test");
    expect(existsSync(join(dataDir, "fieldd", "settings", "doc.loro"))).toBe(true);
    await a.dispose();

    const b = make(dataDir);
    expect(await b.userValues(ID)).toEqual({ greeting: "howdy" });
    expect(await b.appValues()).toEqual({ theme: "dark" });
  });

  it("publishes app writes and generic user undo so desktop subscribers refresh", async () => {
    const svc = make(tempDataDir());
    const sections: string[] = [];
    svc.on("changed", (event: { section: string }) => sections.push(event.section));
    await svc.setAppValue("desktop.showTray", false, "pane");
    expect(await svc.appValues()).toEqual({ "desktop.showTray": false });
    expect(await svc.undo()).toEqual({ applied: true });
    expect(await svc.appValues()).toEqual({});
    expect(sections).toEqual(["app", "settings"]);
  });

  it("migrates P5's settings-user.json once, doc values winning, file renamed aside", async () => {
    const dataDir = tempDataDir();
    mkdirSync(join(dataDir, "fieldd", "plugins"), { recursive: true });
    const legacy = join(dataDir, "fieldd", "plugins", "settings-user.json");
    writeFileSync(
      legacy,
      JSON.stringify({ version: 1, plugins: { [ID]: { greeting: "from-json", extra: 7 } } }),
    );
    const svc = make(dataDir);
    expect(await svc.userValues(ID)).toEqual({ greeting: "from-json", extra: 7 });
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}.migrated`)).toBe(true);
    // the migration is OUTSIDE the undo stack (origin "migrate:")
    expect(await svc.undo()).toEqual({ applied: false, reason: "empty-stack" });
  });

  it("law 2 — undo reverts settings but NEVER an interleaved install-set write", async () => {
    const dataDir = tempDataDir();
    const svc = make(dataDir);
    await svc.setUserValue(ID, "volume", 3, "pane");
    await svc.setInstallSetEntry(
      {
        pluginId: "vibefield.example",
        source: "registry",
        version: "1.0.0",
        artifactSha256: `sha256:${"ab".repeat(32)}`,
        enabled: true,
        grants: [{ capability: "storage.self", decision: "revoked", at: 1 }],
      },
      "reconciler",
    );
    await svc.setUserValue(ID, "volume", 9, "pane");

    // first undo: the volume=9 write reverts; the install-set (with its
    // REVOKED grant) is untouched — undo never re-escalates
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBe(3);
    const set = await svc.installSet();
    expect(set["vibefield.example"]?.grants[0]?.decision).toBe("revoked");

    // second undo: volume=3 reverts too; the install-set STILL stands
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBeUndefined();
    expect((await svc.installSet())["vibefield.example"]?.enabled).toBe(true);

    // redo restores the setting; the install-set never moved
    expect(await svc.redo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBe(3);
  });

  it("law 3 — the horizon is honest: an empty stack says so, and a fresh boot starts clean", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    expect(await a.undo()).toEqual({ applied: false, reason: "empty-stack" });
    await a.setUserValue(ID, "greeting", "hi", "pane");
    await a.dispose();

    // v1 ceiling (two-plane law): the undo stack is daemon-lifetime — a fresh
    // instance holds the VALUE but not the stack
    const b = make(dataDir);
    expect(await b.userValues(ID)).toEqual({ greeting: "hi" });
    expect(await b.undo()).toEqual({ applied: false, reason: "empty-stack" });
  });

  it("tolerant reader — a malformed install-set entry is skipped, never fatal", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    await a.setInstallSetEntry(
      {
        pluginId: "vibefield.good",
        source: "bundled",
        enabled: true,
        grants: [],
      },
      "test",
    );
    // corrupt the doc's install-set section via a raw write from a second
    // instance is not possible without the API — simulate by writing a bogus
    // entry through the same map path (the schema gate is at READ)
    const raw = a as unknown as {
      doc: { getMap(n: string): { set(k: string, v: unknown): void }; commit(o: object): void };
    };
    raw.doc.getMap("installSet").set("vibefield.bad", { not: "an entry" });
    raw.doc.commit({ origin: "no-undo:test" });
    const set = await a.installSet();
    expect(Object.keys(set)).toEqual(["vibefield.good"]);
  });

  it("the doc file never contains device/secret material by construction (law 1 lives in the settings service; the doc only ever receives user-scope writes)", async () => {
    const dataDir = tempDataDir();
    const svc = make(dataDir);
    await svc.setUserValue(ID, "public", "value", "pane");
    const bytes = readFileSync(join(dataDir, "fieldd", "settings", "doc.loro"));
    // sanity: the snapshot holds the user value and nothing else was routed in
    expect(bytes.length).toBeGreaterThan(0);
    expect(await svc.userValues(ID)).toEqual({ public: "value" });
  });
});
