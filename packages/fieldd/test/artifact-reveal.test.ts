// FL-2a — `artifact.reveal`: the window opens a Live app (DESIGN.md §8 "Artifacts"; the panel moved
// into field-app at FL-2). The window never holds `shell.open` (bootstrap.ts; MA's L4, C1 and C2),
// so it names a row of this desktop's own catalog and this desktop opens that row's URL through its
// shell. Over a real daemon and the mock floor: the open, its audit with no URL in it, and each
// refusal before anything opens. The phone's and a peer's refusals are index-tailnet-bound.test.ts's.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactListResult,
  type ArtifactView,
  SHELL_PROVIDER_METHODS,
  ShellProviderCallParams,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const ARTIFACT_ID = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
const MOCK_HOST = "mock.ts.net";
const REVEAL = "artifact.live.reveal";

interface World {
  readonly dataDir: string;
  readonly daemon: FielddDaemon;
  readonly shell: WsRpc;
  readonly window: WsRpc;
}

async function connect(
  daemon: FielddDaemon,
  token: string,
  clientKind = "renderer",
): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return rpc;
}

async function boot(configure?: (mock: MockMgmtServer) => void): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-reveal-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  configure?.(mock);
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  const shell = await connect(daemon, daemon.shellToken, "shell-main");
  await shell.call("shell.provider.register", { methods: [...SHELL_PROVIDER_METHODS] });
  const window = await connect(
    daemon,
    daemon.tokens.mint(["apps.use", "workspace.read"], "window-reveal").token,
  );
  return { dataDir, daemon, shell, window };
}

/** A site on this computer for a Live app to proxy. */
async function localSite(): Promise<number> {
  const site = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    site.once("error", reject);
    site.listen(0, "127.0.0.1", resolve);
  });
  cleanup.push(() => new Promise<void>((resolve) => site.close(() => resolve())));
  const address = site.address();
  if (address === null || typeof address === "string") throw new Error("the site did not bind");
  return address.port;
}

function publish(world: World, port: number) {
  return world.shell.attempt("artifact.publish", {
    artifactId: ARTIFACT_ID,
    title: "Site",
    source: { kind: "proxy", port, scheme: "http" },
  });
}

/** The catalog's row that `want` accepts, as the window reads it, once there is one. */
async function rowOf(world: World, want: (row: ArtifactView) => boolean): Promise<ArtifactView> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { artifacts } = ArtifactListResult.parse(await world.window.call("artifact.list", {}));
    const row = artifacts.find(want);
    if (row !== undefined) return row;
    if (Date.now() > deadline) throw new Error(`no such row in ${JSON.stringify(artifacts)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const openable = (world: World) => rowOf(world, (row) => row.openable);

function openLinks(shell: WsRpc): ShellProviderCallParams[] {
  return shell.notifications
    .filter((notification) => notification.method === "shell.provider.call")
    .map((notification) => ShellProviderCallParams.parse(notification.params))
    .filter((call) => call.method === "shell.openLink");
}

async function revealRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const records: AuditRecordV1[] = [];
  const root = join(dataDir, "audit");
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records.filter((record) => record.action === REVEAL);
}

describe("FL-2a — artifact.reveal, the window opening a Live app", () => {
  it("opens the row's own URL through this desktop's shell, and audits it without the URL", async () => {
    const world = await boot();
    await publish(world, await localSite());
    const row = await openable(world);
    expect(row.url).toContain(MOCK_HOST);

    const opening = world.window.call("artifact.reveal", { artifactKey: row.artifactKey });
    await until(() => openLinks(world.shell).length === 1, 10_000, "the shell is asked");
    const [call] = openLinks(world.shell);
    expect(call).toMatchObject({
      method: "shell.openLink",
      // the standard's spelling of the URL the catalog holds, as `artifact.open`'s reveal hands it
      params: { url: new URL(String(row.url)).href },
      caller: { clientKind: "fieldd" },
    });
    await world.shell.call("shell.provider.resolve", {
      callId: call?.callId,
      outcome: { result: { opened: true } },
    });
    await expect(opening).resolves.toEqual({ opened: true });

    const records = await revealRecords(world.dataDir);
    expect(records.map((record) => [record.phase, record.outcome ?? null])).toEqual([
      ["attempt", null],
      ["outcome", "succeeded"],
    ]);
    expect(records[0]?.target).toEqual({ kind: "artifact", id: ARTIFACT_ID });
    expect(JSON.stringify(records), "the record names no URL").not.toContain(MOCK_HOST);
  });

  it("fails with the shell's word when the shell refuses the open", async () => {
    const world = await boot();
    await publish(world, await localSite());
    const row = await openable(world);
    const opening = world.window.attempt("artifact.reveal", { artifactKey: row.artifactKey });
    await until(() => openLinks(world.shell).length === 1, 10_000, "the shell is asked");
    await world.shell.call("shell.provider.resolve", {
      callId: openLinks(world.shell)[0]?.callId,
      outcome: {
        error: {
          kind: "UNAVAILABLE",
          message: "the primary window is unavailable",
          retryable: true,
        },
      },
    });
    const answer = await opening;
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.data?.kind).toBe("UNAVAILABLE");
  });

  it("refuses a key the catalog does not hold, and opens nothing", async () => {
    const world = await boot();
    const refused = await world.window.callErr("artifact.reveal", {
      artifactKey: `dev-a:${ARTIFACT_ID}`,
    });
    expect(refused.data?.kind).toBe("NOT_FOUND");
    expect(openLinks(world.shell)).toEqual([]);
    expect(await revealRecords(world.dataDir)).toEqual([]);
  });

  it("refuses a row with no URL, and opens nothing", async () => {
    // every add refused, so the row stands with no URL for as long as the row is read
    const world = await boot((mock) => {
      Object.defineProperty(mock, "failNextServeAdd", { get: () => true, set: () => undefined });
    });
    await publish(world, await localSite());
    const row = await rowOf(world, (candidate) => candidate.artifactId === ARTIFACT_ID);
    expect(row.openable).toBe(false);
    const refused = await world.window.callErr("artifact.reveal", {
      artifactKey: row.artifactKey,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(openLinks(world.shell)).toEqual([]);
    expect(await revealRecords(world.dataDir)).toEqual([]);
  });

  it("refuses params that name no key, and never takes a URL in place of one", async () => {
    const world = await boot();
    for (const params of [{}, { artifactKey: "" }, { url: `https://${MOCK_HOST}:12000/` }]) {
      const refused = await world.window.callErr("artifact.reveal", params);
      expect(refused.data?.kind, JSON.stringify(params)).toBe("PRECONDITION_FAILED");
    }
    expect(openLinks(world.shell)).toEqual([]);
  });

  it("is refused to a token without apps.use, and to a plugin holding it", async () => {
    const world = await boot();
    await publish(world, await localSite());
    const row = await openable(world);
    const reader = await connect(
      world.daemon,
      world.daemon.tokens.mint(["workspace.read"], "no-apps-use").token,
    );
    expect(
      (await reader.callErr("artifact.reveal", { artifactKey: row.artifactKey })).data?.kind,
    ).toBe("FORBIDDEN_SCOPE");
    const plugin = await connect(
      world.daemon,
      world.daemon.tokens.mint(["apps.use"], "a-plugin", { pluginId: "com.example.plugin" }).token,
    );
    expect(
      (await plugin.callErr("artifact.reveal", { artifactKey: row.artifactKey })).data?.kind,
    ).toBe("FORBIDDEN_SCOPE");
    expect(openLinks(world.shell)).toEqual([]);
  });
});
