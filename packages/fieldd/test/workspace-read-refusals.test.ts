// M10 (mille c8160d5) — a folder read that did not answer says so in words.
// mille bounds every native read (`readTimeoutMs`) and refuses to download a
// folder that lives only in iCloud (`materializeDataless` off), answering
// ETIMEDOUT and EDATALESS; the worker turns each into its own refusal naming
// the folder (`timed-out`, `dataless`), and the doors into TIMEOUT (retryable)
// and PRECONDITION_FAILED with `WorkspaceReadRefusalDetails` — never "no
// folder at that path", never "the files service could not answer".
//
// CI cannot make the kernel stall a read or evict a folder to iCloud, so the
// engine rows refuse through the test seam (`onHost`): the real mille engine,
// with its `list`/`prefetch`/`resync`/`resolvePath` answering mille's own
// error shape for the folders a row names.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CallerContext,
  WORKSPACE_LIMITS,
  WORKSPACE_READ_REFUSALS,
  WorkspaceReadRefusalDetails,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { readRefused, WorkspaceDoors } from "../src/workspace/doors";
import {
  ENGINE_OPTIONS,
  Engines,
  milleRefusal,
  readRefusal,
  WorkerFailure,
} from "../src/workspace/host/engine";
import { runScrubbed } from "../src/workspace/host/git";
import type { WorkerError } from "../src/workspace/protocol";
import { RootsRegistry } from "../src/workspace/roots";
import { FilesHostRefusal, type FilesHostSupervisor } from "../src/workspace/supervisor";
import { workspaceError } from "../src/workspace/tickets";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function base(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-unread-")));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** mille's own error shape (`FileSystemError`: a code and the folder's path). */
const milleError = (code: string, path: string) =>
  Object.assign(new Error(`${code} from mille`), { code, path });

const SECONDS = `${WORKSPACE_LIMITS.READ_TIMEOUT_MS / 1_000} s`;

describe("mille's read codes as the worker's refusals (M10)", () => {
  it("names the folder and says what happened, per platform", () => {
    const timedOut = milleRefusal(milleError("ETIMEDOUT", "/Users/ada/Keynote.key"), "darwin");
    expect(timedOut).toBeInstanceOf(WorkerFailure);
    expect(timedOut?.code).toBe("timed-out");
    expect(timedOut?.message).toBe(
      `“Keynote.key” did not answer within ${SECONDS} — macOS may still be downloading it from iCloud, or its drive stopped responding. Try again in a moment.`,
    );
    const dataless = milleRefusal(milleError("EDATALESS", "/Users/ada/Archive"), "darwin");
    expect(dataless?.code).toBe("dataless");
    expect(dataless?.message).toBe(
      "“Archive” is in iCloud only — it is not downloaded to this Mac, and VibeField does not download a folder to list it. Download it in Finder, then try again.",
    );
    // elsewhere a stalled read is a drive or a share; no path names no folder
    expect(milleRefusal(milleError("ETIMEDOUT", "/mnt/share/x"), "linux")?.message).toBe(
      `“x” did not answer within ${SECONDS} — its drive or network share may have stopped responding. Try again in a moment.`,
    );
    expect(readRefusal("timed-out", undefined, "darwin").message).toMatch(/^That folder did not/);
    expect(readRefusal("dataless", "/", "darwin").message).toMatch(/^That folder is in iCloud/);
  });

  it("leaves every other failure its own way out", () => {
    for (const other of [
      milleError("ENOENT", "/x"),
      milleError("EACCES", "/x"),
      new Error("plain"),
      new WorkerFailure("not-found", "no folder at that path"),
      null,
      undefined,
      "ETIMEDOUT",
    ])
      expect(milleRefusal(other)).toBeNull();
  });

  it("each engine hands mille the worker's one read deadline and never downloads a folder", () => {
    expect(ENGINE_OPTIONS.readTimeoutMs).toBe(WORKSPACE_LIMITS.READ_TIMEOUT_MS);
    expect(ENGINE_OPTIONS.materializeDataless).toBe(false);
    expect(WORKSPACE_LIMITS.MATERIALIZE_DATALESS).toBe(false);
  });
});

describe("the doors' words for a folder that did not answer", () => {
  it("timed-out is TIMEOUT, retryable; dataless is PRECONDITION_FAILED; the sentence passes as it is", () => {
    const timedOut = readRefused({ code: "timed-out", message: "“x” did not answer" });
    expect(timedOut).toBeInstanceOf(RpcCallError);
    expect(timedOut).toMatchObject({
      kind: "TIMEOUT",
      retryable: true,
      message: "“x” did not answer",
    });
    const details = WorkspaceReadRefusalDetails.parse(timedOut?.details);
    expect(details).toEqual({
      service: "workspace",
      reason: "timed-out",
      timeoutMs: WORKSPACE_LIMITS.READ_TIMEOUT_MS,
    });
    const dataless = readRefused({ code: "dataless", message: "“y” is in iCloud only" });
    expect(dataless).toMatchObject({ kind: "PRECONDITION_FAILED", retryable: false });
    const evicted = WorkspaceReadRefusalDetails.parse(dataless?.details);
    expect(evicted).toEqual({ service: "workspace", reason: "dataless" });
    for (const refused of [details, evicted])
      expect(WORKSPACE_READ_REFUSALS).toContain(refused.reason);
    expect(readRefused({ code: "busy", message: "every engine" })).toBeNull();
  });

  it("the ticket door says the same (History's file column opening a folder)", () => {
    const thrown = (code: "timed-out" | "dataless" | "not-found") => {
      try {
        workspaceError(new FilesHostRefusal({ code, message: `${code} words` }));
      } catch (error) {
        return error as RpcCallError;
      }
      throw new Error("workspaceError returned");
    };
    expect(thrown("timed-out")).toMatchObject({
      kind: "TIMEOUT",
      retryable: true,
      message: "timed-out words",
    });
    expect(thrown("dataless")).toMatchObject({ kind: "PRECONDITION_FAILED", retryable: false });
    expect(thrown("not-found")).toMatchObject({ kind: "NOT_FOUND" });
  });

  it("workspace.list answers the worker's refusal in its words (the phone draws them)", async () => {
    const dir = base();
    const home = join(dir, "home");
    mkdirSync(home);
    const registry = new RootsRegistry({
      file: join(dir, "roots.json"),
      deviceId: () => "dev_test",
      browse: () => ({
        platform: process.platform,
        home,
        user: "",
        fs: {
          readdir: () => [],
          realpath: (path) => path.replace(/^\/private\//, "/"),
          isDirectory: () => true,
          exists: () => true,
        },
      }),
    });
    let refusal: WorkerError = { code: "timed-out", message: "“slow” did not answer" };
    const supervisor = {
      request: () => Promise.reject(new FilesHostRefusal(refusal)),
    } as unknown as FilesHostSupervisor;
    const doors = new WorkspaceDoors({ registry, supervisor });
    cleanup.push(() => doors.dispose());
    const ctx = {
      principal: { kind: "peer-fieldd" },
      transport: "tailnet",
      receivedAt: 0,
    } as unknown as CallerContext;
    const rootId = doors.roots(ctx, {}).roots[0]?.rootId as string;
    await expect(doors.list(ctx, { rootId, path: "slow" })).rejects.toMatchObject({
      kind: "TIMEOUT",
      retryable: true,
      message: "“slow” did not answer",
      details: { service: "workspace", reason: "timed-out" },
    });
    refusal = { code: "dataless", message: "“slow” is in iCloud only" };
    await expect(doors.search(ctx, { rootId, q: "x" })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: "“slow” is in iCloud only",
      details: { service: "workspace", reason: "dataless" },
    });
  });
});

describe("the engine refuses a folder it could not read, never 'no folder at that path'", () => {
  /** The real engine, with mille answering `code` for the folders named. */
  function refusing(root: string, stuck: Map<string, "ETIMEDOUT" | "EDATALESS">): Engines {
    const made = new Engines({
      onHost: (host) => {
        const fx = host.local;
        const refusal = (id: number) => {
          const entry = fx.getSnapshot().getById(id);
          const code = entry === null ? undefined : stuck.get(entry.name);
          return code === undefined || entry === null
            ? null
            : milleError(code, join(root, entry.name));
        };
        const list = fx.list.bind(fx);
        const prefetch = fx.prefetch.bind(fx);
        const resync = fx.resync.bind(fx);
        const resolvePath = fx.resolvePath.bind(fx);
        fx.list = (async (id, options) => {
          const error = refusal(id);
          if (error !== null) throw error;
          return list(id, options);
        }) as typeof fx.list;
        fx.prefetch = (async (id, options) => {
          const error = refusal(id);
          if (error !== null) throw error;
          return prefetch(id, options);
        }) as typeof fx.prefetch;
        fx.resync = (async (id, options) => {
          const error = refusal(id);
          if (error !== null) throw error;
          return resync(id, options);
        }) as typeof fx.resync;
        fx.resolvePath = (async (path) => {
          for (const [name, code] of stuck)
            if (path.includes(`/${name}/`)) throw milleError(code, join(root, name));
          return resolvePath(path);
        }) as typeof fx.resolvePath;
      },
    });
    cleanup.push(() => made.disposeAll());
    return made;
  }

  function tree(): string {
    const root = base();
    mkdirSync(join(root, "slow", "sub"), { recursive: true });
    writeFileSync(join(root, "slow", "target-slow.txt"), "s");
    mkdirSync(join(root, "fast"));
    writeFileSync(join(root, "fast", "target-fast.txt"), "f");
    return root;
  }

  const list = (e: Engines, rootPath: string, segments: string[]) =>
    e.list({ rootPath, segments, offset: 0, limit: 50, kinds: "all" });

  it("a folder whose read stalled is `timed-out`, named; one in iCloud only is `dataless`", async () => {
    const root = tree();
    const e = refusing(root, new Map([["slow", "ETIMEDOUT"]]));
    expect((await list(e, root, ["fast"])).entries.map((entry) => entry.name)).toEqual([
      "target-fast.txt",
    ]);
    const stalled = await list(e, root, ["slow"]).catch((error: unknown) => error);
    expect(stalled).toBeInstanceOf(WorkerFailure);
    expect(stalled).toMatchObject({ code: "timed-out" });
    expect((stalled as Error).message).toContain(`“slow” did not answer within ${SECONDS}`);
    const evicted = refusing(root, new Map([["slow", "EDATALESS"]]));
    await expect(list(evicted, root, ["slow"])).rejects.toMatchObject({
      code: "dataless",
      message: expect.stringContaining("VibeField does not download a folder to list it"),
    });
  });

  it("a stalled folder ON THE WAY is the refusal too, not 'no folder at that path'", async () => {
    const root = tree();
    const e = refusing(root, new Map([["slow", "ETIMEDOUT"]]));
    await expect(list(e, root, ["slow", "sub"])).rejects.toMatchObject({
      code: "timed-out",
      message: expect.stringContaining("“slow”"),
    });
  });

  it("a search leaves out a hit whose folder did not answer and says it is partial", async () => {
    const root = tree();
    const e = refusing(root, new Map([["slow", "ETIMEDOUT"]]));
    const answer = await e.search({
      rootPath: root,
      segments: [],
      q: "target",
      limit: 10,
      kinds: "all",
    });
    expect(answer.hits.map((hit) => hit.relativePath)).toEqual(["fast/target-fast.txt"]);
    expect(answer.complete).toBe(false);
  });
});

describe("an answer too large for the git runner says so (the interim git port)", () => {
  it("a cut answer is refused in words, never Node's 'maxBuffer length exceeded'", async () => {
    const run = await runScrubbed(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(4096))"],
      { env: process.env, maxBuffer: 64 },
    );
    expect(run.ok).toBe(false);
    expect(run.stderr).toBe(
      "git's answer is larger than the 64 bytes VibeField reads at once, so it is not shown",
    );
    const fits = await runScrubbed(process.execPath, ["-e", "process.stdout.write('ok')"], {
      env: process.env,
    });
    expect(fits).toMatchObject({ ok: true, stdout: "ok" });
  });
});
