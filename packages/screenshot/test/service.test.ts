import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotTool, type ScreenshotToolEvent } from "../src/tool";
import { createFakeHelper, type FakeHelperHarness, waitDead } from "./helpers";

let fake: FakeHelperHarness;
let events: ScreenshotToolEvent[];
let tools: ScreenshotTool[];
beforeEach(() => {
  fake = createFakeHelper();
  events = [];
  tools = [];
});
afterEach(() => {
  for (const tool of tools) tool.dispose();
  fake.cleanup();
});

function service(
  mode = "service",
  options: Partial<ConstructorParameters<typeof ScreenshotTool>[0]> = {},
) {
  const tool = new ScreenshotTool({
    helperPath: "/fake/helper",
    persistent: true,
    access: async () => {},
    spawn: fake.spawnFor(mode),
    onEvent: (event) => events.push(event),
    ...options,
  });
  tools.push(tool);
  return tool;
}

function lifecycle(name: string) {
  return events.filter((event) => event.kind === "lifecycle" && event.event === name);
}
async function idle() {
  await vi.waitFor(() => expect(lifecycle("screenshot.helper.idle").length).toBeGreaterThan(0), {
    timeout: 5000,
  });
}

describe("a prewarmed, host-owned screenshot helper", () => {
  it("boots without a capture and reuses the same process for fresh requests", async () => {
    const tool = service();
    await tool.prepare();
    await idle();
    expect(tool.busy).toBe(false);
    expect(tool.retainedStills).toEqual([]);
    expect(lifecycle("screenshot.capture.finished")).toHaveLength(0);
    expect(events.some((e) => e.kind === "diagnostic" && e.line.includes('["--service"]'))).toBe(
      true,
    );
    const first = await tool.capture();
    await vi.waitFor(() => expect(tool.busy).toBe(false));
    const second = await tool.capture();
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") throw new Error("capture failed");
    expect(first.path).not.toBe(second.path);
    expect(tool.retainedStills).toEqual([first.path, second.path]);
    expect(lifecycle("screenshot.helper.spawned")).toHaveLength(1);
    expect(lifecycle("screenshot.helper.ready")[0]).toMatchObject({
      attrs: {
        reused: true,
        permissionMs: 1,
        windowListMs: 2,
        captureMs: 3,
        overlayMs: 4,
        totalMs: 10,
      },
    });
  });

  it("queues one press behind startup and refuses a concurrent press", async () => {
    const tool = service("service", {
      spawn: fake.spawnFor("service", { FAKE_HELPER_BOOT_DELAY: "80" }),
    });
    const preparing = tool.prepare();
    const capture = tool.capture();
    expect(tool.busy).toBe(true);
    expect(await tool.capture()).toMatchObject({ status: "error", code: "busy" });
    await preparing;
    expect((await capture).status).toBe("ok");
    expect(lifecycle("screenshot.helper.spawned")).toHaveLength(1);
    expect(lifecycle("screenshot.helper.ready")[0]).toMatchObject({ attrs: { reused: false } });
  });

  it("holds the slot until cleanup is acknowledged, then kills a hung cleanup", async () => {
    const tool = service("service-linger", { exitGraceMs: 100 });
    expect((await tool.capture()).status).toBe("ok");
    expect(tool.busy).toBe(true);
    expect(await tool.capture()).toMatchObject({ code: "busy" });
    await vi.waitFor(() => expect(lifecycle("screenshot.helper.killed")).toHaveLength(1));
    await vi.waitFor(() => expect(tool.busy).toBe(false));
  });

  it("can start again after an idle helper dies, without a restart loop", async () => {
    const tool = service();
    await tool.prepare();
    await idle();
    const pid = [...fake.pids][0]!;
    process.kill(pid, "SIGKILL");
    await vi.waitFor(() => expect(lifecycle("screenshot.helper.exited")).toHaveLength(1));
    expect(lifecycle("screenshot.helper.spawned")).toHaveLength(1);
    expect((await tool.capture()).status).toBe("ok");
    expect(lifecycle("screenshot.helper.spawned")).toHaveLength(2);
  });

  it("bounds startup even when prewarming has no caller waiting", async () => {
    const tool = service("service-hang-boot", { preOverlayTimeoutMs: 150 });
    await tool.prepare();
    await vi.waitFor(() => expect(lifecycle("screenshot.helper.killed")).toHaveLength(1));
    await vi.waitFor(() => expect(tool.busy).toBe(false));
    expect(await waitDead([...fake.pids][0]!)).toBe(true);
  });

  it("settles a capture when the service dies before its terminal line", async () => {
    const tool = service("service-die");
    expect(await tool.capture()).toMatchObject({ status: "error", code: "helper-exited" });
    expect(tool.busy).toBe(false);
  });

  it("does not retain unsolicited or duplicate terminal results", async () => {
    const premature = service("service-premature");
    await premature.prepare();
    await vi.waitFor(() => expect(lifecycle("screenshot.helper.killed")).toHaveLength(1));
    expect(premature.retainedStills).toEqual([]);
    const duplicate = service("service-duplicate");
    expect((await duplicate.capture()).status).toBe("ok");
    await vi.waitFor(() => expect(duplicate.busy).toBe(false));
    expect(duplicate.retainedStills).toHaveLength(1);
  });

  it("disposes idle and active services and never spawns after an awaited access check", async () => {
    const tool = service();
    await tool.prepare();
    await idle();
    tool.dispose();
    expect(await waitDead([...fake.pids][0]!)).toBe(true);
    expect(await tool.capture()).toMatchObject({ code: "disposed" });

    const active = service("service-hang-capture");
    const result = active.capture();
    await vi.waitFor(() => expect(lifecycle("screenshot.helper.idle")).toHaveLength(2), {
      timeout: 5000,
    });
    active.dispose();
    expect(await result).toMatchObject({ code: "disposed" });

    let release = () => {};
    const access = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spawn = vi.fn(fake.spawnFor("service"));
    const late = service("service", { access: () => access, spawn });
    const pending = late.prepare();
    late.dispose();
    release();
    await pending;
    expect(spawn).not.toHaveBeenCalled();
  });
});
