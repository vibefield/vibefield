// PJ-1 (L3) — the files worker's ONE hardened git runner, for every caller:
// the environment is an allowlist (an inherited GIT_DIR no longer redirects a
// read), no hook a repository names runs, no transport is reachable even when
// a repository's own config re-allows one, and the worker-wide cap holds under
// a burst (counted on real processes, not on the gate's own ledger).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_GIT } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitGate,
  gitEnvironment,
  gitFacts,
  gitGate,
  runGit,
  scrubbedEnvironment,
} from "../src/workspace/host/git";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

/** The test's own git: a quiet identity, no global or system config. */
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

/** A repository with one commit on `branch`, its identity in its own config
 * (the runner reads the person's real global config, never the test's). */
function repo(base: string, name: string, branch: string): string {
  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", branch);
  git(root, "config", "user.name", "Ada");
  git(root, "config", "user.email", "ada@example.com");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "a.txt"), `${name}\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return root;
}

/** Set environment variables for one test; the afterEach restores them. */
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

describe("the environment git sees is an allowlist", () => {
  it("keeps PATH, HOME, USER, LANG, LC_* and TMPDIR, and nothing else of the source", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/home/ada",
      USER: "ada",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      LC_CTYPE: "UTF-8",
      TMPDIR: "/tmp",
      GIT_DIR: "/elsewhere/.git",
      GIT_WORK_TREE: "/elsewhere",
      GIT_CONFIG_GLOBAL: "/elsewhere/config",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/elsewhere/hooks",
      GIT_EXEC_PATH: "/elsewhere/libexec",
      GIT_SSH_COMMAND: "/elsewhere/ssh",
      FIELDD_TOKEN: "secret",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      NODE_OPTIONS: "--require=/elsewhere/x.js",
    };
    expect(scrubbedEnvironment(source, "darwin")).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/ada",
      USER: "ada",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      LC_CTYPE: "UTF-8",
      TMPDIR: "/tmp",
    });
    // the runner's own variables are the only GIT_* git ever sees
    const env = gitEnvironment(source, "darwin");
    expect(Object.keys(env).filter((key) => key.startsWith("GIT_"))).toEqual([
      "GIT_OPTIONAL_LOCKS",
      "GIT_TERMINAL_PROMPT",
      "GIT_NO_LAZY_FETCH",
    ]);
  });

  it("reads a Windows environment's names without regard to case", () => {
    expect(
      scrubbedEnvironment(
        {
          Path: "C:\\Windows",
          SystemRoot: "C:\\Windows",
          USERPROFILE: "C:\\Users\\ada",
          git_dir: "x",
        },
        "win32",
      ),
    ).toEqual({ Path: "C:\\Windows", SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\ada" });
  });

  it("an inherited GIT_DIR no longer redirects a read", async () => {
    const base = scratch("vf-gitdir-");
    const asked = repo(base, "asked", "main");
    const other = repo(base, "other", "elsewhere");
    // the control: the variable WOULD redirect a git that inherited it
    expect(
      execFileSync("git", ["-C", asked, "symbolic-ref", "--short", "HEAD"], {
        encoding: "utf8",
        env: { ...process.env, GIT_DIR: join(other, ".git") },
      }).trim(),
    ).toBe("elsewhere");
    withEnv({ GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other });
    const facts = await gitFacts(asked);
    expect(facts?.branch).toBe("main");
    expect(facts?.worktrees).toEqual([{ path: asked, branch: "main" }]);
  });
});

describe("a repository's config cannot make a read run anything", () => {
  it("a hook the repository names does not run", async () => {
    const base = scratch("vf-hook-");
    const root = repo(base, "hooked", "main");
    const marker = join(base, "hook-ran");
    const hooks = join(base, "hooks");
    mkdirSync(hooks);
    const hook = `#!/bin/sh\necho ran >> "${marker}"\n`;
    for (const dir of [hooks, join(root, ".git", "hooks")]) {
      writeFileSync(join(dir, "pre-commit"), hook);
      chmodSync(join(dir, "pre-commit"), 0o755);
    }
    git(root, "config", "core.hooksPath", hooks);
    // the control: the hook is real, and runs for a git that honours the config
    git(root, "commit", "-q", "--allow-empty", "-m", "control");
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    // through the runner (a commit is the one command sure to reach a hook)
    const run = await runGit(root, ["commit", "-q", "--allow-empty", "-m", "runner"]);
    expect(run.ok, run.stderr).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses every transport, even one the repository's own config re-allows", async () => {
    const base = scratch("vf-proto-");
    const root = repo(base, "here", "main");
    const there = repo(base, "there", "main");
    // the control: the repository can reach the other one
    expect(git(root, "ls-remote", there)).toContain("refs/heads/main");
    git(root, "config", "protocol.file.allow", "always");
    git(root, "config", "protocol.allow", "always");
    for (const url of [there, `file://${there}`]) {
      const run = await runGit(root, ["ls-remote", url]);
      expect(run.ok).toBe(false);
      expect(run.stderr).toMatch(/not allowed/);
    }
  });
});

describe("the worker-wide cap (WORKSPACE_GIT.CONCURRENCY)", () => {
  it("passes a slot straight on, in arrival order", async () => {
    const gate = new GitGate(2);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const tasks = ["a", "b", "c", "d"].map((name) =>
      gate.run(async () => {
        order.push(`start ${name}`);
        if (name === "a" || name === "b") await held;
        order.push(`end ${name}`);
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(gate.active).toBe(2);
    expect(gate.waiting).toBe(2);
    release();
    await Promise.all(tasks);
    expect(order.slice(0, 2)).toEqual(["start a", "start b"]);
    expect(order.indexOf("start c")).toBeLessThan(order.indexOf("start d"));
    expect(gate.active).toBe(0);
    expect(gate.peak).toBe(2);
  });

  it.skipIf(process.platform === "win32")(
    "holds under a burst: never more git processes at once than the cap",
    async () => {
      const base = scratch("vf-burst-");
      const bin = join(base, "bin");
      mkdirSync(bin);
      const log = join(base, "log");
      // a git that says when it starts and ends, and takes its time
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh\necho s >> "${log}"\nsleep 0.15\necho e >> "${log}"\n`,
      );
      chmodSync(join(bin, "git"), 0o755);
      withEnv({ PATH: `${bin}:${process.env["PATH"] ?? ""}` });
      const cap = WORKSPACE_GIT.CONCURRENCY;
      const runs = await Promise.all(
        Array.from({ length: cap * 3 }, () => runGit(base, ["status"])),
      );
      expect(runs.every((run) => run.ok)).toBe(true);
      let live = 0;
      let most = 0;
      const lines = readFileSync(log, "utf8").trim().split("\n");
      for (const line of lines) {
        live += line === "s" ? 1 : -1;
        most = Math.max(most, live);
      }
      expect(lines).toHaveLength(cap * 6);
      // the cap is reached (the burst ran in parallel) and never passed
      expect(most).toBe(cap);
      expect(gitGate.peak).toBeLessThanOrEqual(cap);
    },
  );
});
