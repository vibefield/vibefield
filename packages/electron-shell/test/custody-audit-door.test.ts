import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT } from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { describe, expect, it, type Mock, vi } from "vitest";
import { createShellCustody } from "../src/main/custody/custody";
import { FielddHandleCoordinator } from "../src/main/fieldd-handle-coordinator";
import { fakeDerive, fakeKeystore, keptLog, OWN, vibefieldTree } from "./custody-fakes";

// OB custody, C1 (CUSTODY-SPEC §7.4 "v0.17" and "v0.18"; the PM, 2026-11-10 01:58:44Z) — what custody recorded before
// a pair existed is appended to the audit trail through the HANDLE of the pair that just came up, never through
// main's `appendShellAudit`: that door begins with an ensure, and an append must never be what starts a pair. The
// condition on that: if the handle is dead or the append fails, the record goes to main's LOG, and nothing starts a
// pair to deliver it.
//
// These rows go through the pieces as main composes them: the real coordinator over the real custody's gate, and
// the audit door spelled as `index.ts` spells it. They are GIVEN an injected keystore, an injected process table
// and an injected handle (a pair whose client answers as the row says). `index.ts` is Electron's main module and
// cannot be loaded by a row: its line is PINNED by the row at the foot that reads it, and the proof through the real
// root is owed to the signed build's witness (CUSTODY-SPEC §10, v0.20).

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");

/** A pair's handle whose client answers every request as the row says. */
function handleOf(request: (method: string, params: unknown) => Promise<unknown>): FielddHandle {
  return {
    info: { bootId: "boot-1", port: 4242 },
    client: { status: "ready", onStatusChange: () => () => undefined, request: vi.fn(request) },
    liveness: { kind: "responsive" },
    onLiveness: () => () => undefined,
  } as unknown as FielddHandle;
}

const requestsOf = (handle: FielddHandle): Mock => handle.client.request as unknown as Mock;

/** The lines main's log holds for the records that did not reach the trail. */
const unappended = (log: ReturnType<typeof keptLog>) =>
  log.lines.filter((line) => line.event === "desktop.custody.audit_unappended");

/** What main composes for one pair, over a root MADE in this boot and one older fieldd it stopped: two records
 * wait for the pair that comes up. */
function composed(up: FielddHandle) {
  const tree = vibefieldTree();
  const product = join(tree.userRoots[0] as string, ...LAYOUT.PRODUCT_JSON);
  mkdirSync(dirname(product), { recursive: true });
  writeFileSync(product, JSON.stringify({ pid: 601, nativePid: null, bootId: "boot-before" }));
  let there = true;
  const log = keptLog();
  const custody = createShellCustody<FielddHandle>({
    level: { level: "sealed", own: OWN },
    vibefieldRoot: tree.root,
    keystore: () => fakeKeystore(),
    userRoots: () => tree.users,
    logRoot: tree.logRoot,
    derive: fakeDerive,
    stop: {
      isOurs: async () => true,
      exists: () => there,
      signal: () => {
        there = false;
      },
      sleep: async () => undefined,
    },
    // as `index.ts` binds it: fieldd's `audit.append`, asked on the handle that came up
    audit: (pair, record) => pair.client.request("audit.append", record),
    log,
    now: () => 7_000,
  });
  const startPair = vi.fn<FielddSupervisor["ensure"]>(async () => up);
  const coordinator = new FielddHandleCoordinator({ upstreamEnsure: custody.gate(startPair) });
  return { tree, log, custody, startPair, coordinator };
}

describe("what waited for a pair is appended through that pair's handle, and never starts one (C1)", () => {
  it("the pair that came up is gone before the append: the records go to main's log, and nothing is started to deliver them", async () => {
    const gone = handleOf(async () => {
      throw new Error("the client is closed");
    });
    const { tree, log, custody, startPair, coordinator } = composed(gone);

    expect(await coordinator.ensure({ person: true })).toBe(gone);
    await vi.waitFor(() =>
      expect(log.lines.map((line) => line.event)).toContain("desktop.custody.audit_unavailable"),
    );
    // the first append failed, and the second was not tried: a door that is gone is gone for both
    expect(requestsOf(gone).mock.calls).toEqual([["audit.append", expect.any(Object)]]);

    // main's log holds each record as it was to be appended: its facts, and never a secret
    const held = unappended(log);
    expect(held.map((line) => [line.level, line.attrs])).toEqual([
      [
        "warn",
        {
          action: "shell.custody.root",
          target: { kind: "custody-root", id: "shell" },
          outcome: "succeeded",
          attrs: { outcome: "made-absent", at: 7_000, deferred: true },
        },
      ],
      [
        "warn",
        {
          action: "shell.custody.pair",
          target: { kind: "user-root", id: "user-1" },
          outcome: "succeeded",
          attrs: {
            role: "fieldd",
            outcome: "stopped",
            sources: ["product"],
            pid: 601,
            at: 7_000,
            deferred: true,
          },
        },
      ],
    ]);
    const said = JSON.stringify(log.lines);
    const handoff = custody.forUserRoot(tree.userRoots[0] as string)?.handoff();
    for (const kept of [handoff?.shell, handoff?.pairing, handoff?.records, tree.root]) {
      expect(typeof kept).toBe("string");
      expect(said.includes(kept as string)).toBe(false);
    }

    // nothing was started to deliver them: the one start is the one the person asked for
    expect(startPair).toHaveBeenCalledTimes(1);
    // and the next start is neither delayed by it nor made to try again
    expect(await coordinator.ensure({ person: true })).toBe(gone);
    expect(startPair).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestsOf(gone).mock.calls).toHaveLength(1);
    expect(unappended(log)).toEqual(held);
  });

  it("an append that never answers delays no start", async () => {
    const silent = handleOf(() => new Promise<unknown>(() => undefined));
    const { log, startPair, coordinator } = composed(silent);

    // the start that brought the pair up answers, and so does the next, with the first append still unanswered
    expect(await coordinator.ensure({ person: true })).toBe(silent);
    expect(await coordinator.ensure()).toBe(silent);
    expect(startPair).toHaveBeenCalledTimes(2);
    expect(requestsOf(silent).mock.calls).toHaveLength(1);
    expect(log.lines.map((line) => line.event)).not.toContain("desktop.custody.audit_unavailable");
  });

  it("main appends through the handle of the pair that came up, and custody knows no door that begins with an ensure", () => {
    const main = source("main/index.ts");
    expect(main).toContain('audit: (pair, record) => pair.client.request("audit.append", record),');
    const custody = source("main/custody/custody.ts");
    expect(custody).not.toMatch(/\bensure\(/u);
    expect(custody).not.toContain("appendShellAudit(");
  });
});
