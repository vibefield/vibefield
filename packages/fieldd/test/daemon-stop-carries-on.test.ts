import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { exitAfterStop } from "../src/daemon-stop";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// Item 486 — a failed service stop skipped the rest of the daemon's teardown. Each step of
// fieldd's stop now runs in its own try: a failed step is logged by its name and the next one
// runs, and the stop rejects at its END. Both run files go on every stop (unless superseded); a
// stop a shell asked for marks the record it kept as incomplete; and the process exits non-zero
// when its stop failed. The fault is the `stopFaultAt` seam, at the plugin services' step.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vf-stop-on-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

async function fixture(
  stopFaultAt?: "plugin-services",
): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = tempRoot();
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  cleanup.push(() => native.stop());
  // no files or transcript worker and no agent gateway (its node probe, its listener): a stop that
  // fails before them (the red) leaves no child behind. No rosettad (no `rosettadBin`) and no
  // floor respawn (no `nativeSpawner`) start without their config.
  // the log under the data dir (`logged` reads it): with no `logRoot` fieldd writes no log at all
  const daemon = await bootstrap({
    dataDir,
    logRoot: join(dataDir, "logs"),
    controlPort: 0,
    filesHost: false,
    transcriptHost: false,
    agentGateway: { enabled: false },
    ...(stopFaultAt === undefined ? {} : { stopFaultAt }),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { daemon, dataDir };
}

/** "open" when something answers on the port, "refused" when nothing does. */
function knock(port: number): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once("open", () => {
      socket.close();
      resolve("open");
    });
    socket.once("error", () => resolve("refused"));
  });
}

/** The log's records of one event, read after the stop closed the log. */
function logged(dataDir: string, event: string): Array<Record<string, unknown>> {
  const file = join(dataDir, "logs", "system", "fieldd.ndjson");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes(`"${event}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("item 486: fieldd's stop carries on past a failed step", () => {
  it("a failed step is logged by its name, every later step still runs, and the stop rejects at its end", async () => {
    const { daemon, dataDir } = await fixture("plugin-services");
    const port = daemon.controlPort;
    const tokenPath = join(dataDir, ...LAYOUT.SHELL_TOKEN);
    const productPath = join(dataDir, ...LAYOUT.PRODUCT_JSON);
    expect(existsSync(tokenPath) && existsSync(productPath)).toBe(true);

    const first = await daemon.stop().then(
      () => null,
      (error: unknown) => error,
    );
    expect(first, "the stop rejects").toBeInstanceOf(Error);
    expect(String(first)).toContain("plugin-services");
    // the run files go, the API is closed: the steps after the failed one ran
    expect(existsSync(tokenPath), "the token file").toBe(false);
    expect(existsSync(productPath), "the product record").toBe(false);
    expect(await knock(port)).toBe("refused");
    // the failed step is said by its name
    const failed = logged(dataDir, "fieldd.lifecycle.stop_step_failed");
    expect(JSON.stringify(failed)).toContain('"plugin-services"');
    // idempotent: a second stop answers the same rejection
    await expect(daemon.stop()).rejects.toBe(first);
  });

  it("a stop a shell asked for keeps its record marked incomplete, naming the first failed step", async () => {
    const { daemon, dataDir } = await fixture("plugin-services");
    let stopped: Promise<unknown> | undefined;
    daemon.onShutdownRequest(() => {
      stopped = daemon.stop().catch((error: unknown) => error);
    });
    const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => socket.close());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const shell = new WsRpc(socket);
    await helloAs(shell, daemon.shellToken, "shell-main");
    await shell.call("system.shell.attach", {});
    await shell.call("system.shutdown", { reason: "update" });
    await until(() => stopped !== undefined);
    expect(await stopped).toBeInstanceOf(Error);
    const kept = JSON.parse(readFileSync(join(dataDir, ...LAYOUT.SHELL_LAST_EXIT), "utf8"));
    expect(kept).toMatchObject({ planned: true, why: "update", incomplete: "plugin-services" });
    // the once-record (`LAYOUT.SHELL_EXIT`) is never this stop's to write: the mark is
    // the kept record's alone
    expect(existsSync(join(dataDir, ...LAYOUT.SHELL_EXIT))).toBe(false);
  });

  it("a stop no shell asked for leaves the record as it was, and a clean stop marks nothing", async () => {
    const faulted = await fixture("plugin-services");
    await expect(faulted.daemon.stop()).rejects.toBeInstanceOf(Error);
    expect(existsSync(join(faulted.dataDir, ...LAYOUT.SHELL_LAST_EXIT))).toBe(false);

    const clean = await fixture();
    await clean.daemon.stop();
    expect(existsSync(join(clean.dataDir, ...LAYOUT.SHELL_TOKEN))).toBe(false);
    expect(existsSync(join(clean.dataDir, ...LAYOUT.PRODUCT_JSON))).toBe(false);
    expect(logged(clean.dataDir, "fieldd.lifecycle.stop_step_failed")).toEqual([]);
    expect(logged(clean.dataDir, "fieldd.lifecycle.stopped")).toHaveLength(1);
  });
});

describe("item 486: bin.ts's exit after the stop", () => {
  it("exits 0 after a stop that finished, and non-zero after one that failed", async () => {
    const codes: number[] = [];
    const finished = () => Promise.resolve();
    const failed = () => Promise.reject(new Error("a step failed"));
    await exitAfterStop(finished, (code) => codes.push(code)).catch(() => undefined);
    await exitAfterStop(failed, (code) => codes.push(code)).catch(() => undefined);
    expect(codes).toEqual([0, 1]);
  });
});
