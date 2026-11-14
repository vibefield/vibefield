import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { type RegistryInstallConfig, RegistryInstallService } from "../src/plugin-install";
import { PluginRegistryService } from "../src/plugin-registry";
import { type CapturedLog, captureLogger } from "./drive-fakes";

// Item 329 — a plugin's download, and the plugin list's two fetches, are bounded: a cap counted as
// the body comes, and on http(s) two clocks. Every registry here is the test's own: the real
// example plugin packed into an index the test builds and signs with a key it makes, served over
// file:// or through an injected fetch whose bodies the test makes, in temp roots it removes. No
// network, no real data dir, no child.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
const HOST = "https://registry.test/";
const STOPPED = "fieldd.plugin_install.download_stopped";

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type Keys = ReturnType<typeof generateRegistryKeypair>;

interface Registry {
  dir: string;
  keys: Keys;
  artifact: Buffer;
  pin: string;
}

/** The test's own registry: the example plugin, listed as VibeField's (R1), so no community gate
 * stands in front of its download. */
async function registry(): Promise<Registry> {
  const dir = temp("vf-download-registry-");
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  const built = buildFixtureRegistry({
    dir,
    secretKey: keys.secretKey,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
  });
  return { dir, keys, artifact: bytes, pin: built.index.plugins[KV_ID]!.latest.sha256 };
}

/** A body the test makes, read as a stream with no read ahead. `next` answers each pull with a
 * chunk, or null to end; a promise that never settles is a host that stops sending. `seen` says
 * how many bytes it gave, how often it was pulled, and whether it was cancelled. */
function body(next: (given: number) => Uint8Array | null | Promise<Uint8Array | null>) {
  const seen = { given: 0, pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        seen.pulls += 1;
        const chunk = await next(seen.given);
        if (seen.cancelled) return;
        if (chunk === null) {
          controller.close();
          return;
        }
        seen.given += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}

const never = () => new Promise<never>(() => undefined);

/** The test's own host: the list and its signature from the registry's folder, the download from
 * `download`. `asked` is every URL asked for, in order. */
function host(reg: Registry, download: () => Response) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(url);
    const path = url.slice(HOST.length);
    if (path.startsWith("artifacts/")) return download();
    return new Response(new Uint8Array(readFileSync(join(reg.dir, path))));
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

async function installerFor(
  reg: Registry,
  opts: {
    logs: CapturedLog[];
    registryUrl?: string;
    fetchImpl?: typeof fetch;
    fetchTimeoutMs?: number;
    fetchBounds?: RegistryInstallConfig["fetchBounds"];
  },
) {
  const dataDir = temp("vf-download-data-");
  const installedRoot = join(dataDir, "plugins", "installed");
  mkdirSync(installedRoot, { recursive: true });
  const plugins = new PluginRegistryService({
    dataDir,
    roots: { bundled: [], devLinked: [], installed: [installedRoot] },
  });
  cleanup.push(() => plugins.dispose());
  await plugins.refresh();
  const installer = new RegistryInstallService({
    dataDir,
    plugins,
    registryUrl: opts.registryUrl ?? `${HOST}index.json`,
    registryPublicKey: reg.keys.publicKey,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: opts.fetchTimeoutMs } : {}),
    ...(opts.fetchBounds !== undefined ? { fetchBounds: opts.fetchBounds } : {}),
    logger: captureLogger(opts.logs),
  });
  return { installer, installedRoot };
}

const stops = (logs: CapturedLog[]) => logs.filter((l) => l.event === STOPPED).map((l) => l.attrs);

