import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LAYOUT, type RegistryIndex, SOCKETS } from "@vibefield/contracts";
import { generateRegistryKeypair, signRegistryIndex } from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src";
import { PluginCatalogService } from "../src/plugin-catalog";
import { RegistryInstallService } from "../src/plugin-install";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type CapturedLog, captureLogger } from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// MK-2b — the catalog door's service (MK-D5; MK-2's custody note §1 G3, §6 L1/L2, and its rollback addendum). Every
// registry here is the test's own: an index it writes and signs with a key it makes, read over file:// or through an
// injected fetch, in temp roots it removes. No network, no real data dir, no child.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const KEYS = generateRegistryKeypair();
const OTHER_KEYS = generateRegistryKeypair();
const SHA = `sha256:${"a".repeat(64)}`;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function release(version: string, minContracts = "0.1.0") {
  return {
    version,
    artifactUrl: `artifacts/${version}.vfplugin`,
    sha256: SHA,
    minApp: "0.9.0",
    minContracts,
    publishedAt: 1,
  };
}

function index(generatedAt: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt,
    featured: ["vibefield.simulator", "acme.gone"],
    plugins: {
      "vibefield.simulator": {
        id: "vibefield.simulator",
        repo: "https://example.test/simulator",
        rung: "R1",
        latest: release("1.2.0"),
        history: [],
        listing: { title: "Simulators", objects: [] },
      },
      "acme.burndown": {
        id: "acme.burndown",
        repo: "https://example.test/burndown",
        latest: release("0.7.0", "9.0.0"),
        history: [],
      },
    },
    ...extra,
  };
}

/** Writes a registry the test owns: the index's exact bytes and their signature, by `keys`. */
function publish(dir: string, body: Record<string, unknown>, keys = KEYS): Buffer {
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.sig"), signRegistryIndex(bytes, keys.secretKey));
  return bytes;
}

interface Made {
  catalog: PluginCatalogService;
  logs: CapturedLog[];
}

function make(opts: {
  dataDir: string;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
  fetchTimeoutMs?: number;
  installed?: Array<{ id: string; version: string; source: string }>;
  now?: () => number;
  rename?: typeof rename;
  /** MK-2e: the phase's budget and the two caps, the tests' seams */
  pictures?: { budgetMs?: number; fileMaxBytes?: number; cacheMaxBytes?: number };
}): Made {
  const logs: CapturedLog[] = [];
  const logger = captureLogger(logs);
  const plugins = {
    list: () => opts.installed ?? [],
    get: () => undefined,
    refresh: async () => {},
  };
  const installer = new RegistryInstallService({
    dataDir: opts.dataDir,
    plugins: plugins as never,
    ...(opts.registryUrl !== undefined
      ? { registryUrl: opts.registryUrl, registryPublicKey: KEYS.publicKey }
      : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: opts.fetchTimeoutMs } : {}),
    logger,
  });
  const catalog = new PluginCatalogService({
    dataDir: opts.dataDir,
    installer,
    plugins: plugins as never,
    logger,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.rename !== undefined ? { rename: opts.rename } : {}),
    ...(opts.pictures !== undefined ? { pictures: opts.pictures } : {}),
  });
  return { catalog, logs };
}

const urlOf = (dir: string) => pathToFileURL(join(dir, "index.json")).href;
const heldDir = (dataDir: string) => join(dataDir, "plugins", "catalog");
const heldPath = (dataDir: string) => join(heldDir(dataDir), "held.json");

/** The held file as the test reads it: its raw bytes, its fields, and the index's bytes decoded. */
function readHeldFile(dataDir: string) {
  const raw = readFileSync(heldPath(dataDir));
  const fields = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  return { raw, fields, bytes: Buffer.from(String(fields.index), "base64") };
}

/** Writes the test's own held file, in its own temp root. */
function writeHeldFile(dataDir: string, body: Record<string, unknown> | string): void {
  mkdirSync(heldDir(dataDir), { recursive: true });
  writeFileSync(heldPath(dataDir), typeof body === "string" ? body : JSON.stringify(body));
}

const refusedEvents = (logs: CapturedLog[]) =>
  logs.filter((l) => l.event.endsWith(".index_refused"));

