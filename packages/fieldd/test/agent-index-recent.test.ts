import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG, IndexRecentResult } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import type { ProjectRow, RuntimeRow, SessionRow } from "@vibefield/rosetta-protocol";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { EnrollmentStore, IndexService, normalizeRoot, repoRoots } from "../src/agent-index";
import { RpcCallError } from "../src/native-link";
import type { RosettadSupervisor } from "../src/rosettad-supervisor";

// QL (thinking-ql-empty-pane-launcher.md, QL-D9) — `IndexService.recent`, the
// empty pane launcher's list. What is under test is the RESOLUTION — which
// rosetta project a pane's folder belongs to (the git root, a worktree's `.git`
// FILE grouped under its repo, the longest-prefix fallback outside any repo,
// the folder itself outside any project) — and the JOIN (a runtime's kind to
// the catalog id, an enrolled root to its persona), the join tables' cache,
// and the degraded paths `index.sessions` already answers. The daemon is a
// scripted `fetchFn` routed by path, like the neighbouring suites; the
// repositories are real directories, because the walk reads the disk.

const PROTOCOL = 20;
const ORIGIN = "http://127.0.0.1:65000";

/** a catalog row with a rosetta seam, and its kind — read off THE table, so no
 * vendor is named here */
const ROW = AGENT_CATALOG.find((row) => row.seams.rosetta !== null)!;
const KIND = ROW.seams.rosetta!.kind;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
});

/** a scratch folder, by its RESOLVED spelling (macOS's tmpdir is a symlink) */
const scratch = (label: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `vf-recent-${label}-`)));
  dirs.push(dir);
  return dir;
};

interface Said {
  level: string;
  event: string;
  attrs: LogFields | undefined;
}

const recorder = (): { said: Said[]; logger: Logger } => {
  const said: Said[] = [];
  const at =
    (level: string) =>
    (event: string, _message: string, attrs?: LogFields): void => {
      said.push({ level, event, attrs });
    };
  const logger: Logger = {
    child: () => logger,
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: (event, _message, _error, attrs) => {
      said.push({ level: "error", event, attrs });
    },
    fatal: (event, _message, _error, attrs) => {
      said.push({ level: "fatal", event, attrs });
    },
    isLevelEnabled: () => true,
  };
  return { said, logger };
};

interface Daemon {
  projects: ProjectRow[];
  runtimes: RuntimeRow[];
  sessions: SessionRow[];
  /** a raw body for one route, in place of the scripted one */
  raw: Partial<Record<"projects" | "runtimes" | "sessions", string>>;
  status: number;
  protocol: string;
}

/** The service over a daemon scripted by ROUTE; `urls` is every ask, in order. */
const service = (phase = "ready") => {
  const dir = scratch("store");
  const urls: string[] = [];
  const { said, logger } = recorder();
  const daemon: Daemon = {
    projects: [],
    runtimes: [],
    sessions: [],
    raw: {},
    status: 200,
    protocol: String(PROTOCOL),
  };
  const fetchFn: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    urls.push(url);
    const path = new URL(url).pathname;
    const route = path.slice("/api/".length) as "projects" | "runtimes" | "sessions";
    const scripted =
      route === "projects"
        ? { projects: daemon.projects }
        : route === "runtimes"
          ? { runtimes: daemon.runtimes }
          : { sessions: daemon.sessions };
    return new Response(daemon.raw[route] ?? JSON.stringify(scripted), {
      status: daemon.status,
      headers: { "x-rosetta-protocol-version": daemon.protocol },
    });
  };
  const health = { phase, detail: null, pid: 4242, protocolVersion: PROTOCOL };
  const supervisor = {
    health: () => health,
    state: () => ({ ...health, origin: phase === "ready" ? ORIGIN : null, announce: null }),
  } as unknown as RosettadSupervisor;
  const store = new EnrollmentStore({ path: join(dir, "enrollment.json"), logger });
  const index = new IndexService({
    supervisor,
    store,
    expectedProtocolVersion: PROTOCOL,
    fetchFn,
    logger,
  });
  /** the asks by route (`sessions?…` keeps its query, the tables do not need one) */
  const asked = () => urls.map((url) => url.slice(`${ORIGIN}/api/`.length));
  return { index, daemon, urls, asked, said, health, store, dir };
};

