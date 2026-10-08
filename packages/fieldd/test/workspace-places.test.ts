// PJ-1 (§9; L3, L6) — the files worker's `placeFacts` on real repositories:
// a place's facts (there, mounted, its volume's case rule, its kind), git's
// (branch, tip, the GUARDED first-parent root, the samples, the remotes as git
// uses them, the identity remote's name, the worktrees and `worktreeOf`), the
// HITS (a peer's samples found in this place's objects and history, the
// shallowest held), the cheap read's `unchanged`, a dubious-ownership refusal
// said as a fact, a shallow clone and an unborn branch publishing nothing, no
// `git status` (a clean filter never runs), an `ssh -G` asked only about a
// host the guard admits, and the budget.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  caselessAt,
  mountPointOf,
  parseRemotes,
  pickPushRemote,
  placeKind,
  readPlaces,
  samplesOf,
  sshHostOf,
  taskRootSegments,
} from "../src/workspace/host/places";
import type { PlaceGitRead, PlaceRead, PlaceSampleSet } from "../src/workspace/protocol";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ada",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

function scratch(prefix: string): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function withEnv(patch: Record<string, string>): void {
  const before = new Map(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, patch);
  cleanup.push(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** A repository with `commits` commits on main (the first one holds a file). */
function repo(base: string, name: string, commits: number): string {
  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  for (let i = 0; i < commits; i += 1) {
    writeFileSync(join(root, "n.txt"), `${name} ${i}\n`);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", `c${i}`);
  }
  return root;
}

const head = (root: string) => git(root, "rev-parse", "HEAD").trim();
const firstCommit = (root: string) =>
  git(root, "rev-list", "--max-parents=0", "HEAD").trim().split("\n")[0] ?? "";

/** The test's places are under the system's temp folder: tell the worker
 * none is temporary unless a test says so, so `kind` reads `project`. */
const read = (args: Parameters<typeof readPlaces>[0], temps: string[] = []) =>
  readPlaces(args, { temps });

function done(place: PlaceRead | undefined): Extract<PlaceRead, { skipped: false }> {
  if (place === undefined || place.skipped) throw new Error(`not read: ${JSON.stringify(place)}`);
  return place;
}

function gitOf(place: PlaceRead | undefined): PlaceGitRead {
  const facts = done(place);
  if (facts.git === null || facts.git === "unchanged")
    throw new Error(`no full git read: ${JSON.stringify(facts)}`);
  return facts.git;
}

describe("what a place is (pure)", () => {
  const home = "/Users/ada";
  const context = {
    home,
    temps: ["/tmp", "/private/tmp", "/private/var/folders"],
    taskRoots: [taskRootSegments("~/Documents/Codex/*/*", home, "darwin")],
  };

  it("home, task, temp, project — the owner's word (L6)", () => {
    expect(placeKind("/Users/ada", context, "darwin", true)).toBe("home");
    expect(placeKind("/users/ADA", context, "darwin", true)).toBe("home");
    expect(placeKind("/users/ADA", context, "linux", false)).toBe("project");
    expect(placeKind("/", context, "darwin", true)).toBe("home");
    expect(placeKind("/Users/ada/Documents/Codex/2026-10-01/fix-it", context, "darwin", true)).toBe(
      "task",
    );
    expect(
      placeKind("/Users/ada/Documents/Codex/2026-10-01/fix-it/src", context, "darwin", true),
    ).toBe("task");
    // the glob names the task folder: its parent is not one
    expect(placeKind("/Users/ada/Documents/Codex/2026-10-01", context, "darwin", true)).toBe(
      "project",
    );
    expect(placeKind("/private/tmp/scratch/repo", context, "darwin", true)).toBe("temp");
    expect(placeKind("/tmp", context, "darwin", true)).toBe("temp");
    expect(placeKind("/tmpfoo/x", context, "darwin", true)).toBe("project");
    expect(placeKind("/Users/ada/Projects/vibe-field", context, "darwin", true)).toBe("project");
  });

  it("a drive is Home on Windows; separators and case are the platform's", () => {
    const win = {
      home: "C:\\Users\\ada",
      temps: ["C:\\Users\\ada\\AppData\\Local\\Temp"],
      taskRoots: [taskRootSegments("~/Documents/Codex/*/*", "C:\\Users\\ada", "win32")],
    };
    expect(placeKind("D:\\", win, "win32", true)).toBe("home");
    expect(placeKind("c:\\users\\ada", win, "win32", true)).toBe("home");
    expect(placeKind("C:\\Users\\ada\\AppData\\Local\\Temp\\x", win, "win32", true)).toBe("temp");
    expect(placeKind("C:\\Users\\ada\\Documents\\Codex\\a\\b", win, "win32", true)).toBe("task");
    expect(placeKind("C:\\src\\VibeField", win, "win32", true)).toBe("project");
  });

  it("only a removable volume's mount point can be absent", () => {
    expect(mountPointOf("/Volumes/SSD/lanes/x", "darwin")).toBe("/Volumes/SSD");
    expect(mountPointOf("/Users/ada/x", "darwin")).toBeNull();
    expect(mountPointOf("/media/ada/USB/x", "linux")).toBe("/media/ada/USB");
    expect(mountPointOf("/run/media/ada/USB/x", "linux")).toBe("/run/media/ada/USB");
    expect(mountPointOf("/mnt/data/x", "linux")).toBe("/mnt/data");
    expect(mountPointOf("/home/ada/x", "linux")).toBeNull();
    expect(mountPointOf("E:\\src\\x", "win32")).toBe("E:\\");
  });

  it("an ssh host is read only from an ssh-transport remote", () => {
    expect(sshHostOf("git@github.com:o/r.git")).toBe("github.com");
    expect(sshHostOf("work-gh:o/r")).toBe("work-gh");
    expect(sshHostOf("ssh://git@ghe.example.com:2222/o/r")).toBe("ghe.example.com");
    expect(sshHostOf("git+ssh://alias/o/r")).toBe("alias");
    expect(sshHostOf("https://github.com/o/r")).toBeNull();
    expect(sshHostOf("file:///srv/r")).toBeNull();
    expect(sshHostOf("/srv/git/r")).toBeNull();
    expect(sshHostOf("../r")).toBeNull();
    expect(sshHostOf("C:\\repos\\r")).toBeNull();
    expect(sshHostOf("c:/repos/r")).toBeNull();
  });

  it("the identity remote's name: push remote › push default › origin › the only one", () => {
    const remotes = parseRemotes(
      [
        "fork\tgit@github.com:me/r.git (fetch)",
        "fork\tgit@github.com:me/r.git (push)",
        "origin\thttps://github.com/o/r (fetch)",
        "origin\thttps://github.com/o/r (push)",
        "upstream\thttps://github.com/up/r (fetch)",
      ].join("\n"),
    );
    expect(remotes.map((r) => r.name)).toEqual(["fork", "origin", "upstream"]);
    const config = (entries: Array<[string, string]>) => new Map(entries);
    expect(pickPushRemote(remotes, config([]), "main")).toBe("origin");
    expect(pickPushRemote(remotes, config([["remote.pushdefault", "fork"]]), "main")).toBe("fork");
    expect(
      pickPushRemote(
        remotes,
        config([
          ["remote.pushdefault", "fork"],
          ["branch.main.pushremote", "upstream"],
        ]),
        "main",
      ),
    ).toBe("upstream");
    // a name that is no remote is passed over
    expect(pickPushRemote(remotes, config([["remote.pushdefault", "gone"]]), null)).toBe("origin");
    const lone = [{ name: "mine", url: "x:o/r" }];
    expect(pickPushRemote(lone, config([]), "main")).toBe("mine");
    expect(pickPushRemote([...lone, { name: "two", url: "y:o/r" }], config([]), "main")).toBeNull();
  });

  it("samples the first-parent chain at 0, 1, 2, 4 … 512", () => {
    const chain = Array.from({ length: 600 }, (_, i) => i.toString(16).padStart(40, "0"));
    expect(samplesOf(chain).map((s) => s.depth)).toEqual([
      0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512,
    ]);
    expect(samplesOf(chain.slice(0, 5)).map((s) => s.depth)).toEqual([0, 1, 2, 4]);
    expect(samplesOf(["not-a-sha"])).toEqual([]);
  });
});

describe("placeFacts on real repositories", () => {
  it("reads a checkout: branch, tip, guarded root, samples, remotes, worktrees", async () => {
    const base = scratch("vf-place-");
    const root = repo(base, "proj", 20);
    git(root, "remote", "add", "origin", "https://github.com/o/proj.git");
    git(root, "remote", "add", "upstream", "git@github.com:up/proj.git");
    const side = join(base, "proj-side");
    git(root, "worktree", "add", "-q", "-b", "side", side);
    const plain = join(base, "plain");
    mkdirSync(plain);
    const gone = join(base, "gone");
    const answer = await read({
      places: [{ path: root }, { path: side }, { path: plain }, { path: gone }],
      peers: [],
      taskRoots: [],
    });
    const [checkout, worktree, folder, missing] = answer.places;
    const facts = done(checkout);
    expect(facts).toMatchObject({
      canonical: root,
      exists: true,
      mounted: true,
      kind: "project",
      gitRefused: null,
      hits: [],
    });
    expect(facts.caseless).toBe(caselessAt(root, process.platform));
    const read1 = gitOf(checkout);
    expect(read1).toMatchObject({
      head: head(root),
      branch: "main",
      shallow: false,
      root: firstCommit(root),
      pushRemote: "origin",
      toplevel: root,
      worktreeOf: null,
      worktrees: [{ path: side, branch: "side" }],
    });
    expect(read1.remotes).toEqual([
      { name: "origin", url: "https://github.com/o/proj.git" },
      { name: "upstream", url: "git@github.com:up/proj.git" },
    ]);
    // 20 commits: the tip and 1, 2, 4, 8, 16 back
    expect(read1.samples.map((s) => s.depth)).toEqual([0, 1, 2, 4, 8, 16]);
    expect(read1.samples[0]?.sha).toBe(head(root));
    expect(read1.samples[5]?.sha).toBe(git(root, "rev-parse", "HEAD~16").trim());
    // the linked worktree names its main checkout
    expect(gitOf(worktree)).toMatchObject({
      branch: "side",
      worktreeOf: root,
      root: firstCommit(root),
      worktrees: [{ path: root, branch: "main" }],
    });
    expect(done(folder)).toMatchObject({ exists: true, git: null, gitRefused: null, key: null });
    expect(done(missing)).toMatchObject({ exists: false, canonical: gone, git: null });
  });

  it("a remote is read as git uses it, insteadOf applied; the push default names the identity", async () => {
    const base = scratch("vf-place-url-");
    const root = repo(base, "proj", 1);
    git(root, "config", "url.git@github.com:.insteadOf", "gh:");
    git(root, "remote", "add", "origin", "gh:o/proj");
    git(root, "remote", "add", "mine", "https://example.com/me/proj");
    git(root, "config", "remote.pushDefault", "mine");
    const read1 = gitOf(
      (await read({ places: [{ path: root }], peers: [], taskRoots: [] })).places[0],
    );
    expect(read1.remotes).toContainEqual({ name: "origin", url: "git@github.com:o/proj" });
    expect(read1.pushRemote).toBe("mine");
  });

  it("finds a peer's samples in its own history: the shallowest held, same root only", async () => {
    const base = scratch("vf-place-hits-");
    const a = repo(base, "a", 10);
    const b = join(base, "b");
    git(base, "clone", "-q", a, b);
    // a moves on two commits b lacks
    for (const n of [10, 11]) {
      writeFileSync(join(a, "n.txt"), `a ${n}\n`);
      git(a, "commit", "-q", "-am", `c${n}`);
    }
    const unrelated = repo(base, "c", 3);
    const first = await read({
      places: [{ path: a }, { path: b }, { path: unrelated }],
      peers: [],
      taskRoots: [],
    });
    const [ga, gb, gc] = first.places.map(gitOf);
    const set = (placeId: string, g: PlaceGitRead): PlaceSampleSet => ({
      placeId,
      root: g.root ?? "",
      samples: g.samples,
    });
    const peers: PlaceSampleSet[] = [
      set("A", ga as PlaceGitRead),
      set("B", gb as PlaceGitRead),
      set("C", gc as PlaceGitRead),
      // a forged set: same root, samples that are no commit ids (never handed to git)
      {
        placeId: "F",
        root: (ga as PlaceGitRead).root ?? "",
        samples: [
          { sha: "--output=/tmp/x", depth: 0 },
          { sha: "HEAD", depth: 1 },
        ],
      },
      // claims the root, but its commits are the unrelated repository's
      {
        placeId: "G",
        root: (ga as PlaceGitRead).root ?? "",
        samples: (gc as PlaceGitRead).samples,
      },
    ];
    const second = await read({
      places: [{ path: a }, { path: b }, { path: unrelated }],
      peers,
      taskRoots: [],
    });
    const [ha, hb, hc] = second.places.map((place) => done(place).hits);
    const at = (depth: number, g: PlaceGitRead | undefined) =>
      g?.samples.find((sample) => sample.depth === depth)?.sha;
    // a holds b's tip; b holds a's commit two back (a's tip and one-back are not in b)
    expect(ha).toEqual([
      { placeId: "A", sha: head(a), depth: 0 },
      { placeId: "B", sha: head(b), depth: 0 },
    ]);
    expect(hb).toEqual([
      { placeId: "A", sha: at(2, ga), depth: 2 },
      { placeId: "B", sha: head(b), depth: 0 },
    ]);
    expect(at(2, ga)).toBe(head(b));
    // c's root differs: nothing is looked for in it but its own
    expect(hc).toEqual([{ placeId: "C", sha: head(unrelated), depth: 0 }]);
  });

  it("an unchanged place costs the cheap read; a commit or new candidates read again", async () => {
    const base = scratch("vf-place-cache-");
    const root = repo(base, "proj", 3);
    const first = done(
      (await read({ places: [{ path: root }], peers: [], taskRoots: [] })).places[0],
    );
    const g = gitOf(first);
    const known = { key: first.key, root: g.root, hitsKey: first.hitsKey };
    const again = done(
      (await read({ places: [{ path: root, known }], peers: [], taskRoots: [] })).places[0],
    );
    expect(again.git).toBe("unchanged");
    expect(again.hits).toBe("unchanged");
    expect(again.key).toBe(first.key);
    // new candidates for its root: the hits are read again, git is not
    const peers = [{ placeId: "P", root: g.root ?? "", samples: g.samples }];
    const withPeers = done(
      (await read({ places: [{ path: root, known }], peers, taskRoots: [] })).places[0],
    );
    expect(withPeers.git).toBe("unchanged");
    expect(withPeers.hits).toEqual([{ placeId: "P", sha: head(root), depth: 0 }]);
    // a commit moves the key
    writeFileSync(join(root, "n.txt"), "moved\n");
    git(root, "commit", "-q", "-am", "moved");
    const moved = done(
      (await read({ places: [{ path: root, known }], peers: [], taskRoots: [] })).places[0],
    );
    expect(moved.key).not.toBe(first.key);
    expect(gitOf(moved).head).toBe(head(root));
    // and so does a remote added without a commit (the config's mtime)
    const known2 = { key: moved.key, root: g.root, hitsKey: moved.hitsKey };
    await new Promise((r) => setTimeout(r, 20));
    git(root, "remote", "add", "origin", "https://example.com/o/proj");
    const remoted = done(
      (await read({ places: [{ path: root, known: known2 }], peers: [], taskRoots: [] })).places[0],
    );
    expect(gitOf(remoted).remotes).toEqual([{ name: "origin", url: "https://example.com/o/proj" }]);
  });

  it("guards the root: a shallow clone and an unborn branch publish nothing, an empty first commit is no root", async () => {
    const base = scratch("vf-place-guard-");
    const deep = repo(base, "deep", 6);
    const shallow = join(base, "shallow");
    git(base, "clone", "-q", "--depth", "2", `file://${deep}`, shallow);
    const unborn = join(base, "unborn");
    mkdirSync(unborn);
    git(unborn, "init", "-q", "-b", "main");
    const empty = join(base, "empty");
    mkdirSync(empty);
    git(empty, "init", "-q", "-b", "main");
    git(empty, "commit", "-q", "--allow-empty", "-m", "init");
    writeFileSync(join(empty, "a.txt"), "a\n");
    git(empty, "add", ".");
    git(empty, "commit", "-q", "-m", "a");
    const [s, u, e] = (
      await read({
        places: [{ path: shallow }, { path: unborn }, { path: empty }],
        peers: [],
        taskRoots: [],
      })
    ).places.map(gitOf);
    expect(s).toMatchObject({ shallow: true, root: null, samples: [] });
    expect(s?.head).toBe(head(shallow));
    expect(u).toMatchObject({ head: null, branch: "main", root: null, samples: [] });
    expect(e?.root).toBeNull();
    expect(e?.samples.map((x) => x.depth)).toEqual([0, 1]);
  });

  it.skipIf(process.platform === "win32")(
    "says a dubious-ownership refusal as a fact, and never overrides it",
    async () => {
      const base = scratch("vf-place-owner-");
      const root = repo(base, "theirs", 1);
      const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
      const bin = join(base, "bin");
      mkdirSync(bin);
      // git's own test switch: this repository reads as someone else's
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh\nGIT_TEST_ASSUME_DIFFERENT_OWNER=1 exec "${realGit}" "$@"\n`,
      );
      chmodSync(join(bin, "git"), 0o755);
      withEnv({ PATH: `${bin}:${process.env["PATH"] ?? ""}` });
      const facts = done(
        (await read({ places: [{ path: root }], peers: [], taskRoots: [] })).places[0],
      );
      expect(facts).toMatchObject({ exists: true, git: null, gitRefused: "dubious-ownership" });
    },
  );

  it("runs no git status: a clean filter the repository names never runs", async () => {
    const base = scratch("vf-place-filter-");
    const root = repo(base, "filtered", 1);
    const marker = join(base, "filter-ran");
    git(root, "config", "filter.spy.clean", `sh -c 'echo ran >> "${marker}"; cat'`);
    writeFileSync(join(root, ".gitattributes"), "*.txt filter=spy\n");
    // the same size, a new mtime: status must re-read the file through the filter
    writeFileSync(join(root, "n.txt"), "filtered X\n");
    await read({ places: [{ path: root }], peers: [], taskRoots: [] });
    expect(existsSync(marker)).toBe(false);
    // the control: a status does run it
    git(root, "status", "--porcelain");
    expect(existsSync(marker)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "asks `ssh -G` only about a host the guard admits, and keeps an alias that resolves elsewhere",
    async () => {
      const base = scratch("vf-place-ssh-");
      const root = repo(base, "aliased", 1);
      const bin = join(base, "bin");
      mkdirSync(bin);
      const log = join(base, "ssh-asked");
      writeFileSync(
        join(bin, "ssh"),
        `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$2" = "vf-alias-gh" ]; then echo "hostname github.com"; else echo "hostname $2"; fi\n`,
      );
      chmodSync(join(bin, "ssh"), 0o755);
      withEnv({ PATH: `${bin}:${process.env["PATH"] ?? ""}` });
      git(root, "remote", "add", "origin", "vf-alias-gh:o/r.git");
      git(root, "remote", "add", "plain", "git@vf-plain-host.example:o/r.git");
      git(root, "config", "remote.evil.url", "-oProxyCommand=touch:o/r");
      const read1 = gitOf(
        (await read({ places: [{ path: root }], peers: [], taskRoots: [] })).places[0],
      );
      expect(read1.sshAliases).toEqual({ "vf-alias-gh": "github.com" });
      const asked = readFileSync(log, "utf8").trim().split("\n").sort();
      expect(asked).toEqual(["-G vf-alias-gh", "-G vf-plain-host.example"]);
    },
  );

  it("names a task folder and a temporary one (L6)", async () => {
    const base = scratch("vf-place-kind-");
    const task = join(base, "Documents", "Codex", "2026-10-07", "task-one");
    mkdirSync(task, { recursive: true });
    const temp = join(base, "tmp", "fixture");
    mkdirSync(temp, { recursive: true });
    const answer = await readPlaces(
      {
        places: [{ path: task }, { path: temp }, { path: base }],
        peers: [],
        taskRoots: ["~/Documents/Codex/*/*"],
      },
      { home: base, temps: [join(base, "tmp")] },
    );
    expect(answer.places.map((place) => done(place).kind)).toEqual(["task", "temp", "home"]);
    expect(answer.places.map((place) => done(place).homeRelative)).toEqual([
      "Documents/Codex/2026-10-07/task-one",
      "tmp/fixture",
      null,
    ]);
  });

  it("stops at its budget: what it did not reach comes back skipped", async () => {
    const base = scratch("vf-place-budget-");
    const root = repo(base, "proj", 1);
    const answer = await readPlaces(
      { places: [{ path: root }, { path: root }], peers: [], taskRoots: [] },
      { budgetMs: -1 },
    );
    expect(answer.places).toEqual([
      { path: root, skipped: true },
      { path: root, skipped: true },
    ]);
  });

  it.skipIf(process.platform !== "darwin")(
    "a place on a volume that is not mounted says so",
    async () => {
      const path = `/Volumes/vf-not-mounted-${process.pid}/lanes/x`;
      const facts = done((await read({ places: [{ path }], peers: [], taskRoots: [] })).places[0]);
      expect(facts).toMatchObject({ exists: false, mounted: false, canonical: path });
    },
  );

  it("reads the volume's case rule from the disk itself", () => {
    const base = scratch("vf-place-case-");
    const probe = join(base, "Probe");
    mkdirSync(probe);
    let independent: boolean;
    try {
      independent = statSync(join(base, "pROBE")).ino === statSync(probe).ino;
    } catch {
      independent = false;
    }
    expect(caselessAt(probe, process.platform)).toBe(independent);
  });
});
