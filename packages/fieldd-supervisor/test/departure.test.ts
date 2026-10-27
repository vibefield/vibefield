import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { awaitDeparture, productPath } from "../src/index";

// AL-3 / WP12 D10 — `awaitDeparture`, the ONE "has that daemon left this root" wait (the replace path's, and a quit's
// before the shell exits, so a relaunch never adopts a fieldd on its way out). Gone = no run file, or another boot's.

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function rootWith(bootId: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "vf-depart-"));
  roots.push(root);
  if (bootId !== null) record(root, bootId);
  return root;
}

function record(root: string, bootId: string): void {
  const path = productPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      port: 4242,
      pid: 4242,
      bootId,
      contractsVersion: CONTRACTS_VERSION,
      startedAt: Date.now(),
      nativePid: null,
    }),
  );
}

describe("awaitDeparture (AL-3)", () => {
  it("a root with no run file has been left already", async () => {
    await expect(awaitDeparture(rootWith(null), "boot-a", 200)).resolves.toBe(true);
  });

  it("the run file going is a departure", async () => {
    const root = rootWith("boot-a");
    setTimeout(() => rmSync(productPath(root)), 60);
    await expect(awaitDeparture(root, "boot-a", 2_000, { pollMs: 20 })).resolves.toBe(true);
  });

  it("another boot's run file in its place is a departure", async () => {
    const root = rootWith("boot-a");
    setTimeout(() => record(root, "boot-b"), 60);
    await expect(awaitDeparture(root, "boot-a", 2_000, { pollMs: 20 })).resolves.toBe(true);
  });

  it("a daemon still recorded when the bound passes has not left", async () => {
    await expect(awaitDeparture(rootWith("boot-a"), "boot-a", 120, { pollMs: 20 })).resolves.toBe(
      false,
    );
  });

  it("an aborted wait ends at once, not left", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      awaitDeparture(rootWith("boot-a"), "boot-a", 5_000, { signal: abort.signal }),
    ).resolves.toBe(false);
  });
});
