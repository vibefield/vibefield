import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElectronLocalDiagnostics } from "../src/main/local-diagnostics";
import { createElectronLogging } from "../src/main/logging";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Electron-local diagnostics aggregation", () => {
  it("merges bounded ring/history records and emits live deltas", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-local-diagnostics-"));
    roots.push(root);
    const logging = await createElectronLogging({
      logRoot: join(root, "logs"),
      dataRoot: root,
      bootId: "desktop-local-test",
    });
    const diagnostics = new ElectronLocalDiagnostics(logging);
    logging.logger.info("desktop.test.before_query", "desktop record");
    logging.renderer.ingest({
      time: Date.now(),
      level: "warn",
      event: "renderer.test.before_query",
      message: "renderer record",
      component: "renderer.test",
    });

    const queried = await diagnostics.query({
      sources: [LOG_STREAMS.SYSTEM_DESKTOP, LOG_STREAMS.SYSTEM_RENDERER],
      limit: 20,
    });
    expect(queried.producers).toHaveLength(2);
    expect(queried.records.map((record) => record.event)).toEqual(
      expect.arrayContaining(["desktop.test.before_query", "renderer.test.before_query"]),
    );
    expect(queried.history).toBeDefined();

    const observed = vi.fn();
    const subscription = await diagnostics.subscribe(
      { sources: [LOG_STREAMS.SYSTEM_DESKTOP], limit: 20 },
      observed,
    );
    logging.logger.error("desktop.test.after_subscribe", "new desktop record");
    await vi.waitFor(
      () =>
        expect(observed).toHaveBeenCalledWith(
          expect.objectContaining({
            records: [
              expect.objectContaining({
                event: "desktop.test.after_subscribe",
              }),
            ],
          }),
          "delta",
        ),
      { timeout: 1_000 },
    );

    subscription.dispose();
    diagnostics.dispose();
    await logging.close();
  });

  it("owns, applies, lists, and revokes Electron producer leases", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-local-lease-"));
    roots.push(root);
    const logging = await createElectronLogging({
      logRoot: join(root, "logs"),
      dataRoot: root,
      bootId: "desktop-lease-test",
    });
    const diagnostics = new ElectronLocalDiagnostics(logging);
    const before = Date.now();
    const lease = diagnostics.createLease({
      selector: { kind: "service", service: "desktop" },
      level: "debug",
      duration: "15m",
    });
    expect(lease).toMatchObject({
      selector: { kind: "service", service: "desktop" },
      level: "debug",
    });
    expect(lease.createdAt).toBeGreaterThanOrEqual(before);
    expect(lease.expiresAt - lease.createdAt).toBe(15 * 60 * 1_000);
    expect(logging.desktop.health()).toMatchObject({
      currentLevel: "debug",
      activeLeaseCount: 1,
    });
    expect(diagnostics.listLeases().leases).toEqual([lease]);
    expect(diagnostics.revokeLease({ leaseId: lease.leaseId })).toEqual({ revoked: true });
    expect(logging.desktop.health()).toMatchObject({
      currentLevel: "info",
      activeLeaseCount: 0,
    });

    diagnostics.dispose();
    await logging.close();
  });
});
