import type { ReleaseNotes, UpdateAppLocation } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import type { UpdatePrepared, UpdateQuitPlan } from "../../src/main/quit-flow";
import {
  type ApplyPort,
  type BoxContent,
  type CensusSnapshot,
  censusNotice,
  censusOf,
  consentWords,
  locationNotice,
  quitInstallWords,
  type StageOutcome,
  type StopOutcome,
} from "../../src/main/updates/apply";
import {
  type CancellationLike,
  compareUrlOf,
  FRESH_POLICY_BOUND_MS,
  PREPARE_TTL_MS,
  QUIT_POLICY_BOUND_MS,
  QUIT_STAGE_MS,
  SILENT_RECHECK_MS,
  UpdateController,
  type UpdaterPort,
} from "../../src/main/updates/controller";
import type { NativePlane } from "../../src/main/updates/native-plane";
import { UpdateRefusal } from "../../src/main/updates/refusal";
import { type StoreFs, UpdateStateStore } from "../../src/main/updates/state-store";
import type { ChainResult, FetchBytes, VerifiedChain } from "../../src/main/updates/verify-chain";
import { FixtureOrigin, NOW, ORIGIN } from "./fixture-release";
import { currentList, terminalList } from "./terminal-list-fixture";

// WP12c (L2b-ii, build-wp12-updater.md §10; the PM's rulings 2026-10-15 13:31–13:40Z) — `restartToInstall()` over a
// fake ApplyPort. Every fieldd-touching call (the census, an audit row, the stop) lands on ONE timeline as `fieldd:…`,
// so each branch can assert THE NO-SPAWN PROBE: after a successful daemon stop nothing reaches fieldd — in
// production each of those calls goes through `ensureFieldd()`, which SPAWNS.

const NIGHTLY = "nightly-20261016";
const STAGED_VERSION = "0.9.0-nightly.20261016";
/** AU-6 — the native plane a manifest names when a row gives it notes and no plane of its own (no plane is wired) */
const SOME_PLANE: NativePlane = { digest: "f".repeat(64), members: ["bin/field-native"] };

function memoryStore(initial: string | null = null) {
  const files = new Map<string, string>();
  if (initial !== null) files.set("/state.json", initial);
  const fs: StoreFs = {
    readFile: (path) => files.get(path) ?? null,
    writeAtomic: (path, text) => {
      files.set(path, text);
    },
    moveAside: (path, to) => {
      const text = files.get(path);
      files.delete(path);
      if (text !== undefined) files.set(to, text);
    },
  };
  return { store: new UpdateStateStore("/state.json", fs, () => NOW), files };
}

class FakeUpdater implements UpdaterPort {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  context: {
    verify(fetch: FetchBytes): Promise<ChainResult>;
    verified(r: VerifiedChain): void;
  } | null = null;
  /** AU-1 — what the feed offers: the staged version, or nothing (a check that finds nothing) */
  offers = true;
  /** AU-1 — a download the test releases by hand (a person's check answers before it completes) */
  holdDownload: Promise<void> | null = null;
  downloads = 0;
  constructor(readonly fx: FixtureOrigin) {}
  setFeedURL(options: unknown): void {
    this.context = (options as { vibefield: FakeUpdater["context"] }).vibefield;
  }
  async checkForUpdates() {
    const result = await this.context!.verify(this.fx.fetch);
    if (!result.ok) throw new UpdateRefusal(result.state, result.detail);
    this.context!.verified(result);
    return { isUpdateAvailable: this.offers, updateInfo: { version: STAGED_VERSION } };
  }
  async downloadUpdate(): Promise<unknown> {
    this.downloads += 1;
    if (this.holdDownload !== null) await this.holdDownload;
    return ["/cache/update.zip"];
  }
  on(): unknown {
    return this;
  }
  removeListener(): unknown {
    return this;
  }
}

class FakeApply implements ApplyPort {
  wired = true;
  readonly timeline: string[];
  snapshot: CensusSnapshot = { known: true, sessions: [] };
  consent = true;
  stop: StopOutcome = { ok: true };
  stageOutcome: StageOutcome = { kind: "staged" };
  plan: UpdateQuitPlan | null = null;
  boxes: BoxContent[] = [];
  notices: BoxContent[] = [];
  stoppedWith: string[] | null = null;
  stoppedNative: boolean | null = null;
  constructor(timeline: string[]) {
    this.timeline = timeline;
  }
  async census(): Promise<CensusSnapshot> {
    this.timeline.push("fieldd:census");
    return this.snapshot;
  }
  async confirm(box: BoxContent): Promise<boolean> {
    this.timeline.push("confirm");
    this.boxes.push(box);
    return this.consent;
  }
  quitForUpdate(plan: UpdateQuitPlan): boolean {
    this.timeline.push("quit");
    this.plan = plan;
    return true;
  }
  async stopDaemons(
    sessions: readonly string[],
    _version: string,
    native: boolean,
  ): Promise<StopOutcome> {
    this.timeline.push("fieldd:stop");
    this.stoppedWith = [...sessions];
    this.stoppedNative = native;
    return this.stop;
  }
  async stage(): Promise<StageOutcome> {
    this.timeline.push("stage");
    return this.stageOutcome;
  }
  install(): void {
    this.timeline.push("install");
  }
  async notify(box: BoxContent): Promise<void> {
    this.timeline.push("notify");
    this.notices.push(box);
  }
  restore(): void {
    this.timeline.push("restore");
  }
}

async function stagedController(
  opts: {
    initial?: string | null;
    currentVersion?: string;
    /** the click's fetcher: the fixture's by default; `null` = none wired */
    fetch?: FetchBytes | null;
    /** B3: the installed native plane (absent = not wired, so every release reads touched) */
    nativePlane?: NativePlane;
    /** B3: the head's manifest names this native plane */
    manifestNative?: NativePlane;
    hostOs?: string;
    /** L3b-ii (B4) — the safe window's context: present = the silent apply may run */
    window?: { windowless?: boolean; trayResident?: boolean; display?: boolean | "unknown" };
    /** L3b-ii (B6) — the staged cache */
    cache?: FakeCache;
    /** the head policy's levers at the first check */
    levers?: Record<string, unknown>;
    /** L3c-i — a clock the test moves (a prepared snapshot's two minutes) */
    clock?: { now: number };
    /** AU-7 — where the bundle runs (absent = not macOS's answer: nothing held) */
    location?: UpdateAppLocation;
    /** AU-6 — the head's manifest carries these notes, as given (well-formed or not) */
    notes?: unknown;
    /** AU-6 — the origin the release is served under and the controller frozen to (GitHub's by default) */
    origin?: string;
    /** AU-6 (LC-18) — when this build was made, as the identity hands it to the controller */
    builtAt?: number;
  } = {},
) {
  const origin = opts.origin ?? ORIGIN;
  const fx = new FixtureOrigin(origin);
  fx.setReleases([NIGHTLY]);
  fx.putRelease(NIGHTLY, {
    heads: { nightly: NIGHTLY, beta: null, stable: null },
    ...(opts.levers !== undefined ? { levers: { nightly: opts.levers } } : {}),
  });
  fx.putFeed(NIGHTLY, STAGED_VERSION);
  if (opts.manifestNative !== undefined || opts.notes !== undefined)
    fx.putManifest(NIGHTLY, STAGED_VERSION, opts.manifestNative ?? SOME_PLANE, {
      notes: opts.notes,
    });
  const timeline: string[] = [];
  const apply = new FakeApply(timeline);
  const audits: AuditAppendV1[] = [];
  /** AU-1 — an ATTEMPT row the test holds: what the doors race while fieldd appends it */
  const gates: { attempt: Promise<void> | null } = { attempt: null };
  const { store, files } = memoryStore(opts.initial ?? null);
  const updater = new FakeUpdater(fx);
  const controller = new UpdateController({
    updater,
    feedOptions: (context) => ({ provider: "custom", vibefield: context }),
    newCancellationToken: (): CancellationLike => ({ cancel: () => undefined }),
    origin,
    rootKeys: fx.rootKeys,
    buildChannel: "nightly",
    feedFile: "latest-mac.yml",
    store,
    appendAudit: async (record) => {
      timeline.push(`fieldd:audit:${record.phase}${record.outcome ? `:${record.outcome}` : ""}`);
      audits.push(record);
      if (record.phase === "attempt" && gates.attempt !== null) await gates.attempt;
    },
    log: { info: vi.fn(), warn: vi.fn() },
    now: () => opts.clock?.now ?? NOW,
    apply,
    ...(opts.currentVersion !== undefined ? { currentVersion: opts.currentVersion } : {}),
    ...(opts.fetch === null ? {} : { fetch: opts.fetch ?? fx.fetch }),
    ...(opts.nativePlane !== undefined
      ? { nativePlane: async () => opts.nativePlane!, platformKey: "mac-arm64" }
      : {}),
    ...(opts.hostOs !== undefined ? { hostOsVersion: () => opts.hostOs! } : {}),
    ...(opts.window !== undefined
      ? {
          safeWindowContext: () => ({
            windowless: opts.window?.windowless ?? true,
            trayResident: opts.window?.trayResident ?? true,
          }),
          displayHeldAwake: async () => opts.window?.display ?? false,
        }
      : {}),
    ...(opts.cache !== undefined ? { stagedCache: opts.cache } : {}),
    ...(opts.location !== undefined ? { location: () => opts.location } : {}),
    ...(opts.builtAt !== undefined ? { builtAt: opts.builtAt } : {}),
  });
  return { controller, apply, timeline, audits, files, fx, updater, gates };
}

/** AU-1 — hold the next ATTEMPT row until the returned release is called. */
function holdAttempt(gates: { attempt: Promise<void> | null }): () => void {
  let release: () => void = () => {};
  gates.attempt = new Promise((resolve) => {
    release = resolve;
  });
  return () => release();
}

/** AU-1 — the OUTCOME rows that close the (one) ATTEMPT row: the same operation id. */
function outcomesOfTheAttempt(audits: readonly AuditAppendV1[]): AuditAppendV1[] {
  const attempts = audits.filter((a) => a.phase === "attempt");
  expect(attempts).toHaveLength(1);
  return audits.filter((a) => a.phase === "outcome" && a.operationId === attempts[0]!.operationId);
}

/** L3b-ii (B6) — a staged cache that records what was asked of it. */
class FakeCache {
  cleared = 0;
  bytes = 42 * 1_048_576;
  /** AU-1 — a collection the test ends by hand (a download waits for it) */
  hold: Promise<void> | null = null;
  async clear(): Promise<void> {
    this.cleared += 1;
    if (this.hold !== null) await this.hold;
    this.bytes = 0;
  }
  async size(): Promise<number | null> {
    return this.bytes;
  }
}

async function staged(sessions: CensusSnapshot = { known: true, sessions: [] }) {
  const rig = await stagedController();
  rig.apply.snapshot = sessions;
  await rig.controller.check("manual");
  rig.timeline.length = 0; // the check's own census read is not the apply's
  rig.audits.length = 0;
  return rig;
}

/** THE NO-SPAWN PROBE: nothing reaches fieldd after the stop succeeded. */
function noFielddAfterTheStop(timeline: readonly string[]): void {
  const stop = timeline.indexOf("fieldd:stop");
  expect(stop, timeline.join(" → ")).toBeGreaterThanOrEqual(0);
  expect(
    timeline.slice(stop + 1).filter((step) => step.startsWith("fieldd:")),
    timeline.join(" → "),
  ).toEqual([]);
}

const lastApplyOf = (files: Map<string, string>) =>
  (JSON.parse(files.get("/state.json") ?? "{}") as { lastApply?: Record<string, unknown> })
    .lastApply;

/** AU-1 (AU-D3 A) — the persisted staged clock, as state.json holds it */
const stagedClockOf = (files: Map<string, string>) =>
  (JSON.parse(files.get("/state.json") ?? "{}") as { staged?: unknown }).staged;

const LIVE = {
  known: true,
  sessions: [
    { sessionId: "01SESSIONAAAAAAAAAAAAAAAAA", title: "zsh", cwd: "/Users/me/a" },
    { sessionId: "01SESSIONBBBBBBBBBBBBBBBBB", title: "claude", cwd: "/Users/me/b" },
  ],
} as const satisfies CensusSnapshot;

