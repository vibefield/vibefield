import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import {
  type CancellationLike,
  feedSha512Of,
  UpdateController,
  type UpdaterPort,
  updateErrorOf,
} from "../../src/main/updates/controller";
import { UpdateRefusal } from "../../src/main/updates/refusal";
import {
  FRESH_CLIENT_STATE,
  type StoreFs,
  UpdateStateStore,
} from "../../src/main/updates/state-store";
import type { ChainResult, FetchBytes, VerifiedChain } from "../../src/main/updates/verify-chain";
import { FixtureOrigin, NOW, ORIGIN } from "./fixture-release";

// WP12b (EDP §11.1–§11.3, §13.1's updater list) — the controller over a fake updater that behaves as electron-updater
// does with VibeField's provider: `checkForUpdates` runs the provider's verify (the real chain, against the fixture
// origin) and reports an update when it verified; a refusal throws UpdateRefusal out of the check.

const NIGHTLY = "nightly-20261016";

function memoryStore(initial: string | null = null): {
  store: UpdateStateStore;
  files: Map<string, string>;
} {
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
  // electron-updater turns this ON for a prerelease build (AppUpdater.js:218) — a nightly or a beta — and the
  // provider must ignore it: the signed heads alone decide the channel (D4).
  allowPrerelease = true;
  checks = 0;
  downloads: CancellationLike[] = [];
  context: {
    verify(fetch: FetchBytes): Promise<ChainResult>;
    verified(r: VerifiedChain): void;
  } | null = null;
  holdDownload: Promise<void> | null = null;
  /** held between the provider's verify and its `verified` hand-off (a check in flight) */
  holdCheck: Promise<void> | null = null;
  constructor(readonly fx: FixtureOrigin) {}
  setFeedURL(options: unknown): void {
    this.context = (options as { vibefield: FakeUpdater["context"] }).vibefield;
  }
  async checkForUpdates() {
    this.checks += 1;
    const result = await this.context!.verify(this.fx.fetch);
    if (this.holdCheck !== null) await this.holdCheck;
    if (!result.ok) throw new UpdateRefusal(result.state, result.detail);
    this.context!.verified(result);
    const version = /^version: (.+)$/m.exec(result.feedText)?.[1] ?? "0.0.0";
    return { isUpdateAvailable: version !== "0.9.0-nightly.20261015", updateInfo: { version } };
  }
  async downloadUpdate(token?: unknown): Promise<unknown> {
    this.downloads.push(token as CancellationLike);
    if (this.holdDownload !== null) await this.holdDownload;
    if ((token as { cancelled?: boolean }).cancelled) throw new Error("cancelled");
    return ["/cache/update.zip"];
  }
  on(): unknown {
    return this;
  }
  removeListener(): unknown {
    return this;
  }
}

function setup(opts: { initial?: string | null; channel?: "nightly" | "beta" | "stable" } = {}) {
  const fx = new FixtureOrigin();
  fx.setReleases([NIGHTLY]);
  fx.putRelease(NIGHTLY, { heads: { nightly: NIGHTLY, beta: null, stable: null } });
  fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016");
  const updater = new FakeUpdater(fx);
  const { store, files } = memoryStore(opts.initial ?? null);
  const audits: AuditAppendV1[] = [];
  const log = { info: vi.fn(), warn: vi.fn() };
  const controller = new UpdateController({
    updater,
    feedOptions: (context) => ({ provider: "custom", vibefield: context }),
    newCancellationToken: () => {
      const token = { cancelled: false, cancel: () => (token.cancelled = true) };
      return token;
    },
    origin: ORIGIN,
    rootKeys: fx.rootKeys,
    buildChannel: opts.channel ?? "nightly",
    feedFile: "latest-mac.yml",
    store,
    appendAudit: async (record) => {
      audits.push(record);
    },
    log,
    now: () => NOW,
  });
  return { fx, updater, controller, files, audits, log };
}

