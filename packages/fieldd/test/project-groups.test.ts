// PJ-1 §4 — the projects this desktop computes (project-groups.ts): the
// engine over this desktop's catalog rows and its peers', sessions joined to
// places by the longest cwd, a local place's acts, an equal input computing
// nothing, and ONE summary line per change of the grouping itself. The
// replica path across three desktops is index-mesh.test.ts's; real git
// through the scanner into the grouping is place-scanner.test.ts's.
import type { IndexCatalogProject, IndexCatalogSession, PlaceFacts } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import { ProjectGroups, sessionsByPlace } from "../src/projects/project-groups";

const sha = (n: number) => n.toString(16).padStart(40, "0");

function place(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: false,
    remotes: [],
    samples: [],
    hits: [],
    observedAt: 1,
    ...over,
  };
}

function session(
  id: string,
  cwd: string | undefined,
  activity: { firstAt: number; lastAt: number } | null = { firstAt: 10, lastAt: 20 },
): IndexCatalogSession {
  return {
    device: "dev-a",
    sessionId: id,
    nativeSessionId: `n-${id}`,
    ...(cwd !== undefined ? { cwd } : {}),
    activity,
    streamState: "indexed",
  } as IndexCatalogSession;
}

function row(device: string, projectId: string, places: PlaceFacts[]): IndexCatalogProject {
  return { device, projectId, name: projectId, rootPaths: [], sessionCount: 0, places };
}

function tables() {
  const projects = new CatalogTable<IndexCatalogProject>({
    epoch: "e",
    keyOf: (r) => r.projectId,
  });
  const sessions = new CatalogTable<IndexCatalogSession>({
    epoch: "e",
    keyOf: (r) => r.sessionId,
  });
  return { projects, sessions };
}

function recorder(lines: Array<{ event: string; fields?: LogFields }>): Logger {
  const at = (event: string, _m: string, fields?: LogFields) => {
    lines.push({ event, ...(fields !== undefined ? { fields } : {}) });
  };
  const logger: Logger = {
    child: () => logger,
    trace: at,
    debug: at,
    info: at,
    warn: at,
    error: (event, message, _e, fields) => at(event, message, fields),
    fatal: (event, message, _e, fields) => at(event, message, fields),
    isLevelEnabled: () => true,
  };
  return logger;
}

describe("a session joins the place that holds its cwd by the longest path (§9)", () => {
  it("nested places, aliases, case by the volume's rule, a cwd no place holds", () => {
    const outer = place("p-outer", "/Users/ada/repo", { aliases: ["/users/ada/Repo-Link"] });
    const inner = place("p-inner", "/Users/ada/repo/packages/app");
    const strict = place("p-strict", "/srv/Data", { caseless: false });
    const home = place("p-home", "/", { kind: "home" });
    const win = place("p-win", "C:\\src\\VibeField");
    const joined = sessionsByPlace(
      [outer, inner, strict, home, win],
      [
        session("s1", "/Users/ada/repo/packages/app/src", { firstAt: 5, lastAt: 50 }),
        session("s2", "/Users/ada/repo/docs", { firstAt: 7, lastAt: 9 }),
        session("s3", "/USERS/ADA/REPO", { firstAt: 1, lastAt: 2 }),
        session("s4", "/users/ada/repo-link/x"),
        session("s5", "/srv/data/x"), // a case-sensitive volume: not /srv/Data → `/`
        session("s6", "/srv/Data/x"),
        session("s7", "c:\\src\\vibefield\\packages"),
        session("s8", undefined),
        session("s9", "D:\\elsewhere"),
      ],
    );
    expect(joined.get("p-inner")).toEqual({ sessions: 1, firstAt: 5, lastAt: 50 });
    expect(joined.get("p-outer")).toEqual({ sessions: 3, firstAt: 1, lastAt: 20 });
    expect(joined.get("p-strict")).toEqual({ sessions: 1, firstAt: 10, lastAt: 20 });
    expect(joined.get("p-home")?.sessions).toBe(1);
    expect(joined.get("p-win")?.sessions).toBe(1);
    expect([...joined.values()].reduce((n, a) => n + a.sessions, 0)).toBe(7);
  });
});

