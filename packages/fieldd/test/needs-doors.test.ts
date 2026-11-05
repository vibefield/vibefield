// CP-3 — the needs-you queue's doors (`draft/compose-plane/cp3-the-person.md`, CP3-D6 A), against the mock mgmt
// server (no cargo, no floor). An answer clears the item in every window's list and is one audited `needs.answer` pair
// in the own-actions ledger, its act by index and never its words. Items are raised without a floor by seeding the
// signed store before boot, with the spark they ask for (critique 20f).
// *Corrected 2026-11-04 (IOS-12a; PC-D4 A, PC-D7 A): needs.list, needs.subscribe and needs.answer are `sparks.use`
// rows the person's own screens open, a self phone among them (the home names each item's desktop); only
// needs.notices.subscribe stays agents.manage, the window's and the shell's.*
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  AGENT_INPUT_QUEUE_FORMAT,
  CONTRACTS_VERSION,
  ComposeSparksListResult,
  LAYOUT,
  NEEDS_RECORD_FORMAT,
  NeedsAnswerResult,
  NeedsListResult,
  type NeedsRecord,
  SOCKETS,
  SPARK_KEPT_FILE,
  SPARK_KEPT_FORMAT,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { RecordSigner } from "../src/signed-record";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";
import { SparkStore } from "../src/tool-plane/sparks";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const VELA = "sp-vela00000000";
const QUESTION = "ny-0000000000c0ffee";
const QUESTION_WORDS = "Push the fix to main now, or hold it for the review?";
/** item 158 — an answered question whose fact was in flight when fieldd was killed */
const ITEM_B = "ny-0000000000b0b0b0";

/** A user root with Vela's record and her question kept, signed, as a fieldd before this one left them. */
function seeded(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-needs-doors-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  new SparkStore({
    dir: join(dataDir, ...LAYOUT.SPARKS_DIR),
    keyPath: join(dataDir, ...LAYOUT.SPARKS_KEY_FILE),
  }).write({
    format: 1,
    id: VELA,
    name: "Vela",
    face: { seed: 7 },
    agent: AGENT_CATALOG[0]!.id,
    profiles: ["native"],
    thinksUnder: "native",
    folder: join(dataDir, "sparks", "vela"),
    createdAt: "2026-10-31T15:00:00.000Z",
    updatedAt: "2026-10-31T15:00:00.000Z",
  });
  const question: NeedsRecord = {
    format: NEEDS_RECORD_FORMAT,
    item: {
      id: QUESTION,
      kind: "question",
      state: "open",
      from: { name: "Vela", session: "run-vela", spark: VELA },
      spark: VELA,
      asked: "2026-10-31T16:00:00.000Z",
      words: QUESTION_WORDS,
      choices: ["Push", "Hold", "Not now"],
    },
  };
  new NeedsStore({
    dir: join(dataDir, ...LAYOUT.NEEDS_DIR),
    keyPath: join(dataDir, ...LAYOUT.NEEDS_KEY_FILE),
  }).write(question);
  return dataDir;
}

/** `observedState`, when given, is the floor's lifecycle snapshot: its terminals are the boot's first inventory, which
 * starts the re-attach (a plain mock lists none, so the re-attach never runs; item 158). */
async function boot(dataDir: string, observedState?: unknown): Promise<FielddDaemon> {
  return (await bootWithMock(dataDir, observedState)).daemon;
}

async function bootWithMock(
  dataDir: string,
  observedState?: unknown,
): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  if (observedState !== undefined) mock.observedState = observedState;
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

/** IOS-12a — the person's phone over its home's product door: a tailnet principal whose login is the linked one. */
async function phoneOf(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  login: string = TEST_LOGIN,
): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    headers: { "Tailscale-User-Login": login },
  });
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

async function connect(daemon: FielddDaemon, token: string, clientKind = "renderer") {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, token, clientKind);
  return rpc;
}

/** A renderer window token holding exactly `scopes`. */
async function window(daemon: FielddDaemon, scopes: string[], suffix: string): Promise<WsRpc> {
  const shell = await connect(daemon, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: {
      participantId: `renderer:desktop-test:window-${suffix}`,
      incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
    },
  })) as { token: string };
  return connect(daemon, minted.token);
}

