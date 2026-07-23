import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createElectronLogging } from "../src/main/logging";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function records(path: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("Electron process-owned logging", () => {
  it("persists desktop, renderer, and utility evidence with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-electron-logging-"));
    roots.push(root);
    const logRoot = join(root, "logs");
    const logging = await createElectronLogging({
      logRoot,
      dataRoot: root,
      bootId: "desktop-boot-test",
    });

    logging.logger.info("desktop.test.started", "desktop started", {
      bootstrapToken: "abcdefghijklmnopqrstuvwxyz123456",
    });
    logging.renderer.ingest({
      time: 10,
      observedTime: 20,
      level: "warn",
      event: "renderer.test.forwarded",
      message: "renderer forwarded",
      component: "renderer.test",
      windowId: "7",
      pid: 101,
    });
    logging.utility.ingest({
      time: 30,
      observedTime: 40,
      level: "error",
      event: "utility.test.forwarded",
      message: "utility forwarded",
      component: "utility.test",
      pid: 202,
    });
    await logging.close();

    const [desktop, renderer, utility] = await Promise.all([
      records(logging.desktop.filePath),
      records(logging.renderer.filePath),
      records(logging.utility.filePath),
    ]);
    expect(desktop.map((record) => record.event)).toEqual([
      "desktop.test.started",
      "desktop.lifecycle.logging_stopped",
    ]);
    expect(desktop[0]).toMatchObject({
      service: "desktop",
      role: "main",
      bootId: "desktop-boot-test",
      attrs: { bootstrapToken: "[redacted]" },
    });
    expect(renderer).toEqual([
      expect.objectContaining({
        service: "renderer",
        role: "renderer",
        event: "renderer.test.forwarded",
        windowId: "7",
        pid: 101,
      }),
    ]);
    expect(utility).toEqual([
      expect.objectContaining({
        service: "utility",
        role: "utility",
        event: "utility.test.forwarded",
        pid: 202,
      }),
    ]);

    expect((await stat(logRoot)).mode & 0o777).toBe(0o700);
    for (const path of [
      logging.desktop.filePath,
      logging.renderer.filePath,
      logging.utility.filePath,
    ]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(JSON.stringify({ desktop, renderer, utility })).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
  });
});
