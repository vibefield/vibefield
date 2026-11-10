import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION, type CustodyHandoff } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  productPath,
  runDir,
  tokenPath,
  tryAdopt,
} from "../src/index";
import { createHarness, FIXTURE_SEALED, type Harness, sealedObservePath } from "./helpers";

// OB custody (C2) — adoption under `sealed`: the shell pairs, it does not bear. A sealed fieldd writes no shell.token,
// so the probe reads product.json for where the daemon is and proves itself with a MAC over that port and boot under
// the shell's pairing secret, which is never sent. What answers must prove the same secret back. The daemon here is
// helpers' FIXTURE_SEALED, a whole listener that verifies the MAC by its own spelling of the recipe: fieldd's door is
// fieldd's half, with rows of its own.

const HANDOFF: CustodyHandoff = {
  v: 1,
  shell: "a3".repeat(32),
  pairing: "b4".repeat(32),
  records: "c5".repeat(32),
};
const SECRETS = [HANDOFF.shell, HANDOFF.pairing, HANDOFF.records];
const PAIRING = { kind: "pairing", secret: HANDOFF.shell } as const;
const USER = "01J9USERAAAAAAAAAAAAAAAAAA";

let h: Harness;
let clients: FielddClient[] = [];
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  // an open probe client reconnects for ever
  for (const client of clients) client.close();
  clients = [];
  await h.cleanup();
});

/** One sealed adoption probe, its client (kept or stale) tracked for closing. */
async function probe(
  root: string,
  o: { secret?: string; userId?: string; keepStaleClient?: boolean } = {},
) {
  const result = await tryAdopt(root, 1_500, undefined, undefined, o.userId, {
    credential: o.secret === undefined ? PAIRING : { kind: "pairing", secret: o.secret },
    ...(o.keepStaleClient !== undefined ? { keepStaleClient: o.keepStaleClient } : {}),
  });
  if (result.ok) clients.push(result.client);
  else if (result.stale !== undefined) clients.push(result.stale.client);
  return result;
}

/** product.json alone, as a sealed fieldd leaves the run dir: no shell.token beside it. */
function writeProduct(root: string, record: { port: number; pid: number; bootId: string }): void {
  mkdirSync(runDir(root), { recursive: true });
  const product = {
    ...record,
    contractsVersion: CONTRACTS_VERSION,
    startedAt: Date.now(),
    nativePid: null,
    buildId: null,
    custody: "sealed",
  };
  writeFileSync(productPath(root), JSON.stringify(product));
}

function rewriteProduct(root: string, change: Record<string, unknown>): void {
  const recorded = JSON.parse(readFileSync(productPath(root), "utf8")) as Record<string, unknown>;
  writeFileSync(productPath(root), JSON.stringify({ ...recorded, ...change }));
}