describe("restartToInstall — WP12c's apply, order (A)", () => {
  it("staged on a wired port reads the census, and the tray's count comes from it", async () => {
    const rig = await stagedController();
    rig.apply.snapshot = LIVE;
    await rig.controller.check("manual");
    expect(rig.controller.state).toMatchObject({
      kind: "staged",
      version: STAGED_VERSION,
      sessions: 2,
      blockedBy: "sessions",
    });
  });

  it("at census zero: no box, the ATTEMPT row while fieldd lives, then stop → stage → install", async () => {
    const { controller, apply, timeline, files } = await staged();
    expect(await controller.restartToInstall()).toEqual({ ok: true });
    expect(apply.boxes).toEqual([]);
    expect(timeline).toEqual(["fieldd:census", "fieldd:audit:attempt", "quit"]);
    const prepared = await apply.plan!.prepare();
    expect(prepared).toEqual({ kind: "install" });
    apply.plan!.install();
    expect(timeline.slice(3)).toEqual(["fieldd:stop", "stage", "install"]);
    expect(apply.stoppedWith).toEqual([]);
    expect(lastApplyOf(files)).toMatchObject({
      branch: "installing",
      version: STAGED_VERSION,
      consented: 0,
      audited: false,
      // AU-1 (X3) — how it began; the rig names no running version, so no `from`, and no `landed` until a launch
      trigger: "restart",
    });
    expect(lastApplyOf(files)).not.toHaveProperty("from");
    expect(lastApplyOf(files)).not.toHaveProperty("landed");
    noFielddAfterTheStop(timeline);
  });

  it("AU-1 — the record names the version it leaves and how it began; this launch never shows it", async () => {
    const rig = await stagedController({ currentVersion: "0.9.0-nightly.20261015" });
    await rig.controller.check("manual");
    const prepared = await rig.controller.prepareRestart();
    if (!prepared.ok) throw new Error("prepare refused");
    expect(await rig.controller.confirmRestart(prepared.token)).toEqual({ ok: true });
    await rig.apply.plan!.prepare();
    expect(lastApplyOf(rig.files)).toMatchObject({
      branch: "installing",
      version: STAGED_VERSION,
      from: "0.9.0-nightly.20261015",
      trigger: "restart",
    });
    // written by THIS process just before its exit: the next launch judges it, so this one says nothing of it
    expect(lastApplyOf(rig.files)).not.toHaveProperty("landed");
    expect(rig.controller.view().lastApply).toBeUndefined();
  });

  it("with live sessions: the box lists the ONE snapshot, and the stop compares exactly its ids", async () => {
    const { controller, apply, timeline } = await staged(LIVE);
    expect(await controller.restartToInstall()).toEqual({ ok: true });
    expect(apply.boxes[0]?.message).toBe("Updating ends 2 terminal sessions");
    expect(apply.boxes[0]?.detail).toContain("zsh — /Users/me/a");
    await apply.plan!.prepare();
    // byte for byte what the person consented to (the PM's ruling 13:31Z)
    expect(apply.stoppedWith).toEqual(LIVE.sessions.map((session) => session.sessionId));
    noFielddAfterTheStop(timeline);
  });

  it("Cancel in the box holds: no quit, no attempt row, the update stays staged blocked by its sessions", async () => {
    const { controller, apply, timeline } = await staged(LIVE);
    apply.consent = false;
    expect(await controller.restartToInstall()).toEqual({ ok: false, reason: "consent-declined" });
    expect(timeline).toEqual(["fieldd:census", "confirm"]);
    expect(controller.state).toMatchObject({ kind: "staged", blockedBy: "sessions", sessions: 2 });
  });

  it("an unknown census holds, said in the ledger, never read as zero", async () => {
    const { controller, apply, audits } = await staged();
    apply.snapshot = { known: false };
    expect(await controller.restartToInstall()).toEqual({ ok: false, reason: "census-unknown" });
    expect(apply.plan).toBeNull();
    // L3c-ii — and the click is said, not swallowed: the tray tells the person nothing ended and why
    expect(apply.notices.map((notice) => notice.detail)).toEqual([
      "VibeField couldn't read which terminal sessions are running, so it ended none. Nothing changed; try again in a moment.",
    ]);
    expect(controller.state).toMatchObject({
      kind: "staged",
      blockedBy: "census-unknown",
      sessions: "unknown",
    });
    await vi.waitFor(() => expect(audits.map((a) => a.reasonCode)).toContain("CENSUS_UNKNOWN"));
  });

  it("IL-D5 (a) — a list naming a cell older than its bound holds as census-unknown until a list is current", async () => {
    const { controller, apply, audits } = await staged(
      censusOf(terminalList("terminal-list.stale-cell.json")),
    );
    // the tray's count is unknown, never the stale cell's rows
    expect(controller.state).toMatchObject({
      kind: "staged",
      blockedBy: "census-unknown",
      sessions: "unknown",
    });
    // the click holds too, and says so: nothing quit, nothing ended
    expect(await controller.restartToInstall()).toEqual({ ok: false, reason: "census-unknown" });
    expect(apply.plan).toBeNull();
    expect(apply.notices.map((notice) => notice.detail)).toEqual([censusNotice().detail]);
    await vi.waitFor(() => expect(audits.map((a) => a.reasonCode)).toContain("CENSUS_UNKNOWN"));
    // the cell's rows are current again: they are the census, and the update waits on its sessions
    apply.snapshot = censusOf(currentList());
    await controller.refreshCensus();
    expect(controller.state).toMatchObject({ kind: "staged", blockedBy: "sessions", sessions: 2 });
  });

  it("the daemon's re-check refuses BEFORE the stop: abort — restored, the outcome said now, nothing staged", async () => {
    const { controller, apply, timeline, audits, files } = await staged(LIVE);
    apply.stop = { ok: false, reason: "the live sessions differ", live: ["x"] };
    await controller.restartToInstall();
    const prepared = await apply.plan!.prepare();
    expect(prepared).toEqual({ kind: "abort", reason: "the live sessions differ" });
    apply.plan!.aborted("the live sessions differ");
    expect(timeline).not.toContain("stage"); // the irreversible step never ran
    expect(timeline).toContain("restore");
    await vi.waitFor(() => expect(audits.map((a) => a.reasonCode)).toContain("SESSIONS_CHANGED"));
    // AU-1 — it is the ATTEMPT row's own OUTCOME row: the attempt's operation id, and how the apply began
    expect(outcomesOfTheAttempt(audits)).toEqual([
      expect.objectContaining({
        action: "app.update.apply",
        outcome: "denied",
        reasonCode: "SESSIONS_CHANGED",
        attrs: {
          version: STAGED_VERSION,
          consented: "2",
          began: "restart",
          reason: "the live sessions differ",
        },
      }),
    ]);
    expect(controller.state).toMatchObject({ kind: "staged", blockedBy: "sessions" });
    expect(lastApplyOf(files) ?? null).toBeNull(); // no exit, so nothing to carry to the next launch
  });

  it("Squirrel REFUSES after the stop: relaunch + exit (nothing armed), recorded first, nothing reaches fieldd", async () => {
    const { controller, apply, timeline, files } = await staged(LIVE);
    apply.stageOutcome = { kind: "refused" };
    await controller.restartToInstall();
    const prepared: UpdatePrepared = await apply.plan!.prepare();
    expect(prepared).toEqual({ kind: "exit", relaunch: true, reason: "squirrel-refused" });
    expect(lastApplyOf(files)).toMatchObject({
      branch: "relaunched",
      reason: "squirrel-refused",
      consented: 2,
      trigger: "restart",
    });
    expect(apply.notices).toEqual([]); // the app comes back: no quitting notice
    noFielddAfterTheStop(timeline);
  });

  it("Squirrel TIMES OUT after the stop: the person is told, then exit WITHOUT relaunch; nothing reaches fieldd", async () => {
    const { controller, apply, timeline, files } = await staged();
    apply.stageOutcome = { kind: "timeout" };
    await controller.restartToInstall();
    expect(await apply.plan!.prepare()).toEqual({
      kind: "exit",
      relaunch: false,
      reason: "squirrel-timeout",
    });
    expect(apply.notices[0]?.message).toBe("VibeField is quitting to finish the update");
    expect(lastApplyOf(files)).toMatchObject({
      branch: "exited",
      reason: "squirrel-timeout",
      trigger: "restart",
    });
    // the record is written BEFORE the notice (and so before the exit)
    expect(timeline.indexOf("notify")).toBeGreaterThan(timeline.indexOf("stage"));
    noFielddAfterTheStop(timeline);
  });

  it("an install that stalls is told, recorded, and exits without relaunch; nothing reaches fieldd", async () => {
    const { controller, apply, timeline, files } = await staged();
    await controller.restartToInstall();
    await apply.plan!.prepare();
    apply.plan!.install();
    await apply.plan!.installStalled("the install did not quit the app in time");
    expect(lastApplyOf(files)).toMatchObject({
      branch: "exited",
      reason: "install-failed",
      trigger: "restart",
    });
    expect(apply.notices[0]?.detail).toMatch(/installer didn't take over/);
    // and a later refresh never reads the census once the daemons are down
    await controller.refreshCensus();
    noFielddAfterTheStop(timeline);
  });

  it("an unwired port (Windows, Linux) keeps the update HELD apply-unbuilt", async () => {
    const rig = await stagedController();
    rig.apply.wired = false;
    await rig.controller.check("manual");
    expect(rig.controller.state).toMatchObject({ kind: "staged", blockedBy: "apply-unbuilt" });
    expect(await rig.controller.restartToInstall()).toEqual({ ok: false, reason: "apply-unbuilt" });
    expect(rig.timeline.filter((step) => step === "fieldd:census")).toEqual([]);
  });
});

describe("the next launch carries the last apply's OUTCOME to the ledger, once", () => {
  const state = (lastApply: Record<string, unknown>) =>
    JSON.stringify({
      schemaVersion: 1,
      declined: [],
      remembered: {
        trustRoot: null,
        channels: null,
        policy: { nightly: null, beta: null, stable: null },
      },
      lastCheckAt: null,
      lastApply,
    });

  it("an install that took: the outcome is succeeded, the attempt's operation id kept, then marked delivered", async () => {
    const { audits, files, controller } = await stagedController({
      initial: state({
        at: NOW,
        version: STAGED_VERSION,
        branch: "installing",
        consented: 2,
        operationId: "op-attempt-1",
        audited: false,
      }),
      currentVersion: STAGED_VERSION,
    });
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({
      action: "app.update.apply",
      phase: "outcome",
      outcome: "succeeded",
      operationId: "op-attempt-1",
    });
    await vi.waitFor(() => expect(lastApplyOf(files)).toMatchObject({ audited: true }));
    expect(controller.doctorLines().join("\n")).toMatch(/last apply: .* — installing/);
  });

  it("a timeout's exit: the outcome is failed with its reason, and doctor says it", async () => {
    const { audits, controller } = await stagedController({
      initial: state({
        at: NOW,
        version: STAGED_VERSION,
        branch: "exited",
        reason: "squirrel-timeout",
        consented: 0,
        audited: false,
      }),
      currentVersion: "0.9.0-nightly.20261015",
    });
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({ outcome: "failed", reasonCode: "SQUIRREL_TIMEOUT" });
    expect(controller.doctorLines().join("\n")).toMatch(/exited \(squirrel-timeout\)/);
  });

  it("an outcome already delivered is never appended again", async () => {
    const { audits } = await stagedController({
      initial: state({
        at: NOW,
        version: STAGED_VERSION,
        branch: "relaunched",
        reason: "squirrel-refused",
        consented: 1,
        audited: true,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(audits).toEqual([]);
  });
});

// AU-1 (AU-D11 A; contract-spec X2, X4, X5) — what the last apply LANDED as, judged once by the first launch after it, by
// the version that now runs (every branch), and persisted as `landed`. The window says it from the view's `lastApply`;
// `thisLaunch` marks the launch that judged it, when it runs the version the apply left or landed on; an installed apply
// shows only while its version runs. A record an older app already delivered is history.
describe("AU-1 — the next launch judges what the last apply landed as, once", () => {
  const FROM = "0.9.0-nightly.20261015";
  const RECORD = {
    at: NOW - 60_000,
    version: STAGED_VERSION,
    branch: "installing",
    consented: 0,
    operationId: "op-attempt-2",
    audited: false,
    from: FROM,
    trigger: "restart",
  };
  const state = (lastApply: Record<string, unknown>) =>
    JSON.stringify({ schemaVersion: 1, lastApply });

  it("the version it installed runs: installed, said by THIS launch, and the ledger's row names where it began", async () => {
    const { controller, files, audits } = await stagedController({
      initial: state(RECORD),
      currentVersion: STAGED_VERSION,
    });
    expect(lastApplyOf(files)).toMatchObject({ landed: { at: NOW, outcome: "installed" } });
    expect(controller.view().lastApply).toEqual({
      version: STAGED_VERSION,
      from: FROM,
      outcome: "installed",
      at: NOW,
      trigger: "restart",
      thisLaunch: true,
    });
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({
      phase: "outcome",
      outcome: "succeeded",
      attrs: expect.objectContaining({ from: FROM, began: "restart" }),
    });
    // the ledger's `trigger` is the ATTEMPT row's (`person`, `silent`): one operation, one vocabulary
    expect(audits[0]?.attrs).not.toHaveProperty("trigger");
    // delivered, and the judgement kept
    await vi.waitFor(() =>
      expect(lastApplyOf(files)).toMatchObject({
        audited: true,
        landed: { at: NOW, outcome: "installed" },
      }),
    );
  });

  it("the old version still runs: not-applied", async () => {
    const { controller, files } = await stagedController({
      initial: state(RECORD),
      currentVersion: FROM,
    });
    expect(lastApplyOf(files)).toMatchObject({ landed: { at: NOW, outcome: "not-applied" } });
    expect(controller.view().lastApply).toMatchObject({
      outcome: "not-applied",
      thisLaunch: true,
    });
  });

  it("by version for every branch: an exit Squirrel did arm comes back on the new version, installed", async () => {
    const { controller } = await stagedController({
      initial: state({ ...RECORD, branch: "exited", reason: "squirrel-timeout" }),
      currentVersion: STAGED_VERSION,
    });
    expect(controller.view().lastApply).toMatchObject({ outcome: "installed" });
  });

  it("a record an older app already delivered is history: never judged, never shown (X4)", async () => {
    const { controller, files } = await stagedController({
      initial: state({ ...RECORD, audited: true }),
      currentVersion: STAGED_VERSION,
    });
    expect(lastApplyOf(files)).not.toHaveProperty("landed");
    expect(controller.view().lastApply).toBeUndefined();
  });

  it("a third version (installed by hand after an exit) stamps the judgement, and never says it as its own", async () => {
    const THIRD = "0.9.1-nightly.20261020";
    const { controller, files } = await stagedController({
      initial: state({ ...RECORD, branch: "exited", reason: "install-failed" }),
      currentVersion: THIRD,
    });
    // judged, so no later launch judges it again
    expect(lastApplyOf(files)).toMatchObject({ landed: { at: NOW, outcome: "not-applied" } });
    // neither the version it left nor the one it went to: no "didn't install" from this launch
    expect(controller.view().lastApply).toMatchObject({ outcome: "not-applied" });
    expect(controller.view().lastApply).not.toHaveProperty("thisLaunch");

    // an older app's record names no `from`: an AU-1 launch is never the version it left, so it says nothing either
    const { from: _from, trigger: _trigger, ...older } = RECORD;
    const fromOlder = await stagedController({ initial: state(older), currentVersion: THIRD });
    expect(fromOlder.controller.view().lastApply).toEqual({
      version: STAGED_VERSION,
      outcome: "not-applied",
      at: NOW,
    });
  });

  it("judged once: a later launch keeps the judgement, not as its own; another build never reads it as installed", async () => {
    const first = await stagedController({
      initial: state(RECORD),
      currentVersion: STAGED_VERSION,
    });
    await vi.waitFor(() => expect(lastApplyOf(first.files)).toMatchObject({ audited: true }));
    // the next launch of the version it installed: the same judgement, said as the first launch's
    const again = await stagedController({
      initial: first.files.get("/state.json")!,
      currentVersion: STAGED_VERSION,
      clock: { now: NOW + 3_600_000 },
    });
    expect(again.controller.view().lastApply).toEqual({
      version: STAGED_VERSION,
      from: FROM,
      outcome: "installed",
      at: NOW,
      trigger: "restart",
    });
    // another build on the same state (a hand install, a second copy): never "Updated today" of a version it is not
    const other = await stagedController({
      initial: first.files.get("/state.json")!,
      currentVersion: "0.9.1-nightly.20261020",
      clock: { now: NOW + 3_600_000 },
    });
    expect(lastApplyOf(other.files)).toMatchObject({ landed: { at: NOW, outcome: "installed" } });
    expect(other.controller.view().lastApply).toBeUndefined();
  });
});

// AU-1 (AU-D3 A; LC-12) — the staged clock ("Ready since Oct 19"), persisted across launches, and a person's Restart
// with automatic updates off.
describe("AU-1 — the staged clock, and a person's act with automatic updates off", () => {
  const DAY = 86_400_000;
  const OFF = JSON.stringify({ schemaVersion: 1, enabled: false });

  it("a second launch re-stages the same version and keeps the first day it was ready", async () => {
    const clock = { now: NOW };
    const first = await stagedController({ clock });
    await first.controller.check("manual");
    expect(first.controller.view()).toMatchObject({ phase: "staged", stagedAt: NOW });
    expect(stagedClockOf(first.files)).toEqual({ version: STAGED_VERSION, at: NOW });
    clock.now = NOW + 3 * DAY;
    const second = await stagedController({
      initial: first.files.get("/state.json")!,
      clock,
      currentVersion: "0.9.0-nightly.20261015",
    });
    await second.controller.check("manual");
    expect(second.controller.view()).toMatchObject({ phase: "staged", stagedAt: NOW });
    expect(stagedClockOf(second.files)).toEqual({ version: STAGED_VERSION, at: NOW });
  });

  it("another version starts the clock again", async () => {
    const r = await stagedController({
      initial: JSON.stringify({
        schemaVersion: 1,
        staged: { version: "0.9.0-nightly.20261010", at: NOW - 6 * DAY },
      }),
    });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", stagedAt: NOW });
    expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW });
  });

  it("a decline, a channel change, a lever and a check that finds nothing each clear it", async () => {
    const declined = await stagedController();
    await declined.controller.check("manual");
    declined.controller.decline(STAGED_VERSION);
    expect(stagedClockOf(declined.files)).toBeNull();

    const moved = await stagedController();
    await moved.controller.check("manual");
    moved.controller.setChannel("stable");
    expect(stagedClockOf(moved.files)).toBeNull();

    const yanked = await stagedController();
    await yanked.controller.check("manual");
    yanked.fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: null, stable: null },
      policyVersion: { nightly: 4 },
      levers: { nightly: { yanked: [STAGED_VERSION] } },
    });
    expect(await yanked.controller.restartToInstall()).toEqual({ ok: false, reason: "yanked" });
    expect(stagedClockOf(yanked.files)).toBeNull();

    const nothing = await stagedController();
    await nothing.controller.check("manual");
    expect(stagedClockOf(nothing.files)).not.toBeNull();
    nothing.updater.offers = false;
    await nothing.controller.check("manual");
    expect(nothing.controller.state.kind).toBe("not-available");
    expect(stagedClockOf(nothing.files)).toBeNull();
  });

  it("a check that finds the staged version refused by a lever collects its payload and forgets its clock", async () => {
    const cases: Array<{ levers: Record<string, unknown>; state: Record<string, unknown> }> = [
      { levers: { yanked: [STAGED_VERSION] }, state: { kind: "not-available" } },
      { levers: { killSwitch: true }, state: { kind: "error", unavailable: { state: "killed" } } },
      {
        levers: { floors: { os: "99.0" } },
        state: { kind: "error", unavailable: { state: "floor-unmet" } },
      },
    ];
    for (const { levers, state } of cases) {
      const cache = new FakeCache();
      const r = await stagedController({ cache, hostOs: "15.1.0" });
      await r.controller.check("manual");
      expect(r.controller.state.kind).toBe("staged");
      expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW });
      // the publisher pulls the lever after the download; the next check (a resume, the tray, a person's) reads it,
      // and its own `checking` and `available` have replaced the staged state by the time the lever bites
      r.fx.putRelease(NIGHTLY, {
        heads: { nightly: NIGHTLY, beta: null, stable: null },
        policyVersion: { nightly: 4 },
        levers: { nightly: levers },
      });
      await r.controller.check("manual");
      expect(r.controller.state).toMatchObject(state);
      expect(cache.cleared).toBe(1);
      expect(stagedClockOf(r.files)).toBeNull();
    }
  });

  it("after a relaunch the clock names the payload in the cache: a lever on it collects it, on another keeps it", async () => {
    const OLDER = "0.9.0-nightly.20261010";
    const relaunch = (version: string, levers: Record<string, unknown>, cache: FakeCache) =>
      stagedController({
        initial: JSON.stringify({ schemaVersion: 1, staged: { version, at: NOW - DAY } }),
        levers,
        cache,
      });
    // the same version, yanked: its payload goes, and its clock with it
    const sameCache = new FakeCache();
    const same = await relaunch(STAGED_VERSION, { yanked: [STAGED_VERSION] }, sameCache);
    await same.controller.check("manual");
    expect(same.controller.state).toEqual({ kind: "not-available" });
    expect(sameCache.cleared).toBe(1);
    expect(stagedClockOf(same.files)).toBeNull();
    // an older version under a kill: the kill refuses every version, so it goes too
    const killedCache = new FakeCache();
    const killed = await relaunch(OLDER, { killSwitch: true }, killedCache);
    await killed.controller.check("manual");
    expect(killedCache.cleared).toBe(1);
    expect(stagedClockOf(killed.files)).toBeNull();
    // a yank of the head alone leaves an older version's payload and clock alone
    const keptCache = new FakeCache();
    const kept = await relaunch(OLDER, { yanked: [STAGED_VERSION] }, keptCache);
    await kept.controller.check("manual");
    expect(kept.controller.state).toEqual({ kind: "not-available" });
    expect(keptCache.cleared).toBe(0);
    expect(stagedClockOf(kept.files)).toEqual({ version: OLDER, at: NOW - DAY });
  });

  it("a decline while the click reads the fresh policy stops the prepare: the update is never staged again", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let reading = false;
    const cache = new FakeCache();
    const r = await stagedController({
      cache,
      // the click's fetcher waits at the gate, then finds the policy unreachable
      fetch: async () => {
        reading = true;
        await gate;
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      },
    });
    await r.controller.check("manual");
    const preparing = r.controller.prepareRestart();
    await vi.waitFor(() => expect(reading).toBe(true));
    r.controller.decline(STAGED_VERSION);
    open();
    expect(await preparing).toEqual({ ok: false, reason: "not-staged" });
    // the decline's state and collection stand: never `staged`, blocked by the policy, over a deleted payload
    expect(r.controller.state).toEqual({ kind: "available", version: STAGED_VERSION });
    expect(cache.cleared).toBe(1);
    expect(stagedClockOf(r.files)).toBeNull();
    expect(r.audits.map((a) => a.reasonCode)).not.toContain("POLICY_UNREACHABLE");
  });

  it("a launch on the staged version clears it: it installed", async () => {
    const r = await stagedController({
      initial: JSON.stringify({
        schemaVersion: 1,
        staged: { version: STAGED_VERSION, at: NOW - DAY },
      }),
      currentVersion: STAGED_VERSION,
    });
    expect(stagedClockOf(r.files)).toBeNull();
  });

  it("a person may restart a staged update with automatic updates off; the safe window never applies it", async () => {
    const r = await stagedController({ initial: OFF, window: {} });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "available", version: STAGED_VERSION });
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
    // the safe window is open, yet nothing applied on its own: the off switch governs what happens without a person
    expect(r.apply.plan).toBeNull();
    expect(await r.controller.considerSilentApply("timer")).toEqual({
      applying: false,
      reason: "disabled",
    });
    // LC-12 — the person's Restart is a person's act
    expect(await r.controller.prepareRestart()).toMatchObject({
      ok: true,
      version: STAGED_VERSION,
    });
  });

  it("with automatic updates off, a check keeps the version a person downloaded by hand staged (G5)", async () => {
    const r = await stagedController({ initial: OFF });
    await r.controller.check("manual");
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
    // the card's, the tray's or the Me row's "Check for updates" finds the same version: its payload is in the cache,
    // so Restart to Update stays, on the day it first became ready, and nothing downloads again
    expect(await r.controller.checkForPerson()).toEqual({
      outcome: "held",
      version: STAGED_VERSION,
    });
    expect(r.controller.view()).toMatchObject({
      phase: "staged",
      version: STAGED_VERSION,
      stagedAt: NOW,
      enabled: false,
    });
    expect(r.updater.downloads).toBe(1);
    expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW });
  });
});

