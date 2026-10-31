// WIN-4 — the harness's own win32 branches, proven from a mac. Every native
// suite reaches field-native through these three helpers, so a wrong `.exe` or a
// path where a pipe belongs would fail as "the daemon never came up" on Windows
// and as nothing at all here. An explicit `platform` argument is the whole point
// of the signatures; this is what exercises it. And where the suites' own build
// lands: in the checkout's own target, the one `nativeBinPath` reads.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeEndpointFor, SOCKETS, TerminalRouteSnapshot } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  floorEvidence,
  nativeBinPath,
  nativeBuildEnv,
  nativeEndpoint,
  shortTmpRoot,
  waitWithEvidence,
} from "./native-harness";

describe("the suites' field-native build lands where they look for it", () => {
  const made: string[] = [];
  const dir = (): string => {
    const root = mkdtempSync(join(tmpdir(), "vf-target-"));
    made.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("builds into the checkout's own target — the real path behind its link — when none is named", () => {
    const checkout = dir();
    const lane = dir();
    symlinkSync(lane, join(checkout, "target"));
    expect(nativeBuildEnv(checkout, { PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
      CARGO_TARGET_DIR: realpathSync(lane),
    });
    const plain = dir();
    mkdirSync(join(plain, "target"));
    expect(nativeBuildEnv(plain, {})["CARGO_TARGET_DIR"]).toBe(realpathSync(join(plain, "target")));
    // a checkout that has built nothing yet: its target is made where the suites will look
    const fresh = dir();
    expect(nativeBuildEnv(fresh, {})["CARGO_TARGET_DIR"]).toBe(join(fresh, "target"));
  });

  it("leaves a target directory the caller named, in either of cargo's spellings", () => {
    const checkout = dir();
    symlinkSync(dir(), join(checkout, "target"));
    const named = { CARGO_TARGET_DIR: "/elsewhere" };
    expect(nativeBuildEnv(checkout, named)).toBe(named);
    const build = { CARGO_BUILD_TARGET_DIR: "/elsewhere" };
    expect(nativeBuildEnv(checkout, build)).toBe(build);
  });
});

describe("the native harness is platform-shaped (WIN-4)", () => {
  // tooling (a): `nativeBinPath` asks cargo where the suites' build lands, so
  // these rows name the target directory rather than assume `<repo>/target`
  const REPO = join(import.meta.dirname, "..", "..", "..");
  // the run's own overrides out (a lane exports CARGO_TARGET_DIR), so each row's is the one cargo reads
  const plain = { ...process.env };
  delete plain["CARGO_TARGET_DIR"];
  delete plain["CARGO_BUILD_TARGET_DIR"];
  const named = { ...plain, CARGO_TARGET_DIR: "/elsewhere" };

  it("appends .exe to the cargo artifact on win32 only", () => {
    expect(nativeBinPath(REPO, "darwin", named)).toBe(join("/elsewhere", "debug", "field-native"));
    expect(nativeBinPath(REPO, "linux", named)).toBe(join("/elsewhere", "debug", "field-native"));
    expect(nativeBinPath(REPO, "win32", named)).toBe(
      join("/elsewhere", "debug", "field-native.exe"),
    );
  });

  it("reads where the suites' build lands, as cargo says it: the named target, else the checkout's own", () => {
    // tooling (a) — it was the literal <root>/target/debug, which a target the
    // caller named without a `target` link beside it made a file never written
    const spelled = { ...plain, CARGO_BUILD_TARGET_DIR: "/other" };
    expect(nativeBinPath(REPO, "darwin", spelled)).toBe(join("/other", "debug", "field-native"));
    const own = nativeBuildEnv(REPO, plain)["CARGO_TARGET_DIR"] as string;
    expect(nativeBinPath(REPO, "darwin", plain)).toBe(join(own, "debug", "field-native"));
  });

  it("resolves a LAYOUT path on unix and a named pipe on win32 (WIN-D1)", () => {
    const root = "/tmp/vf-fixture";
    expect(nativeEndpoint(root, SOCKETS.MGMT, "darwin")).toBe(
      join(root, "native", "run", "mgmt.sock"),
    );
    // the pipe name is the endpoint law's, not this harness's — same derivation
    // both planes use, so the suites dial exactly what field-native bound
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).toBe(pipeEndpointFor(root, SOCKETS.MGMT));
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).toMatch(/^\\\\\.\\pipe\\/);
    // no filesystem presence to wait on — the reason the readiness gates connect
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).not.toContain(root);
  });

  it("keeps unix temp roots under /tmp and win32 ones under tmpdir()", () => {
    // shortTmpRoot mkdtemps the root it returns, so each branch is reachable only
    // on a host whose base dir exists: /tmp is absent on win32 (→ C:\tmp), and the
    // win32 branch's tmpdir() is the real base only there. Each host proves its own.
    if (process.platform === "win32") {
      const win = shortTmpRoot("vf-harness-win-", "win32");
      try {
        expect(win.startsWith(join(tmpdir(), "vf-harness-win-"))).toBe(true);
      } finally {
        rmSync(win, { recursive: true, force: true });
      }
    } else {
      const unix = shortTmpRoot("vf-harness-unix-", "darwin");
      try {
        // the sun_path budget: /tmp, never macOS's ~50-byte /var/folders/… root
        expect(unix.startsWith("/tmp/vf-harness-unix-")).toBe(true);
      } finally {
        rmSync(unix, { recursive: true, force: true });
      }
    }
  });
});