/** rosetta's OWN generated rows, so the compiler witnesses the reader still fits */
const session = (
  over: Partial<SessionRow> & Pick<SessionRow, "id" | "native_session_id">,
): SessionRow => ({
  runtime_id: "rt-native",
  project_id: null,
  cwd: null,
  parent_session_id: null,
  delegation: null,
  root_session_id: over.id,
  role: "main",
  title: null,
  summary: null,
  started_at: 1_700_000_000_000,
  updated_at: 1_700_000_100_000,
  activity: { first_at: 1_700_000_000_000, last_at: 1_700_000_100_000 },
  stream_state: "indexed",
  ...over,
});

const project = (id: string, name: string, ...roots: string[]): ProjectRow => ({
  id,
  name,
  root_paths: roots,
  git_repo: null,
});

const runtime = (id: string, kind: string, dataRoot: string): RuntimeRow => ({
  id,
  kind,
  data_root: dataRoot,
  enabled: true,
  account: null,
  config: null,
  skills: null,
  versions_seen: null,
  discovered_at: 1_700_000_000_000,
});

/** a checkout at `root`: a `.git` DIRECTORY */
const checkout = (root: string): string => {
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
};

/** a linked worktree of `main` at `root`: a `.git` FILE naming a git dir whose
 * `commondir` points back at the checkout's `.git` — git's own layout */
const worktree = (main: string, root: string, name: string, relative = false): string => {
  const gitDir = join(main, ".git", "worktrees", name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, ".git"),
    `gitdir: ${relative ? join("..", "main", ".git", "worktrees", name) : gitDir}\n`,
  );
  return root;
};

const refusal = async (call: Promise<unknown>): Promise<RpcCallError> => {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, "the call resolved where it had to refuse").toBeInstanceOf(RpcCallError);
  return error as RpcCallError;
};

describe("repoRoots — the walk rosetta does, mirrored", () => {
  it("a checkout's `.git` directory: the root is its own group", () => {
    const base = scratch("walk");
    const main = checkout(join(base, "main"));
    mkdirSync(join(main, "packages", "app"), { recursive: true });
    expect(repoRoots(join(main, "packages", "app"))).toEqual({ root: main, groupRoot: main });
    expect(repoRoots(main)).toEqual({ root: main, groupRoot: main });
  });

  it("a worktree's `.git` FILE: its own root, grouped under the checkout (absolute and relative gitdir)", () => {
    const base = scratch("walk");
    const main = checkout(join(base, "main"));
    const lane = worktree(main, join(base, "lane"), "lane");
    mkdirSync(join(lane, "src"));
    expect(repoRoots(join(lane, "src"))).toEqual({ root: lane, groupRoot: main });
    const rel = worktree(main, join(base, "rel"), "rel", true);
    expect(repoRoots(rel)).toEqual({ root: rel, groupRoot: main });
  });

  it("a `.git` file that is not a gitdir line ends the walk with no repo, as rosetta's does", () => {
    const base = scratch("walk");
    checkout(base);
    const odd = join(base, "odd");
    mkdirSync(odd);
    writeFileSync(join(odd, ".git"), "not a pointer\n");
    expect(repoRoots(odd)).toBeUndefined();
  });

  it("outside any repo, and for a folder that does not exist, there is none", () => {
    const base = scratch("walk");
    expect(repoRoots(join(base, "plain"))).toBeUndefined();
  });

  it("normalizeRoot spells a path the way rosetta files it", () => {
    expect(normalizeRoot("/w/app/")).toBe("/w/app");
    expect(normalizeRoot("/w/./app//src/../lib")).toBe("/w/app/lib");
    expect(normalizeRoot("/../w")).toBe("/w");
    expect(normalizeRoot("/")).toBe("/");
  });
});

