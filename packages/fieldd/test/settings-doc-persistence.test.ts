// DS-5b × DS-5c (DS wave 2 landing, 2026-10-01) — the SETTINGS document's file
// through the shared system-document writer (`system-doc-file.ts`, built for the
// library by w2-host). The settings document rides the Loro host since DS-5b, so
// the host's merge persist (`hostOwner().persist`) and a local write's persist
// can run together; `persistNow` used to write one fixed `doc.loro.tmp` with no
// queue and no fsync, and `init()` read a torn file as FIRST BOOT — an empty
// document, every PA-32 revocation stamp included (w2-settings' find, 02:47).
//   · a local persist and a merge persist never interleave, and neither loses
//     the other's change (the write that waited exports when it RUNS);
//   · a torn file falls back to the last good copy, never to an empty document.
// The interleaving is forced, not hoped for, exactly as library-doc-persistence
// forces it: the FIRST armed content write of the settings file is parked until
// the row releases it — whether it is made by `writeFile` or a FileHandle.
import { mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDocService } from "../src/settings-doc";

const gate = vi.hoisted(() => ({
  armed: false,
  release: null as null | (() => void),
}));

/** Park the first armed content write of the settings file; pass the rest. */
function held<T>(path: string, write: () => Promise<T>): Promise<T> {
  if (!gate.armed || gate.release !== null || !path.includes(join("settings", "doc.loro")))
    return write();
  return new Promise<T>((resolve, reject) => {
    gate.release = () => {
      write().then(resolve, reject);
    };
  });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const writeFile = ((path: Parameters<typeof actual.writeFile>[0], ...rest: unknown[]) =>
    held(String(path), () =>
      (actual.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest),
    )) as typeof actual.writeFile;
  const open = (async (
    path: Parameters<typeof actual.open>[0],
    flags?: unknown,
    mode?: unknown,
  ) => {
    const handle = await (actual.open as (...a: unknown[]) => Promise<FsPromises.FileHandle>)(
      path,
      flags,
      mode,
    );
    const writeHandle = handle.writeFile.bind(handle);
    handle.writeFile = ((...args: Parameters<typeof handle.writeFile>) =>
      held(String(path), () => writeHandle(...args))) as typeof handle.writeFile;
    return handle;
  }) as typeof actual.open;
  return { ...actual, writeFile, open, default: { ...actual, writeFile, open } };
});

let dirs: string[] = [];
afterEach(() => {
  gate.armed = false;
  gate.release = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "vf-sdoc-file-"));
  dirs.push(d);
  return d;
}
const settingsFile = (dataDir: string) => join(dataDir, ...LAYOUT.SETTINGS_DOC);
const settingsDir = (dataDir: string) => join(dataDir, ...LAYOUT.SETTINGS_DOC.slice(0, -1));

async function until(predicate: () => boolean, label: string, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("DS-5b × DS-5c — the settings document's file: one writer, fsync'd, the last good copy kept", () => {
  it("a local persist interleaved with a merge persist loses neither", async () => {
    const dataDir = tmp();
    const settings = new SettingsDocService({ dataDir });
    await settings.setAppValue("theme", "dark", "test"); // the file exists

    // Another desktop's settings, merged as the host merges them.
    const peer = new SettingsDocService({ dataDir: tmp() });
    await peer.setAppValue("desktop.showTray", false, "peer");

    gate.armed = true;
    // 1. A LOCAL write: its commit lands in memory, its file write is parked.
    const local = settings.setAppValue("theme", "light", "test");
    await until(() => gate.release !== null, "the local write to be parked");
    // 2. The peer's update MERGES meanwhile, and the host persists it.
    settings
      .hostDoc()
      .import(peer.hostDoc().export({ mode: "update", from: settings.hostDoc().oplogVersion() }));
    const merge = settings.hostOwner().persist();
    await Promise.race([merge.catch(() => undefined), new Promise((r) => setTimeout(r, 150))]);
    // 3. The parked write goes through.
    gate.release?.();
    const settled = await Promise.allSettled([local, merge]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
    await settings.dispose();

    // What a restart reads holds BOTH: the local change and the merged one.
    const reloaded = new SettingsDocService({ dataDir });
    expect(await reloaded.appValues()).toEqual({ theme: "light", "desktop.showTray": false });
    await reloaded.dispose();
    await peer.dispose();
  });

  it("a torn file falls back to the last good copy — never to an empty document", async () => {
    const dataDir = tmp();
    const settings = new SettingsDocService({ dataDir });
    await settings.setAppValue("theme", "dark", "test");
    await settings.setAppValue("desktop.showTray", false, "test"); // the newest write
    await settings.dispose();
    const file = settingsFile(dataDir);
    truncateSync(file, Math.floor(readFileSync(file).byteLength / 2));

    const reloaded = new SettingsDocService({ dataDir });
    // the last good copy: everything but the newest write — not first boot
    expect(await reloaded.appValues()).toEqual({ theme: "dark" });
    // the torn file is kept as evidence, out of the rotation
    expect(readdirSync(settingsDir(dataDir)).some((f) => f.startsWith("doc.loro.torn-"))).toBe(
      true,
    );
    await reloaded.dispose();
  });
});