describe("the projects this desktop computes (PJ-1 §4)", () => {
  it("groups its own places with its peers', marks the acts, and says one line per regroup", () => {
    const local = tables();
    const lines: Array<{ event: string; fields?: LogFields }> = [];
    const root = sha(1);
    const mine = place("pl-a", "/Users/ada/app", {
      git: true,
      root,
      identityRemote: "github.com/acme/app",
      remotes: ["github.com/acme/app"],
      samples: [{ sha: sha(9), depth: 0 }],
    });
    const scratch = place("pl-tmp", "/private/tmp/x", { kind: "temp" });
    local.projects.upsert([row("dev-a", "p-app", [mine]), row("dev-a", "p-tmp", [scratch])]);
    local.sessions.upsert([session("s1", "/Users/ada/app/src")]);
    // a peer's clone with NO remote that holds this place's tip: joins by history
    const theirs = place("pl-b", "/home/ada/app", {
      git: true,
      root,
      hits: [{ placeId: "pl-a", sha: sha(9), depth: 0 }],
    });
    const peers = [{ device: "dev-b", projects: [row("dev-b", "p-b", [theirs])], sessions: [] }];
    const groups = new ProjectGroups({
      deviceId: () => "dev-a",
      local,
      peers: () => peers,
      acted: () => new Map([["pl-a", "2026-10-08T00:00:00.000Z"]]),
      logger: recorder(lines),
    });
    const first = groups.regroupNow();
    const app = first?.result.projects.find((p) => p.places.some((pl) => pl.placeId === "pl-a"));
    expect(app?.places.map((pl) => pl.placeId).sort()).toEqual(["pl-a", "pl-b"]);
    expect(app?.devices).toEqual(["dev-a", "dev-b"]);
    expect(app?.places.find((pl) => pl.placeId === "pl-a")).toMatchObject({
      acted: true,
      sessions: 1,
    });
    expect(app?.places.find((pl) => pl.placeId === "pl-b")?.acted).toBe(false);
    expect(first?.result.projects.find((p) => p.bucket === "temp")?.places).toHaveLength(1);
    expect(lines.filter((l) => l.event === "fieldd.projects.regrouped")).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({ devices: 2, places: 3, rows: 2, acrossDevices: 1 });
    // no path, no remote, no name in the line (EL7)
    expect(JSON.stringify(lines)).not.toMatch(/Users|acme|app/);
    // an equal input computes nothing
    expect(groups.regroupNow()).toBe(first);
    expect(groups.computed).toBe(1);
    // a figure moves (a new session): computed again, but the grouping is the same — silent
    local.sessions.upsert([session("s2", "/Users/ada/app")]);
    groups.regroupNow();
    expect(groups.computed).toBe(2);
    expect(lines.filter((l) => l.event === "fieldd.projects.regrouped")).toHaveLength(1);
    // the peer's clone leaves: a regroup, one more line
    peers.length = 0;
    const after = groups.regroupNow();
    expect(after?.result.projects.some((p) => p.devices.includes("dev-b"))).toBe(false);
    expect(lines.filter((l) => l.event === "fieldd.projects.regrouped")).toHaveLength(2);
  });

  it("regroups after the settle when this desktop's rows move", async () => {
    const local = tables();
    const groups = new ProjectGroups({ deviceId: () => "dev-a", local, settleMs: 5 });
    groups.start();
    const deadline = Date.now() + 3_000;
    local.projects.upsert([row("dev-a", "p", [place("pl-x", "/Users/ada/x")])]);
    while (groups.current()?.result.projects.length !== 1) {
      if (Date.now() > deadline) throw new Error("no regroup after a delta");
      await new Promise((r) => setTimeout(r, 10));
    }
    groups.dispose();
    local.projects.upsert([row("dev-a", "q", [place("pl-y", "/Users/ada/y")])]);
    await new Promise((r) => setTimeout(r, 50));
    expect(groups.current()?.result.projects).toHaveLength(1);
  });
});
