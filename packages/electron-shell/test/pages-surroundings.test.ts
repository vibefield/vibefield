import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SUN_PATH_MAX_BYTES, socketPathBytes } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES_IDLE_REAP_MS } from "../src/main/pages/broker/broker";
import {
  makePagesSurroundings,
  PAGES_ENGINE_ENV_KEYS,
  PAGES_ENGINE_IDLE_TIMEOUT_MS,
  PAGES_ENGINE_PATH,
  PAGES_ENGINE_SWITCHES,
  type PagesSurroundings,
  PagesSurroundingsError,
  type PagesSurroundingsOptions,
  pagesCwdIsEmpty,
  pagesEngineEnv,
  pagesEngineEnvViolations,
  pagesRootFor,
  pagesSocketPathFor,
  pagesStreamFileFor,
  pagesStreamIsOff,
  pagesStreamShown,
} from "../src/main/pages/broker/surroundings";

// EY-1 (2026-11-19): the page engine's folders and environment. The environment is built from
// nothing (EL7), the shape sitting 2 measured (EY-S2-01B). A test's parent is its own temp
// folder, never the account's /tmp/vf-<uid>, and it is longer than /tmp, so the folder rows raise
// the socket bound; the bound itself is judged on the product's /tmp in pure rows.

const UID = process.getuid?.() ?? 0;
/** The one peer the engine admits: main's own pid in the product, a row's number here. */
const PEER = 4141;
const peer = { peerPid: PEER } as const;
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const cleanup: string[] = [];

function parent(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-pages-"));
  chmodSync(dir, 0o700);
  cleanup.push(dir);
  return dir;
}

function at(dir: string, extra: Partial<PagesSurroundingsOptions> = {}): PagesSurroundings {
  return makePagesSurroundings({ parent: dir, randomHex: hex, maxSocketPathBytes: 4096, ...extra });
}

