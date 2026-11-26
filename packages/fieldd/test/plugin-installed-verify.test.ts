import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAYOUT, type PluginRecord, type RegistryIndex, SOCKETS } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  canonicalJson,
  generateRegistryKeypair,
  packVfplugin,
  signRegistryIndex,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// Item 279's S3 (2026-11-19) — an installed plugin loads only as what its install verified, once a plugin list key is
// configured; and item 333 — a person's uninstall of a plugin parked in the install set takes its entry off.
//
// Every row boots the REAL daemon with the test's own plugin list: the real kv example packed with the real packer, in
// an index this file signs with a key it makes, read over file://, in temp roots it removes. The installer and the
// registry are the daemon's own, so the check is the one the daemon hands its registry. The revision's files are named
// here by hand (no import of what S3 adds), so the file runs on a tree without S3: there the four reds load what they
// should refuse.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
/** kv's own code: the one file the rows change (its manifest names it as the service) */
const KV_CODE = "service.js";

interface Lab {
  dataDir: string;
  listDir: string;
  keys: { publicKey: string; secretKey: string };
  index: RegistryIndex;
  boot(): Promise<FielddDaemon>;
}

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function lab(): Promise<Lab> {
  const listDir = temp("vf-s3-list-");
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  // VibeField's own rung, so the community gate holds nothing
  const built = buildFixtureRegistry({
    dir: listDir,
    secretKey: keys.secretKey,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
  });
  const dataDir = temp("vf-s3-data-");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return {
    dataDir,
    listDir,
    keys,
    index: built.index,
    boot: async () => {
      const daemon = await bootstrap({
        dataDir,
        controlPort: 0,
        registryUrl: pathToFileURL(join(listDir, "index.json")).href,
        registryPublicKey: keys.publicKey,
      });
      cleanup.push(() => daemon.stop());
      return daemon;
    },
  };
}