// AU-1 (LC-5, X1; AU-G5, AU-G6, X11, X13) — the two doors a person acts through: a check answered when the CHECK
// settles, and a download of THIS found version (automatic updates off, or a skip taken back).
describe("AU-1 — a person's check and download", () => {
  const OFF = JSON.stringify({ schemaVersion: 1, enabled: false });
  const SKIPPED = JSON.stringify({ schemaVersion: 1, declined: [STAGED_VERSION] });
  const holdDownload = (updater: { holdDownload: Promise<void> | null }) => {
    let release: () => void = () => {};
    updater.holdDownload = new Promise((resolve) => {
      release = resolve;
    });
    return () => release();
  };

  it("checkForPerson answers up-to-date, and found before the download completes", async () => {
    const quiet = await stagedController();
    quiet.updater.offers = false;
    expect(await quiet.controller.checkForPerson()).toEqual({ outcome: "up-to-date" });

    const r = await stagedController();
    const release = holdDownload(r.updater);
    expect(await r.controller.checkForPerson()).toEqual({
      outcome: "found",
      version: STAGED_VERSION,
    });
    // answered while the download runs: the view says it
    expect(r.controller.view()).toMatchObject({ phase: "downloading", version: STAGED_VERSION });
    // busy while it runs: one check or download at a time
    expect(await r.controller.checkForPerson()).toEqual({ outcome: "busy" });
    release();
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
  });

  it("checkForPerson answers held for a skipped version and with automatic updates off", async () => {
    const skipped = await stagedController({ initial: SKIPPED });
    expect(await skipped.controller.checkForPerson()).toEqual({
      outcome: "held",
      version: STAGED_VERSION,
    });
    expect(skipped.controller.view()).toMatchObject({ phase: "available", declined: true });

    const off = await stagedController({ initial: OFF });
    expect(await off.controller.checkForPerson()).toEqual({
      outcome: "held",
      version: STAGED_VERSION,
    });
    expect(off.updater.downloads).toBe(0);
  });

  it("checkForPerson answers failed when the check throws", async () => {
    const r = await stagedController();
    r.updater.checkForUpdates = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    expect(await r.controller.checkForPerson()).toEqual({ outcome: "failed" });
  });

  it("downloadForPerson with automatic updates off downloads the found version, audited updates-off", async () => {
    const r = await stagedController({ initial: OFF });
    await r.controller.check("manual");
    expect(r.updater.downloads).toBe(0);
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    expect(r.audits.find((a) => a.action === "app.update.download")).toMatchObject({
      outcome: "succeeded",
      attrs: { version: STAGED_VERSION, why: "updates-off" },
    });
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
    expect(r.updater.downloads).toBe(1);
  });

  it("downloadForPerson after a skip takes the skip back, audited skipped", async () => {
    const r = await stagedController({ initial: SKIPPED });
    await r.controller.check("manual");
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    expect(JSON.parse(r.files.get("/state.json")!).declined).toEqual([]);
    expect(r.audits.find((a) => a.action === "app.update.download")).toMatchObject({
      attrs: { version: STAGED_VERSION, why: "skipped" },
    });
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
  });

  it("downloadForPerson refuses a version a lever refuses, in main's words, and downloads nothing", async () => {
    // a skipped version stays found even when the policy yanks it (the decline is judged first)
    const r = await stagedController({ initial: SKIPPED, levers: { yanked: [STAGED_VERSION] } });
    await r.controller.check("manual");
    expect(r.controller.state).toEqual({ kind: "available", version: STAGED_VERSION });
    // nothing downloaded: the words say the download, never the install (`downloadNotice`)
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({
      ok: false,
      reason: "yanked",
      words: {
        message: "VibeField didn't download the update",
        detail: expect.stringMatching(/^The Oct 16 nightly was withdrawn, so it won't download\./),
      },
    });
    expect(r.updater.downloads).toBe(0);
    expect(r.controller.state.kind).toBe("not-available");
    // the skip is not taken back by a refusal
    expect(JSON.parse(r.files.get("/state.json")!).declined).toEqual([STAGED_VERSION]);
  });

  it("downloadForPerson: nothing found is not-available; while it downloads, the same version is ok once", async () => {
    const idle = await stagedController();
    expect(await idle.controller.downloadForPerson(STAGED_VERSION)).toEqual({
      ok: false,
      reason: "not-available",
    });

    const r = await stagedController();
    const release = holdDownload(r.updater);
    const running = r.controller.check("manual");
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("downloading"));
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    expect(await r.controller.downloadForPerson("0.9.1-nightly.20261020")).toEqual({
      ok: false,
      reason: "not-available",
    });
    release();
    await running;
    expect(r.updater.downloads).toBe(1);
    expect(r.audits.some((a) => a.action === "app.update.download")).toBe(false);
  });

  it("downloadForPerson is one download while a skip's cache collection runs (a double click on Download anyway)", async () => {
    const cache = new FakeCache();
    let collected: () => void = () => {};
    cache.hold = new Promise((resolve) => {
      collected = resolve;
    });
    const r = await stagedController({ cache });
    await r.controller.check("manual");
    expect(r.controller.state.kind).toBe("staged");
    // the skip deletes the staged payload; its collection is still running at the first click
    r.controller.decline(STAGED_VERSION);
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    // the download is the state at once: the second click finds it underway
    expect(r.controller.state).toMatchObject({ kind: "downloading", version: STAGED_VERSION });
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    collected();
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
    // the check's own download, then exactly one more: one audit row, and it says what happened (a skip taken back)
    expect(r.updater.downloads).toBe(2);
    expect(r.audits.filter((a) => a.action === "app.update.download")).toEqual([
      expect.objectContaining({ attrs: { version: STAGED_VERSION, why: "skipped" } }),
    ]);
  });

  it("a skip during the cache collection cancels the download that waits for it", async () => {
    const cache = new FakeCache();
    let collected: () => void = () => {};
    cache.hold = new Promise((resolve) => {
      collected = resolve;
    });
    const r = await stagedController({ cache });
    await r.controller.check("manual");
    r.controller.decline(STAGED_VERSION);
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    // skipped again before the collection ends: the waiting download never starts
    r.controller.decline(STAGED_VERSION);
    collected();
    await vi.waitFor(() => expect(cache.cleared).toBe(2));
    expect(r.controller.state).toEqual({ kind: "available", version: STAGED_VERSION });
    expect(r.updater.downloads).toBe(1);
  });
});

