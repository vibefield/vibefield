import { rmSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  productPath,
  type SupervisorError,
  tryAdopt,
} from "../src/index";
import { createHarness, FIXTURE_READY, type Harness } from "./helpers";

// WP12 D10 (build-wp12-updater.md; the PM's ruling 2026-10-15 11:18Z) — adoption after an app update. A packaged app
// adopts only a fieldd of ITS build; one of another build (or a pre-WP12c one that records none) is REPLACED: asked
// to stop over the channel our token authenticated, given a bounded wait for its run files to go, and then this
// build's fieldd is spawned — which supersedes the old one at field-native if it never stopped (the single-client
// rule). No signal is ever sent to a pid read from a file. Live listeners we cannot adopt are NAMED takeovers.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

function replacing(
  root: string,
  newPort: number,
  token: string,
  events: FielddSupervisorEvent[],
  extra?: Partial<FielddSupervisorOptions>,
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        TEST_PRODUCT_PORT: String(newPort),
        SHELL_TOKEN: token,
      },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 600,
      readinessDeadlineMs: 6000,
      expectedBuildId: "build-y",
      buildMismatch: "replace",
      onEvent: (event) => events.push(event),
      ...extra,
    }),
  );
}

const lifecycleNames = (events: FielddSupervisorEvent[]) =>
  events.flatMap((event) => (event.kind === "lifecycle" ? [event.event] : []));

describe("WP12 D10 — adoption after an app update", () => {
  it("replaces a fieldd of ANOTHER build: asks it to stop, sees its run files go, spawns this build's", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const fresh = await h.startProduct({ token: old.token });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      buildId: "build-x",
      bootId: "boot-old",
    });
    let asked = false;
    // fieldd's side of the verb: acknowledge, and remove the run files as its graceful stop does
    old.api.register("system.shutdown", () => {
      asked = true;
      rmSync(productPath(root), { force: true });
      return { stopping: true };
    });
    const events: FielddSupervisorEvent[] = [];
    const handle = await replacing(root, fresh.port, old.token, events).ensure();
    h.trackPid(handle.childPid);
    expect(asked).toBe(true);
    expect(handle.ownership).toBe("spawned");
    expect(handle.info.buildId).toBe("build-y");
    expect(lifecycleNames(events)).toEqual(
      expect.arrayContaining([
        "fieldd.supervisor.replacing_build",
        "fieldd.supervisor.replaced_build",
        "fieldd.supervisor.ready",
      ]),
    );
  });

  it("replaces a fieldd that records NO build (one an app before WP12c left running)", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const fresh = await h.startProduct({ token: old.token });
    const root = h.mkRoot();
    h.writeRunFiles(root, { port: old.port, pid: process.pid, token: old.token, buildId: null });
    let asked = false;
    old.api.register("system.shutdown", () => {
      asked = true;
      rmSync(productPath(root), { force: true });
      return { stopping: true };
    });
    const handle = await replacing(root, fresh.port, old.token, []).ensure();
    h.trackPid(handle.childPid);
    expect(asked).toBe(true);
    expect(handle.info.buildId).toBe("build-y");
  });

  it("a fieldd that does not stop in time is superseded at field-native — never signalled", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const fresh = await h.startProduct({ token: old.token });
    const root = h.mkRoot();
    // the recorded pid is THIS test process: a signal sent to it would end the test
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      buildId: "build-x",
    });
    old.api.register("system.shutdown", () => ({ stopping: true })); // acknowledges, never goes
    const events: FielddSupervisorEvent[] = [];
    const handle = await replacing(root, fresh.port, old.token, events).ensure();
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(lifecycleNames(events)).toContain("fieldd.supervisor.replace_wait_expired");
  }, 15_000);

  it("adopts a fieldd of THIS build — nothing is asked to stop", async () => {
    const live = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: live.port,
      pid: process.pid,
      token: live.token,
      buildId: "build-y",
    });
    let asked = false;
    live.api.register("system.shutdown", () => {
      asked = true;
      return { stopping: true };
    });
    const handle = await replacing(root, live.port, live.token, []).ensure();
    expect(handle.ownership).toBe("adopted");
    expect(asked).toBe(false);
  });

  it("development REFUSES a different build (`refuse`, as by default) and asks nothing", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      buildId: "build-x",
    });
    let asked = false;
    old.api.register("system.shutdown", () => {
      asked = true;
      return { stopping: true };
    });
    const error = await replacing(root, old.port, old.token, [], { buildMismatch: "refuse" })
      .ensure()
      .then(
        () => null,
        (candidate: unknown) => candidate,
      );
    expect((error as SupervisorError).kind).toBe("incompatible-build");
    expect(asked).toBe(false);
  });

  it("checks the USER before the build: another user's daemon is never asked to stop", async () => {
    const other = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: other.port,
      pid: process.pid,
      token: other.token,
      buildId: "build-x",
      extra: { userId: "01OTHERUSERBBBBBBBBBBBBBBB" },
    });
    const probe = await tryAdopt(root, 800, undefined, "build-y", "01MEUSERAAAAAAAAAAAAAAAAAA", {
      keepStaleClient: true,
    });
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.failure).toBe("user-mismatch");
      expect(probe.stale).toBeUndefined();
    }
  });

  it("a live listener that refuses our token is a NAMED takeover, and the new fieldd is spawned", async () => {
    const foreign = await h.startProduct({ verify: () => null });
    const fresh = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: foreign.port,
      pid: process.pid,
      token: fresh.token,
      buildId: "build-x",
    });
    const events: FielddSupervisorEvent[] = [];
    const handle = await replacing(root, fresh.port, fresh.token, events).ensure();
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(lifecycleNames(events)).toContain("fieldd.supervisor.takeover");
    const takeover = events.find(
      (event) => event.kind === "lifecycle" && event.event === "fieldd.supervisor.takeover",
    );
    expect(takeover?.kind === "lifecycle" && takeover.attrs).toMatchObject({
      probeFailure: "foreign-listener",
    });
  });
});
