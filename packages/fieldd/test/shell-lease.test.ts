import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { ShellLease } from "../src/shell-lease";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1) — the shell lease: a claim on a shell-main connection, a stated
// leave, an unstated one, and the record of how the last holder left, handed to the next attach ONCE. The unit rows
// drive the lease alone over a temp root; the daemon rows drive the two verbs and a real socket's close.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vf-shell-lease-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function lease(dataDir: string, sessions: number | null = 2, now = 1_000) {
  const vacancies: unknown[] = [];
  let held = 0;
  const value = new ShellLease({
    dataDir,
    liveSessions: () => sessions,
    logger: createNoopLogger(),
    now: () => now,
    onVacant: (record) => vacancies.push(record),
    onHeld: () => void held++,
  });
  // The last holder's close starts the record's write (mkdir `fieldd/`, a temp file, a rename) and does not wait
  // for it. A row that ends without `flush()` left that write racing its root's removal, and the rmSync met a
  // directory the write had just made: ENOTEMPTY, CI run 40807651886, 2026-10-29. Pushed after the root's own
  // cleanup, so it runs before it: every lease's writes settle before its root goes.
  cleanup.push(() => value.flush());
  return { value, vacancies, held: () => held };
}

describe("the shell lease (AL-7)", () => {
  it("a holder that goes without saying why leaves UNPLANNED, with the floor's live count; the next attach takes it once", async () => {
    const root = tempRoot();
    const a = lease(root, 2);
    expect(await a.value.attach("c1")).toBeNull();
    a.value.closed("c1");
    await a.value.flush();
    expect(a.vacancies).toEqual([{ planned: false, at: 1_000, sessions: 2 }]);
    // a NEW fieldd on the same root hands the record over: it is fieldd's file, not its memory
    const b = lease(root);
    expect(await b.value.attach("c2")).toEqual({ planned: false, at: 1_000, sessions: 2 });
    expect(await b.value.attach("c3")).toBeNull();
  });

  it("a holder that says why leaves PLANNED, and the reason is kept", async () => {
    const root = tempRoot();
    const a = lease(root, 0);
    await a.value.attach("c1");
    expect(a.value.leave("c1", "restart")).toBe(true);
    a.value.closed("c1");
    await a.value.flush();
    expect(await lease(root).value.attach("c2")).toEqual({
      planned: true,
      why: "restart",
      at: 1_000,
      sessions: 0,
    });
  });

  it("a probe's hello never claims it: its leave is refused and its close records nothing", async () => {
    const root = tempRoot();
    const a = lease(root);
    expect(a.value.leave("probe", "restart")).toBe(false);
    a.value.closed("probe");
    await a.value.flush();
    expect(a.vacancies).toEqual([]);
    expect(existsSync(join(root, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });

  it("only the LAST holder's close vacates it; a second holder keeps it held", async () => {
    const root = tempRoot();
    const a = lease(root);
    await a.value.attach("c1");
    await a.value.attach("c2");
    a.value.closed("c1");
    expect(a.value.held).toBe(true);
    expect(a.vacancies).toEqual([]);
    a.value.closed("c2");
    expect(a.value.held).toBe(false);
    expect(a.vacancies).toHaveLength(1);
    expect(a.held()).toBe(1); // held once, from the first attach
  });

  it("a sealed lease records nothing: the closes after fieldd starts stopping are its own", async () => {
    const root = tempRoot();
    const a = lease(root);
    await a.value.attach("c1");
    a.value.seal();
    a.value.closed("c1");
    await a.value.flush();
    expect(a.vacancies).toEqual([]);
    expect(existsSync(join(root, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });

  it("an unreadable census is said as null, never as zero", async () => {
    const root = tempRoot();
    const a = lease(root, null);
    await a.value.attach("c1");
    a.value.closed("c1");
    await a.value.flush();
    expect(JSON.parse(readFileSync(join(root, ...LAYOUT.SHELL_EXIT), "utf8"))).toMatchObject({
      sessions: null,
    });
  });

  it("a crashed fieldd's record (AL-8a) is kept on disk and handed once, beside the shell's own", async () => {
    const root = tempRoot();
    const a = lease(root);
    a.value.noteManagerExit({ at: 5_000, sessions: 3 });
    await a.value.flush();
    // a NEW fieldd on the same root hands it over: it is fieldd's file, as the shell's record is
    const b = lease(root);
    expect(await b.value.takeManagerExit()).toEqual({ at: 5_000, sessions: 3 });
    expect(await b.value.takeManagerExit()).toBeNull();
    expect(await b.value.attach("c1")).toBeNull();
  });

  it("a garbled record is set aside and read as none", async () => {
    const root = tempRoot();
    const path = join(root, ...LAYOUT.SHELL_EXIT);
    mkdirSync(join(root, "fieldd"), { recursive: true });
    writeFileSync(path, "{not json");
    expect(await lease(root).value.attach("c1")).toBeNull();
    expect(existsSync(path)).toBe(false);
  });
});

async function fixture(
  shape?: (native: MockMgmtServer) => void,
): Promise<{ daemon: FielddDaemon; dataDir: string; native: MockMgmtServer }> {
  const dataDir = tempRoot();
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  shape?.(native);
  await native.start();
  cleanup.push(() => native.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir, native };
}

async function connect(
  daemon: FielddDaemon,
  token: string,
  clientKind: "shell-main" | "renderer",
): Promise<{ rpc: WsRpc; socket: WebSocket }> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return { rpc, socket };
}

describe("the shell lease's verbs (AL-7, the daemon)", () => {
  it("a shell's socket that drops after attach is an UNPLANNED exit, handed to the next shell's attach once", async () => {
    const { daemon, dataDir } = await fixture();
    const first = await connect(daemon, daemon.shellToken, "shell-main");
    expect(await first.rpc.call("system.shell.attach", {})).toEqual({
      lastExit: null,
      lastManagerExit: null,
    });
    first.socket.terminate();
    await until(() => existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT)));
    const next = await connect(daemon, daemon.shellToken, "shell-main");
    const answer = (await next.rpc.call("system.shell.attach", {})) as {
      lastExit: { planned: boolean } | null;
    };
    expect(answer.lastExit).toMatchObject({ planned: false });
    expect(await next.rpc.call("system.shell.attach", {})).toEqual({
      lastExit: null,
      lastManagerExit: null,
    });
  });

  it("a shell that says it is restarting leaves PLANNED", async () => {
    const { daemon, dataDir } = await fixture();
    const first = await connect(daemon, daemon.shellToken, "shell-main");
    await first.rpc.call("system.shell.attach", {});
    expect(await first.rpc.call("system.shell.leave", { why: "restart" })).toEqual({ noted: true });
    first.socket.close();
    await until(() => existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT)));
    const next = await connect(daemon, daemon.shellToken, "shell-main");
    expect(await next.rpc.call("system.shell.attach", {})).toMatchObject({
      lastExit: { planned: true, why: "restart" },
    });
  });

  it("a fieldd that stops closes its shells' sockets itself, and that is no shell leaving", async () => {
    const { daemon, dataDir } = await fixture();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    await shell.rpc.call("system.shell.attach", {});
    await daemon.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });

  it("a shell that drops once its system.shutdown was accepted is no unplanned exit", async () => {
    const { daemon, dataDir } = await fixture();
    daemon.onShutdownRequest(() => undefined);
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    await shell.rpc.call("system.shell.attach", {});
    expect(await shell.rpc.call("system.shutdown", { reason: "quit" })).toMatchObject({
      stopping: true,
    });
    shell.socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });

  // AL-8a (`thinking-app-lifecycle.md` §8.3.1) — the floor's word that the fieldd before this one went without a
  // goodbye reaches the next shell's attach once; a planned departure says nothing; and fieldd's own stop says goodbye.
  it("a floor that says the previous fieldd crashed reaches the next attach once; a planned one never does", async () => {
    const crashed = await fixture((native) => {
      native.helloLastManager = { planned: false, at: 7_000, sessions: 2 };
    });
    await until(() => existsSync(join(crashed.dataDir, ...LAYOUT.MANAGER_EXIT)));
    const shell = await connect(crashed.daemon, crashed.daemon.shellToken, "shell-main");
    expect(await shell.rpc.call("system.shell.attach", {})).toEqual({
      lastExit: null,
      lastManagerExit: { at: 7_000, sessions: 2 },
    });
    expect(await shell.rpc.call("system.shell.attach", {})).toEqual({
      lastExit: null,
      lastManagerExit: null,
    });

    const planned = await fixture((native) => {
      native.helloLastManager = { planned: true, at: 7_000, sessions: 0 };
    });
    const next = await connect(planned.daemon, planned.daemon.shellToken, "shell-main");
    expect(await next.rpc.call("system.shell.attach", {})).toEqual({
      lastExit: null,
      lastManagerExit: null,
    });
  });

  it("fieldd's own stop says goodbye to its floor before it closes the link", async () => {
    const { daemon, native } = await fixture();
    await until(() => native.paired.size > 0);
    await daemon.stop();
    expect(native.requestLog.map((request) => request.method)).toContain("native.lifecycle.detach");
  });

  it("a probe (hello alone) leaves no record, and a window may not touch the lease", async () => {
    const { daemon, dataDir } = await fixture();
    const probe = await connect(daemon, daemon.shellToken, "shell-main");
    probe.socket.close();
    const grant = daemon.tokens.mint(["native.admin"], "test-window");
    const window = await connect(daemon, grant.token, "renderer");
    expect((await window.rpc.callErr("system.shell.attach", {})).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });
});