describe("the plugin list fieldd holds (MK-2b)", () => {
  it("says unconfigured when no build configures a registry, and reads nothing", async () => {
    const { catalog } = make({ dataDir: tempDir("vf-catalog-") });
    expect(await catalog.get()).toEqual({
      state: "unconfigured",
      checkedAt: null,
      plugins: [],
      featured: [],
      updates: 0,
    });
    expect((await catalog.refresh()).state).toBe("unconfigured");
  });

  it("is unread until the first read, then ready with its time, from the signed entries", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    const { catalog } = make({
      dataDir,
      registryUrl: urlOf(registry),
      now: () => 5000,
      installed: [{ id: "vibefield.simulator", version: "1.0.0", source: "registry" }],
    });
    expect((await catalog.get()).state).toBe("unread");
    const read = await catalog.refresh();
    expect(read.state).toBe("ready");
    expect(read.checkedAt).toBe(5000);
    expect(read.plugins.map((p) => [p.id, p.listedAs, p.compatible])).toEqual([
      ["vibefield.simulator", "vibefield", true],
      ["acme.burndown", "community", false],
    ]);
    expect(read.plugins[0]?.listing?.title).toBe("Simulators");
    // the pick keeps only ids the list names
    expect(read.featured).toEqual(["vibefield.simulator"]);
    // an installed registry plugin with a newer compatible release
    expect(read.updates).toBe(1);
    expect(await catalog.get()).toEqual(read);
  });

  it("holds the list across a restart, its time from held.json and everything else from the signed bytes", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    await make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 }).catalog.refresh();
    // the test's own held file says other things too; of the unsigned values only its time is read
    const { fields } = readHeldFile(dataDir);
    writeHeldFile(dataDir, { ...fields, checkedAt: 6000, generatedAt: 1, plugins: {} });
    const again = make({ dataDir, registryUrl: urlOf(registry) }).catalog;
    const held = await again.get();
    expect([held.state, held.checkedAt, held.plugins.length]).toEqual(["ready", 6000, 2]);
    // a time that is not a safe non-negative integer reads as none
    writeHeldFile(dataDir, { ...fields, checkedAt: -1 });
    expect((await again.get()).checkedAt).toBe(null);
  });

  it("offline, the held list stands with its time (unreachable)", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    await make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 }).catalog.refresh();
    const offline = make({ dataDir, registryUrl: urlOf(join(registry, "missing")) }).catalog;
    const read = await offline.refresh();
    expect([read.state, read.checkedAt, read.plugins.length]).toEqual(["unreachable", 5000, 2]);
  });

  it("a list that does not verify is refused, nothing new shown, the held list stays (L2)", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    await make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 }).catalog.refresh();
    publish(registry, index(2000, { featured: [] }), OTHER_KEYS);
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    const read = await catalog.refresh();
    expect([read.state, read.checkedAt]).toEqual(["refused", 5000]);
    expect(read.featured).toEqual(["vibefield.simulator"]);
    expect(logs.filter((l) => l.event === "fieldd.plugin_install.index_refused")).toEqual([
      { event: "fieldd.plugin_install.index_refused", attrs: { reason: "signature" } },
    ]);
  });

  it("refuses a signed list older than the one held (rollback), and lets an equal one through", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(2000));
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 });
    await catalog.refresh();
    publish(registry, index(1000, { featured: [] }));
    const older = await catalog.refresh();
    expect([older.state, older.featured]).toEqual(["refused", ["vibefield.simulator"]]);
    expect(logs.filter((l) => l.event === "fieldd.plugin_catalog.index_refused")).toEqual([
      {
        event: "fieldd.plugin_catalog.index_refused",
        attrs: { reason: "rollback", heldGeneratedAt: 2000, generatedAt: 1000 },
      },
    ]);
    publish(registry, index(2000, { featured: [] }));
    const equal = await catalog.refresh();
    expect([equal.state, equal.featured]).toEqual(["ready", []]);
  });

  it("a held list that fails re-verify shows nothing and is left as it is; the next read replaces it", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const first = publish(registry, index(1000));
    await make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 }).catalog.refresh();
    expect(readHeldFile(dataDir).bytes.equals(first)).toBe(true);
    // the test's own held file, its index changed under the same signature, in its own temp root
    const changed = Buffer.from(JSON.stringify(index(1000, { featured: [] })), "utf8");
    writeHeldFile(dataDir, { ...readHeldFile(dataDir).fields, index: changed.toString("base64") });
    const before = readHeldFile(dataDir).raw;
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry), now: () => 7000 });
    expect(await catalog.get()).toEqual({
      state: "refused",
      checkedAt: null,
      plugins: [],
      featured: [],
      updates: 0,
    });
    await catalog.get();
    expect(readHeldFile(dataDir).raw.equals(before)).toBe(true);
    expect(logs.filter((l) => l.event === "fieldd.plugin_catalog.index_refused")).toEqual([
      { event: "fieldd.plugin_catalog.index_refused", attrs: { reason: "held-signature" } },
    ]);
    // re-verify alone runs on a get, and the installer says nothing for it
    expect(logs.filter((l) => l.event === "fieldd.plugin_install.index_refused").length).toBe(0);
    expect(await catalog.listedAsFor("vibefield.simulator")).toBe("community");
    const read = await catalog.refresh();
    expect([read.state, read.checkedAt]).toEqual(["ready", 7000]);
    expect(readHeldFile(dataDir).bytes.equals(first)).toBe(true);
  });

  it("a held list that verifies and that this build cannot parse is said once per signature, not per get", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    // the test's own held file in its own temp root, signed by its own key: bytes that verify and fail the schema
    const bytes = Buffer.from(
      JSON.stringify({ schemaVersion: 1, generatedAt: -1, plugins: {} }),
      "utf8",
    );
    writeHeldFile(dataDir, {
      signature: signRegistryIndex(bytes, KEYS.secretKey),
      checkedAt: 1,
      index: bytes.toString("base64"),
    });
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.get()).state).toBe("refused");
    expect((await catalog.get()).state).toBe("refused");
    const said = (event: string) => logs.filter((l) => l.event === event);
    expect(said("fieldd.plugin_catalog.index_refused").length).toBe(1);
    expect(said("fieldd.plugin_catalog.index_refused")[0]?.attrs).toEqual({
      reason: "held-schema",
    });
    expect(said("fieldd.plugin_install.index_refused").length).toBe(1);
  });

  it("an unusable held file shows nothing and is said once per file; no file is no list", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.get()).state).toBe("unread");
    const bytes = Buffer.from(JSON.stringify(index(1000)), "utf8");
    const signature = signRegistryIndex(bytes, KEYS.secretKey);
    // the test's own held files, one after another, in its own temp root
    const unusable = [
      "not json",
      { checkedAt: 1, index: bytes.toString("base64") },
      { signature, checkedAt: 1, index: 7 },
      { signature, checkedAt: 1, index: "not base64!" },
    ];
    for (const body of unusable) {
      writeHeldFile(dataDir, body);
      expect(await catalog.get()).toEqual({
        state: "refused",
        checkedAt: null,
        plugins: [],
        featured: [],
        updates: 0,
      });
      expect((await catalog.get()).state).toBe("refused");
      expect(await catalog.listedAsFor("vibefield.simulator")).toBe("community");
    }
    const lines = refusedEvents(logs);
    expect(lines.length).toBe(unusable.length);
    expect(lines.every((l) => l.attrs?.reason === "held-unreadable")).toBe(true);
  });

  it("reads one at a time: a second refresh joins the first, and get says reading meanwhile", async () => {
    const dataDir = tempDir("vf-catalog-");
    const body = Buffer.from(JSON.stringify(index(1000)), "utf8");
    const files: Record<string, Buffer> = {
      "https://registry.test/index.json": body,
      "https://registry.test/index.json.sig": Buffer.from(signRegistryIndex(body, KEYS.secretKey)),
    };
    let calls = 0;
    let open!: () => void;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fetchImpl = (async (url: string) => {
      calls += 1;
      await held;
      return new Response(new Uint8Array(files[url]!));
    }) as unknown as typeof fetch;
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl,
    });
    const one = catalog.refresh();
    const two = catalog.refresh();
    expect(two).toBe(one);
    expect((await catalog.get()).state).toBe("reading");
    open();
    expect((await one).state).toBe("ready");
    expect(calls).toBe(2);
    expect((await catalog.get()).state).toBe("ready");
  });

  it("a host that never answers is offline after the timeout, and leaves nothing running", async () => {
    const dataDir = tempDir("vf-catalog-");
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl,
      fetchTimeoutMs: 50,
    });
    const read = await catalog.refresh();
    expect([read.state, read.checkedAt]).toEqual(["unreachable", null]);
  });

  it("logs a dropped listing, rung or pick once per list, by id and field, never the value (L1)", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const body = index(1000, { featured: "simulator" });
    const plugins = body.plugins as Record<string, Record<string, unknown>>;
    plugins["acme.burndown"]!.listing = { title: "" };
    plugins["acme.burndown"]!.rung = "R9";
    publish(registry, body);
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    await catalog.refresh();
    await catalog.get();
    const dropped = logs.filter((l) => l.event === "fieldd.plugin_install.listing_dropped");
    expect(dropped.map((l) => l.attrs)).toEqual([
      { pluginId: "acme.burndown", field: "rung" },
      { pluginId: "acme.burndown", field: "listing" },
      { field: "featured" },
    ]);
    expect(JSON.stringify(dropped).includes("R9")).toBe(false);
  });

  it("answers G3's read from the held list: the signed rung, and community for an id it does not name", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    const { catalog } = make({ dataDir, registryUrl: urlOf(registry) });
    expect(await catalog.listedAsFor("vibefield.simulator")).toBe("community");
    await catalog.refresh();
    expect(await catalog.listedAsFor("vibefield.simulator")).toBe("vibefield");
    expect(await catalog.listedAsFor("acme.burndown")).toBe("community");
    expect(await catalog.listedAsFor("acme.unlisted")).toBe("community");
  });

  it("keeps one file in its own folder under the data dir, the exact bytes and their signature", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const bytes = publish(registry, index(1000));
    await make({ dataDir, registryUrl: urlOf(registry), now: () => 5000 }).catalog.refresh();
    expect(readdirSync(heldDir(dataDir))).toEqual(["held.json"]);
    expect(statSync(heldPath(dataDir)).mode & 0o777).toBe(0o600);
    const held = readHeldFile(dataDir);
    expect(Object.keys(held.fields).sort()).toEqual(["checkedAt", "index", "signature"]);
    expect(held.fields.checkedAt).toBe(5000);
    expect(held.bytes.equals(bytes)).toBe(true);
    expect(held.fields.signature).toBe(
      readFileSync(join(registry, "index.json.sig"), "utf8").trim(),
    );
    const typed = JSON.parse(held.bytes.toString("utf8")) as RegistryIndex;
    expect(typed.generatedAt).toBe(1000);
  });

  it("a read during a refresh's write sees the old list whole, then the new one, and nothing is refused", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    let gate: Promise<void> | null = null;
    let open = () => {};
    let renaming = () => {};
    const renamed = new Promise<void>((resolve) => {
      renaming = resolve;
    });
    const gatedRename: typeof rename = async (from, to) => {
      if (gate !== null) {
        renaming();
        await gate;
      }
      return rename(from, to);
    };
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry), rename: gatedRename });
    await catalog.refresh();
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    publish(registry, index(2000, { featured: [] }));
    const refresh = catalog.refresh();
    // the gate opens in the test's own path below, and in its cleanup, which waits for the refresh before the temp
    // roots go, so a red leaves nothing pending
    cleanup.push(async () => {
      open();
      await refresh.catch(() => undefined);
    });
    await renamed;
    const during = await catalog.get();
    expect([during.state, during.featured]).toEqual(["reading", ["vibefield.simulator"]]);
    expect(await catalog.listedAsFor("vibefield.simulator")).toBe("vibefield");
    open();
    expect((await refresh).state).toBe("ready");
    const after = await catalog.get();
    expect([after.state, after.featured]).toEqual(["ready", []]);
    expect(await catalog.listedAsFor("vibefield.simulator")).toBe("vibefield");
    expect(refusedEvents(logs).length).toBe(0);
  });
});

