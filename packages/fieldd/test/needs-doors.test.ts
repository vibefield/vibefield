// CP-3 — the needs-you queue's window doors (`draft/compose-plane/cp3-the-person.md`, CP3-D6 A), against the mock
// mgmt server (no cargo, no floor): needs.list, needs.subscribe, needs.answer and needs.notices.subscribe are local
// agents.manage rows that only a trusted desktop caller opens; an answer clears the item in every window's list and is
// one audited `needs.answer` pair in the own-actions ledger, its act by index and never its words. Items are raised
// without a floor by seeding the signed store before boot, with the spark they ask for (critique 20f).
import {
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
  LAYOUT,
  NEEDS_RECORD_FORMAT,
  NeedsAnswerResult,
  NeedsListResult,
  type NeedsRecord,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";
import { SparkStore } from "../src/tool-plane/sparks";
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

async function boot(dataDir: string): Promise<FielddDaemon> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return daemon;
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
    const one = await window(daemon, ["agents.manage"], "one");
    const two = await window(daemon, ["agents.manage"], "two");
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

  it("refuses a token without agents.manage at the registry, and a local token of another client kind as no desktop caller", async () => {
    const daemon = await boot(seeded());
    const observer = await window(daemon, ["agent.observe"], "observer");
    for (const method of [
      "needs.list",
      "needs.subscribe",
      "needs.answer",
      "needs.notices.subscribe",
    ]) {
      const refused = await observer.callErr(method, { item: QUESTION, choice: 0 });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.message, method).toContain("agents.manage");
    }
    // a local token that holds the scope, from a client that is no window (critique 20b)
    const grant = daemon.tokens.mint(["agents.manage"], "debug-client");
    const debug = await connect(daemon, grant.token, "debug");
    for (const method of [
      "needs.list",
      "needs.subscribe",
      "needs.answer",
      "needs.notices.subscribe",
    ]) {
      const refused = await debug.callErr(method, { item: QUESTION, choice: 0 });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.message, method).toContain("trusted desktop caller");
    }
  });

  it("an answer is one needs.answer pair in the own-actions ledger, its act by index and never the words", async () => {
    const dataDir = seeded();
    const daemon = await boot(dataDir);
    const win = await window(daemon, ["agents.manage"], "audit");
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
