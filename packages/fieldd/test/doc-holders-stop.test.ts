// DS-5d × M176 item 7 — a stopping fieldd waits for the holders ledger's last
// write, BOUNDED. M162 made both ladders await `DocHoldersService.stop()` (the
// owner may remove its data root only after it); a filesystem that never
// answers must cost that write, never the shutdown, and the log must say so.
// Each row hands the daemon a stop that never resolves.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOC_HOLDERS_STOP_MS } from "../src/daemon";
import { bootstrap, type FielddDaemon } from "../src/index";
import { DocHoldersService } from "../src/library-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

interface Fixture {
  root: string;
  logRoot: string;
  daemon: FielddDaemon;
  native: MockMgmtServer;
}

/** A real daemon boots and stops in each row; a loaded gate gets room, and a
 * missing bound fails in this file's own words rather than the suite's. */
const ROW_BUDGET_MS = 30_000;
const STOP_GUARD_MS = 20_000;

const fixtures: Fixture[] = [];
/** The real stops the never-settling one ran underneath (its writes settle before the root goes). */
const realStops: Promise<void>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.daemon.stop();
    await fixture.native.stop();
    await Promise.all(realStops.splice(0));
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function setup(options: { stopMs?: number; onFatal?: (reason: string) => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-holders-bound-"));
  const dataDir = join(root, "data");
  const logRoot = join(root, "logs");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  mkdirSync(join(dataDir, "registries"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  const daemon = await bootstrap({
    dataDir,
    logRoot,
    controlPort: 0,
    dataPort: 0,
    ...(options.stopMs === undefined ? {} : { docHoldersStopMs: options.stopMs }),
    ...(options.onFatal === undefined ? {} : { onFatal: options.onFatal }),
  });
  const fixture: Fixture = { root, logRoot, daemon, native };
  fixtures.push(fixture);
  return fixture;
}

/** The ledger's last write never answers: the service still closes (its real
 * stop runs underneath), but the daemon is handed a promise that never settles. */
function holdersNeverSettle(): void {
  const real = DocHoldersService.prototype.stop;
  vi.spyOn(DocHoldersService.prototype, "stop").mockImplementation(function (
    this: DocHoldersService,
  ) {
    realStops.push(real.call(this));
    return new Promise<void>(() => undefined);
  });
}

/** Fail fast with a reason, instead of the suite's timeout, if the bound is gone. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function events(logRoot: string): Array<{ event: string; severity: string; attrs?: unknown }> {
  return readFileSync(join(logRoot, "system", "fieldd.ndjson"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event: string; severity: string; attrs?: unknown });
}

describe("the holders ledger's last write is bounded at stop (DS-5d, M176)", () => {
  it(
    "the clean stop goes on without a ledger that never settles, and says so",
    async () => {
      holdersNeverSettle();
      const { daemon, logRoot } = await setup({ stopMs: 100 });
      await within(daemon.stop(), STOP_GUARD_MS, "the clean stop");
      const lines = events(logRoot);
      const timeout = lines.findIndex((line) => line.event === "fieldd.docs.holders_stop_timeout");
      expect(timeout).toBeGreaterThanOrEqual(0);
      expect(lines[timeout]).toMatchObject({ severity: "WARN", attrs: { budgetMs: 100 } });
      // …and the rest of the ladder ran after it
      expect(lines.findIndex((line) => line.event === "fieldd.lifecycle.stopped")).toBeGreaterThan(
        timeout,
      );
    },
    ROW_BUDGET_MS,
  );

  it(
    "the fatal ladder too: a superseded fieldd reaches onFatal past a ledger that never settles",
    async () => {
      holdersNeverSettle();
      let fatal: (reason: string) => void = () => undefined;
      const reached = new Promise<string>((resolve) => {
        fatal = resolve;
      });
      const { daemon, native, logRoot } = await setup({ stopMs: 100, onFatal: fatal });
      const frame = JSON.stringify({
        jsonrpc: "2.0",
        method: "native.lifecycle.superseded",
        params: { reason: "scripted takeover" },
      });
      for (const sock of native.sockets) sock.write(`${frame}\n`);
      await until(() => daemon.native.superseded, 4_000);
      await expect(within(reached, STOP_GUARD_MS, "the fatal ladder")).resolves.toContain(
        "superseded",
      );
      expect(events(logRoot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "fieldd.docs.holders_stop_timeout",
            severity: "WARN",
            attrs: { budgetMs: 100 },
          }),
        ]),
      );
    },
    ROW_BUDGET_MS,
  );

  it(
    "by default the bound is DOC_HOLDERS_STOP_MS (2 s), the supervisor's own TERM grace",
    async () => {
      expect(DOC_HOLDERS_STOP_MS).toBe(2_000);
      holdersNeverSettle();
      const { daemon, logRoot } = await setup();
      const started = Date.now();
      await within(daemon.stop(), STOP_GUARD_MS, "the clean stop");
      expect(Date.now() - started).toBeGreaterThanOrEqual(DOC_HOLDERS_STOP_MS - 50);
      expect(events(logRoot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "fieldd.docs.holders_stop_timeout",
            attrs: { budgetMs: DOC_HOLDERS_STOP_MS },
          }),
        ]),
      );
    },
    ROW_BUDGET_MS,
  );

  it(
    "a ledger that settles is waited for as before, and nothing is said",
    async () => {
      // the control's flush is a REAL fsync'd write, so its bound is room for a
      // loaded host, not the never-settling rows' 100 ms (that wait is the point)
      const { daemon, logRoot } = await setup({ stopMs: 10_000 });
      await within(daemon.stop(), STOP_GUARD_MS, "the clean stop");
      const lines = events(logRoot);
      expect(lines.some((line) => line.event === "fieldd.docs.holders_stop_timeout")).toBe(false);
      expect(lines.some((line) => line.event === "fieldd.lifecycle.stopped")).toBe(true);
    },
    ROW_BUDGET_MS,
  );
});