describe("the catalog doors (MK-2b)", () => {
  it("get answers at once; refresh is the read, audited with its state and count only", async () => {
    const dataDir = tempDir("vf-catalog-door-");
    const registry = tempDir("vf-registry-");
    publish(registry, index(1000));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await native.start();
    cleanup.push(() => native.stop());
    const registryUrl = urlOf(registry);
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      registryUrl,
      registryPublicKey: KEYS.publicKey,
    });
    cleanup.push(() => daemon.stop());
    const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => socket.close());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const shell = new WsRpc(socket);
    await helloAs(shell, daemon.shellToken, "shell-main");
    expect(await shell.call("plugins.catalog.get", {})).toMatchObject({ state: "unread" });
    const read = (await shell.call("plugins.catalog.refresh", {})) as { state: string };
    expect(read.state).toBe("ready");
    expect(await shell.call("plugins.catalog.get", {})).toMatchObject({ state: "ready" });
    const ledger = () => {
      const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
      if (!existsSync(dir)) return [] as Array<Record<string, unknown>>;
      return readdirSync(dir)
        .filter((f) => f.startsWith("plugins.") && f.endsWith(".jsonl"))
        .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((l) => l.action === "plugin.catalog.refresh");
    };
    await until(() => ledger().some((l) => l.phase === "outcome"));
    const lines = ledger();
    expect(lines.map((l) => l.phase)).toEqual(["attempt", "outcome"]);
    expect(lines[1]?.attrs).toEqual({ state: "ready", count: 2 });
    const written = JSON.stringify(lines);
    expect(written.includes(registry)).toBe(false);
    expect(written.includes(KEYS.publicKey)).toBe(false);
  });
});

