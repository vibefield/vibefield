// SP-1e2 — the crews' door, `compose.sparks.crews.subscribe` (SPE-Q27 (a), SPE-Q40; VF-PM's X2-crews), against the
// mock mgmt server (no cargo, no floor): a spark's crews from its kept record, whole, at the stream floor; `sparks.use`,
// admitted as the needs-you doors are (the person's windows and devices, the phone through its home); and once the
// re-attach has settled, a member whose run did not come back is Ended, and the card hears it. The record is seeded,
// signed, as a fieldd before this one kept it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  CONTRACTS_VERSION,
  ComposeSparksCrewsFrame,
  LAYOUT,
  SOCKETS,
  SPARK_KEPT_FILE,
  SPARK_KEPT_FORMAT,
  type SparkCrew,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { RecordSigner } from "../src/signed-record";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
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
const DOOR = "compose.sparks.crews.subscribe";

/** Vela's two crews as a fieldd before this one kept them: run-21 Ended then, run-22 and run-31 still running. */
const CREWS: SparkCrew[] = [
  {
    id: "cr-3n8w5t1v",
    sparkRun: "run-12",
    at: "2026-11-05T02:10:01.003Z",
    members: [
      {
        runtimeRunId: "run-21",
        at: "2026-11-05T02:10:01.003Z",
        agent: "claude",
        folder: "vibe-field",
        model: "Opus 5.5",
        effort: "high",
        endedAt: "2026-11-05T02:31:40.880Z",
        name: "Claude Code in vibe-field",
      },
      {
        runtimeRunId: "run-22",
        at: "2026-11-05T02:10:04.120Z",
        agent: "claude",
        folder: "vibe-field",
      },
    ],
  },
  {
    id: "cr-9x2q6p4m",
    sparkRun: "run-12",
    at: "2026-11-05T02:40:55.700Z",
    members: [
      {
        runtimeRunId: "run-31",
        at: "2026-11-05T02:40:55.700Z",
        agent: "codex",
        folder: "vibe-field",
      },
    ],
  },
];

/** A user root with Vela's record, and her kept record holding CREWS, each signed. */
function seeded(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-crews-door-"));
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
  const signer = new RecordSigner({ keyPath: join(dataDir, ...LAYOUT.SPARK_FILES_KEY_FILE) });
  const folder = join(dataDir, ...LAYOUT.SPARK_FILES_DIR, VELA);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const body = {
    format: SPARK_KEPT_FORMAT,
    spark: VELA,
    updatedAt: "2026-11-05T02:41:18.220Z",
    crews: CREWS,
  };
  writeFileSync(
    join(folder, SPARK_KEPT_FILE),
    JSON.stringify({ ...body, signature: signer.sign(body) }),
    { mode: 0o600 },
  );
  return dataDir;
}

/** The crews Vela's kept record holds on the disk now (its signature not checked: the store's own tests do that). */
function keptCrews(dataDir: string): SparkCrew[] {
  const path = join(dataDir, ...LAYOUT.SPARK_FILES_DIR, VELA, SPARK_KEPT_FILE);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as { crews?: SparkCrew[] }).crews ?? [];
}

/** A floor that lists no terminal: its first inventory starts the re-attach, which settles with no run to hold
 * (item 158's pattern; a plain mock lists none, so the re-attach never runs). */
const NO_TERMINALS = {
  generation: 1,
  bootId: "b1c2d3e4-5f60-7a8b-9c0d-e1f203a4b5c6",
  terminals: [],
  workers: [{ id: "w1", state: "up" }],
  inventoryBoundMs: 10_000,
};

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

/** The person's phone over its home's product door: a tailnet principal whose login is `login`. */
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

/** Each crew's members as [run, its state on the card's terms]. */
const states = (crews: readonly SparkCrew[]) =>
  crews.map((crew) =>
    crew.members.map((m) => [m.runtimeRunId, m.endedAt === undefined ? "running" : "ended"]),
  );
const allEnded = (crews: readonly SparkCrew[]) =>
  crews.every((crew) => crew.members.every((m) => m.endedAt !== undefined));

