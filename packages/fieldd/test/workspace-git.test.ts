// FS-1a — the interim git service under the files worker (FS-D8's interim,
// FS-D5 read-only): gitFacts on a real temporary repository with a dirty file
// and a second worktree; the room's git-port protocol pinned by the contract's
// fixture (L7 — every exchange run against this implementation, the answer's
// `ok` and the value's keys compared); the write ops refused whatever they
// carry; a commit id that is an option and a path that climbs refused before
// git sees them.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import {
  WORKSPACE_GIT,
  WorkspaceGitFactsResult,
  WorkspaceGitPortResponse,
  WorkspaceGitPortTranscript,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  answerGitRequest,
  createGitService,
  gitFacts,
  serveGitPort,
} from "../src/workspace/host/git";

const FIXTURE = join(
  import.meta.dirname,
  "..",
  "..",
  "contracts",
  "fixtures",
  "workspace-git-port.valid.json",
);

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

/** A repository with two commits, a staged-and-edited file, an untracked
 * file and a second worktree on its own branch. */
function repo(): { root: string; worktree: string; head: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-git-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "src", "a.ts"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  writeFileSync(join(root, "src", "a.ts"), "two\n");
  git(root, "commit", "-q", "-am", "second\n\nCo-authored-by: Grace <grace@example.com>");
  writeFileSync(join(root, "src", "a.ts"), "three\n");
  git(root, "add", "src/a.ts");
  writeFileSync(join(root, "src", "a.ts"), "four\n");
  writeFileSync(join(root, "notes.md"), "untracked\n");
  const worktree = join(base, "wt");
  git(root, "worktree", "add", "-q", "-b", "side", worktree);
  return { root, worktree, head: git(root, "rev-parse", "HEAD").trim() };
}

describe("gitFacts (the room's GitFacts, read-only)", () => {
  it("answers the branch, the dirty count and every worktree", async () => {
    const { root, worktree } = repo();
    const facts = WorkspaceGitFactsResult.parse(await gitFacts(root));
    expect(facts).toEqual({
      branch: "main",
      dirty: 2,
      worktrees: [
        { path: root, branch: "main" },
        { path: worktree, branch: "side" },
      ],
    });
    const other = WorkspaceGitFactsResult.parse(await gitFacts(worktree));
    expect(other?.branch).toBe("side");
    expect(other?.dirty).toBe(0);
  });

  it("answers null outside a repository, and no branch on a detached HEAD", async () => {
    const plain = mkdtempSync(join(tmpdir(), "vf-nogit-"));
    cleanup.push(() => rmSync(plain, { recursive: true, force: true }));
    expect(await gitFacts(plain)).toBeNull();
    const { root, head } = repo();
    git(root, "stash", "-q", "--include-untracked");
    git(root, "checkout", "-q", "--detach", head);
    const facts = WorkspaceGitFactsResult.parse(await gitFacts(root));
    expect(facts?.branch).toBeNull();
    expect(facts?.dirty).toBe(0);
  });

  it("a status takes no lock: the index is untouched by a read", async () => {
    const { root } = repo();
    const index = join(root, ".git", "index");
    const before = readFileSync(index);
    await gitFacts(root);
    expect(readFileSync(index).equals(before)).toBe(true);
  });
});