describe("IndexService.recent — here (QL-D9)", () => {
  it("a folder inside a checkout: its project by git root, asked by project id, every row here, joined to the catalog", async () => {
    const { index, daemon, asked } = service();
    const main = checkout(join(scratch("repo"), "app"));
    mkdirSync(join(main, "src"));
    daemon.projects = [project("p-other", "other", "/elsewhere"), project("p-app", "app", main)];
    daemon.runtimes = [runtime("rt-native", KIND, "~/.native")];
    daemon.sessions = [
      session({
        id: "s1",
        native_session_id: "nat-1",
        project_id: "p-app",
        cwd: join(main, "src"),
        title: "Port the swarm",
        started_at: 1_700_000_000_500,
      }),
    ];
    const result = IndexRecentResult.parse(
      await index.recent({ cwd: join(main, "src"), scope: "here", limit: 20 }),
    );
    expect(asked()).toEqual(["projects", "sessions?project=p-app&limit=20", "runtimes"]);
    expect(result.project).toEqual({ id: "p-app", name: "app" });
    expect(result.rows).toEqual([
      {
        sessionId: "s1",
        nativeSessionId: "nat-1",
        rootSessionId: "s1",
        title: "Port the swarm",
        cwd: join(main, "src"),
        updatedAt: 1_700_000_100_000,
        activity: { firstAt: 1_700_000_000_000, lastAt: 1_700_000_100_000 },
        streamState: "indexed",
        provider: ROW.id,
        startedAt: 1_700_000_000_500,
        here: true,
        project: { id: "p-app", name: "app" },
        cwdExists: true,
      },
    ]);
  });

  it("a worktree nobody has run an agent in finds its repo's project through the `.git` file", async () => {
    const { index, daemon, asked } = service();
    const base = scratch("repo");
    const main = checkout(join(base, "main"));
    const lane = worktree(main, join(base, "lane"), "lane");
    // rosetta has only ever seen the checkout itself
    daemon.projects = [project("p-main", "main", main)];
    const result = await index.recent({ cwd: lane, scope: "here" });
    expect(result.project).toEqual({ id: "p-main", name: "main" });
    expect(asked()).toContain("sessions?project=p-main&limit=100");
  });

  it("a worktree rosetta HAS seen matches by its own root too", async () => {
    const { index, daemon } = service();
    const base = scratch("repo");
    const main = checkout(join(base, "main"));
    const lane = worktree(main, join(base, "lane"), "lane");
    daemon.projects = [project("p-main", "main", lane, main)];
    expect((await index.recent({ cwd: join(lane, "."), scope: "here" })).project?.id).toBe(
      "p-main",
    );
  });

  it("the folder as the shell spells it (a symlink) still finds the project rosetta filed by the resolved path", async () => {
    const { index, daemon } = service();
    const base = scratch("repo");
    const main = checkout(join(base, "main"));
    const { symlinkSync } = await import("node:fs");
    const alias = join(base, "alias");
    symlinkSync(main, alias);
    daemon.projects = [project("p-main", "main", main)];
    expect((await index.recent({ cwd: alias, scope: "here" })).project?.id).toBe("p-main");
  });

  it("a folder in no repo: only the project rooted at exactly it — an ancestor's is another folder's", async () => {
    const { index, daemon, asked } = service();
    const base = scratch("plain");
    const deep = join(base, "a", "b");
    mkdirSync(deep, { recursive: true });
    daemon.projects = [
      project("p-a", "a", join(base, "a")),
      project("p-ab", "b", deep),
      // a sibling that merely shares a string prefix is not the folder
      project("p-abc", "bc", join(base, "a", "bc")),
    ];
    const result = await index.recent({ cwd: deep, scope: "here", limit: 5 });
    expect(result.project).toEqual({ id: "p-ab", name: "b" });
    expect(asked()).toContain("sessions?project=p-ab&limit=5");
  });

  it("a folder under home (itself a project, as rosetta makes every non-repo cwd one) is never filed under home's project", async () => {
    const { index, daemon, asked } = service();
    const home = scratch("home");
    const folder = join(home, "notes");
    mkdirSync(join(folder, "2026"), { recursive: true });
    daemon.projects = [project("p-home", "home", home)];
    daemon.sessions = [
      session({ id: "s-home", native_session_id: "n0", project_id: "p-home", cwd: home }),
      session({ id: "s-in", native_session_id: "n1", cwd: folder }),
      session({ id: "s-under", native_session_id: "n2", cwd: join(folder, "2026") }),
    ];
    const result = await index.recent({ cwd: folder, scope: "here", limit: 10 });
    expect(result.project).toBeUndefined();
    // the cwd-prefix filter (QL-D9), never `project=p-home`
    expect(asked().filter((ask) => ask.startsWith("sessions"))).toEqual(["sessions?limit=1000"]);
    expect(result.rows.map((r) => r.sessionId)).toEqual(["s-in", "s-under"]);
  });

  it("the folder as a case-insensitive volume spells it still finds the project rosetta filed", async () => {
    const { index, daemon } = service();
    const base = scratch("case");
    const main = checkout(join(base, "app"));
    mkdirSync(join(main, "src"));
    const shouted = join(base, "APP", "src");
    // only where the volume folds case (APFS's default); elsewhere there is no such folder
    if (!existsSync(shouted)) return;
    daemon.projects = [project("p-app", "app", main)];
    expect((await index.recent({ cwd: shouted, scope: "here" })).project?.id).toBe("p-app");
    // and outside a repo, the folder filter meets the stored case too
    const plain = join(scratch("case"), "notes");
    mkdirSync(plain);
    daemon.projects = [];
    daemon.sessions = [session({ id: "s-in", native_session_id: "n1", cwd: plain })];
    const upper = join(plain, "..", "NOTES");
    const rows = (await index.recent({ cwd: upper, scope: "here" })).rows;
    expect(rows.map((r) => [r.sessionId, r.here])).toEqual([["s-in", true]]);
  });

  it("a repo no project holds is not claimed by an ancestor's project — it is a folder of its own", async () => {
    const { index, daemon } = service();
    const base = scratch("plain");
    const repo = checkout(join(base, "fresh"));
    daemon.projects = [project("p-home", "home", base)];
    expect((await index.recent({ cwd: repo, scope: "here" })).project).toBeUndefined();
  });

  it("a folder in no project: the newest sessions by folder — run in it or under it, never beside it — and the unassigned are never here", async () => {
    const { index, daemon, asked } = service();
    const base = scratch("plain");
    const folder = join(base, "notes");
    daemon.sessions = [
      session({ id: "s-in", native_session_id: "n1", cwd: folder }),
      session({ id: "s-under", native_session_id: "n2", cwd: join(folder, "2026") }),
      session({ id: "s-beside", native_session_id: "n3", cwd: `${folder}-old` }),
      session({ id: "s-unassigned", native_session_id: "n4", cwd: null }),
    ];
    const result = await index.recent({ cwd: folder, scope: "here", limit: 10 });
    // the miss does not re-read: the table is younger than the floor
    expect(asked()).toEqual(["projects", "sessions?limit=1000", "runtimes"]);
    expect(result.project).toBeUndefined();
    expect(result.rows.map((r) => [r.sessionId, r.here])).toEqual([
      ["s-in", true],
      ["s-under", true],
    ]);
    // the limit is the answer's, not the scan's
    const one = await index.recent({ cwd: folder, scope: "here", limit: 1 });
    expect(one.rows.map((r) => r.sessionId)).toEqual(["s-in"]);
  });

  it("no folder: nothing is here, and the index is not asked", async () => {
    const { index, urls } = service();
    expect(await index.recent({ scope: "here" })).toEqual({ rows: [] });
    expect(urls).toEqual([]);
  });

  it("each row says whether its folder is still here: gone, relative, or none at all", async () => {
    const { index, daemon } = service();
    const base = scratch("plain");
    const here = join(base, "here");
    mkdirSync(here);
    daemon.sessions = [
      session({ id: "s-here", native_session_id: "n1", cwd: here }),
      session({ id: "s-gone", native_session_id: "n2", cwd: join(base, "gone") }),
      session({ id: "s-relative", native_session_id: "n3", cwd: "here" }),
      session({ id: "s-none", native_session_id: "n4", cwd: null }),
    ];
    const rows = (await index.recent({ scope: "all" })).rows;
    expect(rows.map((r) => [r.sessionId, r.cwdExists])).toEqual([
      ["s-here", true],
      ["s-gone", false],
      // names no folder on this device (it would stat fieldd's own cwd)
      ["s-relative", false],
      // no folder to ask about: nothing said
      ["s-none", undefined],
    ]);
    expect(rows.find((r) => r.sessionId === "s-none")).not.toHaveProperty("cwdExists");
  });

  it("a delegated child that reaches the list is dropped — the launcher resumes conversations, not transcript structure", async () => {
    const { index, daemon } = service();
    const folder = join(scratch("plain"), "x");
    daemon.sessions = [
      session({ id: "s-root", native_session_id: "n1", cwd: folder }),
      session({
        id: "s-child",
        native_session_id: "n2",
        cwd: folder,
        parent_session_id: "s-root",
        root_session_id: "s-root",
      }),
    ];
    const result = await index.recent({ cwd: folder, scope: "here" });
    expect(result.rows.map((r) => r.sessionId)).toEqual(["s-root"]);
  });
});