// MK-2e (2026-11-11; MK-E9, B1; `lanes/mk/mk2e/PLAN.md` v3) — the pictures the held list pins, kept in fieldd's folder.
// Every picture here is the test's own: bytes it makes, beside an index it signs with its own key, in its own temp
// root (file://), or served by an injected fetch for `https://registry.test`. No network, no real data dir, no child.
describe("the pictures the held list pins (MK-2e)", () => {
  const hexOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const pinned = (path: string, bytes: Buffer) => ({ path, sha256: `sha256:${hexOf(bytes)}` });
  const picturesDir = (dataDir: string) => join(heldDir(dataDir), "pictures");
  const refusals = (logs: CapturedLog[]) =>
    logs.filter((l) => l.event === "fieldd.plugin_catalog.picture_refused").map((l) => l.attrs);
  const prunes = (logs: CapturedLog[]) =>
    logs.filter((l) => l.event === "fieldd.plugin_catalog.pictures_pruned").map((l) => l.attrs);

  /** The test's index with the simulator's listing given, and any other entry's listing beside it. */
  function listed(
    generatedAt: number,
    listing: Record<string, unknown>,
    others: Record<string, Record<string, unknown>> = {},
  ): Record<string, unknown> {
    const body = index(generatedAt);
    const plugins = body.plugins as Record<string, Record<string, unknown>>;
    plugins["vibefield.simulator"]!.listing = { title: "Simulators", ...listing };
    for (const [id, extra] of Object.entries(others))
      plugins[id]!.listing = { title: "Burndown", ...extra };
    return body;
  }

  /** Picture files the test writes beside its own index. */
  function place(registry: string, files: Record<string, Buffer>): void {
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(join(registry, path, ".."), { recursive: true });
      writeFileSync(join(registry, path), bytes);
    }
  }

  /** An https registry the test serves through an injected fetch; `asked` is every URL fetched, in order. */
  function served(body: Record<string, unknown>, files: Record<string, Buffer>) {
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    const table: Record<string, Buffer> = {
      "https://registry.test/index.json": bytes,
      "https://registry.test/index.json.sig": Buffer.from(signRegistryIndex(bytes, KEYS.secretKey)),
    };
    for (const [path, file] of Object.entries(files)) table[`https://registry.test/${path}`] = file;
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      const file = table[url];
      return file === undefined
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array(file));
    }) as unknown as typeof fetch;
    const pictures = () => asked.filter((u) => !u.includes("/index.json"));
    return { fetchImpl, asked, pictures };
  }

  it("keeps each pinned picture under its pin's hex, the same bytes, mode 0o600, one file per pin", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const icon = randomBytes(40);
    const day = randomBytes(50);
    const night = randomBytes(60);
    const still = randomBytes(70);
    place(registry, {
      "pictures/icon.png": icon,
      "pictures/day.png": day,
      "pictures/night.png": night,
      "pictures/still.png": still,
    });
    publish(
      registry,
      listed(1000, {
        icon: pinned("pictures/icon.png", icon),
        spread: {
          day: pinned("pictures/day.png", day),
          night: pinned("pictures/night.png", night),
        },
        objects: [
          {
            type: "phone",
            label: "Phone",
            category: "devices",
            stills: {
              day: pinned("pictures/still.png", still),
              night: pinned("pictures/still.png", still),
            },
          },
        ],
      }),
    );
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.refresh()).state).toBe("ready");
    const all = [icon, day, night, still];
    expect(readdirSync(picturesDir(dataDir)).sort()).toEqual(all.map(hexOf).sort());
    for (const bytes of all) {
      const file = join(picturesDir(dataDir), hexOf(bytes));
      expect(readFileSync(file).equals(bytes)).toBe(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(refusals(logs)).toEqual([]);
    expect(prunes(logs)).toEqual([]);
  });

  it("keeps no bytes that miss their pin, and says so once by id, field and reason; the list stays ready", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const promised = randomBytes(32);
    place(registry, { "pictures/icon.png": randomBytes(32) });
    publish(registry, listed(1000, { icon: pinned("pictures/icon.png", promised) }));
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.refresh()).state).toBe("ready");
    expect((await catalog.refresh()).state).toBe("ready");
    expect(readdirSync(picturesDir(dataDir))).toEqual([]);
    expect(refusals(logs)).toEqual([
      { pluginId: "vibefield.simulator", field: "icon", reason: "pin" },
    ]);
  });

  it("refuses a file past the cap while reading (size), says a missing one unreachable, keeps the rest", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const big = randomBytes(65);
    const fits = randomBytes(64);
    place(registry, { "pictures/big.png": big, "pictures/fits.png": fits });
    publish(
      registry,
      listed(1000, {
        icon: pinned("pictures/big.png", big),
        spread: {
          day: pinned("pictures/gone.png", randomBytes(8)),
          night: pinned("pictures/fits.png", fits),
        },
      }),
    );
    const { catalog, logs } = make({
      dataDir,
      registryUrl: urlOf(registry),
      pictures: { fileMaxBytes: 64 },
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(readdirSync(picturesDir(dataDir))).toEqual([hexOf(fits)]);
    const said = refusals(logs);
    expect(said).toHaveLength(2);
    expect(said).toEqual(
      expect.arrayContaining([
        { pluginId: "vibefield.simulator", field: "icon", reason: "size" },
        { pluginId: "vibefield.simulator", field: "spread.day", reason: "unreachable" },
      ]),
    );
  });

  it("refuses an https picture past the cap while it streams", async () => {
    const dataDir = tempDir("vf-catalog-");
    const big = randomBytes(65);
    const registry = served(listed(1000, { icon: pinned("pictures/big.png", big) }), {
      "pictures/big.png": big,
    });
    const { catalog, logs } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
      pictures: { fileMaxBytes: 64 },
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toEqual(["https://registry.test/pictures/big.png"]);
    expect(readdirSync(picturesDir(dataDir))).toEqual([]);
    expect(refusals(logs)).toEqual([
      { pluginId: "vibefield.simulator", field: "icon", reason: "size" },
    ]);
  });

  it("makes no fetch that could pass the folder's cap, and says the first one once (total)", async () => {
    const dataDir = tempDir("vf-catalog-");
    const files = [randomBytes(10), randomBytes(11), randomBytes(12), randomBytes(13)];
    const registry = served(
      listed(1000, {
        icon: pinned("pictures/0.png", files[0]!),
        spread: {
          day: pinned("pictures/1.png", files[1]!),
          night: pinned("pictures/2.png", files[2]!),
        },
        objects: [
          {
            type: "phone",
            label: "Phone",
            category: "devices",
            stills: {
              day: pinned("pictures/3.png", files[3]!),
              night: pinned("pictures/3.png", files[3]!),
            },
          },
        ],
      }),
      Object.fromEntries(files.map((bytes, i) => [`pictures/${i}.png`, bytes])),
    );
    // 100 bytes held back per fetch in flight against a cap of 250: two fetches fit, the third would pass it
    const { catalog, logs } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
      pictures: { fileMaxBytes: 100, cacheMaxBytes: 250 },
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toEqual([
      "https://registry.test/pictures/0.png",
      "https://registry.test/pictures/1.png",
    ]);
    expect(readdirSync(picturesDir(dataDir)).sort()).toEqual(
      [files[0]!, files[1]!].map(hexOf).sort(),
    );
    expect(refusals(logs)).toEqual([
      { pluginId: "vibefield.simulator", field: "spread.night", reason: "total" },
    ]);
  });

  it("fetches one pin once, whichever entries name it", async () => {
    const dataDir = tempDir("vf-catalog-");
    const same = randomBytes(24);
    const registry = served(
      listed(
        1000,
        { icon: pinned("pictures/simulator.png", same) },
        { "acme.burndown": { icon: pinned("pictures/burndown.png", same) } },
      ),
      { "pictures/simulator.png": same, "pictures/burndown.png": same },
    );
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toEqual(["https://registry.test/pictures/simulator.png"]);
    expect(readdirSync(picturesDir(dataDir))).toEqual([hexOf(same)]);
  });

  it("keeps an https index's scheme, and an encoded dot never becomes a segment", async () => {
    const dataDir = tempDir("vf-catalog-");
    const icon = randomBytes(24);
    const registry = served(listed(1000, { icon: pinned("a/%2e%2e/icon.png", icon) }), {
      "a/%252e%252e/icon.png": icon,
    });
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toEqual(["https://registry.test/a/%252e%252e/icon.png"]);
    expect(readFileSync(join(picturesDir(dataDir), hexOf(icon))).equals(icon)).toBe(true);
  });

  it("on a file index, an encoded dot is a name: the picture beside it is read, never the one above", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const icon = randomBytes(24);
    // the bytes an escape would reach, one folder up from `a/`, are not the pinned ones
    place(registry, { "a/%2e%2e/icon.png": icon, "icon.png": randomBytes(24) });
    publish(registry, listed(1000, { icon: pinned("a/%2e%2e/icon.png", icon) }));
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(readFileSync(join(picturesDir(dataDir), hexOf(icon))).equals(icon)).toBe(true);
    expect(refusals(logs)).toEqual([]);
  });

  it("a refused, a rolled-back and an unreachable read fetch nothing and prune nothing", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const icon = randomBytes(24);
    place(registry, { "pictures/icon.png": icon });
    publish(registry, listed(1000, { icon: pinned("pictures/icon.png", icon) }));
    const first = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await first.catalog.refresh()).state).toBe("ready");
    // a file the list does not pin: any phase would prune it
    const stale = join(picturesDir(dataDir), hexOf(randomBytes(8)));
    writeFileSync(stale, randomBytes(8));
    const before = readdirSync(picturesDir(dataDir)).sort();
    const reads: Array<[string, Made]> = [];
    // refused: the same list signed by another key
    const refusedAt = tempDir("vf-registry-");
    place(refusedAt, { "pictures/icon.png": icon });
    publish(
      refusedAt,
      listed(3000, { icon: pinned("pictures/icon.png", randomBytes(24)) }),
      OTHER_KEYS,
    );
    reads.push(["refused", make({ dataDir, registryUrl: urlOf(refusedAt) })]);
    // rolled back: a list older than the one held
    const olderAt = tempDir("vf-registry-");
    place(olderAt, { "pictures/icon.png": icon });
    publish(olderAt, listed(500, { icon: pinned("pictures/icon.png", randomBytes(24)) }));
    reads.push(["refused", make({ dataDir, registryUrl: urlOf(olderAt) })]);
    // unreachable: no index at the place named
    reads.push(["unreachable", make({ dataDir, registryUrl: urlOf(join(registry, "nowhere")) })]);
    for (const [state, made] of reads) {
      expect((await made.catalog.refresh()).state).toBe(state);
      expect(readdirSync(picturesDir(dataDir)).sort()).toEqual(before);
      expect(prunes(made.logs)).toEqual([]);
      expect(refusals(made.logs)).toEqual([]);
    }
    expect(existsSync(stale)).toBe(true);
  });

  it("fetches again a cached file that no longer matches, and one past the cap without reading it", async () => {
    const dataDir = tempDir("vf-catalog-");
    const icon = randomBytes(24);
    const day = randomBytes(24);
    const registry = served(
      listed(1000, {
        icon: pinned("pictures/icon.png", icon),
        spread: { day: pinned("pictures/day.png", day), night: pinned("pictures/icon.png", icon) },
      }),
      { "pictures/icon.png": icon, "pictures/day.png": day },
    );
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
      pictures: { fileMaxBytes: 64 },
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toHaveLength(2);
    // one changed under the same size, one grown past the cap
    writeFileSync(join(picturesDir(dataDir), hexOf(icon)), randomBytes(24));
    writeFileSync(join(picturesDir(dataDir), hexOf(day)), randomBytes(65));
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toHaveLength(4);
    expect(readFileSync(join(picturesDir(dataDir), hexOf(icon))).equals(icon)).toBe(true);
    expect(readFileSync(join(picturesDir(dataDir), hexOf(day))).equals(day)).toBe(true);
    // a third read finds both matching and fetches nothing
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toHaveLength(4);
  });

  it("never follows or removes what is not a regular file under a pin's name", async () => {
    const dataDir = tempDir("vf-catalog-");
    const linked = randomBytes(24);
    const walled = randomBytes(24);
    const registry = served(
      listed(1000, {
        icon: pinned("pictures/linked.png", linked),
        spread: {
          day: pinned("pictures/walled.png", walled),
          night: pinned("pictures/linked.png", linked),
        },
      }),
      { "pictures/linked.png": linked, "pictures/walled.png": walled },
    );
    const dir = picturesDir(dataDir);
    mkdirSync(dir, { recursive: true });
    // made in the test's own root, pointing only inside it
    const target = join(dataDir, "target.bin");
    const kept = randomBytes(24);
    writeFileSync(target, kept);
    symlinkSync(target, join(dir, hexOf(linked)));
    mkdirSync(join(dir, hexOf(walled)));
    const unpinnedLink = join(dir, hexOf(randomBytes(8)));
    symlinkSync(target, unpinnedLink);
    const unpinnedDir = join(dir, hexOf(randomBytes(8)));
    mkdirSync(unpinnedDir);
    const { catalog, logs } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
    });
    expect((await catalog.refresh()).state).toBe("ready");
    // the link read as absent: fetched, and the rename replaced the link, never its target
    expect(lstatSync(join(dir, hexOf(linked))).isFile()).toBe(true);
    expect(readFileSync(join(dir, hexOf(linked))).equals(linked)).toBe(true);
    expect(readFileSync(target).equals(kept)).toBe(true);
    // the directory stays, its pin refused, its temp file gone
    expect(lstatSync(join(dir, hexOf(walled))).isDirectory()).toBe(true);
    expect(refusals(logs)).toEqual([
      { pluginId: "vibefield.simulator", field: "spread.day", reason: "cache" },
    ]);
    expect(readdirSync(dir).some((name) => name.includes(".tmp-"))).toBe(false);
    // neither unpinned one was pruned
    expect(lstatSync(unpinnedLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(unpinnedDir).isDirectory()).toBe(true);
    expect(prunes(logs)).toEqual([]);
  });

  it("refuses a pictures folder that is not a directory, and fetches nothing", async () => {
    const dataDir = tempDir("vf-catalog-");
    const icon = randomBytes(24);
    const registry = served(listed(1000, { icon: pinned("pictures/icon.png", icon) }), {
      "pictures/icon.png": icon,
    });
    mkdirSync(heldDir(dataDir), { recursive: true });
    writeFileSync(picturesDir(dataDir), "not a folder");
    const { catalog, logs } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl: registry.fetchImpl,
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(registry.pictures()).toEqual([]);
    expect(refusals(logs)).toEqual([{ field: "pictures", reason: "cache" }]);
    expect(readFileSync(picturesDir(dataDir), "utf8")).toBe("not a folder");
  });

  it("prunes, before it fetches, the pinned-name files a newer list drops, and says a count", async () => {
    const dataDir = tempDir("vf-catalog-");
    const registry = tempDir("vf-registry-");
    const kept = randomBytes(24);
    const dropped = randomBytes(24);
    place(registry, { "pictures/kept.png": kept, "pictures/dropped.png": dropped });
    publish(
      registry,
      listed(1000, {
        icon: pinned("pictures/kept.png", kept),
        spread: {
          day: pinned("pictures/dropped.png", dropped),
          night: pinned("pictures/kept.png", kept),
        },
      }),
    );
    const { catalog, logs } = make({ dataDir, registryUrl: urlOf(registry) });
    expect((await catalog.refresh()).state).toBe("ready");
    const dir = picturesDir(dataDir);
    writeFileSync(join(dir, "notes.txt"), "the folder's other names stay");
    writeFileSync(join(dir, hexOf(randomBytes(8)).toUpperCase()), "not lowercase hex");
    publish(registry, listed(2000, { icon: pinned("pictures/kept.png", kept) }));
    expect((await catalog.refresh()).state).toBe("ready");
    expect(existsSync(join(dir, hexOf(kept)))).toBe(true);
    expect(existsSync(join(dir, hexOf(dropped)))).toBe(false);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(readdirSync(dir)).toHaveLength(3);
    expect(prunes(logs)).toEqual([{ count: 1 }]);
  });

  it("ends the phase at its budget, unsaid, and the refresh answers ready", async () => {
    const dataDir = tempDir("vf-catalog-");
    const body = Buffer.from(
      JSON.stringify(listed(1000, { icon: pinned("pictures/icon.png", randomBytes(24)) })),
      "utf8",
    );
    const files: Record<string, Buffer> = {
      "https://registry.test/index.json": body,
      "https://registry.test/index.json.sig": Buffer.from(signRegistryIndex(body, KEYS.secretKey)),
    };
    let asked = 0;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      const file = files[url];
      if (file !== undefined) return Promise.resolve(new Response(new Uint8Array(file)));
      asked += 1;
      // a picture host that never answers: it ends only when its signal does
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const { catalog, logs } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl,
      pictures: { budgetMs: 50 },
    });
    expect((await catalog.refresh()).state).toBe("ready");
    expect(asked).toBe(1);
    expect(readdirSync(picturesDir(dataDir))).toEqual([]);
    expect(refusals(logs)).toEqual([]);
  });

  it("says reading while the phase runs, and ready once it ends", async () => {
    const dataDir = tempDir("vf-catalog-");
    const icon = randomBytes(24);
    const body = Buffer.from(
      JSON.stringify(listed(1000, { icon: pinned("pictures/icon.png", icon) })),
      "utf8",
    );
    const files: Record<string, Buffer> = {
      "https://registry.test/index.json": body,
      "https://registry.test/index.json.sig": Buffer.from(signRegistryIndex(body, KEYS.secretKey)),
    };
    let open!: () => void;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    let pictureAsked = false;
    const fetchImpl = (async (url: string) => {
      const file = files[url];
      if (file !== undefined) return new Response(new Uint8Array(file));
      pictureAsked = true;
      await held;
      return new Response(new Uint8Array(icon));
    }) as unknown as typeof fetch;
    const { catalog } = make({
      dataDir,
      registryUrl: "https://registry.test/index.json",
      fetchImpl,
    });
    const read = catalog.refresh();
    cleanup.push(async () => {
      open();
      await read.catch(() => undefined);
    });
    await until(() => pictureAsked);
    expect((await catalog.get()).state).toBe("reading");
    open();
    expect((await read).state).toBe("ready");
    expect((await catalog.get()).state).toBe("ready");
    expect(readFileSync(join(picturesDir(dataDir), hexOf(icon))).equals(icon)).toBe(true);
  });
});