describe("the UpdateController (WP12b)", () => {
  it("owns the updater's switches: no auto-download, NOTHING installs on quit, no silent downgrade", () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });

  it("leaves allowPrerelease as electron-updater set it (on, for a nightly build) and lets the heads decide", async () => {
    // a BETA client on a nightly build: allowPrerelease is true, the newest release is a nightly — and no nightly
    // is offered, because the heads name no beta
    const { updater, controller } = setup({ channel: "beta" });
    expect(updater.allowPrerelease).toBe(true);
    await controller.check("manual");
    expect(controller.state).toMatchObject({
      kind: "error",
      code: "refused",
      unavailable: { service: "updates", state: "channel-unresolved" },
    });
    expect(updater.downloads).toHaveLength(0);
  });

  it("checks, downloads and stages — and HOLDS the staged update until WP12c's gate exists", async () => {
    const { controller, updater } = setup();
    const seen: string[] = [];
    controller.subscribe((state) => seen.push(state.kind));
    await controller.check("manual");
    expect(seen).toEqual(["checking", "available", "downloading", "staged", "staged"]);
    expect(controller.state).toMatchObject({
      kind: "staged",
      version: "0.9.0-nightly.20261016",
      blockedBy: "apply-unbuilt",
    });
    expect(updater.downloads).toHaveLength(1);
    expect(await controller.restartToInstall()).toEqual({ ok: false, reason: "apply-unbuilt" });
  });

  it("refuses before any download, says UNAVAILABLE and audits the clause", async () => {
    const { fx, controller, updater, audits } = setup();
    fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016", fx.stranger);
    await controller.check("manual");
    expect(controller.state).toEqual({
      kind: "error",
      code: "refused",
      unavailable: { service: "updates", state: "feed-unverified" },
    });
    expect(updater.downloads).toHaveLength(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "app.update.verify",
      target: { kind: "app-update", id: "nightly" },
      phase: "outcome",
      outcome: "denied",
      reasonCode: "FEED_UNVERIFIED",
    });
  });

  it("keeps one check in flight", async () => {
    const { controller, updater } = setup();
    const first = controller.check("manual");
    const second = await controller.check("manual");
    await first;
    expect(second).toEqual({ kind: "none", reason: "in-flight" });
    expect(updater.checks).toBe(1);
  });

  it("persists a decline across restarts and cancels that version's in-flight download", async () => {
    const { controller, updater, files } = setup();
    let release: () => void = () => {};
    updater.holdDownload = new Promise((resolve) => {
      release = resolve;
    });
    const running = controller.check("manual");
    await vi.waitFor(() => expect(controller.state.kind).toBe("downloading"));
    controller.decline("0.9.0-nightly.20261016");
    release();
    await running;
    // AU-1 (LC-13) — the skipped version stays found (`available`, declined): "Download anyway" is one click away
    expect(controller.state).toEqual({ kind: "available", version: "0.9.0-nightly.20261016" });
    expect(controller.view()).toMatchObject({ phase: "available", declined: true });
    expect((updater.downloads[0] as { cancelled?: boolean }).cancelled).toBe(true);
    expect(JSON.parse(files.get("/state.json")!).declined).toEqual(["0.9.0-nightly.20261016"]);
    // a restart reads the decline back: the version is found and not downloaded
    const again = setup({ initial: files.get("/state.json")! });
    await again.controller.check("manual");
    expect(again.controller.state).toEqual({
      kind: "available",
      version: "0.9.0-nightly.20261016",
    });
    expect(again.updater.downloads).toHaveLength(0);
  });

  it("honors the off switch at every stage boundary", async () => {
    const { controller, updater } = setup();
    let release: () => void = () => {};
    updater.holdDownload = new Promise((resolve) => {
      release = resolve;
    });
    const running = controller.check("manual");
    await vi.waitFor(() => expect(controller.state.kind).toBe("downloading"));
    controller.setEnabled(false);
    release();
    await running;
    // AU-1 (X13) — a found update waits for you: off mid-download lands on `available`, never a blank idle
    expect(controller.state).toEqual({ kind: "available", version: "0.9.0-nightly.20261016" });
    expect(await controller.check("launch")).toEqual({ kind: "none", reason: "disabled" });
    // a person's explicit check still runs — and downloads nothing
    updater.holdDownload = null;
    await controller.check("manual");
    expect(controller.state.kind).toBe("available");
    expect(updater.downloads).toHaveLength(1);
    // AU-1 (X13) — and on again, the found version downloads
    controller.setEnabled(true);
    await vi.waitFor(() => expect(controller.state.kind).toBe("staged"));
    expect(updater.downloads).toHaveLength(2);
  });

  it("AU-1 — the store keeps the staged clock, and reads an older file as nothing staged", () => {
    const { store, files } = memoryStore(null);
    const staged = { version: "0.9.0-nightly.20261016", at: NOW - 9 * 86_400_000 };
    store.save({ ...FRESH_CLIENT_STATE, staged });
    expect(JSON.parse(files.get("/state.json")!).staged).toEqual(staged);
    expect(store.load()).toEqual({ state: { ...FRESH_CLIENT_STATE, staged }, recovered: null });
    // a file an older app wrote names no staged clock: nothing staged, and nothing else lost
    const older = memoryStore(
      JSON.stringify({ schemaVersion: 1, declined: ["0.9.0-nightly.20261015"], lastCheckAt: NOW }),
    );
    expect(older.store.load()).toMatchObject({
      state: { staged: null, declined: ["0.9.0-nightly.20261015"], lastCheckAt: NOW },
      recovered: null,
    });
  });

  it("starts from defaults when no setting exists (the absent-settings class)", () => {
    const { controller } = setup({ channel: "beta" });
    expect(controller.enabled).toBe(true);
    expect(controller.channel).toBe("beta");
    expect(controller.lastCheckAt).toBeNull();
  });

  it("moves an unreadable state aside LOUDLY — a warn line, an audit row and a doctor line", async () => {
    const { controller, files, log, audits } = setup({ initial: "{ not json" });
    expect(controller.enabled).toBe(true);
    expect([...files.keys()].some((key) => key.startsWith("/state.json.unreadable-"))).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      "desktop.update.state_recovered",
      expect.any(String),
      expect.any(Object),
    );
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({
      action: "app.update.verify",
      outcome: "failed",
      reasonCode: "STATE_UNREADABLE",
    });
    expect(controller.doctorLines().join("\n")).toMatch(
      /unreadable .* moved aside .* build's floor/,
    );
  });

  it("says what blocks a staged update, and a refusal's clause, in its doctor lines", async () => {
    const { controller } = setup();
    await controller.check("manual");
    expect(controller.doctorLines().join("\n")).toMatch(
      /staged 0\.9\.0-nightly\.20261016 .* blocked by: apply-unbuilt/,
    );
    const refused = setup();
    refused.fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016", refused.fx.stranger);
    await refused.controller.check("manual");
    expect(refused.controller.doctorLines()).toContain(
      'UNAVAILABLE {service: "updates", state: "feed-unverified"}',
    );
  });

  it("AU-1 — a channel change outlives the check in flight: the old channel's answer is dropped, never judged", async () => {
    const { controller, updater } = setup();
    let release: () => void = () => {};
    updater.holdCheck = new Promise((resolve) => {
      release = resolve;
    });
    const running = controller.checkForPerson();
    await vi.waitFor(() => expect(updater.checks).toBe(1));
    controller.setChannel("stable");
    // still checking: a second check now would be handed the first one's (nightly) answer
    expect(controller.state.kind).toBe("checking");
    expect(await controller.check("manual")).toEqual({ kind: "none", reason: "in-flight" });
    release();
    expect(await running).toEqual({ outcome: "busy" });
    // nothing found, nothing downloaded, and the nightly chain never stands as the stable one's levers
    expect(controller.state).toEqual({ kind: "idle" });
    expect(controller.verified).toBeNull();
    expect(updater.downloads).toHaveLength(0);
  });

  it("AU-1 — a channel change drops the old channel's staged clock whatever the state shows", () => {
    const staged = { version: "0.9.0-nightly.20261016", at: NOW - 86_400_000 };
    // a relaunch: the state is idle, and the payload waits in the cache behind it
    const { controller, files } = setup({
      initial: JSON.stringify({ schemaVersion: 1, declined: [], lastCheckAt: NOW, staged }),
    });
    expect(controller.state.kind).toBe("idle");
    controller.setChannel("stable");
    expect(JSON.parse(files.get("/state.json")!).staged).toBeNull();
  });

  it("remembers what it accepted, so a replayed older policy is refused next time", async () => {
    const { controller, files } = setup();
    await controller.check("manual");
    expect(JSON.parse(files.get("/state.json")!).remembered).toEqual({
      trustRoot: 1,
      channels: 10,
      policy: { nightly: 3, beta: null, stable: null },
    });
  });

  it("maps raw failures to bounded codes", () => {
    expect(updateErrorOf(new UpdateRefusal("policy-rollback", "x"))).toMatchObject({
      code: "refused",
      unavailable: { state: "policy-rollback" },
    });
    expect(updateErrorOf(Object.assign(new Error("x"), { code: "ERR_CHECKSUM_MISMATCH" }))).toEqual(
      {
        kind: "error",
        code: "checksum-mismatch",
      },
    );
    expect(updateErrorOf(Object.assign(new Error("x"), { code: "ENOTFOUND" })).code).toBe(
      "offline",
    );
    expect(updateErrorOf(new Error("net::ERR_INTERNET_DISCONNECTED")).code).toBe("offline");
    expect(updateErrorOf(new Error("something else")).code).toBe("failed");
  });
});

// WP12 L4 (R4) — the staged line's sha512 is the verified feed's top-level one, as electron-builder writes it
describe("feedSha512Of", () => {
  it("reads the top-level sha512, unquoted or quoted, and nothing from a file entry alone", () => {
    expect(feedSha512Of("version: 1.2.0\nsha512: abc+/=\n")).toBe("abc+/=");
    expect(feedSha512Of("version: 1.2.0\nsha512: 'abc+/='\n")).toBe("abc+/=");
    expect(feedSha512Of("version: 1.2.0\nfiles:\n  - url: x.zip\n    sha512: abc\n")).toBeNull();
  });
});