describe("IndexService.recent — all", () => {
  it("every project, newest first as rosetta orders them, each row saying whether it is here", async () => {
    const { index, daemon, asked } = service();
    const main = checkout(join(scratch("repo"), "app"));
    daemon.projects = [project("p-app", "app", main), project("p-web", "web", "/w/web")];
    daemon.sessions = [
      session({ id: "s-web", native_session_id: "n1", project_id: "p-web", cwd: "/w/web" }),
      session({ id: "s-app", native_session_id: "n2", project_id: "p-app", cwd: main }),
      session({ id: "s-none", native_session_id: "n3" }),
    ];
    const result = await index.recent({ cwd: main, scope: "all", limit: 50 });
    expect(asked()).toEqual(["projects", "sessions?limit=50", "runtimes"]);
    expect(result.project).toEqual({ id: "p-app", name: "app" });
    expect(result.rows.map((r) => [r.sessionId, r.here, r.project?.name])).toEqual([
      ["s-web", false, "web"],
      ["s-app", true, "app"],
      // the unassigned bucket has no project, and is never here
      ["s-none", false, undefined],
    ]);
  });

  it("with no folder nothing is here, and the list still answers", async () => {
    const { index, daemon } = service();
    daemon.projects = [project("p-web", "web", "/w/web")];
    daemon.sessions = [
      session({ id: "s-web", native_session_id: "n1", project_id: "p-web", cwd: "/w/web" }),
    ];
    const result = await index.recent({ scope: "all" });
    expect(result.project).toBeUndefined();
    expect(result.rows.map((r) => [r.sessionId, r.here, r.project?.id])).toEqual([
      ["s-web", false, "p-web"],
    ]);
  });
});

