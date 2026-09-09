import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScreenshotTool, type ScreenshotToolEvent } from "../src/tool";
import {
  createFakeHelper,
  type FakeHelperHarness,
  waitDead,
  writeExecutableHelper,
} from "./helpers";

// SNAP-D1 — the tool against a scripted fake helper that is a real child
// process. Each `it` names the promise it pins: one live helper, the
// pre-overlay deadline, terminal lines, honest failure on every other ending,
// dispose, and the still ring.

let fake: FakeHelperHarness;
let events: ScreenshotToolEvent[];
const accept = async (): Promise<void> => undefined;

beforeEach(() => {
  fake = createFakeHelper();
  events = [];
});
afterEach(() => {
  fake.cleanup();
});

function tool(mode: string, extra: Partial<ConstructorParameters<typeof ScreenshotTool>[0]> = {}) {
  return new ScreenshotTool({
    helperPath: "/fake/field-screenshot-helper",
    spawn: fake.spawnFor(mode),
    access: accept,
    onEvent: (event) => events.push(event),
    ...extra,
  });
}

const lifecycle = () =>
  events.flatMap((event) => (event.kind === "lifecycle" ? [event.event] : []));
const pidOf = () => {
  const spawned = events.find(
    (event) => event.kind === "lifecycle" && event.event === "screenshot.helper.spawned",
  );
  return spawned?.kind === "lifecycle" && typeof spawned.attrs["pid"] === "number"
    ? spawned.attrs["pid"]
    : undefined;
};

describe("the happy path", () => {
  it("answers ok with the helper's still, minus the wire version", async () => {
    const t = tool("ok");
    const result = await t.capture();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result).toMatchObject({ width: 640, height: 480, scale: 2, displayId: 1 });
    expect(result.bounds).toEqual({ x: 10, y: 20, width: 320, height: 240 });
    expect("v" in result).toBe(false);
    expect(existsSync(result.path)).toBe(true);
    expect(t.retainedStills).toEqual([result.path]);
    // the helper was asked for exactly one capture
    expect(events.some((e) => e.kind === "diagnostic" && e.line.includes('["--once"]'))).toBe(true);
    expect(lifecycle()).toEqual(
      expect.arrayContaining([
        "screenshot.helper.spawned",
        "screenshot.helper.ready",
        "screenshot.capture.finished",
      ]),
    );
  });

  it("carries the helper's unknown fields through to the caller (tolerant reader)", async () => {
    const result = await tool("unknown-field").capture();
    expect(result).toMatchObject({ status: "ok", pinned: false, futureField: { carried: true } });
  });

  it("answers cancel when the user backs out", async () => {
    expect(await tool("cancel").capture()).toEqual({ status: "cancel" });
  });

  it("relays the helper's typed error and its message", async () => {
    expect(await tool("error").capture()).toEqual({
      status: "error",
      code: "permission-denied",
      message: "Screen Recording permission is required",
    });
  });

  it("tolerates a repeated ready and CRLF endings", async () => {
    expect(await tool("ready-twice").capture()).toEqual({ status: "cancel" });
    const crlf = new ScreenshotTool({
      helperPath: "/fake/helper",
      spawn: fake.spawnFor("ok", { FAKE_HELPER_CRLF: "1" }),
      access: accept,
    });
    expect((await crlf.capture()).status).toBe("ok");
  });

  it("forwards stderr as diagnostics, one line each, never as protocol", async () => {
    expect(await tool("stderr-then-cancel").capture()).toEqual({ status: "cancel" });
    const lines = events.flatMap((e) => (e.kind === "diagnostic" ? [e.line] : []));
    expect(lines).toContain("monitor 1 DISPLAY1 1920x1080");
    expect(lines).toContain("using wgc");
  });

  it("is idle again once the helper has exited", async () => {
    const t = tool("ok");
    const first = t.capture();
    expect(t.busy).toBe(true);
    await first;
    const pid = pidOf();
    if (pid !== undefined) await waitDead(pid);
    // the exit event races the settle by design — wait for it
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(t.busy).toBe(false);
    expect((await t.capture()).status).toBe("ok");
  });
});

describe("one capture at a time", () => {
  it("answers busy while a helper is live", async () => {
    const t = tool("cancel");
    const first = t.capture();
    expect(await t.capture()).toMatchObject({ status: "error", code: "busy" });
    expect((await first).status).toBe("cancel");
  });

  it("stays busy while a helper lingers after its answer, then kills it", async () => {
    const t = tool("linger", { exitGraceMs: 100 });
    const result = await t.capture();
    expect(result.status).toBe("ok");
    expect(t.busy).toBe(true);
    const pid = pidOf();
    expect(pid).toBeDefined();
    expect(await waitDead(pid!)).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(t.busy).toBe(false);
    expect(lifecycle()).toContain("screenshot.helper.killed");
  });
});

