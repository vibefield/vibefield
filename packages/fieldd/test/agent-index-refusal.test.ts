import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexEnrollmentRecord } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnrollmentStore, IndexService } from "../src/agent-index";
import type { RosettadState, RosettadSupervisor } from "../src/rosettad-supervisor";

// AC-D8 (thinking-ar-agent-catalog.md §5.2, §13) — the index service reads the
// daemon's enrollment refusal and SUBTRACTS the refused root so the daemon can
// come up. The refusal names a root, and a real root under a user's data
// directory is longer than the supervisor's 256-char failure-detail budget per
// line, so the reason ("unknown agent kind") is cut off there; the supervisor
// keeps `--enroll …` lines whole on the state (`enrollRefusals`) and that is
// what the service reads. These rows pin that seam without a daemon.

const PROTOCOL = 20;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-refusal-"));
  dirs.push(dir);
  // a root long enough that the daemon's refusal line passes 256 characters
  const dataRoot = join(
    dir,
    "users",
    "a-fuid-with-a-long-name-0123456789abcdef",
    "agents",
    "roots",
    "hermes",
    "9a3d7c1e-2b4f-4a6c-8d0e-1f2a3b4c5d6e-and-some-more-characters-for-good-measure",
  );
  mkdirSync(dataRoot, { recursive: true });
  const enrollPath = join(dir, "users", "1", "index", "enrollment.json");
  const logger = createNoopLogger();
  const store = new EnrollmentStore({ path: enrollPath, logger });
  store.enrollRuntime({ kind: "hermes", dataRoot, label: "Ghost", profileId: "hermes:1" });
  store.publish();
  const events = new EventEmitter();
  const requestRestart = vi.fn(async () => null);
  let phase = "ready";
  const supervisor = Object.assign(events, {
    health: () => ({ phase, detail: null, pid: 4242, protocolVersion: PROTOCOL }),
    state: () => ({}),
    requestRestart,
  }) as unknown as RosettadSupervisor;
  const index = new IndexService({
    supervisor,
    store,
    expectedProtocolVersion: PROTOCOL,
    logger,
  });
  const refusal = `--enroll ${enrollPath}: runtime #1 (kind "hermes", data_root ${JSON.stringify(dataRoot)}): unknown agent kind`;
  expect(refusal.length).toBeGreaterThan(256);
  const transition = (over: Partial<RosettadState>): RosettadState => ({
    phase: "restarting",
    detail: `rosettad exited (2) — ${refusal.slice(0, 256)}`,
    pid: null,
    protocolVersion: null,
    origin: null,
    announce: null,
    enrollRefusals: [],
    ...over,
  });
  const record = (): IndexEnrollmentRecord => JSON.parse(readFileSync(enrollPath, "utf8"));
  const setPhase = (p: string) => {
    phase = p;
  };
  return {
    dir,
    dataRoot,
    store,
    events,
    requestRestart,
    index,
    refusal,
    transition,
    record,
    setPhase,
  };
}

describe("AC-D8 — the daemon's refusal is read in full and subtracts the root", () => {
  it("a `restarting` transition carrying the whole refusal line retires the root with the refusal; the supervisor's own retry relaunches (no restart request)", async () => {
    const { events, requestRestart, index, refusal, transition, record } = setup();
    expect(record().runtimes).toHaveLength(1);
    events.emit("transition", transition({ enrollRefusals: [refusal] }));
    const after = record();
    expect(after.runtimes).toEqual([]);
    expect(after.retired?.[0]).toMatchObject({ kind: "hermes", profile_id: "hermes:1" });
    expect(after.retired?.[0]?.refused?.detail).toContain("unknown agent kind");
    expect(after.retired?.[0]?.refused?.at).toMatch(/^\d{4}-/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestRestart).not.toHaveBeenCalled();
    index.dispose();
  });

  it("the real daemon's line, prefixed `rosettad: ` and with a decomposed accent spelled the `{:?}` way, is read and unescaped", async () => {
    const { dir, events, index, transition, record, store } = setup();
    // a second root whose path holds a combining accent (macOS keeps José as
    // Jose + U+0301); rosettad prints it as `Jose\u{301}`
    const accented = join(dir, "users", "Jose\u0301", "agents", "roots", "hermes", "r2");
    mkdirSync(accented, { recursive: true });
    store.enrollRuntime({
      kind: "hermes",
      dataRoot: accented,
      label: "Accent",
      profileId: "hermes:2",
    });
    store.publish();
    expect(record().runtimes).toHaveLength(2);
    const printed = accented.replace("Jose\u0301", "Jose\\u{301}");
    const line = `rosettad: --enroll x: runtime #2 (kind "hermes", data_root "${printed}"): unknown agent kind`;
    events.emit("transition", transition({ enrollRefusals: [line] }));
    const after = record();
    expect(after.runtimes.map((rt) => rt.profile_id)).toEqual(["hermes:1"]);
    expect(after.retired?.find((rt) => rt.profile_id === "hermes:2")?.refused?.detail).toContain(
      "unknown agent kind",
    );
    index.dispose();
  });

  it("the truncated failure detail alone is not enough on a real path — the reason was cut off — and nothing is subtracted", async () => {
    const { events, index, transition, record } = setup();
    events.emit("transition", transition({ enrollRefusals: [] }));
    expect(record().runtimes).toHaveLength(1);
    index.dispose();
  });

  it("a `failed` transition (the intensity window closed) subtracts and asks for ONE restart, deferred past the supervisor's own bookkeeping", async () => {
    const { events, requestRestart, index, refusal, transition, record } = setup();
    events.emit("transition", transition({ phase: "failed", enrollRefusals: [refusal] }));
    expect(record().runtimes).toEqual([]);
    expect(requestRestart).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestRestart).toHaveBeenCalledTimes(1);
    index.dispose();
  });

  it("a refusal for a root the record does not name changes nothing; a `ready` transition is ignored; dispose stops listening", async () => {
    const { events, requestRestart, index, transition, record, dataRoot } = setup();
    const other = `--enroll x: runtime #1 (kind "hermes", data_root ${JSON.stringify(`${dataRoot}-other`)}): unknown agent kind`;
    events.emit("transition", transition({ enrollRefusals: [other] }));
    expect(record().runtimes).toHaveLength(1);
    events.emit("transition", transition({ phase: "ready", enrollRefusals: [] }));
    expect(record().runtimes).toHaveLength(1);
    index.dispose();
    events.emit("transition", transition({ enrollRefusals: [other.replace("-other", "")] }));
    expect(record().runtimes).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestRestart).not.toHaveBeenCalled();
  });
});