describe("IndexService.recent — the join", () => {
  it("a kind no catalog row maps carries no provider (shown, never resumable); an enrolled root carries its persona", async () => {
    const { index, daemon, store, dir } = service();
    const personaRoot = join(dir, "persona-root");
    mkdirSync(personaRoot);
    store.enrollRuntime({ kind: KIND, dataRoot: personaRoot, profileId: "p-work" });
    daemon.runtimes = [
      runtime("rt-native", KIND, "~/.native"),
      runtime("rt-persona", KIND, personaRoot),
      runtime("rt-stranger", "a-kind-no-row-maps", "~/.stranger"),
    ];
    daemon.sessions = [
      session({ id: "s1", native_session_id: "n1", runtime_id: "rt-native" }),
      session({ id: "s2", native_session_id: "n2", runtime_id: "rt-persona" }),
      session({ id: "s3", native_session_id: "n3", runtime_id: "rt-stranger" }),
    ];
    const rows = (await index.recent({ scope: "all" })).rows;
    expect(rows.map((r) => [r.sessionId, r.provider, r.profileId])).toEqual([
      ["s1", ROW.id, undefined],
      ["s2", ROW.id, "p-work"],
      ["s3", undefined, undefined],
    ]);
    // a persona's root is fieldd's business: no row names it
    expect(JSON.stringify(rows)).not.toContain(personaRoot);
    // …and the native resume's provenance reads the SAME join: the agent and
    // the persona the index files each conversation under (EL7 — agent.resume
    // runs it only there)
    expect(await index.nativeSessionAgent("n1")).toEqual({ provider: ROW.id });
    expect(await index.nativeSessionAgent("n2")).toEqual({ provider: ROW.id, profileId: "p-work" });
    expect(await index.nativeSessionAgent("n3")).toEqual({});
    expect(await index.nativeSessionAgent("n-never")).toBeUndefined();
  });

  it("the tables are read once and served from the cache; a new daemon generation reads them again", async () => {
    const { index, daemon, asked, health } = service();
    const main = checkout(join(scratch("repo"), "app"));
    daemon.projects = [project("p-app", "app", main)];
    daemon.runtimes = [runtime("rt-native", KIND, "~/.native")];
    daemon.sessions = [session({ id: "s1", native_session_id: "n1", project_id: "p-app" })];
    await index.recent({ cwd: main, scope: "here" });
    await index.recent({ cwd: main, scope: "all" });
    expect(asked().filter((a) => !a.startsWith("sessions"))).toEqual(["projects", "runtimes"]);
    health.pid = 4343;
    await index.recent({ cwd: main, scope: "here" });
    expect(asked().filter((a) => !a.startsWith("sessions"))).toEqual([
      "projects",
      "runtimes",
      "projects",
      "runtimes",
    ]);
  });

  it("a MISS re-reads a table — but never more often than the floor, and a hit waits for the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    const { index, daemon, asked } = service();
    const base = scratch("repo");
    const app = checkout(join(base, "app"));
    const fresh = checkout(join(base, "fresh"));
    daemon.projects = [project("p-app", "app", app)];
    daemon.runtimes = [runtime("rt-native", KIND, "~/.native")];
    daemon.sessions = [session({ id: "s1", native_session_id: "n1", project_id: "p-app" })];
    await index.recent({ cwd: app, scope: "here" });
    const tables = () => asked().filter((a) => !a.startsWith("sessions"));
    expect(tables()).toEqual(["projects", "runtimes"]);

    // the index meets a new repo: a folder no cached project holds re-reads,
    // but not within the floor of the last read
    daemon.projects = [project("p-app", "app", app), project("p-fresh", "fresh", fresh)];
    expect((await index.recent({ cwd: fresh, scope: "here" })).project).toBeUndefined();
    expect(tables()).toEqual(["projects", "runtimes"]);
    vi.setSystemTime(1_800_000_002_500);
    expect((await index.recent({ cwd: fresh, scope: "here" })).project?.id).toBe("p-fresh");
    expect(tables()).toEqual(["projects", "runtimes", "projects"]);

    // a row naming a runtime the cache does not hold re-reads that table
    daemon.runtimes = [...daemon.runtimes, runtime("rt-new", KIND, "~/.new")];
    daemon.sessions = [
      session({ id: "s2", native_session_id: "n2", project_id: "p-app", runtime_id: "rt-new" }),
    ];
    vi.setSystemTime(1_800_000_005_000);
    const rows = (await index.recent({ cwd: app, scope: "here" })).rows;
    expect(rows[0]?.provider).toBe(ROW.id);
    expect(tables()).toEqual(["projects", "runtimes", "projects", "runtimes"]);

    // past the TTL even a hit reads again
    vi.setSystemTime(1_800_000_040_000);
    await index.recent({ cwd: app, scope: "here" });
    expect(tables()).toEqual([
      "projects",
      "runtimes",
      "projects",
      "runtimes",
      "projects",
      "runtimes",
    ]);
  });
});