async function shellRpc(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

/** The installed plugin's folder, the slot its pointer selects, and that revision's folder. */
function installed(dataDir: string): { pluginDir: string; slot: string; revision: string } {
  const pluginDir = join(dataDir, ...LAYOUT.PLUGINS_INSTALLED_DIR, KV_ID);
  const pointer = JSON.parse(readFileSync(join(pluginDir, ".vf-current.json"), "utf8")) as {
    slot: string;
  };
  return { pluginDir, slot: pointer.slot, revision: join(pluginDir, "revisions", pointer.slot) };
}

/** A signed plugin list's bytes and signature under `secretKey`, as the fixture writes one. */
function signedList(index: RegistryIndex, secretKey: string): { bytes: Buffer; signature: string } {
  const bytes = Buffer.from(canonicalJson(index), "utf8");
  return { bytes, signature: signRegistryIndex(bytes, secretKey) };
}

/** The row's state and why, as Installed reads it. */
const shape = (row: PluginRecord | undefined) => [row?.state, row?.lastError?.kind];
const REFUSED = ["invalid", "PLUGIN_ARTIFACT_MISMATCH"];

/** Installs kv through the daemon's own door, and answers its row. */
async function install(daemon: FielddDaemon): Promise<PluginRecord> {
  const rpc = await shellRpc(daemon);
  await rpc.call("plugins.install", { id: KV_ID });
  const row = daemon.plugins.get(KV_ID);
  expect(row?.source).toBe("registry");
  return row as PluginRecord;
}

describe("an installed plugin loads only as what its install verified (item 279's S3)", () => {
  it("a byte changed in its code after the install is refused at the next boot, and Remove… stands", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const first = await l.boot();
    await install(first);
    await first.stop();
    const { revision } = installed(l.dataDir);
    const code = join(revision, KV_CODE);
    writeFileSync(code, `${readFileSync(code, "utf8")}\n// changed after the install\n`);

    const daemon = await l.boot();
    expect(shape(daemon.plugins.get(KV_ID))).toEqual(REFUSED);
    expect(daemon.plugins.get(KV_ID)?.title).toBe(KV_ID);
    // Remove… stands on it: the door takes it off, as for any plugin from the list
    const rpc = await shellRpc(daemon);
    await rpc.call("plugins.uninstall", { id: KV_ID });
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();
  });

  it("a file the artifact does not carry, put in its revision, is refused", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const daemon = await l.boot();
    await install(daemon);
    writeFileSync(join(installed(l.dataDir).revision, "extra.js"), "export const extra = 1;\n");
    await daemon.plugins.refresh();
    expect(shape(daemon.plugins.get(KV_ID))).toEqual(REFUSED);
  });

  it("a revision made by hand for a release no list signed is refused", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const daemon = await l.boot();
    await install(daemon);
    const { pluginDir, revision, slot } = installed(l.dataDir);
    // the genuine revision copied with its code changed, under a slot of its own, its marker and the pointer made to
    // agree with it, and the list kept beside the genuine one copied beside it
    const forged = "f".repeat(64);
    const forgedDir = join(pluginDir, "revisions", forged);
    cpSync(revision, forgedDir, { recursive: true });
    writeFileSync(join(forgedDir, KV_CODE), "export default function forged() {}\n");
    const pin = `sha256:${forged}`;
    writeFileSync(
      join(forgedDir, ".vf-artifact.json"),
      `${JSON.stringify({ version: 1, pluginId: KV_ID, slot: forged, artifactSha256: pin })}\n`,
    );
    for (const suffix of [".index.json", ".index.json.sig"]) {
      const kept = join(pluginDir, "revisions", `${slot}${suffix}`);
      if (existsSync(kept)) cpSync(kept, join(pluginDir, "revisions", `${forged}${suffix}`));
    }
    writeFileSync(
      join(pluginDir, ".vf-current.json"),
      `${JSON.stringify({ version: 2, pluginId: KV_ID, slot: forged, artifactSha256: pin, committedAt: 1, commitEpoch: 2 })}\n`,
    );
    await daemon.plugins.refresh();
    expect(shape(daemon.plugins.get(KV_ID))).toEqual(REFUSED);
  });

  it("a revision whose kept list, signed with the list key, names no such release is refused", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const daemon = await l.boot();
    await install(daemon);
    const { pluginDir, slot } = installed(l.dataDir);
    // a list the key signed, newer, that names kv at another release only
    const entry = l.index.plugins[KV_ID];
    if (entry === undefined) throw new Error("the fixture list lacks kv");
    const other = signedList(
      {
        ...l.index,
        generatedAt: l.index.generatedAt + 1,
        plugins: {
          [KV_ID]: {
            ...entry,
            latest: { ...entry.latest, version: "0.9.0", sha256: `sha256:${"0".repeat(64)}` },
            history: [],
          },
        },
      },
      l.keys.secretKey,
    );
    writeFileSync(join(pluginDir, "revisions", `${slot}.index.json`), other.bytes);
    writeFileSync(join(pluginDir, "revisions", `${slot}.index.json.sig`), other.signature);
    await daemon.plugins.refresh();
    expect(shape(daemon.plugins.get(KV_ID))).toEqual(REFUSED);
  });

  it("a genuine install loads across a restart, its provenance the pointer's own", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const first = await l.boot();
    await install(first);
    await first.stop();
    const daemon = await l.boot();
    const row = daemon.plugins.get(KV_ID);
    const { slot } = installed(l.dataDir);
    expect(row?.state).not.toBe("invalid");
    expect(row?.lastError).toBeUndefined();
    expect(row?.registry?.artifactSha256).toBe(`sha256:${slot}`);
    expect(row?.registry?.publisher).toBe("vibefield");
    expect(row?.installRevision).toBe(slot);
  });

  it("the same release installed again from a newer list reuses its revision and still loads", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const daemon = await l.boot();
    const before = await install(daemon);
    // An enabled plugin pressed again at its own release is an update with nothing to move: the update coordinator
    // answers CONFLICT "candidate is already current" (since 2026-08-17). A plugin that is off commits plainly, so it
    // is the road on which the same release is installed again (2026-11-24).
    await (await shellRpc(daemon)).call("plugins.disable", { id: KV_ID });
    // the list moves on, the release the same: item 322's compare of the folder in place still holds
    const newer = signedList(
      { ...l.index, generatedAt: l.index.generatedAt + 1 },
      l.keys.secretKey,
    );
    writeFileSync(join(l.listDir, "index.json"), newer.bytes);
    writeFileSync(join(l.listDir, "index.json.sig"), newer.signature);
    const again = await install(daemon);
    expect(again.installRevision).toBe(before.installRevision);
    // the list kept beside the revision is the newer one, so the load below is checked against it
    const { revision } = installed(l.dataDir);
    expect(readFileSync(`${revision}.index.json`)).toEqual(newer.bytes);
    await daemon.plugins.refresh();
    expect(daemon.plugins.get(KV_ID)?.state).not.toBe("invalid");
  });
});

describe("a person's uninstall of a plugin parked in the install set (item 333)", () => {
  it("takes the parked entry off and answers, though nothing of it is here", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const ABSENT = "vibefield.absent.plugin";
    const seed = new SettingsDocService({ dataDir: l.dataDir });
    // an entry the list does not carry: parked at every walk, never installed
    await seed.setInstallSetEntry(
      { pluginId: ABSENT, source: "registry", enabled: true, grants: [] },
      "another-desktop",
    );
    await seed.dispose();
    const daemon = await l.boot();
    const rpc = await shellRpc(daemon);
    expect(daemon.plugins.get(ABSENT)).toBeUndefined();
    const answer = await rpc
      .call("plugins.uninstall", { id: ABSENT })
      .catch((error: unknown) => error);
    expect(answer).toEqual({ ok: true });
    await daemon.stop();
    const after = new SettingsDocService({ dataDir: l.dataDir });
    cleanup.push(() => after.dispose());
    expect((await after.installSet())[ABSENT]).toBeUndefined();
  });

  it("still answers NOT_FOUND for a plugin neither here nor in the install set", {
    timeout: 60_000,
  }, async () => {
    const l = await lab();
    const daemon = await l.boot();
    const rpc = await shellRpc(daemon);
    const refused = await rpc.callErr("plugins.uninstall", { id: "vibefield.never.plugin" });
    expect(refused.data?.kind).toBe("NOT_FOUND");
  });
});