describe("tryAdopt with a pairing — a sealed fieldd", () => {
  it("adopts with no token file: product.json for where, the pairing for who", async () => {
    const root = h.mkRoot();
    const daemon = await h.startSealedDaemon(root, { handoff: HANDOFF });
    expect(existsSync(tokenPath(root))).toBe(false);

    const result = await probe(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info).toMatchObject({
      port: daemon.port,
      pid: daemon.pid,
      bootId: "boot-sealed",
      custody: "sealed",
    });
    expect(result.client.status).toBe("ready");
    expect(await result.client.request("system.health")).toEqual({ ok: true, state: "READY" });
    // one hello, the shell's, carrying a MAC and never the secret it was made with
    const { hellos } = daemon.observed();
    expect(hellos).toHaveLength(1);
    expect(hellos[0]).toMatchObject({ clientKind: "shell-main", credential: "object" });
    for (const secret of SECRETS) expect(hellos[0]?.raw).not.toContain(secret);
    expect(existsSync(tokenPath(root))).toBe(false);
  });

  it("pairs with a daemon that serves a user, and holds the record to the user it expects", async () => {
    const root = h.mkRoot();
    await h.startSealedDaemon(root, { handoff: HANDOFF, userId: USER });
    const mine = await probe(root, { userId: USER });
    expect(mine.ok).toBe(true);
    // the daemon is ours and proved it; it serves another user than this supervisor resolved
    const theirs = await probe(root, { userId: "01J9USERBBBBBBBBBBBBBBBBBB" });
    expect(theirs).toMatchObject({ ok: false, failure: "user-mismatch" });
  });

  it("a listener that cannot answer is foreign and was told nothing", async () => {
    const root = h.mkRoot();
    // planted at the recorded port: it takes any hello and says yes, and it holds no secret to prove
    const planted = await h.startSealedDaemon(root, { mode: "accept" });
    writeProduct(root, { port: planted.port, pid: planted.pid, bootId: planted.bootId });

    const result = await probe(root);
    expect(result).toMatchObject({ ok: false, failure: "foreign-listener" });
    expect(result.ok === false && result.stale).toBeUndefined();
    const { hellos } = planted.observed();
    expect(hellos).toHaveLength(1);
    expect(hellos[0]?.credential).toBe("object");
    for (const secret of SECRETS) expect(hellos[0]?.raw).not.toContain(secret);
  });

  it("a daemon handed another secret refuses the pairing: foreign, and nothing kept", async () => {
    const root = h.mkRoot();
    const daemon = await h.startSealedDaemon(root, { handoff: HANDOFF });
    const result = await probe(root, { secret: "d6".repeat(32) });
    expect(result).toMatchObject({ ok: false, failure: "foreign-listener" });
    expect(daemon.observed().hellos).toHaveLength(1);
  });

  it("a rewritten product.json port fails: a hello relayed to the real daemon was made for another port", async () => {
    const root = h.mkRoot();
    const daemon = await h.startSealedDaemon(root, { handoff: HANDOFF });
    // a relay at another port, passing every byte to the real daemon and back
    const relay = await h.startGatedProxy(daemon.port);
    relay.open();
    rewriteProduct(root, { port: relay.port });

    const result = await probe(root);
    expect(result).toMatchObject({ ok: false, failure: "foreign-listener" });
    // the real daemon heard the hello and refused it: its MAC names the relay's port
    expect(daemon.observed().hellos).toHaveLength(1);
    // put back, the same daemon pairs
    rewriteProduct(root, { port: daemon.port });
    expect((await probe(root)).ok).toBe(true);
  });

  it("a record that names another boot does not pair", async () => {
    const root = h.mkRoot();
    await h.startSealedDaemon(root, { handoff: HANDOFF });
    rewriteProduct(root, { bootId: "boot-before" });
    expect(await probe(root)).toMatchObject({ ok: false, failure: "foreign-listener" });
  });

  it("nothing recorded is nothing to adopt, and a dead port is stale files, token or none", async () => {
    const root = h.mkRoot();
    expect(await probe(root)).toMatchObject({ ok: false, failure: "no-run-files" });
    const gone = await h.startProduct();
    gone.api.close();
    writeProduct(root, { port: gone.port, pid: process.pid, bootId: "boot-gone" });
    expect(await probe(root)).toMatchObject({ ok: false, failure: "stale-files" });
  });
});