// WP12d (L3b-i, build-wp12-updater.md §12; the PM's ruling 2026-10-15 16:03Z) — two reads in front of the census, both
// before anything is torn down. B2: a FRESH verified policy at the click (no offline allowance); a lever that now
// refuses stops the apply. B3: the native plane by digest from that same chain — untouched keeps the floor and its
// sessions (no census, no box, `native: false`), anything else is today's path.
describe("restartToInstall — L3b-i: the fresh policy (B2) and the planes by digest (B3)", () => {
  const LOCAL: NativePlane = {
    digest: "e".repeat(64),
    members: ["bin/field-native", "bin/field-terminal-host", "bin/sidecar-slim"],
  };
  const OFFLINE: FetchBytes = async () => {
    throw new Error("net::ERR_INTERNET_DISCONNECTED");
  };

  async function stagedWith(
    opts: Parameters<typeof stagedController>[0],
    sessions: CensusSnapshot = { known: true, sessions: [] },
  ) {
    const rig = await stagedController(opts);
    rig.apply.snapshot = sessions;
    await rig.controller.check("manual");
    rig.timeline.length = 0;
    rig.audits.length = 0;
    return rig;
  }

  /** The policy re-published after the download: a higher version, its levers as given. */
  function republish(
    fx: FixtureOrigin,
    levers: Record<string, unknown>,
    signer?: FixtureOrigin["stranger"],
  ) {
    fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: null, stable: null },
      policyVersion: { nightly: 4 },
      levers: { nightly: levers },
      ...(signer !== undefined ? { policySigner: signer } : {}),
    });
  }

  it("offline at the click HOLDS `policy-unreachable`, in the PM's words, and tears nothing down", async () => {
    const rig = await stagedWith({ fetch: OFFLINE }, LIVE);
    expect(await rig.controller.restartToInstall()).toEqual({
      ok: false,
      reason: "policy-unreachable",
    });
    expect(rig.apply.notices.map((box) => box.detail)).toEqual([
      "VibeField checks the update policy before installing and couldn't reach it; try again when online.",
    ]);
    expect(rig.timeline).toEqual(["fieldd:audit:outcome:denied", "notify"]);
    expect(rig.audits[0]).toMatchObject({
      action: "app.update.apply",
      outcome: "denied",
      reasonCode: "POLICY_UNREACHABLE",
    });
    expect(rig.controller.state).toMatchObject({ kind: "staged", blockedBy: "policy-unreachable" });
    expect(rig.apply.plan).toBeNull();
  });

  it("no fetcher wired is unreachable too — never an apply on the policy the download saw", async () => {
    const rig = await stagedWith({ fetch: null });
    expect(await rig.controller.restartToInstall()).toEqual({
      ok: false,
      reason: "policy-unreachable",
    });
    expect(rig.apply.plan).toBeNull();
  });

  it("a fetch that never answers is unreachable after the bound", async () => {
    const rig = await stagedWith({ fetch: () => new Promise<never>(() => undefined) });
    vi.useFakeTimers();
    try {
      const outcome = rig.controller.restartToInstall();
      await vi.advanceTimersByTimeAsync(FRESH_POLICY_BOUND_MS);
      expect(await outcome).toEqual({ ok: false, reason: "policy-unreachable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a kill switch published after the download stops the apply: said, nothing torn down, the payload deleted (B6)", async () => {
    const cache = new FakeCache();
    const rig = await stagedWith({ cache });
    republish(rig.fx, { killSwitch: true });
    expect(await rig.controller.restartToInstall()).toEqual({ ok: false, reason: "killed" });
    expect(rig.apply.notices[0]?.detail).toBe(
      "Updates on the nightly channel are paused by VibeField's publisher. Nothing changed; your current version keeps running.",
    );
    expect(rig.audits[0]).toMatchObject({ action: "app.update.apply", reasonCode: "KILLED" });
    // L3b-ii: a kill no longer holds the staged payload — it is deleted, and a lifted kill downloads again
    expect(rig.controller.state).toMatchObject({ kind: "error", unavailable: { state: "killed" } });
    await vi.waitFor(() => expect(cache.cleared).toBe(1));
    expect(rig.apply.plan).toBeNull();
    expect(rig.timeline).not.toContain("fieldd:census");
  });

  it("a yank published after the download forgets the staged version; a floor above this Mac skips it", async () => {
    const yanked = await stagedWith({});
    republish(yanked.fx, { yanked: [STAGED_VERSION] });
    expect(await yanked.controller.restartToInstall()).toEqual({ ok: false, reason: "yanked" });
    expect(yanked.controller.state).toEqual({ kind: "not-available" });
    expect(yanked.audits[0]).toMatchObject({ reasonCode: "YANKED" });
    const floored = await stagedWith({ hostOs: "15.1.0" });
    republish(floored.fx, { floors: { os: "99.0" } });
    expect(await floored.controller.restartToInstall()).toEqual({
      ok: false,
      reason: "floor-unmet",
    });
    expect(floored.apply.notices[0]?.detail).toContain("needs macOS 99.0 or later");
    expect(floored.controller.state).toMatchObject({
      kind: "error",
      unavailable: { state: "floor-unmet" },
    });
  });

  it("a policy that no longer verifies holds `policy-unverified`, its state in the ledger", async () => {
    const rig = await stagedWith({});
    republish(rig.fx, {}, rig.fx.stranger);
    expect(await rig.controller.restartToInstall()).toEqual({
      ok: false,
      reason: "policy-unverified",
    });
    expect(rig.audits[0]).toMatchObject({
      reasonCode: "POLICY_UNVERIFIED",
      attrs: { state: "feed-unverified" },
    });
    expect(rig.apply.plan).toBeNull();
  });

  it("B3 untouched: live sessions, yet no census, no box — fieldd stops alone and the floor keeps them", async () => {
    const rig = await stagedWith({ nativePlane: LOCAL, manifestNative: LOCAL }, LIVE);
    expect(rig.controller.state).toMatchObject({ kind: "staged", keepsSessions: true });
    expect(rig.controller.state).not.toHaveProperty("blockedBy");
    expect(rig.controller.doctorLines()).toContain(
      `native plane: untouched by ${STAGED_VERSION} — its sessions keep running`,
    );
    expect(await rig.controller.restartToInstall()).toEqual({ ok: true });
    expect(rig.apply.boxes).toEqual([]);
    expect(rig.timeline).toEqual(["fieldd:audit:attempt", "quit"]);
    await rig.apply.plan!.prepare();
    expect(rig.apply.stoppedNative).toBe(false);
    expect(rig.apply.stoppedWith).toEqual([]);
    noFielddAfterTheStop(rig.timeline);
  });

  it("B3 touched — another digest, an extra member, or no manifest: the census, the box, the floor stopped", async () => {
    const cases: Array<Parameters<typeof stagedController>[0]> = [
      { nativePlane: LOCAL, manifestNative: { ...LOCAL, digest: "f".repeat(64) } },
      {
        nativePlane: LOCAL,
        manifestNative: { ...LOCAL, members: [...LOCAL.members, "bin/truffle-sidecar"].sort() },
      },
      { nativePlane: LOCAL },
    ];
    for (const opts of cases) {
      const rig = await stagedWith(opts, LIVE);
      expect(rig.controller.state).toMatchObject({ kind: "staged", blockedBy: "sessions" });
      expect(await rig.controller.restartToInstall()).toEqual({ ok: true });
      expect(rig.apply.boxes[0]?.message).toBe("Updating ends 2 terminal sessions");
      await rig.apply.plan!.prepare();
      expect(rig.apply.stoppedNative).toBe(true);
    }
  });

  it("B3 when the head moved past the staged version: its manifest says nothing of the staged bytes — touched", async () => {
    const rig = await stagedWith({ nativePlane: LOCAL, manifestNative: LOCAL }, LIVE);
    const NEXT = "nightly-20261017";
    rig.fx.setReleases([NEXT, NIGHTLY]);
    rig.fx.putRelease(NEXT, {
      heads: { nightly: NEXT, beta: null, stable: null },
      headsVersion: 11,
      policyVersion: { nightly: 4 },
    });
    rig.fx.putFeed(NEXT, "0.9.0-nightly.20261017");
    rig.fx.putManifest(NEXT, "0.9.0-nightly.20261017", LOCAL);
    expect(await rig.controller.restartToInstall()).toEqual({ ok: true });
    expect(rig.apply.boxes).toHaveLength(1);
    await rig.apply.plan!.prepare();
    expect(rig.apply.stoppedNative).toBe(true);
    expect(rig.controller.doctorLines()).toContain(
      "native plane: touched (head-moved) — the apply ends its sessions",
    );
  });

  it("doctor names the policy and its levers", async () => {
    const rig = await stagedWith({ currentVersion: "0.8.0" });
    republish(rig.fx, { yanked: ["0.8.0"], requireUserConfirmation: true, minSupported: "0.9.0" });
    await rig.controller.check("manual");
    const lines = rig.controller.doctorLines();
    expect(lines).toContain("policy: v4 for nightly — confirmation required, 1 yanked");
    expect(lines).toContain("the running version 0.8.0 is yanked; the next update replaces it");
    expect(lines).toContain(
      "UNSUPPORTED: 0.8.0 is below the minimum supported 0.9.0 (advisory, never a block)",
    );
  });
});

// WP12d (L3b-ii, build-wp12-updater.md §12 B4/B6; the PM's ruling 2026-10-15 16:03Z and its reading point 17:07Z) — the
// silent self-apply, its timer, and the staged cache. The timer lives ONLY while staged and dies on every exit branch
// and on a decline; the silent path asks no one, and a release that touches the floor needs a FRESH census at zero.
describe("the silent self-apply (B4) and the staged cache (B6)", () => {
  const LOCAL: NativePlane = {
    digest: "e".repeat(64),
    members: ["bin/field-native", "bin/field-terminal-host", "bin/sidecar-slim"],
  };

  async function rig(
    opts: Parameters<typeof stagedController>[0],
    sessions: CensusSnapshot = { known: true, sessions: [] },
  ) {
    const built = await stagedController(opts);
    built.apply.snapshot = sessions;
    return built;
  }

  it("staged with the safe window open: it applies ON ITS OWN — no box, the attempt says silent, the timer dies", async () => {
    const r = await rig({ window: {} });
    await r.controller.check("manual");
    expect(r.apply.plan).not.toBeNull();
    expect(r.apply.boxes).toEqual([]);
    expect(r.apply.notices).toEqual([]);
    expect(r.audits.find((a) => a.phase === "attempt")).toMatchObject({
      attrs: expect.objectContaining({ trigger: "silent", native: "stop" }),
    });
    expect(r.controller.silentTimerAlive).toBe(false);
    // the fresh census was read by the apply itself, after the check's own read
    expect(r.timeline.filter((step) => step === "fieldd:census").length).toBeGreaterThanOrEqual(2);
    await r.apply.plan!.prepare();
    expect(r.controller.silentTimerAlive).toBe(false);
    // AU-1 (X3) — the record says the safe window began it
    expect(lastApplyOf(r.files)).toMatchObject({ branch: "installing", trigger: "silent" });
  });

  it("each closed clause holds it, named: a window open, no tray, the display held or unread", async () => {
    for (const [window, clause] of [
      [{ windowless: false }, "windowless"],
      [{ trayResident: false }, "tray-resident"],
      [{ display: true }, "display-awake-unheld"],
      [{ display: "unknown" as const }, "display-awake-unheld"],
    ] as const) {
      const r = await rig({ window });
      await r.controller.check("manual");
      expect(r.apply.plan, clause).toBeNull();
      expect(r.controller.doctorLines().some((line) => line.includes(clause))).toBe(true);
      expect(r.controller.silentTimerAlive).toBe(true);
    }
  });

  it("the policy's requireUserConfirmation keeps it a person's act", async () => {
    const r = await rig({ window: {}, levers: { requireUserConfirmation: true } });
    await r.controller.check("manual");
    expect(r.apply.plan).toBeNull();
    expect(await r.controller.considerSilentApply("timer")).toEqual({
      applying: false,
      reason: "confirmation-required",
    });
  });

  it("requireUserConfirmation published after the download holds it at the apply's fresh read, before the attempt", async () => {
    const safe = { windowless: false };
    const r = await rig({ window: safe });
    await r.controller.check("manual");
    expect(r.apply.plan).toBeNull(); // a window is open: the silent path waits
    // the publisher turns the lever on; the policy the download saw does not say it
    r.fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: null, stable: null },
      policyVersion: { nightly: 4 },
      levers: { nightly: { requireUserConfirmation: true } },
    });
    safe.windowless = true;
    expect(await r.controller.considerSilentApply("window-closed")).toEqual({
      applying: false,
      reason: "confirmation-required",
    });
    expect(r.apply.plan).toBeNull();
    expect(r.timeline).not.toContain("fieldd:audit:attempt");
    expect(r.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
  });

  it("automatic updates switched off while the apply reads the fresh policy: the silent path holds, nothing torn down", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let reading = false;
    const origin: { fetch: FetchBytes | null } = { fetch: null };
    const r = await rig({
      window: {},
      // the click's fetcher waits at the gate: the fresh read is what the person's switch races
      fetch: async (url) => {
        reading = true;
        await gate;
        return origin.fetch!(url);
      },
    });
    origin.fetch = r.fx.fetch;
    const running = r.controller.check("manual");
    await vi.waitFor(() => expect(reading).toBe(true));
    r.controller.setEnabled(false);
    open();
    await running;
    expect(r.apply.plan).toBeNull();
    expect(r.timeline).not.toContain("fieldd:audit:attempt");
    expect(r.controller.doctorLines()).toContain("silent apply: not now (staged) — disabled");
    expect(r.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
  });

  it("switched off while the ATTEMPT row is appended: held before the quit, and the ATTEMPT row gets its OUTCOME row", async () => {
    const safe = { windowless: false };
    const r = await rig({ window: safe });
    await r.controller.check("manual");
    expect(r.apply.plan).toBeNull(); // a window is open: the silent path waits
    const release = holdAttempt(r.gates);
    safe.windowless = true;
    const considering = r.controller.considerSilentApply("window-closed");
    await vi.waitFor(() => expect(r.timeline).toContain("fieldd:audit:attempt"));
    r.controller.setEnabled(false);
    release();
    expect(await considering).toEqual({ applying: false, reason: "disabled" });
    expect(r.apply.plan).toBeNull();
    expect(r.timeline).not.toContain("quit");
    // one OUTCOME row closes the ATTEMPT row: its operation id, the refusal, and how the apply began
    expect(outcomesOfTheAttempt(r.audits)).toEqual([
      expect.objectContaining({
        action: "app.update.apply",
        outcome: "denied",
        reasonCode: "DISABLED",
        attrs: { version: STAGED_VERSION, consented: "0", began: "silent" },
      }),
    ]);
    expect(r.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
  });

  it("a release that touches the floor waits for a FRESH census at zero — live sessions hold it, and nobody is asked", async () => {
    const r = await rig({ window: {} }, LIVE);
    await r.controller.check("manual");
    expect(r.apply.plan).toBeNull();
    expect(r.apply.boxes).toEqual([]);
    expect(await r.controller.considerSilentApply("timer")).toEqual({
      applying: false,
      reason: "sessions",
    });
  });

  it("a release that leaves the floor alone applies silently over live sessions — they keep running", async () => {
    const r = await rig({ window: {}, nativePlane: LOCAL, manifestNative: LOCAL }, LIVE);
    await r.controller.check("manual");
    expect(r.apply.plan).not.toBeNull();
    expect(r.apply.boxes).toEqual([]);
    await r.apply.plan!.prepare();
    expect(r.apply.stoppedNative).toBe(false);
  });

  it("offline, the silent path holds without a box", async () => {
    const r = await rig({
      window: {},
      fetch: async () => {
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      },
    });
    await r.controller.check("manual");
    expect(r.apply.plan).toBeNull();
    expect(r.apply.notices).toEqual([]);
    expect(r.controller.state).toMatchObject({ kind: "staged", blockedBy: "policy-unreachable" });
  });

  it("the timer lives only while staged: born staged, dead on a decline, back on an aborted apply, dead at the stop", async () => {
    const declined = await rig({ window: { windowless: false } });
    await declined.controller.check("manual");
    expect(declined.controller.silentTimerAlive).toBe(true);
    declined.controller.decline(STAGED_VERSION);
    expect(declined.controller.silentTimerAlive).toBe(false);

    const aborted = await rig({ window: { windowless: false } });
    await aborted.controller.check("manual");
    expect(await aborted.controller.restartToInstall()).toEqual({ ok: true });
    expect(aborted.controller.silentTimerAlive).toBe(false); // the quit is underway
    aborted.apply.stop = { ok: false, reason: "a session was born" };
    expect(await aborted.apply.plan!.prepare()).toMatchObject({ kind: "abort" });
    aborted.apply.plan!.aborted("a session was born");
    expect(aborted.controller.silentTimerAlive).toBe(true); // still staged, nothing torn down

    const stopped = await rig({ window: { windowless: false } });
    await stopped.controller.check("manual");
    expect(await stopped.controller.restartToInstall()).toEqual({ ok: true });
    await stopped.apply.plan!.prepare();
    expect(stopped.controller.silentTimerAlive).toBe(false);
    stopped.controller.dispose();
    expect(stopped.controller.silentTimerAlive).toBe(false);
  });

  it("one apply at a time: a second Restart while the first is mid-check is the same apply", async () => {
    const r = await rig({ window: { windowless: false } });
    await r.controller.check("manual");
    const [first, second] = await Promise.all([
      r.controller.restartToInstall(),
      r.controller.restartToInstall(),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "quit-underway" });
    expect(r.timeline.filter((step) => step === "quit")).toEqual(["quit"]);
  });

  it("the timer re-evaluates every 30 minutes while staged", async () => {
    vi.useFakeTimers();
    try {
      const r = await rig({ window: { windowless: false } });
      await r.controller.check("manual");
      const consider = vi.spyOn(r.controller, "considerSilentApply");
      await vi.advanceTimersByTimeAsync(SILENT_RECHECK_MS);
      expect(consider).toHaveBeenCalledWith("timer");
      r.controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("B6: a check that finds nothing, a decline, and a yank each delete the staged payload; doctor says the size", async () => {
    const quiet = new FakeCache();
    const nothing = await rig({ cache: quiet });
    (
      nothing.controller as unknown as {
        options: { updater: { checkForUpdates: () => Promise<unknown> } };
      }
    ).options.updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
    await nothing.controller.check("manual");
    await vi.waitFor(() => expect(quiet.cleared).toBe(1));

    const declinedCache = new FakeCache();
    const declined = await rig({ cache: declinedCache });
    await declined.controller.check("manual");
    expect(declined.controller.doctorLines()).toContain("update cache: 42.0 MB");
    declined.controller.decline(STAGED_VERSION);
    await vi.waitFor(() => expect(declinedCache.cleared).toBe(1));

    const yankedCache = new FakeCache();
    const yanked = await rig({ cache: yankedCache });
    await yanked.controller.check("manual");
    yanked.fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: null, stable: null },
      policyVersion: { nightly: 4 },
      levers: { nightly: { yanked: [STAGED_VERSION] } },
    });
    expect(await yanked.controller.restartToInstall()).toEqual({ ok: false, reason: "yanked" });
    await vi.waitFor(() => expect(yankedCache.cleared).toBe(1));
    await vi.waitFor(() =>
      expect(yanked.controller.doctorLines()).toContain("update cache: 0.0 MB"),
    );
  });
});

// WP12d (L3c-i; build-wp12-updater.md §13 C2/C6, the PM's ruling 2026-10-15 18:17Z) — the two-phase apply the tray and
// the Settings card share, and the one projection they both render. `prepareRestart` takes ONE snapshot and binds a
// token to it; `confirmRestart` acts on exactly that snapshot (fieldd's re-check is the last word); an expired,
// replaced or spent token is `expired` — a fresh prepare, never a silent proceed. No apply asks twice.
describe("the two-phase apply (C2) and the one projection (C6)", () => {
  // L3c-ii — an expired snapshot answers with main's own sentence, the one the tray's notice says
  const EXPIRED = {
    ok: false,
    reason: "expired",
    words: {
      message: "VibeField didn't install the update",
      detail:
        "The list of sessions it would end may have changed while you decided. Nothing changed; choose Restart to Update again.",
    },
  };

  async function staged(
    opts: Parameters<typeof stagedController>[0],
    sessions: CensusSnapshot = LIVE,
  ) {
    const r = await stagedController(opts);
    r.apply.snapshot = sessions;
    await r.controller.check("manual");
    r.timeline.length = 0;
    r.audits.length = 0;
    return r;
  }

  it("the card's consent: ONE snapshot and a token; confirm acts on THAT snapshot, with no box of its own", async () => {
    const r = await staged({});
    const prepared = await r.controller.prepareRestart();
    expect(prepared).toMatchObject({
      ok: true,
      version: STAGED_VERSION,
      keepsSessions: false,
      sessions: LIVE.sessions,
    });
    if (!prepared.ok) return;
    // L3c-ii — the consent's words travel with the snapshot: the very words the tray's box joins
    expect(prepared.consent).toEqual(consentWords(STAGED_VERSION, LIVE.sessions));
    expect(prepared.consent?.message).toBe(
      `Updating ends ${LIVE.sessions.length} terminal sessions`,
    );
    // a session is born after the snapshot: the stop still names exactly what the person saw (fieldd re-checks)
    r.apply.snapshot = {
      known: true,
      sessions: [...LIVE.sessions, { sessionId: "01SESSIONCCCCCCCCCCCCCCCCC" }],
    };
    expect(await r.controller.confirmRestart(prepared.token)).toEqual({ ok: true });
    expect(r.apply.boxes).toEqual([]); // the card was the consent: main asks nothing more
    await r.apply.plan!.prepare();
    expect(r.apply.stoppedWith).toEqual(LIVE.sessions.map((session) => session.sessionId));
    expect(r.timeline.filter((step) => step === "fieldd:census")).toEqual(["fieldd:census"]);
  });

  it("a token is one use: replaced by a later prepare, spent by any confirm, dead after two minutes or a changed update", async () => {
    const clock = { now: NOW };
    const r = await staged({ clock });
    const first = await r.controller.prepareRestart();
    const second = await r.controller.prepareRestart();
    if (!first.ok || !second.ok) throw new Error("prepare refused");
    expect(await r.controller.confirmRestart(first.token)).toEqual(EXPIRED);
    // the wrong token spent the snapshot too: the right one now needs a fresh prepare
    expect(await r.controller.confirmRestart(second.token)).toEqual(EXPIRED);

    const third = await r.controller.prepareRestart();
    if (!third.ok) throw new Error("prepare refused");
    expect(third.expiresAt).toBe(NOW + PREPARE_TTL_MS);
    clock.now += PREPARE_TTL_MS + 1;
    expect(await r.controller.confirmRestart(third.token)).toEqual(EXPIRED);

    clock.now = NOW;
    const fourth = await r.controller.prepareRestart();
    if (!fourth.ok) throw new Error("prepare refused");
    r.controller.decline(STAGED_VERSION);
    expect(await r.controller.confirmRestart(fourth.token)).toEqual(EXPIRED);
    expect(r.apply.plan).toBeNull(); // nothing ever proceeded
  });

  it("the tray's native box sits between the same two phases — left open past two minutes, nothing proceeds, and it says so", async () => {
    const clock = { now: NOW };
    const r = await staged({ clock });
    r.apply.confirm = async (box) => {
      r.apply.boxes.push(box);
      clock.now += PREPARE_TTL_MS + 1;
      return true;
    };
    expect(await r.controller.restartToInstall()).toEqual({ ok: false, reason: "expired" });
    expect(r.apply.boxes).toHaveLength(1);
    expect(r.apply.notices[0]?.detail).toContain("choose Restart to Update again");
    expect(r.apply.plan).toBeNull();
  });

  it("the update moved while the ATTEMPT row was appended — a decline, a channel change, a check: nothing proceeds", async () => {
    // nothing serialises these doors against the person's confirm: each moves the staged state during the row's await
    type Rig = Awaited<ReturnType<typeof staged>>;
    const movers: Array<[string, (r: Rig) => unknown]> = [
      ["a decline", (r) => r.controller.decline(STAGED_VERSION)],
      ["a channel change", (r) => r.controller.setChannel("stable")],
      [
        "a check that finds nothing",
        (r) => {
          r.updater.offers = false;
          return r.controller.check("manual");
        },
      ],
    ];
    for (const [name, move] of movers) {
      const r = await staged({});
      const prepared = await r.controller.prepareRestart();
      if (!prepared.ok) throw new Error("prepare refused");
      const release = holdAttempt(r.gates);
      const confirming = r.controller.confirmRestart(prepared.token);
      await vi.waitFor(() => expect(r.timeline).toContain("fieldd:audit:attempt"));
      const moving = move(r);
      release();
      expect(await confirming, name).toEqual(EXPIRED);
      await moving;
      expect(r.apply.plan, name).toBeNull();
      // one OUTCOME row closes the ATTEMPT row, under its operation id
      expect(outcomesOfTheAttempt(r.audits), name).toEqual([
        expect.objectContaining({
          action: "app.update.apply",
          outcome: "denied",
          reasonCode: "NOT_STAGED",
          attrs: { version: STAGED_VERSION, consented: "2", began: "restart" },
        }),
      ]);
    }
  });

  it("a quit already underway at the last step: refused, and the ATTEMPT row gets its OUTCOME row", async () => {
    const r = await staged({});
    r.apply.quitForUpdate = () => {
      r.timeline.push("quit");
      return false;
    };
    const prepared = await r.controller.prepareRestart();
    if (!prepared.ok) throw new Error("prepare refused");
    expect(await r.controller.confirmRestart(prepared.token)).toEqual({
      ok: false,
      reason: "quit-underway",
    });
    expect(outcomesOfTheAttempt(r.audits)).toEqual([
      expect.objectContaining({
        outcome: "denied",
        reasonCode: "QUIT_UNDERWAY",
        attrs: { version: STAGED_VERSION, consented: "2", began: "restart" },
      }),
    ]);
  });

  it("a refusal at prepare carries the words the tray says, and the card's path shows no box of main's", async () => {
    const r = await staged({
      fetch: async () => {
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      },
    });
    expect(await r.controller.prepareRestart()).toEqual({
      ok: false,
      reason: "policy-unreachable",
      words: {
        message: "VibeField didn't install the update",
        detail:
          "VibeField checks the update policy before installing and couldn't reach it; try again when online.",
      },
    });
    expect(r.apply.notices).toEqual([]);
  });

  it("C6 — a channel below the build's is a deliberate downgrade: persisted, audited, the old payload dropped, subscribers told", async () => {
    const cache = new FakeCache();
    const r = await staged({ cache }, { known: true, sessions: [] });
    const updater = (r.controller as unknown as { options: { updater: FakeUpdater } }).options
      .updater;
    expect(updater.allowDowngrade).toBe(false); // a nightly build on nightly
    const heard: string[] = [];
    r.controller.subscribe((state) => heard.push(state.kind));
    r.controller.setChannel("stable");
    expect(updater.allowDowngrade).toBe(true);
    expect(r.controller.state).toEqual({ kind: "idle" });
    expect(heard).toContain("idle");
    expect(JSON.parse(r.files.get("/state.json")!).channel).toBe("stable");
    expect(r.audits).toContainEqual(
      expect.objectContaining({
        action: "app.update.channel",
        attrs: { from: "nightly", to: "stable", downgrade: "true" },
      }),
    );
    await vi.waitFor(() => expect(cache.cleared).toBe(1));
    expect(r.controller.view()).toMatchObject({
      phase: "idle",
      channel: "stable",
      buildChannel: "nightly",
    });
    r.controller.setChannel("nightly");
    expect(updater.allowDowngrade).toBe(false);
  });

  it("C6 — the view says the state, the person's choices and the advisory line, and hears a decline", async () => {
    const r = await staged({ currentVersion: "0.8.0", levers: { minSupported: "0.9.0" } });
    expect(r.controller.view()).toEqual({
      phase: "staged",
      version: STAGED_VERSION,
      sessions: 2,
      blockedBy: "sessions",
      channel: "nightly",
      buildChannel: "nightly",
      enabled: true,
      lastCheckAt: NOW,
      applyWired: true,
      unsupportedBelow: "0.9.0",
      // AU-1 — the running version, and when this version first became ready here
      currentVersion: "0.8.0",
      stagedAt: NOW,
    });
    const heard: string[] = [];
    r.controller.subscribe(() => heard.push(r.controller.view().phase));
    r.controller.setEnabled(false);
    expect(r.controller.view().enabled).toBe(false);
    expect(heard.length).toBeGreaterThan(0);
  });

  it("L3c-ii — no consent words where nothing ends: an untouched release, or no live session", async () => {
    const plane: NativePlane = {
      digest: "e".repeat(64),
      members: ["bin/field-native", "bin/field-terminal-host", "bin/sidecar-slim"],
    };
    const untouched = await staged({ nativePlane: plane, manifestNative: plane });
    const keeps = await untouched.controller.prepareRestart();
    expect(keeps).toMatchObject({ ok: true, keepsSessions: true, sessions: [] });
    expect(keeps.ok && keeps.consent).toBeUndefined();

    const quiet = await staged({}, { known: true, sessions: [] });
    const none = await quiet.controller.prepareRestart();
    expect(none).toMatchObject({ ok: true, keepsSessions: false, sessions: [] });
    expect(none.ok && none.consent).toBeUndefined();
  });

  it("L3c-ii — a found update that does not download is `available`, never a check that never ends", async () => {
    const off = await stagedController({});
    off.controller.setEnabled(false);
    await off.controller.check("manual"); // a person's check still runs with updates off, and downloads nothing
    expect(off.controller.view()).toMatchObject({
      phase: "available",
      version: STAGED_VERSION,
      enabled: false,
    });
    expect(off.controller.view().declined).toBeUndefined();

    const skipped = await stagedController({});
    skipped.controller.decline(STAGED_VERSION);
    await skipped.controller.check("manual");
    expect(skipped.controller.view()).toMatchObject({
      phase: "available",
      version: STAGED_VERSION,
      declined: true,
      enabled: true,
    });
  });

  it("L4 (R4) — a staged update leaves its line: the version and the sha512 the signed feed gave its payload", async () => {
    const r = await staged({});
    const log = (
      r.controller as unknown as { options: { log: { info: ReturnType<typeof vi.fn> } } }
    ).options.log;
    expect(log.info).toHaveBeenCalledWith(
      "desktop.update.staged",
      "An update is downloaded; it installs at the next restart",
      { version: STAGED_VERSION, sha512: "AAAA" },
    );
  });
});

// AU-7 (AU-G8; LC-10; main-process.md §8.2, §8.3) — a copy macOS won't let replace itself (App Translocation, a disk
// image, a folder it can't write): a person's check still sees what exists, nothing downloads, and an apply refuses
// FIRST — before the fresh policy, the census and any stop — in the words of the way out.
describe("AU-7 — a copy macOS won't let replace itself", () => {
  const WORDS = { message: locationNotice().message, detail: locationNotice().detail };

  it("a person's check sees the release; nothing downloads, and Download refuses in the move's words", async () => {
    const r = await stagedController({ location: "read-only" });
    expect(await r.controller.checkForPerson()).toEqual({
      outcome: "held",
      version: STAGED_VERSION,
    });
    expect(r.updater.downloads).toBe(0);
    expect(r.controller.view()).toMatchObject({
      phase: "available",
      version: STAGED_VERSION,
      location: "read-only",
    });
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({
      ok: false,
      reason: "location",
      words: WORDS,
    });
    expect(r.updater.downloads).toBe(0);
    expect(r.controller.doctorLines()).toContain(
      "app location: read-only — macOS won't let it replace itself",
    );
  });

  it("nothing checks on its own: a launch and a resume start nothing", async () => {
    const r = await stagedController({ location: "read-only" });
    const asked = vi.spyOn(r.updater, "checkForUpdates");
    expect(await r.controller.check("launch")).toEqual({ kind: "none", reason: "location" });
    expect(await r.controller.check("resume")).toEqual({ kind: "none", reason: "location" });
    expect(asked).not.toHaveBeenCalled();
    expect(r.controller.view().phase).toBe("idle");
  });

  it("a staged update's Restart refuses `location` BEFORE anything stops: no census, no ATTEMPT row, no stop", async () => {
    // staged where it could replace itself, then read as read-only — the guard behind decide's hold (a read-only copy
    // never downloads, so the doors cannot stage one; a payload a relaunch finds in the cache is the case it covers)
    const r = await staged(LIVE);
    (r.controller as unknown as { where: UpdateAppLocation | undefined }).where = "read-only";
    expect(await r.controller.prepareRestart()).toEqual({
      ok: false,
      reason: "location",
      words: WORDS,
    });
    expect(await r.controller.restartToInstall()).toEqual({ ok: false, reason: "location" });
    // the tray's Restart says it in the native box; the census, the audit and the stop never ran
    expect(r.apply.notices).toEqual([locationNotice()]);
    expect(r.timeline).toEqual(["notify"]);
    expect(r.timeline).not.toContain("fieldd:stop");
    expect(r.audits).toEqual([]);
    expect(r.apply.plan).toBeNull();
    expect(await r.controller.considerSilentApply("timer")).toEqual({
      applying: false,
      reason: "location",
    });
    expect(r.timeline).toEqual(["notify"]);
  });

  it("a writable copy outside Applications updates as usual, and the view says where it runs", async () => {
    const r = await stagedController({ location: "elsewhere" });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", location: "elsewhere" });
    r.timeline.length = 0;
    expect(await r.controller.restartToInstall()).toEqual({ ok: true });
    expect(r.timeline).toEqual(["fieldd:census", "fieldd:audit:attempt", "quit"]);
    expect(r.controller.doctorLines()).toContain("app location: elsewhere");
  });
});

// AU-5 (AU-D9 A; LC-14, LC-24, LC-36; main-process.md §7.4) — install on quit. The lifecycle calls it only after a
// person's quit has stopped every pair (`lifecycle.test.ts` holds that), so from its first step nothing reaches fieldd:
// an append would START it. The record says the quit began it, and the next launch's OUTCOME row and words carry it.
describe("AU-5 — install on quit", () => {
  const FROM = "0.9.0-nightly.20261015";
  const ENDED = { ended: 2 } as const;
  const OFFLINE: FetchBytes = async () => {
    throw new Error("net::ERR_INTERNET_DISCONNECTED");
  };

  /** staged, with the check's own fieldd calls cleared: what the quit adds is all the timeline holds */
  async function ready(opts: Parameters<typeof stagedController>[0] = {}) {
    const rig = await stagedController({ currentVersion: FROM, ...opts });
    await rig.controller.check("manual");
    expect(rig.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
    rig.timeline.length = 0;
    rig.audits.length = 0;
    return rig;
  }

  /** The policy re-published after the download: a higher version, its levers as given. */
  function republish(fx: FixtureOrigin, levers: Record<string, unknown>) {
    fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: null, stable: null },
      policyVersion: { nightly: 4 },
      levers: { nightly: levers },
    });
  }

  it("ready: the box's line names it, and the quit stages Squirrel in its own bound and records the install", async () => {
    const r = await ready();
    expect(r.controller.quitInstallLine()).toBe("The Oct 16 nightly installs as you quit.");
    expect(r.controller.quitInstallLine()).toBe(quitInstallWords(STAGED_VERSION));
    const stage = vi.spyOn(r.apply, "stage");
    const fetched = r.fx.requests.length;
    expect(await r.controller.installOnQuit(ENDED)).toEqual({ installing: true });
    // the fresh policy was read, then Squirrel staged in the quit's bound — and nothing reached fieldd
    expect(r.fx.requests.length).toBeGreaterThan(fetched);
    expect(stage).toHaveBeenCalledWith(QUIT_STAGE_MS);
    expect(r.timeline).toEqual(["stage"]);
    expect(r.audits).toEqual([]);
    expect(lastApplyOf(r.files)).toMatchObject({
      version: STAGED_VERSION,
      branch: "installing",
      consented: 2,
      audited: false,
      from: FROM,
      trigger: "quit",
    });
    expect(lastApplyOf(r.files)).not.toHaveProperty("reason");
    // the person's quit exits: no update quit, no install hand-off, no relaunch
    expect(r.apply.plan).toBeNull();
    expect(r.timeline).not.toContain("install");
    // one attempt: the line is gone and a second call is busy
    expect(r.controller.quitInstallLine()).toBeNull();
    expect(await r.controller.installOnQuit(ENDED)).toEqual({ installing: false, reason: "busy" });
    expect(r.timeline).toEqual(["stage"]);
  });

  it("Squirrel refused or timed out: the app still exits, and the record is exited with Squirrel's reason", async () => {
    for (const [outcome, reason] of [
      [{ kind: "refused" }, "squirrel-refused"],
      [{ kind: "timeout" }, "squirrel-timeout"],
    ] as const) {
      const r = await ready();
      r.apply.stageOutcome = outcome;
      expect(await r.controller.installOnQuit(ENDED)).toEqual({ installing: false, reason });
      expect(r.timeline, reason).toEqual(["stage"]);
      expect(r.audits, reason).toEqual([]);
      expect(lastApplyOf(r.files), reason).toMatchObject({
        version: STAGED_VERSION,
        branch: "exited",
        reason,
        consented: 2,
        trigger: "quit",
      });
    }
  });

  it("what holds it says no line on the box and installs nothing, before any fetch or fieldd call", async () => {
    const cases: [string, () => Promise<Awaited<ReturnType<typeof ready>>>, string][] = [
      ["nothing staged", () => stagedController({ currentVersion: FROM }), "not-staged"],
      [
        "no apply on this platform",
        async () => {
          const r = await ready();
          r.apply.wired = false;
          return r;
        },
        "apply-unbuilt",
      ],
      [
        "automatic updates off (AU-D9 A ties it to the switch)",
        async () => {
          const r = await ready();
          r.controller.setEnabled(false);
          return r;
        },
        "disabled",
      ],
      [
        "a copy macOS won't let replace itself",
        async () => {
          const r = await ready();
          (r.controller as unknown as { where: UpdateAppLocation | undefined }).where = "read-only";
          return r;
        },
        "location",
      ],
      [
        "the last verified policy requires confirmation (LC-24)",
        () => ready({ levers: { requireUserConfirmation: true } }),
        "confirmation-required",
      ],
    ];
    for (const [name, make, reason] of cases) {
      const r = await make();
      r.timeline.length = 0;
      r.audits.length = 0;
      const fetched = r.fx.requests.length;
      expect(r.controller.quitInstallLine(), name).toBeNull();
      expect(await r.controller.installOnQuit(ENDED), name).toEqual({ installing: false, reason });
      expect(r.timeline, name).toEqual([]);
      expect(r.audits, name).toEqual([]);
      expect(r.fx.requests.length, name).toBe(fetched);
      expect(lastApplyOf(r.files) ?? null, name).toBeNull();
    }
  });

  it("a declined version is not ready: no line, nothing staged to Squirrel", async () => {
    const r = await ready();
    r.controller.decline(STAGED_VERSION);
    r.timeline.length = 0;
    expect(r.controller.quitInstallLine()).toBeNull();
    expect(await r.controller.installOnQuit(ENDED)).toMatchObject({ installing: false });
    expect(r.timeline).toEqual([]);
  });

  it("offline at the quit: nothing installs, the update stays ready, and the record says the quit began it (LC-14)", async () => {
    const r = await ready({ fetch: OFFLINE });
    // the line reads what main knows now; the 3 s read may still hold what it said
    expect(r.controller.quitInstallLine()).toBe(quitInstallWords(STAGED_VERSION));
    expect(await r.controller.installOnQuit(ENDED)).toEqual({
      installing: false,
      reason: "policy-unreachable",
    });
    expect(r.timeline).toEqual([]);
    expect(r.audits).toEqual([]);
    expect(r.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
    // exited with no Squirrel reason: the policy held it, and the next launch says the quit didn't install it
    expect(lastApplyOf(r.files)).toMatchObject({
      version: STAGED_VERSION,
      branch: "exited",
      consented: 2,
      trigger: "quit",
    });
    expect(lastApplyOf(r.files)).not.toHaveProperty("reason");
  });

  it("a policy read that never answers is unreachable after the quit's 3 s, well inside the click's bound", async () => {
    expect(QUIT_POLICY_BOUND_MS).toBeLessThan(FRESH_POLICY_BOUND_MS);
    const r = await ready({ fetch: () => new Promise<never>(() => undefined) });
    vi.useFakeTimers();
    try {
      const outcome = r.controller.installOnQuit(ENDED);
      await vi.advanceTimersByTimeAsync(QUIT_POLICY_BOUND_MS);
      expect(await outcome).toEqual({ installing: false, reason: "policy-unreachable" });
    } finally {
      vi.useRealTimers();
    }
    expect(r.timeline).toEqual([]);
  });

  it("requireUserConfirmation published after the download holds it at the quit's fresh read (LC-24)", async () => {
    const r = await ready();
    expect(r.controller.quitInstallLine()).not.toBeNull();
    republish(r.fx, { requireUserConfirmation: true });
    expect(await r.controller.installOnQuit(ENDED)).toEqual({
      installing: false,
      reason: "confirmation-required",
    });
    expect(r.timeline).toEqual([]);
    expect(r.audits).toEqual([]);
    expect(lastApplyOf(r.files)).toMatchObject({ branch: "exited", trigger: "quit" });
    expect(r.controller.state).toMatchObject({ kind: "staged", version: STAGED_VERSION });
  });

  it("a kill switch published after the download: refused, the payload deleted, and its audit row skipped", async () => {
    const cache = new FakeCache();
    const r = await ready({ cache });
    republish(r.fx, { killSwitch: true });
    expect(await r.controller.installOnQuit(ENDED)).toEqual({
      installing: false,
      reason: "killed",
    });
    // the pairs are down: the lever's row would START fieldd, so it is skipped (B6's deletion still runs)
    expect(r.timeline).toEqual([]);
    expect(r.audits).toEqual([]);
    expect(r.controller.state).toMatchObject({ kind: "error", unavailable: { state: "killed" } });
    await vi.waitFor(() => expect(cache.cleared).toBe(1));
    expect(lastApplyOf(r.files)).toMatchObject({ branch: "exited", trigger: "quit" });
  });

  it("the next launch's OUTCOME row and window carry it: began quit, installed or held", async () => {
    const took = await ready();
    expect(await took.controller.installOnQuit(ENDED)).toEqual({ installing: true });
    const installed = await stagedController({
      initial: took.files.get("/state.json")!,
      currentVersion: STAGED_VERSION,
    });
    await vi.waitFor(() => expect(installed.audits).toHaveLength(1));
    expect(installed.audits[0]).toMatchObject({
      action: "app.update.apply",
      phase: "outcome",
      outcome: "succeeded",
      attrs: expect.objectContaining({ began: "quit", consented: "2", from: FROM }),
    });
    expect(installed.controller.view().lastApply).toMatchObject({
      outcome: "installed",
      trigger: "quit",
      thisLaunch: true,
    });

    const offline = await ready({ fetch: OFFLINE });
    await offline.controller.installOnQuit(ENDED);
    const held = await stagedController({
      initial: offline.files.get("/state.json")!,
      currentVersion: FROM,
    });
    await vi.waitFor(() => expect(held.audits).toHaveLength(1));
    expect(held.audits[0]).toMatchObject({
      outcome: "failed",
      reasonCode: "QUIT_HELD",
      attrs: expect.objectContaining({ branch: "exited", began: "quit" }),
    });
    expect(held.controller.view().lastApply).toMatchObject({
      version: STAGED_VERSION,
      outcome: "not-applied",
      trigger: "quit",
      thisLaunch: true,
    });
  });
});

