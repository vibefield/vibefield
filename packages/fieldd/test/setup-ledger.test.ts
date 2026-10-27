import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SetupLedger, setupStepState } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupLedgerStore } from "../src/setup-ledger";

// AO-2 — the Setup Assistant's ledger on disk (design-03 §4.3's `setup.*`): a
// person's answers survive a restart, the same answer is written once, a newer
// build's rows are never erased, a ledger this fieldd cannot read is set aside
// rather than overwritten, and the file is private.

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function ledgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-setup-ledger-"));
  dirs.push(dir);
  return join(dir, "fieldd", "setup.json");
}

const at = (iso: string) => () => new Date(iso);

describe("the setup ledger store (AO-2)", () => {
  it("starts empty with no file, and writes nothing until a step is answered", () => {
    const path = ledgerPath();
    const store = new SetupLedgerStore({ path });
    expect(store.snapshot()).toEqual({ format: 1, steps: {}, hidden: false });
    expect(existsSync(path)).toBe(false);
  });

  it("records an answer, keeps it across a restart, and writes the same answer once", () => {
    const path = ledgerPath();
    const store = new SetupLedgerStore({ path, now: at("2026-10-27T05:41:30.000Z") });
    expect(store.answer("history", "later")).toBe(true);
    expect(store.answer("history", "later")).toBe(false);
    const written = SetupLedger.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(written.steps.history).toEqual({ state: "later", at: "2026-10-27T05:41:30.000Z" });
    // private: the file 0600, its directory 0700
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);

    const reloaded = new SetupLedgerStore({ path, now: at("2026-10-27T06:00:00.000Z") });
    expect(setupStepState(reloaded.snapshot(), "history")).toBe("later");
    // answering it later moves it; "later" is not "no"
    expect(reloaded.answer("history", "answered")).toBe(true);
    expect(reloaded.snapshot().steps.history).toEqual({
      state: "answered",
      at: "2026-10-27T06:00:00.000Z",
    });
  });

  it("hides Finish setting up, and says each change to its listeners as a snapshot", () => {
    const store = new SetupLedgerStore({ path: ledgerPath() });
    const seen: unknown[] = [];
    const off = store.onChange((ledger) => seen.push(ledger));
    expect(store.hide(true)).toBe(true);
    expect(store.hide(true)).toBe(false);
    store.answer("devices", "later");
    off();
    store.hide(false);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ hidden: true, steps: {} });
    expect(seen[1]).toMatchObject({ hidden: true, steps: { devices: { state: "later" } } });
    // a snapshot is a copy: nothing a listener holds can reach the store
    (seen[1] as { hidden: boolean }).hidden = false;
    expect(store.snapshot().hidden).toBe(false);
  });

  it("carries a newer build's rows and keys through its own writes", () => {
    const path = ledgerPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        format: 1,
        steps: { skills: { state: "later", at: "2026-11-02T09:00:00.000Z" } },
        hidden: false,
        moments: { limit: { state: "retired" } },
      }),
    );
    const store = new SetupLedgerStore({ path });
    store.answer("history", "answered");
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(written.moments).toEqual({ limit: { state: "retired" } });
    expect((written.steps as Record<string, unknown>).skills).toEqual({
      state: "later",
      at: "2026-11-02T09:00:00.000Z",
    });
  });

  it("sets an unreadable ledger aside and starts empty, never overwriting the bytes", () => {
    const path = ledgerPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    const logger = createNoopLogger();
    const error = vi.spyOn(logger, "error");
    const store = new SetupLedgerStore({ path, logger });
    expect(store.snapshot()).toEqual({ format: 1, steps: {}, hidden: false });
    expect(error).toHaveBeenCalledWith(
      "fieldd.setup.ledger_unreadable",
      expect.any(String),
      undefined,
      expect.objectContaining({ aside: expect.stringContaining("setup.json.unreadable-") }),
    );
    const aside = readdirSync(dirname(path)).filter((name) =>
      name.startsWith("setup.json.unreadable-"),
    );
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dirname(path), aside[0] ?? ""), "utf8")).toBe("{ not json");
    expect(existsSync(path)).toBe(false);
  });
});