describe("the one legacy read — a fieldd from before custody", () => {
  it("is found by its own token file: incompatible-build, marked, its client kept for the stop verb", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      bootId: "boot-old",
    });

    const result = await probe(root, { keepStaleClient: true });
    expect(result).toMatchObject({ ok: false, failure: "incompatible-build", preCustody: true });
    if (result.ok || result.stale === undefined) {
      throw new Error("the old daemon's client was dropped");
    }
    expect(result.stale.info.bootId).toBe("boot-old");
    expect(result.stale.client.status).toBe("ready");
    const health = await result.stale.client.request("system.health");
    expect(health).toEqual({ ok: true, state: "READY" });
  });

  it("without the caller's ask, the old daemon's client is closed and only the verdict returns", async () => {
    const old = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port: old.port, pid: process.pid, token: old.token });
    const result = await probe(root);
    expect(result).toMatchObject({ ok: false, failure: "incompatible-build", preCustody: true });
    expect(result.ok === false && result.stale).toBeUndefined();
  });

  it("with no token file the same daemon is a foreign listener: there is no bearer to try", async () => {
    const old = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port: old.port, pid: process.pid, token: old.token });
    rmSync(tokenPath(root));
    expect(await probe(root)).toMatchObject({ ok: false, failure: "foreign-listener" });
  });

  it("a token file beside a listener that refuses it too is still foreign", async () => {
    const stranger = await h.startProduct({ verify: () => null });
    const root = h.mkRoot();
    h.writeRunFiles(root, { port: stranger.port, pid: process.pid });
    expect(await probe(root)).toMatchObject({ ok: false, failure: "foreign-listener" });
  });

  it("never asks another user's old daemon to stop: user-mismatch comes first", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      extra: { userId: "01J9USERBBBBBBBBBBBBBBBBBB" },
    });
    const result = await probe(root, { userId: USER, keepStaleClient: true });
    expect(result).toMatchObject({ ok: false, failure: "user-mismatch" });
    expect(result.ok === false && result.stale).toBeUndefined();
  });
});

describe("the supervisor at `sealed`", () => {
  const lifecycleNames = (events: FielddSupervisorEvent[]) =>
    events.flatMap((event) => (event.kind === "lifecycle" ? [event.event] : []));

  it("adopts a sealed fieldd: ownership adopted, the level read from its record, no token file", async () => {
    const root = h.mkRoot();
    const daemon = await h.startSealedDaemon(root, { handoff: HANDOFF });
    const events: FielddSupervisorEvent[] = [];
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        // adoption works, so the spawn is never reached: an inert command
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "leave-running",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3_000,
        liveness: false,
        custody: { handoff: () => HANDOFF },
        onEvent: (event) => events.push(event),
      }),
    );
    const handle = await sup.ensure();
    expect(handle.ownership).toBe("adopted");
    expect(handle.info).toMatchObject({
      pid: daemon.pid,
      bootId: "boot-sealed",
      custody: "sealed",
    });
    expect(handle.client.status).toBe("ready");
    expect(lifecycleNames(events)).toContain("fieldd.supervisor.adopted");
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.spawned");
    expect(existsSync(tokenPath(root))).toBe(false);
    for (const secret of SECRETS) expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("asks a fieldd from before custody to stop by its own bearer, then spawns a sealed one", async () => {
    const old = await h.startProduct({ scopes: ["native.admin"] });
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: old.port,
      pid: process.pid,
      token: old.token,
      bootId: "boot-old",
    });
    let asked = false;
    // fieldd's side of the verb: acknowledge, and remove its record as its graceful stop does
    old.api.register("system.shutdown", () => {
      asked = true;
      rmSync(productPath(root), { force: true });
      return { stopping: true };
    });
    const script = h.writeFixture(join(root, "fx"), "sealed.mjs", FIXTURE_SEALED);
    const events: FielddSupervisorEvent[] = [];
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: [script] },
        environment: { CV: CONTRACTS_VERSION, OBSERVE_FILE: sealedObservePath(root) },
        shutdownPolicy: "leave-running",
        adoptProbeMs: 600,
        readinessDeadlineMs: 6_000,
        liveness: false,
        // no `buildMismatch: "replace"`: a daemon from before custody is replaced whatever the build policy says
        custody: { handoff: () => HANDOFF },
        onEvent: (event) => events.push(event),
      }),
    );
    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    expect(asked).toBe(true);
    expect(handle.ownership).toBe("spawned");
    expect(handle.info.custody).toBe("sealed");
    expect(lifecycleNames(events)).toEqual(
      expect.arrayContaining([
        "fieldd.supervisor.replacing_build",
        "fieldd.supervisor.replaced_build",
        "fieldd.supervisor.ready",
      ]),
    );
  });
});