// The texts name no inside: Settings → Plugins' update row shows them as they are.
const TOO_LARGE = {
  kind: "PRECONDITION_FAILED",
  message: "the plugin's download is larger than VibeField takes — discarded",
  details: { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
};
const UNREACHABLE = {
  kind: "UNAVAILABLE",
  message: "the plugin's download took too long — stopped",
  retryable: true,
  details: { pluginKind: "PLUGIN_SOURCE_UNAVAILABLE" },
};

describe("a plugin's download is bounded (item 329)", () => {
  it("refuses a body past its cap while it is read, before the hash", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const chunk = new Uint8Array(64 * 1024);
    const endless = body(() => chunk);
    const { fetchImpl } = host(reg, () => new Response(endless.stream));
    const cap = 256 * 1024;
    const { installer, installedRoot } = await installerFor(reg, {
      logs,
      fetchImpl,
      fetchBounds: { artifactMaxBytes: cap },
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject(TOO_LARGE);
    // an endless body: the read stopped one chunk past the cap, and the body was cancelled
    expect(endless.seen.given).toBeLessThanOrEqual(cap + chunk.byteLength);
    expect(endless.seen.cancelled).toBe(true);
    expect(stops(logs)).toEqual([{ pluginId: KV_ID, reason: "size" }]);
    // no hash was taken of it, and nothing was staged
    expect(logs.some((l) => l.event === "fieldd.plugin_install.artifact_mismatch")).toBe(false);
    expect(existsSync(join(installedRoot, KV_ID))).toBe(false);
  });

  it("refuses a declared length past its cap before a byte of the body is read", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const unread = body(() => new Uint8Array(1024));
    // a response as a host sends it, its length declared in its headers
    const declared = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(1024 * 1024) }),
      body: unread.stream,
    } as unknown as Response;
    const { fetchImpl } = host(reg, () => declared);
    const { installer } = await installerFor(reg, {
      logs,
      fetchImpl,
      fetchBounds: { artifactMaxBytes: 1024 },
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject(TOO_LARGE);
    expect([unread.seen.pulls, unread.seen.cancelled]).toEqual([0, true]);
    expect(stops(logs)).toEqual([{ pluginId: KV_ID, reason: "size" }]);
  });

  it("stops a download that stops sending after the stall, as unreachable", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const stalled = body((given) => (given === 0 ? new Uint8Array(1024) : never()));
    const { fetchImpl } = host(reg, () => new Response(stalled.stream));
    const { installer, installedRoot } = await installerFor(reg, {
      logs,
      fetchImpl,
      fetchTimeoutMs: 200,
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject(UNREACHABLE);
    expect([stalled.seen.given, stalled.seen.cancelled]).toEqual([1024, true]);
    expect(stops(logs)).toEqual([{ pluginId: KV_ID, reason: "time" }]);
    expect(existsSync(join(installedRoot, KV_ID))).toBe(false);
  });

  it("stops a download that trickles on past its deadline, as unreachable", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    // a byte every 10 ms: never a stall, never an end
    const aByteLater = () =>
      new Promise<Uint8Array>((resolve) => setTimeout(() => resolve(new Uint8Array(1)), 10));
    const trickle = body(aByteLater);
    const { fetchImpl } = host(reg, () => new Response(trickle.stream));
    const { installer } = await installerFor(reg, {
      logs,
      fetchImpl,
      fetchTimeoutMs: 2_000,
      fetchBounds: { artifactDeadlineMs: 150 },
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject(UNREACHABLE);
    expect(trickle.seen.given).toBeGreaterThan(0);
    expect(trickle.seen.cancelled).toBe(true);
    expect(stops(logs)).toEqual([{ pluginId: KV_ID, reason: "time" }]);
  });

  it("refuses a download past its cap on the file road, unread", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    expect(reg.artifact.byteLength).toBeGreaterThan(1024);
    const { installer, installedRoot } = await installerFor(reg, {
      logs,
      registryUrl: pathToFileURL(join(reg.dir, "index.json")).href,
      fetchBounds: { artifactMaxBytes: 1024 },
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject(TOO_LARGE);
    expect(stops(logs)).toEqual([{ pluginId: KV_ID, reason: "size" }]);
    expect(existsSync(join(installedRoot, KV_ID))).toBe(false);
  });

  it("installs as before within its bounds, the body read whole across its chunks", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    // the real artifact in 100-byte chunks, with no length declared
    const next = (given: number) =>
      given < reg.artifact.byteLength
        ? new Uint8Array(reg.artifact.subarray(given, given + 100))
        : null;
    const whole = body(next);
    const { fetchImpl } = host(reg, () => new Response(whole.stream));
    const { installer } = await installerFor(reg, { logs, fetchImpl });
    const candidate = await installer.prepare({ id: KV_ID });
    expect(candidate.artifact.artifactSha256).toBe(reg.pin);
    expect([whole.seen.given, whole.seen.cancelled]).toEqual([reg.artifact.byteLength, false]);
    expect(stops(logs)).toEqual([]);
    expect(await installer.discard(candidate)).toBe(true);
  });
});

describe("the plugin list's fetch is capped (item 329)", () => {
  it("refuses a list past its cap by its reason, and fetches nothing past it", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { fetchImpl, asked } = host(reg, () => {
      throw new Error("the download is never asked for");
    });
    const { installer } = await installerFor(reg, {
      logs,
      fetchImpl,
      fetchBounds: { indexMaxBytes: 64 },
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: "the plugin list is larger than VibeField reads — refused",
    });
    expect(asked).toEqual([`${HOST}index.json`]);
    const refused = logs.filter((l) => l.event === "fieldd.plugin_install.index_refused");
    expect(refused.map((l) => l.attrs)).toEqual([{ reason: "size" }]);
  });
});
