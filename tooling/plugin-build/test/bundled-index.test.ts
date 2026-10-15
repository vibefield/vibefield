import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBundledIndex, verifyBundledIndex } from "../src/bundled-index";
import { canonicalJson } from "../src/canonical";
import { generateRegistryKeypair, signRegistryIndex } from "../src/registry-sign";
import { signersOf, verifySignedBytes, verifyTrustRoot } from "../src/trust";

// WP8a (build-wp8-bundled-plugins.md §4–§5, W2): the six refusals the ONE verifier owes, each named in its words —
// round trip · a flipped byte · an extra file · a missing file · a forged signature · a wrong platform — plus the
// trust-root step fieldd runs first (TD-2). Every key here is minted for the test and dropped with it.

const manifest = (id: string) => ({
  manifestVersion: 1,
  id,
  version: "0.1.0",
  title: "Demo",
  engines: { app: "^0.1.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onObject:${id}`],
  capabilities: ["doc.write"],
  contributes: {
    objects: [
      {
        type: id,
        title: "Demo",
        schemaVersion: 1,
        size: { w: 100, h: 100 },
        props: { label: { kind: "string", maxLength: 40 } },
        groups: { label: ["label"] },
        binding: { kind: "demo" },
      },
    ],
  },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vf-bundled-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writePlugin(name: string, id: string): string {
  const root = join(dir, "src", name);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "vibefield.plugin.json"), `${JSON.stringify(manifest(id), null, 2)}\n`);
  writeFileSync(join(root, "dist", "renderer.js"), `export default "${id}";\n`);
  writeFileSync(join(root, "dist", "renderer.css"), ".demo { color: red }\n");
  writeFileSync(join(root, "package.json"), "{}\n"); // never staged: not a §5.2 member
  return root;
}

async function stage(platform = "any") {
  const key = generateRegistryKeypair();
  const stageRoot = join(dir, "plugins", "bundled");
  const result = await buildBundledIndex({
    stageRoot,
    plugins: [
      { rootDir: writePlugin("a", "com.example.alpha") },
      { rootDir: writePlugin("b", "com.example.beta") },
    ],
    appVersion: "0.9.0",
    platform,
    secretKey: key.secretKey,
    now: 1_760_000_000_000,
  });
  return { key, stageRoot, result, trust: { keys: [key.publicKey], threshold: 1 } };
}

describe("buildBundledIndex + verifyBundledIndex (WP8a)", () => {
  it("round trip: stages the §5.2 members only, signs canonical bytes, and every plugin verifies", async () => {
    const { stageRoot, result, trust } = await stage();
    const entry = result.index.plugins["com.example.alpha"];
    expect(Object.keys(entry?.files ?? {})).toEqual([
      "dist/renderer.css",
      "dist/renderer.js",
      "vibefield.plugin.json",
    ]);
    expect(readFileSync(join(stageRoot, BUNDLED_PLUGIN_INDEX_FILE), "utf8")).toBe(
      canonicalJson(result.index),
    );
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect([...verdict.plugins.values()].map((p) => p.ok)).toEqual([true, true]);
    expect(verdict.unlisted).toEqual([]);
  });

  it("a flipped byte refuses THAT plugin, naming the file; the other still verifies", async () => {
    const { stageRoot, trust } = await stage();
    const js = join(stageRoot, "com.example.alpha", "dist", "renderer.js");
    const bytes = readFileSync(js);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(js, bytes);
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    if (!verdict.ok) throw new Error(verdict.reason);
    const alpha = verdict.plugins.get("com.example.alpha");
    expect(alpha?.ok === false && alpha.reason).toBe(
      "dist/renderer.js does not match the bundled index",
    );
    expect(verdict.plugins.get("com.example.beta")?.ok).toBe(true);
  });

  it("an extra file refuses the plugin — a staged tree is exactly its index", async () => {
    const { stageRoot, trust } = await stage();
    writeFileSync(join(stageRoot, "com.example.beta", "dist", "payload.js"), "steal()\n");
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    if (!verdict.ok) throw new Error(verdict.reason);
    const beta = verdict.plugins.get("com.example.beta");
    expect(beta?.ok === false && beta.reason).toBe("dist/payload.js is not in the bundled index");
  });

  it("a missing file refuses the plugin, and a missing directory too", async () => {
    const { stageRoot, trust } = await stage();
    rmSync(join(stageRoot, "com.example.alpha", "dist", "renderer.css"));
    rmSync(join(stageRoot, "com.example.beta"), { recursive: true });
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    if (!verdict.ok) throw new Error(verdict.reason);
    const alpha = verdict.plugins.get("com.example.alpha");
    const beta = verdict.plugins.get("com.example.beta");
    expect(alpha?.ok === false && alpha.reason).toBe("dist/renderer.css is missing");
    expect(beta?.ok === false && beta.reason).toBe("com.example.beta's directory is missing");
  });

  it("a forged signature refuses the ROOT: an altered index re-signed by a key the app does not trust", async () => {
    const { stageRoot, trust } = await stage();
    const indexPath = join(stageRoot, BUNDLED_PLUGIN_INDEX_FILE);
    const forged = Buffer.from(readFileSync(indexPath, "utf8").replace("0.9.0", "0.9.1"));
    writeFileSync(indexPath, forged);
    const stranger = generateRegistryKeypair();
    writeFileSync(
      join(stageRoot, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE),
      `${signRegistryIndex(forged, stranger.secretKey)}\n`,
    );
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    expect(verdict.ok === false && verdict.reason).toBe(
      "the bundled index's signature does not verify against the app's bundled key",
    );
  });

  it("a root staged for another platform refuses the ROOT", async () => {
    const { stageRoot, trust } = await stage("win32-x64");
    const verdict = await verifyBundledIndex({ root: stageRoot, trust, platform: "darwin-arm64" });
    expect(verdict.ok === false && verdict.reason).toBe(
      "the bundled root was staged for win32-x64, not darwin-arm64",
    );
  });

  it("refuses a missing index, and ignores (never registers) a directory the index does not list", async () => {
    const { stageRoot, trust } = await stage();
    mkdirSync(join(stageRoot, "com.example.stray"));
    const verdict = await verifyBundledIndex({ root: stageRoot, trust });
    expect(verdict.ok && verdict.unlisted).toEqual(["com.example.stray"]);
    rmSync(join(stageRoot, BUNDLED_PLUGIN_INDEX_FILE));
    const gone = await verifyBundledIndex({ root: stageRoot, trust });
    expect(gone.ok === false && gone.reason).toBe(
      `${BUNDLED_PLUGIN_INDEX_FILE} is missing or unreadable`,
    );
  });

  it("refuses to stage over an existing plugin directory", async () => {
    const { stageRoot } = await stage();
    const key = generateRegistryKeypair();
    await expect(
      buildBundledIndex({
        stageRoot,
        plugins: [{ rootDir: join(dir, "src", "a") }],
        appVersion: "0.9.0",
        secretKey: key.secretKey,
      }),
    ).rejects.toThrow(/exists — a bundled root is staged fresh/);
  });
});

describe("the trust-root step (TD-2)", () => {
  const fixture = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "contracts",
      "fixtures",
      "trust-root.valid.json",
    ),
  );

  it("verifies a document signed by an anchor key, and refuses one signed by no anchor key", () => {
    const root = generateRegistryKeypair();
    const sig = `${signRegistryIndex(fixture, root.secretKey)}\n`;
    const ok = verifyTrustRoot(fixture, sig, { keys: [root.publicKey], threshold: 1 });
    expect(ok.ok && ok.signers).toEqual([root.publicKey]);
    const other = generateRegistryKeypair();
    const refused = verifyTrustRoot(fixture, sig, { keys: [other.publicKey], threshold: 1 });
    expect(refused.ok === false && refused.reason).toMatch(
      /signed by 0 of the app's root keys; 1 must/,
    );
  });

  it("counts a key once however many lines it signed, and a threshold of two needs two keys", () => {
    const a = generateRegistryKeypair();
    const b = generateRegistryKeypair();
    const sa = signRegistryIndex(fixture, a.secretKey);
    const twice = `${sa}\n${sa}\n`;
    expect(signersOf(fixture, twice, [a.publicKey, b.publicKey])).toEqual([a.publicKey]);
    const anchor = { keys: [a.publicKey, b.publicKey], threshold: 2 };
    expect(verifySignedBytes(fixture, twice, anchor)).toBe(false);
    expect(
      verifySignedBytes(fixture, `${sa}\n${signRegistryIndex(fixture, b.secretKey)}\n`, anchor),
    ).toBe(true);
  });

  it("refuses a malformed document before any signature", () => {
    const key = generateRegistryKeypair();
    const bytes = Buffer.from('{"schemaVersion":2}');
    const verdict = verifyTrustRoot(bytes, signRegistryIndex(bytes, key.secretKey), {
      keys: [key.publicKey],
      threshold: 1,
    });
    expect(verdict.ok === false && verdict.reason).toMatch(/malformed/);
  });
});
