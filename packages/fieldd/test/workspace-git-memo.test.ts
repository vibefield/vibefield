// History QA (2026-11-24) — the room's pane asks `branch`, `status` and `log` every four seconds, and the files
// worker used to run seven git processes for each tick whatever had moved. This file holds what it runs now (one
// status shared by `branch` and `status`; the log kept under the head's and the upstream's ids) and that the
// answers are the ones the old reads gave: on a branch ahead of its upstream, with no upstream, detached, before
// the first commit, and outside a repository.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGitService,
  forgetGitMemos,
  parseStatus,
  parseStatusHeads,
  runGit,
  STATUS_SHARE_MS,
} from "../src/workspace/host/git";

let cleanup: Array<() => void> = [];
beforeEach(() => forgetGitMemos());
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

function folder(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-git-memo-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

/** A repository on `main`, two commits pushed to a bare remote it tracks, and one more not pushed. */
function tracked(): { root: string; remote: string } {
  const base = folder();
  const remote = join(base, "remote.git");
  const root = join(base, "repo");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  writeFileSync(join(root, "a.txt"), "two\n");
  git(root, "commit", "-q", "-am", "second");
  git(root, "remote", "add", "origin", remote);
  git(root, "-c", "protocol.file.allow=always", "push", "-q", "-u", "origin", "main");
  writeFileSync(join(root, "a.txt"), "three\n");
  git(root, "commit", "-q", "-am", "third");
  writeFileSync(join(root, "note.md"), "untracked\n");
  return { root, remote };
}

/** A runner that counts what it is asked to run, by git's first word. */
function counting(): { run: typeof runGit; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: (root, args, options) => {
      calls.push(args[0] as string);
      return runGit(root, args, options);
    },
  };
}

const tick = (service: ReturnType<typeof createGitService>) =>
  Promise.all([service.branch(), service.status(), service.log()]);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("the `# branch` records of a status read", () => {
  it("reads the head, its upstream and the counts", () => {
    const raw = [
      "# branch.oid 1111111111111111111111111111111111111111",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaaa bbbb a.txt",
      "",
    ].join("\0");
    expect(parseStatusHeads(raw)).toEqual({
      oid: "1111111111111111111111111111111111111111",
      name: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    // the entries are read from the same output, the header records skipped
    expect(parseStatus(raw).map((entry) => entry.path)).toEqual(["a.txt"]);
  });

  it("answers as the old reads did where they answered nothing", () => {
    const of = (...records: string[]) => parseStatusHeads([...records, ""].join("\0"));
    // detached: `rev-parse --abbrev-ref HEAD` said "HEAD"
    expect(of("# branch.oid 2222", "# branch.head (detached)")).toMatchObject({
      name: "HEAD",
      upstream: null,
    });
    // before the first commit: it failed, so no name
    expect(of("# branch.oid (initial)", "# branch.head main")).toMatchObject({
      oid: null,
      name: null,
    });
    // an upstream that is set and gone: `@{u}` resolved to nothing
    expect(of("# branch.oid 3333", "# branch.head main", "# branch.upstream origin/gone")).toEqual({
      oid: "3333",
      name: "main",
      upstream: null,
      ahead: null,
      behind: null,
    });
    // no header at all (an output that is not `--branch`'s)
    expect(parseStatusHeads("1 .M N... 100644 100644 100644 aaaa bbbb a.txt\0")).toBeNull();
  });
});

describe("a tick of the pane's three asks (History QA, 2026-11-24)", { timeout: 30_000 }, () => {
  it("runs one status and reads the log once, then two processes a tick while nothing moves", async () => {
    const { root } = tracked();
    const { run, calls } = counting();
    const [branch, status, log] = await tick(createGitService(root, run));
    expect(branch).toEqual({ name: "main", upstream: "origin/main", ahead: 1, behind: 0 });
    expect(status.error).toBeNull();
    expect(status.entries.map((entry) => entry.path)).toEqual(["note.md"]);
    expect(log.commits.map((commit) => commit.subject)).toEqual(["third", "second", "first"]);
    expect(log.commits.map((commit) => commit.pushed)).toEqual([false, true, true]);
    // one shared status, the upstream's id, and the log's own three reads
    expect([...calls].sort()).toEqual(["log", "log", "rev-list", "rev-parse", "status"]);

    // the next tick (a new service, as the worker builds one for each ask): the status and the upstream's id
    await pause(STATUS_SHARE_MS + 80);
    calls.length = 0;
    const again = await tick(createGitService(root, run));
    expect([...calls].sort()).toEqual(["rev-parse", "status"]);
    expect(again).toEqual([branch, status, log]);
  });

  it("reads the log again when the head moves, and when only the upstream does", async () => {
    const { root } = tracked();
    const { run, calls } = counting();
    const first = await createGitService(root, run).log();
    writeFileSync(join(root, "a.txt"), "four\n");
    git(root, "commit", "-q", "-am", "fourth");
    await pause(STATUS_SHARE_MS + 80);
    calls.length = 0;
    const moved = await createGitService(root, run).log();
    expect(moved.commits.map((commit) => commit.subject)).toEqual([
      "fourth",
      "third",
      "second",
      "first",
    ]);
    expect(moved.commits.length).toBe(first.commits.length + 1);
    expect(calls.filter((call) => call === "log").length).toBe(2);

    // a push moves the upstream and not the head: what is pushed changes
    git(root, "-c", "protocol.file.allow=always", "push", "-q", "origin", "main");
    await pause(STATUS_SHARE_MS + 80);
    calls.length = 0;
    const pushed = await createGitService(root, run).log();
    expect(pushed.commits.map((commit) => commit.pushed)).toEqual([true, true, true, true]);
    expect(calls.filter((call) => call === "log").length).toBe(2);
  });

  it("with no upstream a quiet tick is the one status", async () => {
    const base = folder();
    git(base, "init", "-q", "-b", "main");
    writeFileSync(join(base, "a.txt"), "one\n");
    git(base, "add", ".");
    git(base, "commit", "-q", "-m", "only");
    const { run, calls } = counting();
    const [branch, , log] = await tick(createGitService(base, run));
    expect(branch).toEqual({ name: "main", upstream: null, ahead: null, behind: null });
    expect(log.commits.map((commit) => commit.pushed)).toEqual([null]);
    await pause(STATUS_SHARE_MS + 80);
    calls.length = 0;
    await tick(createGitService(base, run));
    expect(calls).toEqual(["status"]);
  });

  it("names a detached head as the old read did", async () => {
    const { root } = tracked();
    git(root, "checkout", "-q", "--detach", "HEAD~1");
    const branch = await createGitService(root).branch();
    expect(branch).toEqual({ name: "HEAD", upstream: null, ahead: null, behind: null });
  });

  it("outside a repository every answer is the old one, and the status is asked once", async () => {
    const base = folder();
    const { run, calls } = counting();
    const [branch, status, log] = await tick(createGitService(base, run));
    expect(branch).toEqual({ name: null, upstream: null, ahead: null, behind: null });
    expect(status.entries).toEqual([]);
    expect(status.error).not.toBeNull();
    expect(log.commits).toEqual([]);
    expect(log.error).not.toBeNull();
    expect(calls.filter((call) => call === "status").length).toBe(1);
  });
});
