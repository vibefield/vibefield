import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrashArtifactManager, startLocalCrashReporter } from "../src/main/crash-artifacts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function captureLogger(events: Array<{ level: string; event: string; attrs?: unknown }>): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ level: "trace", event, attrs }),
    debug: (event, _message, attrs) => events.push({ level: "debug", event, attrs }),
    info: (event, _message, attrs) => events.push({ level: "info", event, attrs }),
    warn: (event, _message, attrs) => events.push({ level: "warn", event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ level: "error", event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ level: "fatal", event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

describe("Electron local crash evidence", () => {
  it("starts Crashpad early with upload disabled and no submit URL", () => {
    const start = vi.fn();
    const config = startLocalCrashReporter({
      start,
      bootId: "desktop-boot-1",
      appVersion: "1.2.3",
      contractsVersion: "0.1.0",
      channel: "production",
    });
    expect(start).toHaveBeenCalledOnce();
    expect(config).toEqual({
      productName: "VibeField",
      uploadToServer: false,
      globalExtra: {
        appVersion: "1.2.3",
        contractsVersion: "0.1.0",
        channel: "production",
        processRole: "desktop-main",
        bootId: "desktop-boot-1",
      },
    });
    expect(config).not.toHaveProperty("submitURL");
  });

  it("retains the newest five dumps and never follows symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-crash-artifacts-"));
    roots.push(root);
    const crashRoot = join(root, "dumps");
    await chmod(root, 0o700);
    const now = Date.now();
    let clock = now - 10_000;
    const events: Array<{ level: string; event: string; attrs?: unknown }> = [];
    const manager = new CrashArtifactManager({
      dataRoot: root,
      crashDumpsRoot: crashRoot,
      bootId: "desktop-current",
      appVersion: "1.2.3",
      logger: captureLogger(events),
      now: () => clock,
    });
    await manager.initialize();
    clock = now;

    for (let index = 0; index < 7; index += 1) {
      const path = join(crashRoot, `dump-${index}.dmp`);
      await writeFile(path, `dump ${index}`, { mode: 0o644 });
      const time = new Date(now - index * 1_000);
      await utimes(path, time, time);
    }
    const outside = join(root, "outside.dmp");
    await writeFile(outside, "outside");
    if (process.platform !== "win32") {
      await symlink(outside, join(crashRoot, "unsafe.dmp"));
    }

    const list = await manager.refresh("renderer");
    expect(list.artifacts).toHaveLength(5);
    expect(list.cleanup.deletedArtifacts).toBe(2);
    expect(list.cleanup.skippedUnsafeEntries).toBe(process.platform === "win32" ? 0 : 1);
    expect(list.artifacts.every((artifact) => artifact.processRole === "renderer")).toBe(true);
    expect(JSON.stringify(list)).not.toContain(root);
    expect(await readFile(outside, "utf8")).toBe("outside");
    for (const artifact of list.artifacts) {
      const selected = await manager.selectArtifacts([artifact.artifactId]);
      expect(selected).toHaveLength(1);
    }
    expect(events.map((event) => event.event)).toContain("desktop.crash.artifacts_refreshed");
    await manager.markClean();
  });

  // POSIX mode bits do not exist on win32: `chmod` there flips only the
  // read-only attribute, so the manager's 0o700/0o600 arguments are no-ops and
  // every path stats as 0o666 — an expectation here would measure the CRT's
  // fiction, not who can read the evidence. Split out of the retention row so
  // ONLY the mode question is withheld; the retention, the symlink refusal, and
  // the path redaction that row proves still run on both platforms. A dump is
  // raw process memory, which is why its permissions are asserted at all rather
  // than left to whatever umask the launching shell happened to carry.
  it.skipIf(process.platform === "win32")(
    "keeps the dump root, each retained dump, and the manifest state private (0700 / 0600)",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "vibefield-crash-private-"));
      roots.push(root);
      const crashRoot = join(root, "dumps");
      await chmod(root, 0o700);
      const manager = new CrashArtifactManager({
        dataRoot: root,
        crashDumpsRoot: crashRoot,
        bootId: "desktop-private",
        appVersion: "1.2.3",
        logger: captureLogger([]),
      });
      await manager.initialize();
      expect((await stat(crashRoot)).mode & 0o777).toBe(0o700);

      // written 0o644, the mode Crashpad leaves behind — the manager tightening
      // it is the property, so an already-private fixture would prove nothing
      await writeFile(join(crashRoot, "dump-0.dmp"), "dump 0", { mode: 0o644 });
      const list = await manager.refresh("renderer");
      expect(list.artifacts).toHaveLength(1);
      for (const artifact of list.artifacts) {
        const selected = await manager.selectArtifacts([artifact.artifactId]);
        expect((await stat(selected[0]?.path ?? "")).mode & 0o777).toBe(0o600);
      }
      expect((await stat(join(root, "crash", "manifest-state.json"))).mode & 0o777).toBe(0o600);
      await manager.markClean();
    },
  );

  it("persists viewed state and reports only genuinely unclean prior runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-crash-marker-"));
    roots.push(root);
    const crashRoot = join(root, "dumps");
    const firstEvents: Array<{ level: string; event: string; attrs?: unknown }> = [];
    const first = new CrashArtifactManager({
      dataRoot: root,
      crashDumpsRoot: crashRoot,
      bootId: "desktop-first",
      appVersion: "1.0.0",
      logger: captureLogger(firstEvents),
    });
    await first.initialize();
    await writeFile(join(crashRoot, "first.dmp"), "dump");
    const firstList = await first.refresh("main");
    const artifactId = firstList.artifacts[0]?.artifactId;
    expect(artifactId).toBeDefined();
    await expect(first.markViewed({ artifactId })).resolves.toEqual({ viewed: true });

    const secondEvents: Array<{ level: string; event: string; attrs?: unknown }> = [];
    const second = new CrashArtifactManager({
      dataRoot: root,
      crashDumpsRoot: crashRoot,
      bootId: "desktop-second",
      appVersion: "1.0.0",
      logger: captureLogger(secondEvents),
    });
    const secondList = await second.initialize();
    expect(secondList.artifacts[0]).toMatchObject({ artifactId, viewed: true });
    expect(secondEvents.map((event) => event.event)).toContain(
      "desktop.crash.previous_run_unclean",
    );
    await second.markClean();

    const thirdEvents: Array<{ level: string; event: string; attrs?: unknown }> = [];
    const third = new CrashArtifactManager({
      dataRoot: root,
      crashDumpsRoot: crashRoot,
      bootId: "desktop-third",
      appVersion: "1.0.0",
      logger: captureLogger(thirdEvents),
    });
    await third.initialize();
    expect(thirdEvents.map((event) => event.event)).not.toContain(
      "desktop.crash.previous_run_unclean",
    );
    await third.markClean();
    await expect(access(join(root, "crash", "active-run.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // Planting the link needs SeCreateSymbolicLinkPrivilege on win32, so these
  // two report SKIPPED rather than returning early and counting as passes —
  // the guard itself is cross-platform, only the attack fixture is withheld.
  it.skipIf(process.platform === "win32")(
    "rejects a symlinked state file instead of reading outside data",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "vibefield-crash-state-link-"));
      roots.push(root);
      const stateRoot = join(root, "crash");
      const outside = join(root, "outside.json");
      await writeFile(outside, '{"v":1,"artifacts":{}}');
      await mkdir(stateRoot, { recursive: true });
      await symlink(outside, join(stateRoot, "manifest-state.json"));
      const manager = new CrashArtifactManager({
        dataRoot: root,
        crashDumpsRoot: join(root, "dumps"),
        bootId: "desktop-link",
        appVersion: "1.0.0",
        logger: captureLogger([]),
      });
      await manager.initialize();
      expect((await lstat(join(stateRoot, "manifest-state.json"))).isFile()).toBe(true);
      expect(await readFile(outside, "utf8")).toBe('{"v":1,"artifacts":{}}');
      await manager.markClean();
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a symlinked crash root instead of scanning outside its authority",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "vibefield-crash-root-link-"));
      roots.push(root);
      const outside = join(root, "outside-dumps");
      const crashRoot = join(root, "dumps");
      await mkdir(outside);
      await writeFile(join(outside, "outside.dmp"), "outside");
      await symlink(outside, crashRoot);
      const manager = new CrashArtifactManager({
        dataRoot: root,
        crashDumpsRoot: crashRoot,
        bootId: "desktop-link",
        appVersion: "1.0.0",
        logger: captureLogger([]),
      });
      await expect(manager.initialize()).rejects.toThrow();
      expect(await readFile(join(outside, "outside.dmp"), "utf8")).toBe("outside");
    },
  );
});