describe("honest failure on every other ending", () => {
  it("times out a helper that never shows its overlay, and kills it", async () => {
    const t = tool("hang", { preOverlayTimeoutMs: 150 });
    const result = await t.capture();
    expect(result).toMatchObject({ status: "error", code: "helper-timeout" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toContain("150 ms");
    const pid = pidOf();
    expect(pid).toBeDefined();
    expect(await waitDead(pid!)).toBe(true);
  });

  it("reports a helper that exits without a result, with its last stderr line", async () => {
    const result = await tool("exit-silent").capture();
    expect(result).toMatchObject({ status: "error", code: "helper-exited" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toContain("exit code 3");
    expect(result.message).toContain("boom: capture chain refused");
  });

  it("kills a helper that prints prose on stdout — the contract admits only JSON", async () => {
    const result = await tool("garbage").capture();
    expect(result).toMatchObject({ status: "error", code: "helper-protocol" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toContain("not-json");
    expect(lifecycle()).toContain("screenshot.helper.killed");
  });

  it("refuses a status the contract does not know", async () => {
    const result = await tool("bad-shape").capture();
    expect(result).toMatchObject({ status: "error", code: "helper-protocol" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toContain("unrecognized");
  });

  it("bounds a helper that never ends its line", async () => {
    const result = await tool("oversize", { preOverlayTimeoutMs: 5_000 }).capture();
    expect(result).toMatchObject({ status: "error", code: "helper-protocol" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toContain("line-too-long");
    const pid = pidOf();
    expect(pid).toBeDefined();
    expect(await waitDead(pid!)).toBe(true);
  });

  it("answers helper-missing without spawning when the executable is absent", async () => {
    let spawned = 0;
    const t = new ScreenshotTool({
      helperPath: join(fake.dir, "does-not-exist"),
      spawn: () => {
        spawned += 1;
        throw new Error("must not spawn");
      },
    });
    expect(await t.capture()).toMatchObject({ status: "error", code: "helper-missing" });
    expect(spawned).toBe(0);
  });

  it("answers unsupported-platform when no helper exists for this platform", async () => {
    const t = new ScreenshotTool({ helperPath: null });
    expect(await t.capture()).toMatchObject({ status: "error", code: "unsupported-platform" });
  });

  it("answers helper-spawn-failed when spawn itself throws or errors", async () => {
    const throwing = new ScreenshotTool({
      helperPath: "/fake/helper",
      access: accept,
      spawn: () => {
        throw new Error("EACCES");
      },
    });
    expect(await throwing.capture()).toMatchObject({
      status: "error",
      code: "helper-spawn-failed",
    });
  });

  it("rejects nonsensical timings at construction", () => {
    expect(() => new ScreenshotTool({ helperPath: null, preOverlayTimeoutMs: 0 })).toThrow(
      RangeError,
    );
    expect(() => new ScreenshotTool({ helperPath: null, retainedStills: -1 })).toThrow(RangeError);
  });
});

describe("dispose", () => {
  it("kills a live helper and settles its capture as disposed", async () => {
    const t = tool("hang");
    const pending = t.capture();
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    t.dispose();
    expect(await pending).toMatchObject({ status: "error", code: "disposed" });
    const pid = pidOf();
    expect(pid).toBeDefined();
    expect(await waitDead(pid!)).toBe(true);
    expect(t.disposed).toBe(true);
    expect(await t.capture()).toMatchObject({ status: "error", code: "disposed" });
    t.dispose(); // idempotent
  });
});

describe("the still ring (SNAP-D4)", () => {
  it("keeps the newest N stills and unlinks the oldest", async () => {
    const t = tool("ok", { retainedStills: 2 });
    const paths: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await t.capture();
      if (result.status !== "ok") throw new Error(`capture ${i} was ${result.status}`);
      paths.push(result.path);
      const pid = pidOf();
      if (pid !== undefined) await waitDead(pid);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      events.length = 0;
    }
    // unlink is asynchronous and best-effort; give it a moment
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(t.retainedStills).toEqual(paths.slice(1));
    expect(existsSync(paths[0]!)).toBe(false);
    expect(existsSync(paths[1]!)).toBe(true);
    expect(existsSync(paths[2]!)).toBe(true);
  });

  it("reports an unlink that fails instead of throwing into the capture", async () => {
    const t = tool("ok", {
      retainedStills: 1,
      unlink: async () => {
        throw new Error("EPERM");
      },
    });
    for (let i = 0; i < 2; i += 1) {
      expect((await t.capture()).status).toBe("ok");
      const pid = pidOf();
      if (pid !== undefined) await waitDead(pid);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(lifecycle()).toContain("screenshot.still.unlink_failed");
  });
});

describe.skipIf(process.platform === "win32")("the default spawn and access path", () => {
  it("runs a real executable with --once and applies the exec-bit check", async () => {
    const helper = writeExecutableHelper(
      fake.dir,
      `[ "$1" = "--once" ] || exit 7\nprintf '{"v":1,"status":"ready"}\\n{"v":1,"status":"cancel"}\\n'`,
    );
    const t = new ScreenshotTool({ helperPath: helper });
    expect(await t.capture()).toEqual({ status: "cancel" });
    const notExecutable = join(fake.dir, "fake-helper.mjs");
    const refused = new ScreenshotTool({ helperPath: notExecutable });
    expect(await refused.capture()).toMatchObject({ status: "error", code: "helper-missing" });
  });
});