/** Root ids taken from a list, in order; a session stays random. */
function rootIds(ids: string[]): (bytes: number) => string {
  return (bytes) => (bytes === 8 ? hex(8) : (ids.shift() ?? hex(4)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the engine's environment", () => {
  it("is exactly the allowlist, with the instance's own folders and session, and the three switches on", () => {
    const s = at(parent());
    const env = pagesEngineEnv(s, peer);
    expect(Object.keys(env).sort()).toEqual([...PAGES_ENGINE_ENV_KEYS].sort());
    expect(env).toEqual({
      PATH: PAGES_ENGINE_PATH,
      HOME: s.home,
      TMPDIR: s.tmp,
      AGENT_BROWSER_SOCKET_DIR: s.socketDir,
      AGENT_BROWSER_NAMESPACE: "pages",
      AGENT_BROWSER_IDLE_TIMEOUT_MS: String(PAGES_ENGINE_IDLE_TIMEOUT_MS),
      AGENT_BROWSER_DAEMON: "1",
      AGENT_BROWSER_SESSION: s.session,
      // the stream server off: no loopback listener, no command relay
      AGENT_BROWSER_NO_STREAM: "1",
      // the socket admits main alone, by its pid (and so by its uid)
      AGENT_BROWSER_PEER_PIDS: String(PEER),
      // the bridge's address, which carries the launch's key, is never told back
      AGENT_BROWSER_HIDE_CDP_URL: "1",
    });
    expect(Object.isFrozen(env)).toBe(true);
    for (const name of PAGES_ENGINE_SWITCHES) expect(PAGES_ENGINE_ENV_KEYS).toContain(name);
    expect([...PAGES_ENGINE_SWITCHES]).toEqual([
      "AGENT_BROWSER_NO_STREAM",
      "AGENT_BROWSER_PEER_PIDS",
      "AGENT_BROWSER_HIDE_CDP_URL",
    ]);
  });

  it("refuses an environment with a switch missing or off: no engine starts with the stream on", () => {
    const s = at(parent());
    const env = pagesEngineEnv(s, peer);
    const check = (patch: Record<string, string>) =>
      pagesEngineEnvViolations({ ...env, ...patch }, s, { smoke: false, ...peer });
    for (const name of PAGES_ENGINE_SWITCHES) {
      const { [name]: _gone, ...without } = env;
      expect(pagesEngineEnvViolations(without, s, { smoke: false, ...peer })).toEqual([
        `missing:${name}`,
      ]);
    }
    // the engine reads a switch as off for "", 0, false and no; main sets "1" and takes nothing else
    for (const off of ["", "0", "false", "no", "true", "yes"]) {
      expect(check({ AGENT_BROWSER_NO_STREAM: off }), off).toEqual([
        "wrong-value:AGENT_BROWSER_NO_STREAM",
      ]);
      expect(check({ AGENT_BROWSER_HIDE_CDP_URL: off }), off).toEqual([
        "wrong-value:AGENT_BROWSER_HIDE_CDP_URL",
      ]);
    }
  });

  it("names main alone as the socket's peer: one pid, never a list, a blank or another's", () => {
    const s = at(parent());
    const env = pagesEngineEnv(s, peer);
    const check = (value: string) =>
      pagesEngineEnvViolations({ ...env, AGENT_BROWSER_PEER_PIDS: value }, s, {
        smoke: false,
        ...peer,
      });
    // a blank value admits no one and a list admits others: neither is main alone
    for (const value of ["", " ", "0", "-1", "4141,4142", "4141 ", "abc", "04141"]) {
      expect(check(value), JSON.stringify(value)).toEqual(["not-one-pid:AGENT_BROWSER_PEER_PIDS"]);
    }
    expect(check("4142")).toEqual(["not-the-peer:AGENT_BROWSER_PEER_PIDS"]);
    expect(check(String(PEER))).toEqual([]);
    for (const peerPid of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
      expect(() => pagesEngineEnv(s, { peerPid }), String(peerPid)).toThrow(PagesSurroundingsError);
    }
    // the uid check's own switch adds nothing over a named pid, and is not a name the engine gets
    expect(
      pagesEngineEnvViolations({ ...env, AGENT_BROWSER_PEER_UID_CHECK: "1" }, s, {
        smoke: false,
        ...peer,
      }),
    ).toEqual(["unexpected:AGENT_BROWSER_PEER_UID_CHECK"]);
  });

  it("ignores main's own environment: secrets, host facts, the auto-launch names", () => {
    const planted = {
      FIELD_TOKEN: "t",
      FIELDD_SECRET: "s",
      VIBEFIELD_DEV_PAGES_ENGINE: "/x/agent-browser",
      VIBEFIELD_DEV_REPO_ROOT: "/x",
      AGENT_BROWSER_CDP: "9222",
      AGENT_BROWSER_PROVIDER: "p",
      ELECTRON_RUN_AS_NODE: "1",
      VF_SMOKE_RUN: "run",
    };
    for (const [key, value] of Object.entries(planted)) vi.stubEnv(key, value);
    const env = pagesEngineEnv(at(parent()), peer);
    expect(Object.keys(env).sort()).toEqual([...PAGES_ENGINE_ENV_KEYS].sort());
  });

  it("names keys, never values, in what it refuses", () => {
    const s = at(parent());
    const env = { ...pagesEngineEnv(s, peer), FIELD_TOKEN: "s3cret-value", OTHER: "x" };
    const found = pagesEngineEnvViolations(env, s, { smoke: false });
    expect(found).toEqual(["forbidden:FIELD_TOKEN", "unexpected:OTHER"]);
    expect(found.join(" ")).not.toContain("s3cret-value");
  });

  it("refuses each departure: a missing key, a value off its rule, another root", () => {
    const s = at(parent());
    const other = at(parent());
    const env = pagesEngineEnv(s, peer);
    const check = (patch: Record<string, string>) =>
      pagesEngineEnvViolations({ ...env, ...patch }, s, { smoke: false });
    const { AGENT_BROWSER_DAEMON: _gone, ...noDaemon } = env;
    expect(pagesEngineEnvViolations(noDaemon, s, { smoke: false })).toEqual([
      "missing:AGENT_BROWSER_DAEMON",
    ]);
    expect(check({ PATH: "/opt/homebrew/bin:/usr/bin" })).toEqual(["path-not-fixed:PATH"]);
    expect(check({ AGENT_BROWSER_IDLE_TIMEOUT_MS: "0" })).toEqual([
      "idle-not-finite:AGENT_BROWSER_IDLE_TIMEOUT_MS",
    ]);
    expect(check({ AGENT_BROWSER_DAEMON: "true" })).toEqual(["wrong-value:AGENT_BROWSER_DAEMON"]);
    expect(check({ AGENT_BROWSER_SESSION: other.session })).toEqual([
      "not-this-session:AGENT_BROWSER_SESSION",
    ]);
    expect(check({ HOME: other.home })).toEqual(["outside-root:HOME"]);
    expect(check({ AGENT_BROWSER_CDP: "9222" })).toEqual(["forbidden:AGENT_BROWSER_CDP"]);
    expect(check({ vibefield_dev_x: "1" })).toEqual(["forbidden:vibefield_dev_x"]);
    // the names that ask the engine for a listener of its own
    expect(check({ AGENT_BROWSER_STREAM_PORT: "9223" })).toEqual([
      "forbidden:AGENT_BROWSER_STREAM_PORT",
    ]);
    expect(check({ AGENT_BROWSER_DASHBOARD: "1" })).toEqual(["forbidden:AGENT_BROWSER_DASHBOARD"]);
  });

  it("carries the smoke's mark in a smoke only", () => {
    const s = at(parent());
    expect(pagesEngineEnv(s, { ...peer, smokeRun: "vf-smoke-abc" }).VF_SMOKE_RUN).toBe(
      "vf-smoke-abc",
    );
    expect("VF_SMOKE_RUN" in pagesEngineEnv(s, peer)).toBe(false);
    const marked = { ...pagesEngineEnv(s, peer), VF_SMOKE_RUN: "vf-smoke-abc" };
    expect(pagesEngineEnvViolations(marked, s, { smoke: false })).toEqual([
      "forbidden:VF_SMOKE_RUN",
    ]);
    expect(() => pagesEngineEnv(s, { ...peer, smokeRun: "a\nb" })).toThrow(PagesSurroundingsError);
    expect(() => pagesEngineEnv(s, { ...peer, smokeRun: "" })).toThrow(PagesSurroundingsError);
  });
});

// The engine's idle exit before main's reap (2026-11-24): main's reap owns how long an idle engine
// lives; the engine's own idle exit only bounds an orphan after main is gone. An engine that ends
// itself first costs the agent its element refs between two calls.
describe("the engine's own idle exit", () => {
  it("is an orphan's bound: finite, and at least twice main's reap of an idle engine", () => {
    expect(Number.isSafeInteger(PAGES_ENGINE_IDLE_TIMEOUT_MS)).toBe(true);
    expect(PAGES_ENGINE_IDLE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PAGES_ENGINE_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * PAGES_IDLE_REAP_MS);
  });

  it("reaches the engine as the one idle bound it is given", () => {
    const env = pagesEngineEnv(at(parent()), peer);
    expect(Number(env.AGENT_BROWSER_IDLE_TIMEOUT_MS)).toBeGreaterThanOrEqual(
      2 * PAGES_IDLE_REAP_MS,
    );
  });
});

// The release binary's stream port (2026-11-24): an engine with the stream ON writes its port in a
// `<session>.stream` file beside its socket, before it binds the socket. Main reads the folder once
// the engine is ready: any such file means the stream is on, and the engine is refused.
describe("the stream server's port file", () => {
  it("is the session's own, beside the socket", () => {
    const s = at(parent());
    expect(pagesStreamFileFor(s)).toBe(join(dirname(s.socketPath), `${s.session}.stream`));
  });

  it("shows the stream off for a folder with no such file, whatever else the engine wrote", () => {
    const s = at(parent());
    expect(pagesStreamIsOff(s)).toBe(true);
    for (const name of [`${s.session}.pid`, `${s.session}.version`, `${s.session}.sock`]) {
      writeFileSync(join(dirname(s.socketPath), name), "1");
    }
    expect(pagesStreamIsOff(s)).toBe(true);
  });

  it("shows the stream on for the session's file, and for any other session's in the folder", () => {
    const own = at(parent());
    writeFileSync(pagesStreamFileFor(own), "49152");
    expect(pagesStreamIsOff(own)).toBe(false);
    const other = at(parent());
    writeFileSync(join(dirname(other.socketPath), "ffffffffffffffff.stream"), "49153");
    expect(pagesStreamIsOff(other)).toBe(false);
  });

  it("is not shown off by a folder that cannot be read: what main cannot tell, it refuses", () => {
    const s = at(parent());
    renameSync(dirname(s.socketPath), `${dirname(s.socketPath)}-gone`);
    expect(pagesStreamIsOff(s)).toBe(false);
  });

  it("says which of the three a folder shows: off, on, or one it could not read (2026-11-24: its own word, never `on`)", () => {
    const off = at(parent());
    expect(pagesStreamShown(off)).toBe("off");
    const on = at(parent());
    writeFileSync(pagesStreamFileFor(on), "49152");
    expect(pagesStreamShown(on)).toBe("on");
    const unread = at(parent());
    renameSync(dirname(unread.socketPath), `${dirname(unread.socketPath)}-gone`);
    expect(pagesStreamShown(unread)).toBe("unread");
  });
});

describe("the engine's folders", () => {
  it("makes <parent>/vf-<uid>/pg-<8 hex> with four 0700 folders and an empty cwd", () => {
    const p = parent();
    const s = at(p);
    expect(s.root.startsWith(`${p}/vf-${UID}/pg-`)).toBe(true);
    expect(s.root.slice(-8)).toMatch(/^[0-9a-f]{8}$/u);
    for (const dir of [join(p, `vf-${UID}`), s.root, s.socketDir, s.home, s.tmp, s.cwd]) {
      expect(statSync(dir).mode & 0o7777, dir).toBe(0o700);
    }
    const run = join(s.socketDir, "namespaces", "pages", "run");
    expect(statSync(run).isDirectory()).toBe(true);
    expect(pagesCwdIsEmpty(s)).toBe(true);
    expect(s.session).toMatch(/^[0-9a-f]{16}$/u);
    expect(s.socketPath).toBe(join(run, `${s.session}.sock`));
  });

  it("gives each instance a fresh root and session, and never reuses a taken root", () => {
    const p = parent();
    const a = at(p);
    const b = at(p);
    expect(a.root).not.toBe(b.root);
    expect(a.session).not.toBe(b.session);
    const ids = ["aaaaaaaa", "aaaaaaaa", "cccccccc"];
    const first = at(p, { randomHex: rootIds(ids) });
    const second = at(p, { randomHex: rootIds(ids) });
    expect(first.root.endsWith("/pg-aaaaaaaa")).toBe(true);
    expect(second.root.endsWith("/pg-cccccccc")).toBe(true);
    const allTaken = ["aaaaaaaa", "cccccccc", "aaaaaaaa"];
    expect(() => at(p, { randomHex: rootIds(allTaken) })).toThrow(/in three tries/u);
  });

  it("refuses a vf-<uid> folder that is a link, open to others, or another uid's", () => {
    const linked = parent();
    symlinkSync(parent(), join(linked, `vf-${UID}`));
    expect(() => at(linked)).toThrow(/is a link/u);
    const open = parent();
    mkdirSync(join(open, `vf-${UID}`), { mode: 0o755 });
    chmodSync(join(open, `vf-${UID}`), 0o755);
    expect(() => at(open)).toThrow(/mode 0755, not 0700/u);
    expect(() => at(parent(), { uid: UID + 1 })).toThrow(/belongs to uid/u);
  });

  it("refuses a parent others may write without the sticky bit", () => {
    const p = parent();
    chmodSync(p, 0o777);
    expect(() => at(p)).toThrow(/without the sticky bit/u);
  });
});

describe("the daemon's socket path", () => {
  it("fits sun_path under the product's /tmp for the longest uid", () => {
    const root = pagesRootFor("/tmp", 4_294_967_295, "ffffffff");
    const longest = pagesSocketPathFor(root, "f".repeat(16));
    expect(socketPathBytes(longest)).toBeLessThanOrEqual(SUN_PATH_MAX_BYTES);
  });

  it("is judged before anything is made: a parent too long for its bound makes nothing", () => {
    const p = parent();
    expect(() => at(p, { maxSocketPathBytes: 40 })).toThrow(/over 40/u);
    expect(() => statSync(join(p, `vf-${UID}`))).toThrow();
  });

  it("takes only well-formed parts", () => {
    expect(() => pagesRootFor("tmp", UID, "aaaaaaaa")).toThrow(PagesSurroundingsError);
    expect(() => pagesRootFor("/tmp", -1, "aaaaaaaa")).toThrow(PagesSurroundingsError);
    expect(() => pagesRootFor("/tmp", UID, "AAAAAAAA")).toThrow(PagesSurroundingsError);
    expect(() => pagesSocketPathFor("/tmp/x", "default")).toThrow(PagesSurroundingsError);
  });
});
