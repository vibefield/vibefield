import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import type { UpdatePrepared, UpdateQuitPlan } from "../../src/main/quit-flow";
import type {
  ApplyPort,
  BoxContent,
  CensusSnapshot,
  StageOutcome,
  StopOutcome,
} from "../../src/main/updates/apply";
import {
  type CancellationLike,
  FRESH_POLICY_BOUND_MS,
  PREPARE_TTL_MS,
  SILENT_RECHECK_MS,
  UpdateController,
  type UpdaterPort,
} from "../../src/main/updates/controller";
import type { NativePlane } from "../../src/main/updates/native-plane";
import { UpdateRefusal } from "../../src/main/updates/refusal";
import { type StoreFs, UpdateStateStore } from "../../src/main/updates/state-store";
import type { ChainResult, FetchBytes, VerifiedChain } from "../../src/main/updates/verify-chain";
import { FixtureOrigin, NOW, ORIGIN } from "./fixture-release";

// WP12c (L2b-ii, build-wp12-updater.md §10; the PM's rulings 2026-10-15 13:31–13:40Z) — `restartToInstall()` over a
// fake ApplyPort. Every fieldd-touching call (the census, an audit row, the stop) lands on ONE timeline as `fieldd:…`,
// so each branch can assert THE NO-SPAWN PROBE: after a successful daemon stop nothing reaches fieldd — in
// production each of those calls goes through `ensureFieldd()`, which SPAWNS.

const NIGHTLY = "nightly-20261016";
const STAGED_VERSION = "0.9.0-nightly.20261016";

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
  constructor(readonly fx: FixtureOrigin) {}
  setFeedURL(options: unknown): void {
    this.context = (options as { vibefield: FakeUpdater["context"] }).vibefield;
  }
  async checkForUpdates() {
    const result = await this.context!.verify(this.fx.fetch);
    if (!result.ok) throw new UpdateRefusal(result.state, result.detail);
    this.context!.verified(result);
    return { isUpdateAvailable: true, updateInfo: { version: STAGED_VERSION } };
  }
  async downloadUpdate(): Promise<unknown> {
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
  } = {},
) {
  const fx = new FixtureOrigin();
  fx.setReleases([NIGHTLY]);
  fx.putRelease(NIGHTLY, {
    heads: { nightly: NIGHTLY, beta: null, stable: null },
    ...(opts.levers !== undefined ? { levers: { nightly: opts.levers } } : {}),
  });
  fx.putFeed(NIGHTLY, STAGED_VERSION);
  if (opts.manifestNative !== undefined)
    fx.putManifest(NIGHTLY, STAGED_VERSION, opts.manifestNative);
  const timeline: string[] = [];
  const apply = new FakeApply(timeline);
  const audits: AuditAppendV1[] = [];
  const { store, files } = memoryStore(opts.initial ?? null);
  const controller = new UpdateController({
    updater: new FakeUpdater(fx),
    feedOptions: (context) => ({ provider: "custom", vibefield: context }),
    newCancellationToken: (): CancellationLike => ({ cancel: () => undefined }),
    origin: ORIGIN,
    rootKeys: fx.rootKeys,
    buildChannel: "nightly",
    feedFile: "latest-mac.yml",
    store,
    appendAudit: async (record) => {
      timeline.push(`fieldd:audit:${record.phase}${record.outcome ? `:${record.outcome}` : ""}`);
      audits.push(record);
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
  });
  return { controller, apply, timeline, audits, files, fx };
}

/** L3b-ii (B6) — a staged cache that records what was asked of it. */
class FakeCache {
  cleared = 0;
  bytes = 42 * 1_048_576;
  async clear(): Promise<void> {
    this.cleared += 1;
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
    });
    noFielddAfterTheStop(timeline);
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
    expect(controller.state).toMatchObject({
      kind: "staged",
      blockedBy: "census-unknown",
      sessions: "unknown",
    });
    await vi.waitFor(() => expect(audits.map((a) => a.reasonCode)).toContain("CENSUS_UNKNOWN"));
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
    expect(lastApplyOf(files)).toMatchObject({ branch: "exited", reason: "squirrel-timeout" });
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
    expect(lastApplyOf(files)).toMatchObject({ branch: "exited", reason: "install-failed" });
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
      reason: "the policy requires confirmation",
    });
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
    expect(await r.controller.confirmRestart(first.token)).toEqual({
      ok: false,
      reason: "expired",
    });
    // the wrong token spent the snapshot too: the right one now needs a fresh prepare
    expect(await r.controller.confirmRestart(second.token)).toEqual({
      ok: false,
      reason: "expired",
    });

    const third = await r.controller.prepareRestart();
    if (!third.ok) throw new Error("prepare refused");
    expect(third.expiresAt).toBe(NOW + PREPARE_TTL_MS);
    clock.now += PREPARE_TTL_MS + 1;
    expect(await r.controller.confirmRestart(third.token)).toEqual({
      ok: false,
      reason: "expired",
    });

    clock.now = NOW;
    const fourth = await r.controller.prepareRestart();
    if (!fourth.ok) throw new Error("prepare refused");
    r.controller.decline(STAGED_VERSION);
    expect(await r.controller.confirmRestart(fourth.token)).toEqual({
      ok: false,
      reason: "expired",
    });
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
    });
    const heard: string[] = [];
    r.controller.subscribe(() => heard.push(r.controller.view().phase));
    r.controller.setEnabled(false);
    expect(r.controller.view().enabled).toBe(false);
    expect(heard.length).toBeGreaterThan(0);
  });
});