// Item 63 → item 68 — a real-floor row's wait that times out names what the floor and fieldd did, from their own
// logs, and what fieldd heard of the link. Before, it said only "poll timed out", and the logs went with the root.
describe("a stalled real-floor wait says which step stalled", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const T0 = 1_792_990_000_000;
  /** A data dir whose floor log holds `floor`, and whose fieldd log holds `fieldd` when given (each with one line
   * that is not JSON), as the suites lay them out. */
  const dataDirWith = (floor: object[], fieldd?: object[]): string => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-evidence-"));
    made.push(dataDir);
    mkdirSync(join(dataDir, "logs", "system"), { recursive: true });
    const write = (file: string, records: object[]) =>
      writeFileSync(
        join(dataDir, "logs", "system", file),
        `${[...records.map((r) => JSON.stringify(r)), "not json"].join("\n")}\n`,
      );
    write("field-native.ndjson", floor);
    if (fieldd !== undefined) write("fieldd.ndjson", fieldd);
    return dataDir;
  };
  const sceneOf = (dataDir: string, spawnedAt: number | undefined, connected = false) => ({
    dataDir,
    spawnedAt,
    link: { connected, terminalRoutes: undefined },
  });
  const STALLED = [
    { time: T0 + 1150, event: "field_native.lifecycle.boot_started", level: 30, attrs: {} },
    {
      time: T0 + 1158,
      event: "field_native.lifecycle.ready",
      level: 30,
      attrs: { endpoint: "/tmp/vf-x/users/1/native/run/mgmt.sock" },
    },
    {
      time: T0 + 16_204,
      event: "field_native.terminal.cell_ended",
      level: 40,
      attrs: {
        class: "agent",
        role: "class",
        instance: 1,
        detail: "no hello within 15s — killed",
        attribution: "unknown",
        control_socket: "/tmp/vf-x/users/1/native/run/termctl.1.sock",
      },
    },
    {
      time: T0 + 16_210,
      event: "field_native.terminal.cell_stderr",
      level: 30,
      attrs: { instance: 2, line: "door http://127.0.0.1:5555/?token=never-printed" },
    },
  ];

  it("names a cell killed at its hello deadline, in ms since the spawn, and carries no socket, endpoint or line", () => {
    const evidence = floorEvidence(sceneOf(dataDirWith(STALLED), T0));
    expect(evidence).toContain(
      "fieldd's link: NOT connected; no route snapshot heard (neither the hello nor a routes stream carried one)",
    );
    expect(evidence).toContain("the logs (4 event(s); ms since the spawn) (no fieldd log at ");
    expect(evidence).toContain("  +1150 floor field_native.lifecycle.boot_started");
    expect(evidence).toContain(
      '  +16204 floor field_native.terminal.cell_ended [level 40] class="agent" role="class" instance=1 detail="no hello within 15s — killed" attribution="unknown"',
    );
    expect(evidence).toContain("  +16210 floor field_native.terminal.cell_stderr instance=2");
    for (const secret of ["mgmt.sock", "termctl", "token", "never-printed", "5555"])
      expect(evidence).not.toContain(secret);
  });

  it("says what fieldd heard of the routes, and that neither log exists when neither was written", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-evidence-"));
    made.push(dataDir);
    const routes = TerminalRouteSnapshot.parse({
      revision: 3,
      cells: [
        {
          cellInstanceId: 1,
          cellBootId: "boot-1",
          pid: 4242,
          endpoints: {
            controlSocket: "/tmp/vf-x/termctl.1.sock",
            frameSocket: "/tmp/vf-x/termframe.1.sock",
            authToken: "never-printed",
          },
          tokenGeneration: 1,
          workloadClass: "agent",
          role: "class",
        },
      ],
    });
    const evidence = floorEvidence({
      dataDir,
      spawnedAt: T0,
      link: { connected: true, terminalRoutes: routes },
    });
    expect(evidence).toBe(
      `fieldd's link: connected; routes heard at revision 3, 1 cell(s) (1 agent/class)\nthe logs hold no event (no floor or fieldd log at ${join(dataDir, "logs", "system")})`,
    );
  });

  it("a floor spawned earlier (a restart's) counts from its logs' first event, and the last `limit` are shown", () => {
    const evidence = floorEvidence(sceneOf(dataDirWith(STALLED), undefined, true), 2);
    expect(evidence).toContain("the logs (4 event(s), the last 2; ms since their first event)");
    expect(evidence).toContain("  +15054 floor field_native.terminal.cell_ended");
    expect(evidence).not.toContain("boot_started");
  });

  it("item 68 — merges fieldd's own log into the floor's by time: a login pane whose re-read never came is named by what fieldd did and did not log", () => {
    const fieldd = [
      {
        time: T0 + 2_000,
        event: "fieldd.agents.login_started",
        level: 30,
        attrs: { sessionId: "s-1", profileId: "claude:native-default", token: "never-printed" },
      },
      {
        time: T0 + 2_600,
        event: "fieldd.agents.husk_reaped",
        level: 30,
        attrs: { sessionId: "s-1", terminated: true },
      },
    ];
    const evidence = floorEvidence(sceneOf(dataDirWith(STALLED.slice(0, 2), fieldd), T0));
    const lines = evidence.split("\n");
    // one timeline, in time order, each line saying whose it is
    expect(lines.slice(2)).toEqual([
      "  +1150 floor field_native.lifecycle.boot_started",
      "  +1158 floor field_native.lifecycle.ready",
      '  +2000 fieldd fieldd.agents.login_started sessionId="s-1" profileId="claude:native-default"',
      '  +2600 fieldd fieldd.agents.husk_reaped sessionId="s-1" terminated=true',
    ]);
    expect(evidence).not.toContain("never-printed");
  });

  it("item 68 — waitWithEvidence answers the value as soon as the row has it, and changes no budget", async () => {
    let asks = 0;
    const value = await waitWithEvidence(
      "the third ask",
      () => (++asks === 3 ? "ready" : undefined),
      5_000,
      () => undefined,
      1,
    );
    expect(value).toBe("ready");
    expect(asks).toBe(3);
  });

  it("item 68 — at the deadline the error says what was awaited, what the row last saw, and the scene's evidence", async () => {
    const dataDir = dataDirWith(STALLED.slice(0, 2));
    const error = await waitWithEvidence(
      "the persona's identity re-read after its login pane ends",
      (seen) => {
        seen({ profileId: "claude:native-default", identity: undefined, loggingIn: true });
        return undefined;
      },
      30,
      () => sceneOf(dataDir, T0, true),
      5,
    ).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    const lines = (error as Error).message.split("\n");
    expect(lines[0]).toBe(
      "the persona's identity re-read after its login pane ends did not hold within 30 ms",
    );
    expect(lines[1]).toBe(
      'the row last saw: {"profileId":"claude:native-default","loggingIn":true}',
    );
    expect(lines[2]).toBe(
      "fieldd's link: connected; no route snapshot heard (neither the hello nor a routes stream carried one)",
    );
    expect(lines).toContain("  +1158 floor field_native.lifecycle.ready");
  });

  it("item 97 — a wait's witness is asked once, at the deadline, and its word follows what the row saw", async () => {
    let asked = 0;
    const error = await waitWithEvidence(
      "the run's exit",
      (seen) => {
        seen({ exited: false });
        return undefined;
      },
      30,
      () => undefined,
      5,
      async () => {
        asked += 1;
        return "the floor's row for pane p1: not listed";
      },
    ).catch((e: unknown) => e as Error);
    expect(asked).toBe(1);
    expect((error as Error).message.split("\n")).toEqual([
      "the run's exit did not hold within 30 ms",
      'the row last saw: {"exited":false}',
      "the floor's row for pane p1: not listed",
      "no floor scene was recorded for this row",
    ]);
    // a witness that fails says so in its place, and the wait's own error still stands
    const failed = await waitWithEvidence(
      "the run's exit",
      () => undefined,
      1,
      () => undefined,
      1,
      async () => {
        throw new Error("lsof is not here");
      },
    ).catch((e: unknown) => e as Error);
    expect((failed as Error).message.split("\n")[2]).toBe(
      "the row's witness failed: lsof is not here",
    );
  });

  it("item 68 — a row that reported nothing, with no scene recorded, says both", async () => {
    const error = await waitWithEvidence(
      "nothing",
      () => undefined,
      1,
      () => undefined,
      1,
    ).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe(
      "nothing did not hold within 1 ms\nthe row reported nothing it saw\nno floor scene was recorded for this row",
    );
  });
});