describe("the git port protocol (L7 — the contract's fixture, exchange by exchange)", () => {
  const transcript = WorkspaceGitPortTranscript.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));

  it("answers every exchange with the fixture's `ok` and the value's shape", async () => {
    const { root, head } = repo();
    const service = createGitService(root);
    for (const { request, response } of transcript.exchanges) {
      // the fixture's commit ids are examples; this repository's HEAD stands in
      const asked =
        request.op === "commitFiles" &&
        typeof request.args === "string" &&
        /^[0-9a-f]+$/.test(request.args)
          ? { ...request, args: head }
          : request;
      const answer = WorkspaceGitPortResponse.parse(await answerGitRequest(service, asked));
      expect(answer.id, `${request.op} keeps its id`).toBe(request.id);
      expect(answer.ok, `${request.op} (${JSON.stringify(request.args)})`).toBe(response.ok);
      if (response.ok && answer.ok) {
        const want = Object.keys(response.value as object).sort();
        expect(Object.keys(answer.value as object).sort(), `${request.op}'s value keys`).toEqual(
          want,
        );
      } else if (!response.ok && !answer.ok) {
        expect(answer.error, `${request.op}'s refusal`).toBe(response.error);
      }
    }
  });

  it("reads what the repository holds: both slots, the log's co-author, one commit's files", async () => {
    const { root, head } = repo();
    const service = createGitService(root);
    const status = await service.status();
    expect(status.entries).toEqual(
      expect.arrayContaining([
        { path: "src/a.ts", original: null, index: "M", worktree: "M" },
        { path: "notes.md", original: null, index: null, worktree: "?" },
      ]),
    );
    const log = await service.log();
    expect(log.commits.map((c) => c.subject)).toEqual(["second", "first"]);
    expect(log.commits[0]?.coAuthors).toEqual([{ name: "Grace", email: "grace@example.com" }]);
    expect(log.commits[0]?.pushed).toBeNull(); // no upstream: never "unpushed"
    const files = await service.commitFiles(head);
    expect(files.files).toEqual([
      { path: "src/a.ts", original: null, status: "M", added: 1, deleted: 1 },
    ]);
    const staged = await service.diff({ path: "src/a.ts", staged: true });
    expect(staged.text).toContain("+three");
    const untracked = await service.diff({ path: "notes.md" });
    expect(untracked.text).toContain("+untracked");
  });

  it("refuses every write op as read-only, whatever it carries, and changes nothing", async () => {
    const { root } = repo();
    const service = createGitService(root);
    const before = git(root, "status", "--porcelain");
    for (const [index, op] of WORKSPACE_GIT.WRITE_OPS.entries()) {
      const answer = await answerGitRequest(service, { id: index, op, args: ["src/a.ts"] });
      expect(answer).toEqual({ id: index, ok: false, error: WORKSPACE_GIT.READ_ONLY_ERROR });
    }
    expect(git(root, "status", "--porcelain")).toBe(before);
  });

  it("never hands git an option for a commit id, nor a path that leaves the root", async () => {
    const { root } = repo();
    const service = createGitService(root);
    const owned = join(tmpdir(), `vf-owned-${process.pid}`);
    for (const sha of [`--output=${owned}`, "HEAD~1", "-p", "", 42]) {
      const answer = await answerGitRequest(service, { id: 1, op: "commitFiles", args: sha });
      expect(answer?.ok).toBe(false);
      const diff = await answerGitRequest(service, {
        id: 2,
        op: "diff",
        args: { path: "src/a.ts", sha },
      });
      expect(diff?.ok).toBe(false);
    }
    expect(() => readFileSync(owned)).toThrow();
    for (const path of ["../outside", "/etc/passwd", "a/../../b", "C:\\x"]) {
      const answer = await answerGitRequest(service, { id: 3, op: "diff", args: { path } });
      expect(answer).toMatchObject({ id: 3, ok: false });
    }
    // not a request: no numeric id, no answer (rosetta's own rule)
    expect(await answerGitRequest(service, { op: "status" })).toBeNull();
    expect(await answerGitRequest(service, "status")).toBeNull();
    // a name on Object's prototype is an unknown op, never a call
    expect(await answerGitRequest(service, { id: 4, op: "constructor" })).toEqual({
      id: 4,
      ok: false,
      error: "unknown op: constructor",
    });
  });

  it("serves the protocol on a port, as FS-1b will hand the room one", async () => {
    const { root } = repo();
    const { port1, port2 } = new MessageChannel();
    cleanup.push(() => {
      port1.close();
      port2.close();
    });
    serveGitPort(
      {
        postMessage: (message) => port1.postMessage(message),
        addEventListener: (_type, listener) => port1.on("message", (data) => listener({ data })),
        start: () => port1.start(),
      },
      createGitService(root),
    );
    const answers: unknown[] = [];
    port2.on("message", (data) => answers.push(data));
    port2.postMessage({ id: 7, op: "branch" });
    port2.postMessage({ id: 8, op: "stage", args: ["src/a.ts"] });
    const deadline = Date.now() + 5_000;
    while (answers.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(answers).toEqual(
      expect.arrayContaining([
        { id: 7, ok: true, value: { name: "main", upstream: null, ahead: null, behind: null } },
        { id: 8, ok: false, error: WORKSPACE_GIT.READ_ONLY_ERROR },
      ]),
    );
  });
});
