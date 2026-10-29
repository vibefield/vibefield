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
import { fileURLToPath } from "node:url";
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

// EL9 — the golden ledger the contracts test parses, read here from disk by the store
const CONNECT_ASK_GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "fixtures",
  "setup-ledger-connect-ask.valid.json",
);

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

  it("retires a moment once, beside the steps, and keeps it across a restart (AO-6b)", () => {
    const path = ledgerPath();
    const store = new SetupLedgerStore({ path });
    expect(store.moment("limit", "retired")).toBe(true);
    expect(store.moment("limit", "retired")).toBe(false);
    store.answer("history", "answered");
    const again = new SetupLedgerStore({ path });
    expect(again.snapshot()).toMatchObject({
      steps: { history: { state: "answered" } },
      moments: { limit: { state: "retired" } },
    });
  });

  it("writes each saying of an asked moment with its time, and never over a retired one (TS-4)", () => {
    const path = ledgerPath();
    let now = "2026-10-29T01:00:00.000Z";
    const store = new SetupLedgerStore({ path, now: () => new Date(now) });
    expect(store.moment("connect-ask:away", "asked")).toBe(true);
    now = "2026-11-29T01:00:00.000Z";
    // the time is the answer: the same state, said again, is written again
    expect(store.moment("connect-ask:away", "asked")).toBe(true);
    expect(new SetupLedgerStore({ path }).snapshot().moments?.["connect-ask:away"]).toEqual({
      state: "asked",
      at: "2026-11-29T01:00:00.000Z",
    });
    // retired is for good: an ask never brings it back
    expect(store.moment("limit", "retired")).toBe(true);
    expect(store.moment("limit", "asked")).toBe(false);
    expect(store.snapshot().moments?.limit).toMatchObject({ state: "retired" });
    // and a moment that was asked can still be retired
    expect(store.moment("connect-ask:away", "retired")).toBe(true);
  });

  it("reads the golden connect-ask ledger from disk and writes a saying beside AO's rows (EL9)", () => {
    const path = ledgerPath();
    mkdirSync(dirname(path), { recursive: true });
    const golden = readFileSync(CONNECT_ASK_GOLDEN, "utf8");
    writeFileSync(path, golden);
    const store = new SetupLedgerStore({ path, now: at("2026-11-27T00:00:00.000Z") });
    expect(store.snapshot()).toEqual(JSON.parse(golden));
    expect(store.moment("connect-ask:approval-wait", "asked")).toBe(true);
    const written = SetupLedger.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(written.moments).toEqual({
      limit: { state: "retired", at: "2026-10-28T16:10:00.000Z" },
      "connect-ask:away": { state: "asked", at: "2026-10-28T22:40:05.000Z" },
      "connect-ask:approval-wait": { state: "asked", at: "2026-11-27T00:00:00.000Z" },
    });
    expect(setupStepState(written, "devices")).toBe("later");
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