// AU-6 (AU-D10 A; AU-G10; LC-7, LC-18, LC-19; X18) — the release's signed notes on the Updates page and in "What's
// new": the staged clock keeps the staged version's own (a newer head never swaps them), the apply's record copies
// them for the relaunch, the one link is main's, and notes that do not parse are dropped and said, never a refusal.
// And when this build was made.
describe("AU-6 — the release's notes and the build time", () => {
  const OFF = JSON.stringify({ schemaVersion: 1, enabled: false });
  const NOTES_A = {
    kind: "log",
    since: { version: "0.9.0-nightly.20261015", tag: "nightly-20261015" },
    commits: 12,
    product: 7,
    lines: [
      { track: "AU-6", text: "the notes ride the signed manifest" },
      { track: "QW1", text: "hidden means unread" },
    ],
  };
  const COMPARE =
    "https://github.com/vibefield/vibefield/compare/nightly-20261015...nightly-20261016";
  const NOTES_VIEW = { version: STAGED_VERSION, body: NOTES_A, compareUrl: COMPARE };
  const holdDownload = (updater: { holdDownload: Promise<void> | null }) => {
    let release: () => void = () => {};
    updater.holdDownload = new Promise((resolve) => {
      release = resolve;
    });
    return () => release();
  };
  type Logged = { options: { log: { warn: ReturnType<typeof vi.fn> } } };
  const warnLog = (controller: UpdateController) =>
    (controller as unknown as Logged).options.log.warn;

  it("staged: the view carries the head's notes with main's comparison, and the staged clock keeps them", async () => {
    const r = await stagedController({ notes: NOTES_A });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({
      phase: "staged",
      version: STAGED_VERSION,
      notes: NOTES_VIEW,
    });
    expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW, notes: NOTES_A });
    expect(r.controller.doctorLines()).toContain(
      `release notes: ${NIGHTLY} — present (log, 2 lines)`,
    );
  });

  it("found and downloading (automatic updates off): the notes show before anything is staged", async () => {
    const r = await stagedController({ initial: OFF, notes: NOTES_A });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({
      phase: "available",
      version: STAGED_VERSION,
      notes: NOTES_VIEW,
    });
    expect(r.updater.downloads).toBe(0);
    const release = holdDownload(r.updater);
    expect(await r.controller.downloadForPerson(STAGED_VERSION)).toEqual({ ok: true });
    await vi.waitFor(() =>
      expect(r.controller.view()).toMatchObject({ phase: "downloading", notes: NOTES_VIEW }),
    );
    release();
    await vi.waitFor(() => expect(r.controller.state.kind).toBe("staged"));
    expect(r.controller.view()).toMatchObject({ phase: "staged", notes: NOTES_VIEW });
  });

  it("a newer head never swaps the staged version's notes; the apply's record copies them for the relaunch", async () => {
    const FROM = "0.9.0-nightly.20261015";
    const r = await stagedController({ notes: NOTES_A, currentVersion: FROM });
    await r.controller.check("manual");
    // a newer nightly is published after the download, with notes of its own
    const NEXT = "nightly-20261017";
    const NEXT_VERSION = "0.9.0-nightly.20261017";
    const NOTES_B = {
      ...NOTES_A,
      since: { version: STAGED_VERSION, tag: NIGHTLY },
      lines: [{ track: "TS-6", text: "the newer head's own line" }],
    };
    r.fx.setReleases([NEXT, NIGHTLY]);
    r.fx.putRelease(NEXT, {
      heads: { nightly: NEXT, beta: null, stable: null },
      headsVersion: 11,
      policyVersion: { nightly: 4 },
    });
    r.fx.putFeed(NEXT, NEXT_VERSION);
    r.fx.putManifest(NEXT, NEXT_VERSION, SOME_PLANE, { notes: NOTES_B });
    // the click's fresh read verified the newer head: the staged version still says its own
    const prepared = await r.controller.prepareRestart();
    if (!prepared.ok) throw new Error("prepare refused");
    expect(r.controller.verified?.headVersion).toBe(NEXT_VERSION);
    expect(r.controller.verified?.notes).toEqual(NOTES_B);
    expect(r.controller.view()).toMatchObject({ phase: "staged", notes: NOTES_VIEW });
    expect(await r.controller.confirmRestart(prepared.token)).toEqual({ ok: true });
    await r.apply.plan!.prepare();
    expect(lastApplyOf(r.files)).toMatchObject({
      version: STAGED_VERSION,
      branch: "installing",
      notes: NOTES_A,
    });
    // this launch says nothing of the apply it wrote
    expect(r.controller.view().lastApply).toBeUndefined();

    // the next launch runs the version it installed: "What's new" from the record, offline, with the comparison
    const installed = await stagedController({
      initial: r.files.get("/state.json")!,
      currentVersion: STAGED_VERSION,
      fetch: null,
    });
    expect(installed.controller.view().lastApply).toMatchObject({
      version: STAGED_VERSION,
      outcome: "installed",
      thisLaunch: true,
      notes: NOTES_VIEW,
    });
    // the old version still runs: nothing installed, so nothing is new
    const notApplied = await stagedController({
      initial: r.files.get("/state.json")!,
      currentVersion: FROM,
    });
    expect(notApplied.controller.view().lastApply).toMatchObject({ outcome: "not-applied" });
    expect(notApplied.controller.view().lastApply).not.toHaveProperty("notes");
  });

  it("a dev-keyed fixture origin gives the notes and no comparison: the link is GitHub's alone", async () => {
    const r = await stagedController({
      origin: "http://127.0.0.1:47123/vibefield/vibefield/releases",
      notes: NOTES_A,
    });
    await r.controller.check("manual");
    expect(r.controller.view().notes).toEqual({ version: STAGED_VERSION, body: NOTES_A });
  });

  it("a head without notes gives none, and doctor says absent", async () => {
    const r = await stagedController({ manifestNative: SOME_PLANE });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", version: STAGED_VERSION });
    expect(r.controller.view()).not.toHaveProperty("notes");
    expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW });
    expect(r.controller.doctorLines()).toContain(`release notes: ${NIGHTLY} — absent`);
  });

  it("notes that do not parse: still staged, no notes, said once per head in the log and in doctor", async () => {
    const r = await stagedController({
      notes: { ...NOTES_A, lines: [{ track: "AU-6", text: "two\nlines" }] },
    });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", version: STAGED_VERSION });
    expect(r.controller.view()).not.toHaveProperty("notes");
    expect(stagedClockOf(r.files)).toEqual({ version: STAGED_VERSION, at: NOW });
    const warn = warnLog(r.controller);
    const said = () =>
      warn.mock.calls.filter(([event]) => event === "desktop.update.notes_dropped");
    expect(said()).toEqual([
      [
        "desktop.update.notes_dropped",
        "The release's notes did not parse; the update goes on without them",
        { head: NIGHTLY, version: STAGED_VERSION, reason: "lines.0.text: one line of plain text" },
      ],
    ]);
    // the same head verified again (a check, the click's fresh read): never said twice
    await r.controller.check("manual");
    const prepared = await r.controller.prepareRestart();
    expect(prepared.ok).toBe(true);
    expect(said()).toHaveLength(1);
    expect(r.controller.doctorLines()).toContain(
      `release notes: ${NIGHTLY} — dropped (lines.0.text: one line of plain text)`,
    );
  });

  it("persisted notes that no longer parse are dropped alone: the staged clock and its day stand", async () => {
    const DAY = 86_400_000;
    const r = await stagedController({
      initial: JSON.stringify({
        schemaVersion: 1,
        staged: { version: STAGED_VERSION, at: NOW - DAY, notes: { kind: "html", body: "<b>" } },
      }),
    });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", stagedAt: NOW - DAY });
    expect(r.controller.view()).not.toHaveProperty("notes");
  });

  it("the build time rides every phase's view when the identity names it, and is absent otherwise", async () => {
    const BUILT = Date.parse("2026-10-15T09:00:00.000Z");
    const r = await stagedController({ builtAt: BUILT });
    expect(r.controller.view()).toMatchObject({ phase: "idle", builtAt: BUILT });
    await r.controller.check("manual");
    expect(r.controller.view()).toMatchObject({ phase: "staged", builtAt: BUILT });
    const bare = await stagedController();
    expect(bare.controller.view()).not.toHaveProperty("builtAt");
  });
});