describe("SP-1e2 — the crews' door (SPE-Q27 (a), X2-crews)", () => {
  it("D2 · serves a spark's kept crews whole; once the re-attach settles, a member whose run did not come back is Ended, and the subscriber hears it", async () => {
    const dataDir = seeded();
    const { daemon } = await bootWithMock(dataDir, NO_TERMINALS);
    const win = await window(daemon, ["sparks.use"], "one");
    const sub = (await win.call(DOOR, { spark: VELA })) as { subId: string; snapshot: unknown };
    expect(sub.subId).toMatch(/^ps-/);
    const first = ComposeSparksCrewsFrame.parse(sub.snapshot);
    expect(first.spark).toBe(VELA);
    // the crews, whole, in the order they were made; every member kept (SPE-Q14 (a))
    expect(first.crews.map((crew) => crew.id)).toEqual(["cr-3n8w5t1v", "cr-9x2q6p4m"]);
    expect(first.crews.map((crew) => crew.members.length)).toEqual([2, 1]);
    // the floor lists no terminal, so no run comes back: the settle ends run-22 and run-31
    await until(() => daemon.agents.reattachSettled(), 5_000, "the re-attach ran");
    if (!allEnded(first.crews))
      await until(
        () =>
          win.notifications.some(
            (n) =>
              n.method === "compose.sparks.crews.delta" &&
              n.params.subId === sub.subId &&
              allEnded(ComposeSparksCrewsFrame.parse(n.params.payload).crews),
          ),
        15_000,
        "the settled crews reached the subscriber",
      );
    const kept = keptCrews(dataDir);
    expect(states(kept)).toEqual([
      [
        ["run-21", "ended"],
        ["run-22", "ended"],
      ],
      [["run-31", "ended"]],
    ]);
    // an end kept before is kept as it was; an end the settle found carries no name (the run was not seen)
    expect(kept[0]?.members[0]).toEqual(CREWS[0]?.members[0]);
    expect(kept[0]?.members[1]).not.toHaveProperty("name");
    // nothing waits for a member that is not on the board
    const again = (await win.call(DOOR, { spark: VELA })) as { snapshot: unknown };
    expect(ComposeSparksCrewsFrame.parse(again.snapshot).waiting).toEqual([]);
  }, 60_000);

  it("D3 · refuses a token without sparks.use, a local token of another client kind, an unknown spark and a malformed ask", async () => {
    const { daemon } = await bootWithMock(seeded());
    const observer = await window(daemon, ["agent.observe"], "observer");
    const scoped = await observer.callErr(DOOR, { spark: VELA });
    expect(scoped.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(scoped.message).toContain("sparks.use");
    const grant = daemon.tokens.mint(["sparks.use"], "debug-client");
    const debug = await connect(daemon, grant.token, "debug");
    const kind = await debug.callErr(DOOR, { spark: VELA });
    expect(kind.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(kind.message).toContain("own windows and devices");
    const win = await window(daemon, ["sparks.use"], "one");
    expect((await win.callErr(DOOR, { spark: "sp-nobody00000000" })).data?.kind).toBe("NOT_FOUND");
    expect((await win.callErr(DOOR, {})).data?.kind).toBe("PRECONDITION_FAILED");
  }, 60_000);

  it("D4 · the person's phone subscribes through its home; a tailnet login this desktop has not linked is refused", async () => {
    const dataDir = seeded();
    writeLinkFixture(dataDir);
    const { daemon, mock } = await bootWithMock(dataDir);
    const phone = await phoneOf(daemon, mock);
    const sub = (await phone.call(DOOR, { spark: VELA })) as { snapshot: unknown };
    expect(ComposeSparksCrewsFrame.parse(sub.snapshot).crews.map((crew) => crew.id)).toEqual([
      "cr-3n8w5t1v",
      "cr-9x2q6p4m",
    ]);
    const stranger = await phoneOf(daemon, mock, "someone-else@example.com");
    expect((await stranger.callErr(DOOR, { spark: VELA })).data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 60_000);
});
