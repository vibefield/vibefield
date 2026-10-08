import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectIdentityFile } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectIdentityStore } from "../src/project-identity";

// MV-3a (L4) — the project colour's identity on disk: a deal persists across a
// reload, the counter never rewinds, a record this fieldd cannot read is set
// aside, and the file is private.

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-project-identity-"));
  dirs.push(dir);
  return dir;
}

describe("the project identity store (L4)", () => {
  it("deals from 0 in first-seen order, keeps a key's sequence, and reloads the same deals", () => {
    const file = join(scratch(), "fieldd", "project-identity.json");
    const store = createProjectIdentityStore({ file });
    expect(store.deal("/repo/a")).toBe(0);
    expect(store.deal("/repo/b")).toBe(1);
    expect(store.deal("/repo/a")).toBe(0);
    expect(store.seq("/repo/c")).toBeUndefined();
    expect(store.next()).toBe(2);
    // the file is the contract's shape, and private
    const written = ProjectIdentityFile.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(written).toEqual({
      version: 1,
      next: 2,
      projects: [
        { key: "/repo/a", seq: 0 },
        { key: "/repo/b", seq: 1 },
      ],
    });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    // a restart deals the same colours
    const reloaded = createProjectIdentityStore({ file });
    expect(reloaded.seq("/repo/b")).toBe(1);
    expect(reloaded.deal("/repo/c")).toBe(2);
    expect(reloaded.deal("/repo/a")).toBe(0);
  });

  it("keeps `next` past the bound: a dropped key that returns is dealt afresh, never a retired sequence", () => {
    const file = join(scratch(), "project-identity.json");
    const store = createProjectIdentityStore({ file, maxKeys: 2 });
    store.deal("/one");
    store.deal("/two");
    store.deal("/three");
    const written = ProjectIdentityFile.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(written.projects.map((entry) => entry.key)).toEqual(["/two", "/three"]);
    expect(written.next).toBe(3);
    const reloaded = createProjectIdentityStore({ file, maxKeys: 2 });
    expect(reloaded.deal("/one")).toBe(3);
    expect(reloaded.seq("/three")).toBe(2);
  });

  it("sets aside a record it cannot read and starts afresh, said once; an absent file is empty", () => {
    const dir = scratch();
    const file = join(dir, "project-identity.json");
    writeFileSync(file, '{"version": 7, "projects": "no"}');
    const warned: string[] = [];
    const logger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: (event: string) => {
        warned.push(event);
      },
      error: () => undefined,
      fatal: () => undefined,
      isLevelEnabled: () => false,
    };
    const store = createProjectIdentityStore({ file, logger, now: () => 42 });
    expect(warned).toEqual(["fieldd.monitor.identity_set_aside"]);
    expect(store.next()).toBe(0);
    expect(readFileSync(`${file}.unreadable-42`, "utf8")).toContain('"version": 7');
    expect(store.deal("/fresh")).toBe(0);
    expect(createProjectIdentityStore({ file: join(dir, "missing.json") }).next()).toBe(0);
  });

  it("with no file it is the memory store", () => {
    const store = createProjectIdentityStore();
    expect(store.deal("/a")).toBe(0);
    expect(store.deal("/b")).toBe(1);
    expect([...store.entries()]).toEqual([
      ["/a", 0],
      ["/b", 1],
    ]);
  });
});