describe("IndexService.recent — degraded, the way index.sessions is", () => {
  it("an index that is not ready is never asked — UNAVAILABLE with the phase", async () => {
    const { index, urls } = service("starting");
    const error = await refusal(index.recent({ cwd: "/w/app", scope: "here" }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "starting" });
    expect(urls).toEqual([]);
  });

  it("projects the reader cannot vouch for are UNAVAILABLE {malformed}, said once at warn", async () => {
    const { index, daemon, said } = service();
    daemon.raw.projects = JSON.stringify({ projects: [{ id: "p", name: "p" }] });
    const error = await refusal(index.recent({ cwd: "/w/app", scope: "here" }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "malformed" });
    expect(said.filter((s) => s.event === "fieldd.index.projects_malformed")).toHaveLength(1);
  });

  it("session rows the reader cannot vouch for are UNAVAILABLE {malformed}", async () => {
    const { index, daemon } = service();
    daemon.raw.sessions = JSON.stringify({ sessions: [{ id: "s1", started_at: "yesterday" }] });
    const error = await refusal(index.recent({ scope: "all" }));
    expect(error.details).toEqual({ service: "index", state: "malformed" });
  });

  it("a daemon that refuses the question is UNAVAILABLE {error}; one speaking another protocol is INCOMPATIBLE", async () => {
    const failing = service();
    failing.daemon.status = 500;
    const error = await refusal(failing.index.recent({ scope: "all" }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "error" });
    const skewed = service();
    skewed.daemon.protocol = "19";
    const wrong = await refusal(skewed.index.recent({ scope: "all" }));
    expect(wrong.kind).toBe("INCOMPATIBLE");
  });

  it("a runtimes body that is not what the type promises degrades the join, never the list", async () => {
    const { index, daemon } = service();
    daemon.raw.runtimes = JSON.stringify({ runtimes: [{ id: 7 }, null] });
    daemon.sessions = [session({ id: "s1", native_session_id: "n1" })];
    const rows = (await index.recent({ scope: "all" })).rows;
    expect(rows.map((r) => [r.sessionId, r.provider])).toEqual([["s1", undefined]]);
  });

  it("unknown envelope fields on the projects body are logged once, at debug", async () => {
    const { index, daemon, said } = service();
    daemon.raw.projects = JSON.stringify({ projects: [], generation: 3 });
    await index.recent({ cwd: "/w/app", scope: "here" });
    await index.recent({ cwd: "/w/app", scope: "here" });
    const news = said.filter((s) => s.event === "fieldd.index.unknown_fields");
    expect(news).toEqual([
      {
        level: "debug",
        event: "fieldd.index.unknown_fields",
        attrs: { shape: "projects", keys: ["generation"] },
      },
    ]);
  });
});