/** The own-actions ledger's lines (JSONL) under the user root. */
function ownActions(dataDir: string): Array<Record<string, unknown>> {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("own-actions.") && f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("the needs-you queue's doors (CP3-D6 A)", () => {
  it("a window lists, subscribes to and answers the queue; the item leaves every window's list", async () => {
    const dataDir = seeded();
    const daemon = await boot(dataDir);
    const one = await window(daemon, ["sparks.use"], "one");
    const two = await window(daemon, ["sparks.use"], "two");
    const listed = NeedsListResult.parse(await one.call("needs.list", {}));
    expect(listed.items.map((i) => [i.id, i.kind, i.state, i.choices])).toEqual([
      [QUESTION, "question", "open", ["Push", "Hold", "Not now"]],
    ]);
    const subs = await Promise.all(
      [one, two].map(
        async (w) =>
          (await w.call("needs.subscribe", {})) as { subId: string; snapshot: NeedsListResult },
      ),
    );
    for (const sub of subs) expect(NeedsListResult.parse(sub.snapshot).items).toHaveLength(1);

    const answered = NeedsAnswerResult.parse(
      await one.call("needs.answer", { item: QUESTION, choice: 0 }),
    );
    // the act is done; the spark sleeps and cannot be started without a floor, so it is told when it next wakes
    expect(answered.item).toMatchObject({ id: QUESTION, state: "answered" });
    expect(answered.item.answer).toMatchObject({ choice: 0, outcome: "done", told: false });
    expect(answered.item.answer?.waits).toBeDefined();
    for (const [i, w] of [one, two].entries())
      await until(() =>
        w.notifications.some(
          (n) =>
            n.method === "needs.delta" &&
            n.params.subId === subs[i]!.subId &&
            NeedsListResult.parse(n.params.payload).items.length === 0,
        ),
      );
    expect(NeedsListResult.parse(await two.call("needs.list", {})).items).toEqual([]);

    // answered once, for every window: the same act again answers it as it is; another is refused
    expect(
      NeedsAnswerResult.parse(await two.call("needs.answer", { item: QUESTION, choice: 0 })).item
        .answer?.choice,
    ).toBe(0);
    const again = await two.callErr("needs.answer", { item: QUESTION, choice: 1 });
    expect(again.data?.kind).toBe("PRECONDITION_FAILED");
    expect(again.data?.details).toMatchObject({ reason: "answered" });
    // by its place, never its word
    expect((await one.callErr("needs.answer", { item: QUESTION, choice: "Push" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect(
      (await one.callErr("needs.answer", { item: "ny-00000000000000ff", choice: 0 })).data?.kind,
    ).toBe("NOT_FOUND");
  });

  it("refuses a token without the doors' scopes at the registry, and a local token of another client kind as none of the person's screens", async () => {
    const daemon = await boot(seeded());
    const observer = await window(daemon, ["agent.observe"], "observer");
    for (const [method, scope] of [
      ["needs.list", "sparks.use"],
      ["needs.subscribe", "sparks.use"],
      ["needs.answer", "sparks.use"],
      ["needs.notices.subscribe", "agents.manage"],
    ] as const) {
      const refused = await observer.callErr(method, { item: QUESTION, choice: 0 });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.message, method).toContain(scope);
    }
    // a local token that holds the scopes, from a client that is no window (critique 20b)
    const grant = daemon.tokens.mint(["sparks.use", "agents.manage"], "debug-client");
    const debug = await connect(daemon, grant.token, "debug");
    for (const [method, words] of [
      ["needs.list", "own windows and devices"],
      ["needs.subscribe", "own windows and devices"],
      ["needs.answer", "own windows and devices"],
      ["needs.notices.subscribe", "trusted desktop caller"],
    ] as const) {
      const refused = await debug.callErr(method, { item: QUESTION, choice: 0 });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.message, method).toContain(words);
    }
  });

  it("IOS-12a — the person's phone lists the queue and the sparks through its home, each naming this desktop, and answers there", async () => {
    const dataDir = seeded();
    writeLinkFixture(dataDir);
    const { daemon, mock } = await bootWithMock(dataDir);
    const phone = await phoneOf(daemon, mock);
    const listed = NeedsListResult.parse(await phone.call("needs.list", { scope: "mesh" }));
    expect(listed.items.map((item) => item.id)).toEqual([QUESTION]);
    const here = listed.items[0]?.device;
    expect(here).toEqual(expect.any(String));
    // the home asked every self desktop it knows; with no peer, it answered alone
    expect(listed.desktops).toEqual([{ device: here, state: "answered" }]);
    const sparks = ComposeSparksListResult.parse(
      await phone.call("compose.sparks.list", { scope: "mesh" }),
    );
    expect(sparks.sparks.map((spark) => [spark.id, spark.device])).toEqual([[VELA, here]]);
    expect(sparks.desktops).toEqual([{ device: here, state: "answered" }]);
    // `local`, the Mac's list: this desktop's own, with no merge note
    expect(NeedsListResult.parse(await phone.call("needs.list", {})).desktops).toBeUndefined();
    // one desktop's queue, this one's, whole
    const sub = (await phone.call("needs.subscribe", {})) as { snapshot: unknown };
    expect(NeedsListResult.parse(sub.snapshot).items.map((item) => item.device)).toEqual([here]);
    // its own device named on the act is this desktop: served here, not forwarded
    const answered = NeedsAnswerResult.parse(
      await phone.call("needs.answer", { item: QUESTION, choice: 1, device: here }),
    );
    expect(answered.item).toMatchObject({ id: QUESTION, state: "answered", device: here });
    // the window's notices stay the window's: the phone's preset does not hold agents.manage
    const notices = await phone.callErr("needs.notices.subscribe", {});
    expect(notices.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("IOS-12a — a tailnet login this desktop has not linked holds none of the doors", async () => {
    const dataDir = seeded();
    writeLinkFixture(dataDir);
    const { daemon, mock } = await bootWithMock(dataDir);
    const stranger = await phoneOf(daemon, mock, "someone-else@example.com");
    for (const method of ["needs.list", "compose.sparks.list", "needs.answer"]) {
      const refused = await stranger.callErr(method, { item: QUESTION, choice: 0 });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
  });

  it("an answer is one needs.answer pair in the own-actions ledger, its act by index and never the words", async () => {
    const dataDir = seeded();
    const daemon = await boot(dataDir);
    const win = await window(daemon, ["sparks.use"], "audit");
    await win.call("needs.answer", { item: QUESTION, choice: 1 });
    await until(() =>
      ownActions(dataDir).some((l) => l.action === "needs.answer" && l.phase === "outcome"),
    );
    const lines = ownActions(dataDir).filter((l) => l.action === "needs.answer");
    expect(lines.map((l) => l.phase)).toEqual(["attempt", "outcome"]);
    for (const line of lines) {
      expect(line.target).toMatchObject({ kind: "needs-item", id: QUESTION });
      expect((line.actor as { kind: string }).kind).toBe("local-token");
    }
    expect(lines[0]?.attrs).toMatchObject({ choice: 1 });
    expect(lines[1]).toMatchObject({ outcome: "succeeded" });
    expect(lines[1]?.attrs).toMatchObject({ kind: "question", outcome: "done", told: false });
    const ledger = readdirSync(join(dataDir, ...LAYOUT.AUDIT_DIR))
      .map((f) => readFileSync(join(dataDir, ...LAYOUT.AUDIT_DIR, f), "utf8"))
      .join("\n");
    expect(ledger).not.toContain("Push the fix");
    expect(ledger).not.toContain('"Hold"');
  });

  it("B1 · a boot settles the stamped heads a killed fieldd left: a spark's words are audited uncertain (restarted), and a wake's answer is neither telling nor owed again (item 158)", async () => {
    const dataDir = seeded();
    const inputsDir = join(dataDir, ...LAYOUT.AGENT_INPUTS_DIR);
    mkdirSync(inputsDir, { recursive: true, mode: 0o700 });
    chmodSync(inputsDir, 0o700);
    const signer = new RecordSigner({ keyPath: join(dataDir, ...LAYOUT.AGENT_INPUTS_KEY_FILE) });
    /** a queue file as the killed fieldd kept it: signed for its run, its head stamped */
    const keepQueue = (run: string, inputs: unknown[]) => {
      const unsigned = { format: AGENT_INPUT_QUEUE_FORMAT, run, inputs };
      const file = join(inputsDir, `${run}.json`);
      writeFileSync(file, JSON.stringify({ ...unsigned, signature: signer.sign(unsigned) }), {
        mode: 0o600,
      });
      chmodSync(file, 0o600);
    };
    const sending = "2026-11-04T16:02:11.402Z";
    // run-a: a spark's words, in flight when fieldd was killed
    keepQueue("run-a", [
      {
        id: "a1a1a1a1a1a1",
        text: "run the tests",
        from: { kind: "spark", spark: VELA, name: "Vela" },
        at: "2026-11-04T16:02:10.118Z",
        sending,
      },
    ]);
    // run-b: fieldd's wake carrying an answer's fact, in flight; the answer's record says it is telling there
    const fact = 'you answered Vela\'s question "Ship it?": Push';
    keepQueue("run-b", [
      {
        id: "b2b2b2b2b2b2",
        text: fact,
        from: { kind: "fieldd" },
        at: "2026-11-04T16:02:10.500Z",
        sending,
        items: [ITEM_B],
      },
    ]);
    const needsDir = join(dataDir, ...LAYOUT.NEEDS_DIR);
    new NeedsStore({ dir: needsDir, keyPath: join(dataDir, ...LAYOUT.NEEDS_KEY_FILE) }).write({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id: ITEM_B,
        kind: "question",
        state: "answered",
        from: { name: "Vela", session: "run-b", spark: VELA },
        spark: VELA,
        asked: "2026-11-04T16:01:00.000Z",
        words: "Ship it?",
        choices: ["Push", "Hold", "Not now"],
        answer: { choice: 0, at: "2026-11-04T16:02:10.400Z", outcome: "done", told: true },
      },
      owed: fact,
      telling: { run: "run-b", at: "2026-11-04T16:02:10.500Z" },
    });
    // a floor that lists no terminal: neither run exists, and its first inventory starts the re-attach, which settles
    // with no record to hold; then the settle reconcile finds both kept queues' runs gone
    const daemon = await boot(dataDir, {
      generation: 1,
      bootId: "b1c2d3e4-5f60-7a8b-9c0d-e1f203a4b5c6",
      terminals: [],
      workers: [{ id: "w1", state: "up" }],
      inventoryBoundMs: 10_000,
    });
    await until(() => daemon.agents.reattachSettled(), 5_000, "the re-attach ran");
    const queues = () => readdirSync(inputsDir).filter((f) => f.endsWith(".json"));
    await until(() => queues().length === 0, 5_000, "the kept queues settled").catch(
      () => undefined,
    );
    expect(queues()).toEqual([]);
    // the line is the own-actions ledger's: a ledger is chosen by the action's name, never by its principal
    await until(() =>
      ownActions(dataDir).some(
        (l) => l.action === "tools.agent_send.delivery" && l.phase === "outcome",
      ),
    ).catch(() => undefined);
    const delivery = ownActions(dataDir).filter(
      (l) => l.action === "tools.agent_send.delivery" && l.phase === "attempt",
    );
    expect(delivery).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ kind: "run", id: "run-a" }),
        attrs: expect.objectContaining({ spark: VELA, outcome: "uncertain", reason: "restarted" }),
      }),
    ]);
    // uncertain drops both owed and telling: the answer's record holds nothing more
    expect(readdirSync(needsDir).filter((f) => f.startsWith(ITEM_B))).toEqual([]);
  });

  it("B2 · a boot reads every spark's kept record once, and sets aside one copied into another spark's folder (item 159)", async () => {
    const dataDir = seeded();
    const sparkFiles = join(dataDir, ...LAYOUT.SPARK_FILES_DIR);
    const signer = new RecordSigner({ keyPath: join(dataDir, ...LAYOUT.SPARK_FILES_KEY_FILE) });
    const kept = (spark: string) => join(sparkFiles, spark, SPARK_KEPT_FILE);
    mkdirSync(join(sparkFiles, VELA), { recursive: true, mode: 0o700 });
    const body = { format: SPARK_KEPT_FORMAT, spark: VELA, updatedAt: "2026-11-05T01:00:00.000Z" };
    writeFileSync(kept(VELA), JSON.stringify({ ...body, signature: signer.sign(body) }), {
      mode: 0o600,
    });
    // Vela's own signed record, put in another spark's folder
    const KIWI = "sp-kiwi00000000";
    mkdirSync(join(sparkFiles, KIWI), { mode: 0o700 });
    writeFileSync(kept(KIWI), readFileSync(kept(VELA)), { mode: 0o600 });
    const before = readFileSync(kept(VELA), "utf8");
    await boot(dataDir);
    expect(existsSync(kept(KIWI))).toBe(false);
    expect(readdirSync(join(sparkFiles, KIWI))).toEqual([
      expect.stringMatching(/^kept\.json\.forged-\d+$/),
    ]);
    expect(readFileSync(kept(VELA), "utf8")).toBe(before);
  });

  it("needs.notices.subscribe answers an empty snapshot: a notice is an event, never kept", async () => {
    const daemon = await boot(seeded());
    const win = await window(daemon, ["agents.manage"], "notices");
    const sub = (await win.call("needs.notices.subscribe", {})) as {
      subId: string;
      snapshot: unknown;
    };
    expect(sub.subId).toMatch(/^ps-/);
    expect(sub.snapshot).toEqual({ notices: [] });
  });
});