// AU-6 (X18; EDP-38) — the notes' one link: composed by main from the frozen origin and two release tags, or nothing.
describe("AU-6 — compareUrlOf", () => {
  const GITHUB = "https://github.com/vibefield/vibefield/releases";
  const log = (since: { version: string; tag: string }): ReleaseNotes => ({
    kind: "log",
    since,
    commits: 3,
    product: 1,
    lines: [],
  });
  const NIGHTLY_SINCE = { version: "0.1.0-nightly.20261027", tag: "nightly-20261027" };

  it("composes GitHub's comparison from the two release tags, for every channel's shape", () => {
    expect(compareUrlOf(GITHUB, log(NIGHTLY_SINCE), "0.1.0-nightly.20261028")).toBe(
      "https://github.com/vibefield/vibefield/compare/nightly-20261027...nightly-20261028",
    );
    expect(compareUrlOf(`${GITHUB}/`, log(NIGHTLY_SINCE), "0.1.0-nightly.20261028")).toBe(
      "https://github.com/vibefield/vibefield/compare/nightly-20261027...nightly-20261028",
    );
    const beta = log({ version: "0.2.0-beta.1", tag: "v0.2.0-beta.1" });
    expect(compareUrlOf(GITHUB, beta, "0.2.0-beta.2")).toBe(
      "https://github.com/vibefield/vibefield/compare/v0.2.0-beta.1...v0.2.0-beta.2",
    );
    const stable = log({ version: "0.1.0", tag: "v0.1.0" });
    expect(compareUrlOf(GITHUB, stable, "0.2.0")).toBe(
      "https://github.com/vibefield/vibefield/compare/v0.1.0...v0.2.0",
    );
    const dotted = "https://github.com/vibe-field/vibe.field/releases";
    expect(compareUrlOf(dotted, stable, "0.2.0")).toBe(
      "https://github.com/vibe-field/vibe.field/compare/v0.1.0...v0.2.0",
    );
  });

  it("the since tag is its version's own; a version with no tag shape falls back to a signed release tag", () => {
    // the version names the tag, whatever the signed `tag` says
    const named = log({ version: "0.1.0-nightly.20261027", tag: "something-else" });
    expect(compareUrlOf(GITHUB, named, "0.1.0-nightly.20261028")).toBe(
      "https://github.com/vibefield/vibefield/compare/nightly-20261027...nightly-20261028",
    );
    const fallback = log({ version: "0.1.0-local.1", tag: "nightly-20261027" });
    expect(compareUrlOf(GITHUB, fallback, "0.1.0-nightly.20261028")).toBe(
      "https://github.com/vibefield/vibefield/compare/nightly-20261027...nightly-20261028",
    );
    const neither = log({ version: "0.1.0-local.1", tag: "main" });
    expect(compareUrlOf(GITHUB, neither, "0.1.0-nightly.20261028")).toBeNull();
  });

  it("nothing for notes from no release, a version with no tag, or any origin but GitHub's releases", () => {
    const written: ReleaseNotes = { kind: "written", since: null, lines: ["The first release."] };
    expect(compareUrlOf(GITHUB, written, "0.1.0")).toBeNull();
    expect(compareUrlOf(GITHUB, log(NIGHTLY_SINCE), "0.1.0-local.2")).toBeNull();
    for (const origin of [
      "http://127.0.0.1:47123/vibefield/vibefield/releases",
      "http://github.com/vibefield/vibefield/releases",
      "https://github.com/vibefield/vibefield/releases/download",
      "https://github.com/vibefield/../releases",
      "https://github.com/vibefield/./releases",
      "https://github.com.example/vibefield/vibefield/releases",
      "https://example.com/github.com/vibefield/vibefield/releases",
      "https://github.com/vibefield/vibefield/releases?x=1",
    ]) {
      expect(compareUrlOf(origin, log(NIGHTLY_SINCE), "0.1.0-nightly.20261028"), origin).toBeNull();
    }
  });
});
