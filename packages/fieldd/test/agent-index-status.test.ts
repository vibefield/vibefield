import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStatus } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import type { StatusResponse } from "@vibefield/rosetta-protocol";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EnrollmentStore, IndexService, type RosettaProjectBackfill } from "../src/agent-index";
import type { RosettadSupervisor } from "../src/rosettad-supervisor";

// AO-4 — `index.status` carries what History's room draws its first reading
// from, folded from the one `/api/status` read it already makes: the search
// build's stage, the daemon's start, and rosetta's per-project fold handed to
// the caller's keying (ProjectDoors.backfills, for this desktop's windows).
// The body is CAST, so a value that is not what the generated type promises is
// left out rather than sent: a reader refuses a whole status over one field.

const PROTOCOL = 20;
const ORIGIN = "http://127.0.0.1:65000";
const STARTED = 1_793_092_320_000;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** rosetta's `/api/status` mid first reading (its generated type, so the
 * compiler holds the fake to the wire). */
const body = (over: { daemon?: Partial<NonNullable<StatusResponse["daemon"]>> } = {}) =>
  ({
    protocol_version: PROTOCOL,
    schema_version: 1,
    canonical_ready: true,
    search: {
      readiness: "building",
      progress: { stage: "optimizing", documents_done: 41_230, documents_total: 90_411 },
      projection_epoch: null,
      revision: null,
    },
    daemon: {
      started_at: STARTED,
      uptime_ms: 95_000,
      runtimes: [],
      hub: { subscribers: 0 } as unknown as NonNullable<StatusResponse["daemon"]>["hub"],
      ingest: {
        phase: "backfilling",
        runtimes: [],
        projects: [
          {
            project_id: "r-app",
            sessions_total: 3,
            sessions_done: 1,
            bytes_total: 900,
            bytes_streamed: 300,
          },
          {
            project_id: null,
            sessions_total: 1,
            sessions_done: 0,
            bytes_total: 0,
            bytes_streamed: 0,
          },
        ],
      },
      ...over.daemon,
    },
  }) satisfies StatusResponse;

/** The service over a scripted daemon answering the two reads `status()` makes. */
const service = (status: unknown, phase = "ready") => {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-status-"));
  dirs.push(dir);
  const fetchFn: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const answer = url.endsWith("/api/status") ? status : { runtimes: [] };
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "x-rosetta-protocol-version": String(PROTOCOL) },
    });
  };
  const health = { phase, detail: null, pid: 4242, protocolVersion: PROTOCOL };
  const supervisor = {
    health: () => health,
    state: () => ({ ...health, origin: phase === "ready" ? ORIGIN : null, announce: null }),
  } as unknown as RosettadSupervisor;
  const logger = createNoopLogger();
  return new IndexService({
    supervisor,
    store: new EnrollmentStore({ path: join(dir, "enrollment.json"), logger }),
    expectedProtocolVersion: PROTOCOL,
    fetchFn,
    logger,
  });
};

describe("AO-4 — index.status feeds History's first reading", () => {
  it("names the search build's stage and the daemon's start; uptime is never sent", async () => {
    const status = IndexStatus.parse(await service(body()).status());
    expect(status.search?.progress).toEqual({ done: 41_230, total: 90_411, stage: "optimizing" });
    expect(status.startedAt).toBe(STARTED);
    expect(status).not.toHaveProperty("uptimeMs");
    // no keying asked for: no fold
    expect(status).not.toHaveProperty("projects");
  });

  it("hands rosetta's per-project fold to the caller's keying, mirrored, and answers what it keys", async () => {
    const keying = vi.fn((rows: readonly RosettaProjectBackfill[]) =>
      rows.map((row) => ({
        key: row.projectId === null ? null : "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8",
        sessionsTotal: row.sessionsTotal,
        sessionsDone: row.sessionsDone,
        bytesTotal: row.bytesTotal,
        bytesStreamed: row.bytesStreamed,
      })),
    );
    const status = IndexStatus.parse(await service(body()).status({ projects: keying }));
    expect(keying).toHaveBeenCalledWith([
      {
        projectId: "r-app",
        sessionsTotal: 3,
        sessionsDone: 1,
        bytesTotal: 900,
        bytesStreamed: 300,
      },
      { projectId: null, sessionsTotal: 1, sessionsDone: 0, bytesTotal: 0, bytesStreamed: 0 },
    ]);
    expect(status.projects?.map((row) => row.key)).toEqual([
      "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8",
      null,
    ]);
  });

  it("leaves out what the cast body does not say as a count, and folds a stage it never heard of to unknown", async () => {
    const odd = body();
    const daemon = odd.daemon as unknown as Record<string, unknown>;
    daemon.started_at = "soon";
    (daemon.ingest as { projects: unknown[] }).projects.push({
      project_id: "r-odd",
      sessions_total: -1,
      sessions_done: 0,
      bytes_total: 0,
      bytes_streamed: 0,
    });
    (odd.search.progress as { stage: string }).stage = "compacting";
    const keying = vi.fn((_rows: readonly RosettaProjectBackfill[]) => []);
    const status = IndexStatus.parse(await service(odd).status({ projects: keying }));
    expect(status).not.toHaveProperty("startedAt");
    expect(keying.mock.calls[0]?.[0].map((row) => row.projectId)).toEqual(["r-app", null]);
    expect(status.search?.progress?.stage).toBe("unknown");
  });

  it("before the daemon is ready: no clock, and no fold is asked for", async () => {
    const keying = vi.fn((_rows: readonly RosettaProjectBackfill[]) => []);
    const status = IndexStatus.parse(
      await service(body(), "starting").status({ projects: keying }),
    );
    expect(status.phase).toBe("starting");
    expect(status).not.toHaveProperty("startedAt");
    expect(status).not.toHaveProperty("projects");
    expect(keying).not.toHaveBeenCalled();
  });
});
