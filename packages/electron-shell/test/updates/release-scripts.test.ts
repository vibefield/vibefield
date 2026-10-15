import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChannelHeads,
  ReleaseManifest,
  releasePlatformKey,
  UpdatePolicy,
  UpdatePolicySource,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { auditAppUpdate } from "../../../../scripts/audit-app-update.mjs";
import { asarFiles, auditAsar, readAsarHeader } from "../../../../scripts/audit-asar.mjs";
import { hashPlanes, mergeManifest, planeOf } from "../../../../scripts/release-manifest.mjs";
import { planRelease, ReleasePlanError } from "../../../../scripts/release-plan.mjs";
import { buildChannels, ReleaseSignError, signRelease } from "../../../../scripts/release-sign.mjs";
import { verifyReleaseDir } from "../../../../scripts/release-verify.mjs";
// The release workflow's scripts (WP12 L3a, build-wp12-updater.md D4–D8, D11), driven against THE CLIENT'S OWN CHAIN:
// what `release-sign` writes must be exactly what `verifyUpdateChain` accepts, and `release-verify` is that chain run
// over a directory. DEV keys minted per run; no secret leaves the test.
import * as keygen from "../../../../scripts/trust-keygen.mjs";

const NOW = Date.parse("2026-10-16T03:00:00Z");
const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const POLICIES = join(REPO, "apps/desktop/packaging/policy");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-release-"));
  dirs.push(dir);
  return dir;
}

/** A DEV trust-root (two root keys, a release key) written as the stage embeds it, plus the release secret. */
function devTrust() {
  const rootA = keygen.generateKeypair();
  const rootB = keygen.generateKeypair();
  const release = keygen.generateKeypair();
  const bundled = keygen.generateKeypair();
  const registry = keygen.generateKeypair();
  const doc = keygen.assembleTrustRoot({
    root: [rootA.publicKey, rootB.publicKey],
    release: [release.publicKey],
    bundled: [bundled.publicKey],
    registry: [registry.publicKey],
  });
  const bytes = Buffer.from(keygen.canonicalJson(doc));
  const dir = scratch();
  const path = join(dir, "trust-root.json");
  writeFileSync(path, bytes);
  writeFileSync(`${path}.sig`, keygen.signTrustRoot(bytes, "", rootA.secretKey));
  return {
    path,
    rootKeys: [rootA.publicKey, rootB.publicKey],
    release,
    stranger: keygen.generateKeypair(),
  };
}

function releaseDir(): string {
  const dir = scratch();
  writeFileSync(
    join(dir, "latest-mac.yml"),
    "version: 0.1.0-nightly.20261016\nfiles:\n  - url: VibeField-mac.zip\n    sha512: AAAA\n    size: 1\npath: VibeField-mac.zip\nsha512: AAAA\nreleaseDate: '2026-10-16T03:00:00.000Z'\n",
  );
  // a well-formed manifest naming this release: the client's chain reads it at step 6b (L3b-i, B3), so a stub refuses
  writeFileSync(
    join(dir, "release-manifest.json"),
    `${JSON.stringify(
      mergeManifest({
        version: "0.1.0-nightly.20261016",
        tag: "nightly-20261016",
        channel: "nightly",
        commit: "c".repeat(40),
        builds: {
          "mac-arm64": {
            shell: { digest: "1".repeat(64), files: 1 },
            fieldd: { digest: "2".repeat(64), files: 1 },
            "field-native": { digest: "3".repeat(64), files: 1, members: ["bin/field-native"] },
          },
        },
        previous: null,
      }),
      null,
      2,
    )}\n`,
  );
  return dir;
}

const sign = (over: Partial<Parameters<typeof signRelease>[0]> & { secret?: string }) =>
  signRelease({
    dir: over.dir ?? releaseDir(),
    tag: "nightly-20261016",
    channel: "nightly",
    run: 7,
    policies: POLICIES,
    trustRoot: over.trustRoot ?? "",
    now: NOW,
    ...over,
  });

describe("release-sign → release-verify: what the sign step writes, the client's chain accepts", () => {
  it("signs every policy, the heads, the feed and the manifest; the trust-root rides unchanged; the chain verifies", async () => {
    const trust = devTrust();
    const dir = releaseDir();
    const result = sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey });
    expect(result.unsigned).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(
      [
        "channels.json",
        "latest-mac.yml",
        "release-manifest.json",
        "trust-root.json",
        "update-policy.beta.json",
        "update-policy.nightly.json",
        "update-policy.stable.json",
      ]
        .flatMap((name) => [name, `${name}.sig`])
        .sort(),
    );
    expect(readFileSync(join(dir, "trust-root.json"))).toEqual(readFileSync(trust.path));
    // the written documents are the contracts' shapes
    for (const ch of ["nightly", "beta", "stable"])
      expect(
        UpdatePolicy.safeParse(
          JSON.parse(readFileSync(join(dir, `update-policy.${ch}.json`), "utf8")),
        ).success,
      ).toBe(true);
    const heads = ChannelHeads.parse(JSON.parse(readFileSync(join(dir, "channels.json"), "utf8")));
    expect(heads.heads).toEqual({ nightly: "nightly-20261016", beta: null, stable: null });
    const verified = await verifyReleaseDir({
      dir,
      tag: "nightly-20261016",
      channel: "nightly",
      rootKeys: trust.rootKeys,
      now: NOW + 1000,
    });
    expect(verified).toEqual({
      unsigned: false,
      verified: ["latest-mac.yml", "release-manifest.json"],
    });
  });

  it("a feed altered after signing is refused by the chain, naming its state", async () => {
    const trust = devTrust();
    const dir = releaseDir();
    sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey });
    writeFileSync(
      join(dir, "latest-mac.yml"),
      `${readFileSync(join(dir, "latest-mac.yml"), "utf8")}# tampered\n`,
    );
    await expect(
      verifyReleaseDir({
        dir,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: trust.rootKeys,
        now: NOW,
      }),
    ).rejects.toThrow(/feed-unverified/);
  });

  it("a release verified against ANOTHER root is refused at the trust-root", async () => {
    const trust = devTrust();
    const dir = releaseDir();
    sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey });
    await expect(
      verifyReleaseDir({
        dir,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: [keygen.generateKeypair().publicKey, keygen.generateKeypair().publicKey],
        now: NOW,
      }),
    ).rejects.toThrow(/trust-root-rejected/);
  });

  it("no secret, no metadata: every latest*.yml is removed, nothing update-visible is written, and verify says so", async () => {
    const trust = devTrust();
    const dir = releaseDir();
    const result = sign({ dir, trustRoot: trust.path, secret: "" });
    expect(result.unsigned).toBe(true);
    expect(readdirSync(dir)).toEqual(["release-manifest.json"]);
    await expect(
      verifyReleaseDir({
        dir,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: trust.rootKeys,
        now: NOW,
      }),
    ).resolves.toEqual({ unsigned: true, verified: [] });
  });

  it("refuses a secret that is not one of the trust-root's release keys, before writing anything", () => {
    const trust = devTrust();
    const dir = releaseDir();
    expect(() => sign({ dir, trustRoot: trust.path, secret: trust.stranger.secretKey })).toThrow(
      /not a release key/,
    );
    expect(readdirSync(dir).sort()).toEqual(["latest-mac.yml", "release-manifest.json"]);
  });

  it("D5: a changed policy body without a version bump is refused, as is a version below the published one", () => {
    const trust = devTrust();
    const previous = scratch();
    const published = {
      ...UpdatePolicySource.parse(JSON.parse(readFileSync(join(POLICIES, "stable.json"), "utf8"))),
      killSwitch: true, // the published body differs, at the committed version
      generatedAt: NOW - 1000,
      expires: "2026-12-01T00:00:00Z",
      trustRootVersion: 1,
    };
    writeFileSync(join(previous, "update-policy.stable.json"), JSON.stringify(published));
    const dir = releaseDir();
    expect(() =>
      sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey, previousDir: previous }),
    ).toThrow(/changed without a version bump/);
    expect(readdirSync(dir).sort()).toEqual(["latest-mac.yml", "release-manifest.json"]); // nothing written
    writeFileSync(
      join(previous, "update-policy.stable.json"),
      JSON.stringify({ ...published, killSwitch: false, version: 9 }),
    );
    expect(() =>
      sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey, previousDir: previous }),
    ).toThrow(ReleaseSignError);
  });

  it("D4: the previous release's heads are carried, this channel's head moves, and the version only rises", () => {
    const heads = buildChannels({
      tag: "v0.1.0-beta.2",
      channel: "beta",
      run: 3,
      previous: {
        version: 40,
        heads: { nightly: "nightly-20261015", beta: "v0.1.0-beta.1", stable: null },
      },
      now: NOW,
      trustRootVersion: 1,
    });
    expect(heads.heads).toEqual({
      nightly: "nightly-20261015",
      beta: "v0.1.0-beta.2",
      stable: null,
    });
    expect(heads.version).toBe(41);
    expect(() =>
      buildChannels({
        tag: "nightly-20261016",
        channel: "beta",
        run: 1,
        previous: null,
        now: NOW,
        trustRootVersion: 1,
      }),
    ).toThrow(/not a beta tag/);
  });

  it("the committed policy sources are UpdatePolicySource, one per channel, each naming its own channel", () => {
    for (const ch of ["nightly", "beta", "stable"]) {
      const source = UpdatePolicySource.parse(
        JSON.parse(readFileSync(join(POLICIES, `${ch}.json`), "utf8")),
      );
      expect(source.channel).toBe(ch);
    }
  });
});

describe("release-plan (D6, D7, D14)", () => {
  const base = { commit: "a".repeat(40), now: NOW, productVersion: "0.1.0" };

  it("a scheduled or dispatched run is a nightly: dated tag, stamped prerelease version, never latest", () => {
    for (const event of ["schedule", "workflow_dispatch"]) {
      expect(planRelease({ ...base, event, ref: "refs/heads/main" })).toMatchObject({
        channel: "nightly",
        tag: "nightly-20261016",
        version: "0.1.0-nightly.20261016",
        prerelease: true,
        makeLatest: false,
        skip: false,
      });
    }
  });

  it("a nightly is skipped when main is red or unchanged since the last nightly", () => {
    expect(planRelease({ ...base, event: "schedule", ref: "", mainGreen: false })).toMatchObject({
      skip: true,
      reason: expect.stringMatching(/red/),
    });
    expect(
      planRelease({ ...base, event: "schedule", ref: "", lastNightlyCommit: base.commit }),
    ).toMatchObject({ skip: true, reason: expect.stringMatching(/unchanged/) });
  });

  it("a second nightly in one UTC day is skipped: today's tag name is already used (D7)", () => {
    expect(
      planRelease({
        ...base,
        event: "workflow_dispatch",
        ref: "",
        lastNightlyTag: "nightly-20261016",
      }),
    ).toMatchObject({ skip: true, reason: expect.stringMatching(/today's nightly exists/) });
    expect(
      planRelease({
        ...base,
        event: "workflow_dispatch",
        ref: "",
        lastNightlyTag: "nightly-20261015",
      }),
    ).toMatchObject({ skip: false, tag: "nightly-20261016" });
  });

  it("a pushed beta tag is a prerelease; a stable tag is latest; both must be the committed version", () => {
    expect(planRelease({ ...base, event: "push", ref: "refs/tags/v0.1.0-beta.3" })).toMatchObject({
      channel: "beta",
      version: "0.1.0-beta.3",
      prerelease: true,
      makeLatest: false,
    });
    expect(planRelease({ ...base, event: "push", ref: "refs/tags/v0.1.0" })).toMatchObject({
      channel: "stable",
      version: "0.1.0",
      prerelease: false,
      makeLatest: true,
    });
    expect(() => planRelease({ ...base, event: "push", ref: "refs/tags/v0.2.0" })).toThrow(
      /commit-bumped/,
    );
    expect(() =>
      planRelease({ ...base, event: "push", ref: "refs/tags/nightly-20261016" }),
    ).toThrow(ReleasePlanError);
    expect(() => planRelease({ ...base, event: "pull_request", ref: "" })).toThrow(/schedule/);
  });
});

describe("release-manifest (D11): the planes are computed from bytes", () => {
  it("assigns each resources path to its plane", () => {
    expect(planeOf("bin/field-native")).toBe("field-native");
    expect(planeOf("bin/field-terminal-host")).toBe("field-native");
    expect(planeOf("bin/sidecar-slim.exe")).toBe("field-native");
    // L3b-i (B3): the floor execs `truffle-sidecar` from its own directory when `sidecar-slim` is absent (mesh.rs)
    expect(planeOf("bin/truffle-sidecar")).toBe("field-native");
    expect(planeOf("bin/fieldd")).toBe("fieldd");
    expect(planeOf("bin/rosettad")).toBe("fieldd");
    expect(planeOf("plugins/bundled/vibefield.browser/manifest.json")).toBe("fieldd");
    expect(planeOf("app.asar")).toBe("shell");
    expect(planeOf(null)).toBe("shell");
  });

  function fakeApp(nativeBytes: string): string {
    const app = join(scratch(), "VibeField.app");
    const res = join(app, "Contents", "Resources");
    mkdirSync(join(res, "bin"), { recursive: true });
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(app, "Contents", "MacOS", "VibeField"), "electron");
    writeFileSync(join(res, "app.asar"), "asar");
    writeFileSync(join(res, "bin", "fieldd"), "fieldd");
    writeFileSync(join(res, "bin", "field-native"), nativeBytes);
    return app;
  }

  it("a first release touches every plane; a byte change in the floor touches field-native alone", () => {
    const before = hashPlanes(fakeApp("native-1"));
    const first = mergeManifest({
      version: "0.1.0-nightly.20261015",
      tag: "nightly-20261015",
      channel: "nightly",
      commit: "b".repeat(40),
      builds: { "mac-arm64": before },
      previous: null,
    });
    expect(ReleaseManifest.parse(first).touched).toEqual(["shell", "fieldd", "field-native"]);
    const same = mergeManifest({
      ...first,
      tag: "nightly-20261016",
      builds: { "mac-arm64": hashPlanes(fakeApp("native-1")) },
      previous: first,
    });
    expect(same.touched).toEqual([]);
    const changed = mergeManifest({
      ...first,
      tag: "nightly-20261016",
      builds: { "mac-arm64": hashPlanes(fakeApp("native-2")) },
      previous: first,
    });
    expect(changed.touched).toEqual(["field-native"]);
    expect(changed.previous).toBe("nightly-20261015");
  });

  it("names the field-native plane's members, resources-relative — the client compares the set (B3)", () => {
    const planes = hashPlanes(fakeApp("native-1"));
    expect(planes["field-native"]).toMatchObject({ files: 1, members: ["bin/field-native"] });
    expect(planes.fieldd.members).toBeUndefined();
  });

  it("keys a build by the release workflow's platform key, the one the client computes", () => {
    expect(releasePlatformKey("darwin", "arm64")).toBe("mac-arm64");
    expect(releasePlatformKey("win32", "x64")).toBe("win-x64");
    expect(releasePlatformKey("linux", "x64")).toBe("linux-x64");
    const yml = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
    const platforms = [...yml.matchAll(/^ {10}- platform: ([a-z0-9-]+)$/gm)].map((m) => m[1]);
    expect(platforms).toEqual(["mac-arm64"]);
  });
});

describe("audit-asar (D12): every asar path is in the stage's app/ census, and none is node_modules", () => {
  /** A synthetic archive in Electron's layout: an 8-byte pickle naming the header pickle's size, then that pickle
   * (its payload size, the JSON's length, the JSON), then the bytes. */
  function writeAsar(path: string, files: Record<string, unknown>): void {
    const json = Buffer.from(JSON.stringify({ files }));
    const padded = Math.ceil(json.length / 4) * 4;
    const header = Buffer.alloc(8 + padded);
    header.writeUInt32LE(4 + padded, 0);
    header.writeUInt32LE(json.length, 4);
    json.copy(header, 8);
    const size = Buffer.alloc(8);
    size.writeUInt32LE(4, 0);
    size.writeUInt32LE(header.length, 4);
    writeFileSync(path, Buffer.concat([size, header]));
  }

  function rig(files: Record<string, unknown>, census: string[], unpacked: string[] = []) {
    const root = scratch();
    const resources = join(root, "VibeField.app", "Contents", "Resources");
    mkdirSync(resources, { recursive: true });
    writeAsar(join(resources, "app.asar"), files);
    for (const rel of unpacked) {
      mkdirSync(join(resources, "app.asar.unpacked", rel, ".."), { recursive: true });
      writeFileSync(join(resources, "app.asar.unpacked", rel), "x");
    }
    const stageApp = join(root, "stage", "app");
    for (const rel of census) {
      mkdirSync(join(stageApp, rel, ".."), { recursive: true });
      writeFileSync(join(stageApp, rel), "x");
    }
    return { app: join(root, "VibeField.app"), stageApp };
  }

  it("reads the archive's directory, packed and unpacked", () => {
    const { app } = rig(
      {
        "package.json": { size: 2, offset: "0" },
        shell: {
          files: { "main.cjs": { size: 3, offset: "2" }, "a.node": { size: 1, unpacked: true } },
        },
      },
      ["package.json"],
    );
    const header = readAsarHeader(join(app, "Contents", "Resources", "app.asar"));
    expect(asarFiles(header)).toEqual([
      { path: "package.json", unpacked: false },
      { path: "shell/main.cjs", unpacked: false },
      { path: "shell/a.node", unpacked: true },
    ]);
  });

  it("a clean app passes; a node_modules path and a path outside the census fail, named", () => {
    const clean = rig(
      { "package.json": { size: 2 }, shell: { files: { "main.cjs": { size: 3 } } } },
      ["package.json", "shell/main.cjs"],
    );
    expect(auditAsar(clean)).toEqual([]);
    const dirty = rig(
      {
        "package.json": { size: 2 },
        node_modules: {
          files: {
            "@vibecook": {
              files: { "truffle-sidecar-darwin-arm64": { files: { "sidecar-slim": { size: 9 } } } },
            },
          },
        },
        "stray.js": { size: 1 },
      },
      ["package.json"],
      ["node_modules/x/y.node"],
    );
    expect(auditAsar(dirty)).toEqual([
      "node_modules/@vibecook/truffle-sidecar-darwin-arm64/sidecar-slim: a node_modules path in the asar",
      "node_modules/x/y.node: a node_modules path in the asar",
      "stray.js: not in the stage's app/ census",
    ]);
  });
});

// The WORKFLOW LINT that runs in every verify (actionlint is the second one, by hand: `actionlint
// .github/workflows/*.yml`). release.yml is read as text — its jobs are its two-space keys under `jobs:` and its steps
// the `- ` items — and held to the PM's permissions table (2026-10-15 14:47Z): every secret in the ONE step that uses
// it, only the build and sign jobs in `release-signing`, only publish writing, every third-party action SHA-pinned.
describe("release.yml's shape — the permissions table, as a test", () => {
  const WORKFLOWS = join(REPO, ".github", "workflows");
  const yml = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");
  const jobsText = yml.slice(yml.indexOf("\njobs:\n") + 7);
  const jobs = new Map<string, string>();
  for (const block of jobsText.split(/\n(?= {2}[a-z][a-z-]*:\n)/)) {
    const name = /^ {2}([a-z][a-z-]*):/.exec(block)?.[1];
    if (name !== undefined) jobs.set(name, block);
  }
  const stepsOf = (job: string) =>
    (jobs.get(job) ?? "")
      .split(/\n(?= {6}- )/)
      .slice(1)
      .map((text) => ({ name: /name: ([^\n]+)/.exec(text)?.[1]?.trim() ?? "(unnamed)", text }));
  const permissionsOf = (job: string) => {
    const block =
      /\n {4}permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/.exec(jobs.get(job) ?? "")?.[1] ?? "";
    return Object.fromEntries(
      [...block.matchAll(/ {6}([a-z-]+): ([a-z]+)/g)].map((m) => [m[1], m[2]]),
    );
  };

  it("grants nothing at the top, and each job exactly its row", () => {
    expect(yml).toMatch(/\npermissions: \{\}\n/);
    expect([...jobs.keys()]).toEqual(["plan", "verify", "build", "sign", "converge", "publish"]);
    expect(permissionsOf("plan")).toEqual({ contents: "read", actions: "read" });
    for (const job of ["verify", "build", "sign", "converge"])
      expect(permissionsOf(job), job).toEqual({ contents: "read" });
    expect(permissionsOf("publish")).toEqual({ contents: "write" });
  });

  it("puts ONLY the build and sign jobs in release-signing", () => {
    for (const [job, text] of jobs)
      expect(/\n {4}environment: release-signing\n/.test(text), job).toBe(
        job === "build" || job === "sign",
      );
  });

  it("scopes every secret to the one step that uses it, never a job's or the workflow's env", () => {
    const where: Record<string, string[]> = {};
    for (const job of jobs.keys())
      for (const step of stepsOf(job))
        for (const m of step.text.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)) {
          const name = m[1]!;
          where[name] = [...(where[name] ?? []), `${job} › ${step.name}`];
        }
    expect(where).toEqual({
      VIBEFIELD_BUNDLED_INDEX_SECRET: [
        "build › Package, signed (J4 — the Apple credentials exist)",
        "build › Stage, release-keyed (TD-3 — the bundled index is signed here)",
      ],
      CSC_LINK: ["build › Package, signed (J4 — the Apple credentials exist)"],
      CSC_KEY_PASSWORD: ["build › Package, signed (J4 — the Apple credentials exist)"],
      APPLE_API_KEY_P8: ["build › Package, signed (J4 — the Apple credentials exist)"],
      APPLE_API_KEY_ID: ["build › Package, signed (J4 — the Apple credentials exist)"],
      APPLE_API_ISSUER: ["build › Package, signed (J4 — the Apple credentials exist)"],
      VIBEFIELD_RELEASE_SECRET: ["sign › Sign (TD-3, D8 — the release key, in this step alone)"],
    });
    // and every occurrence was inside a step (none at a job's or the workflow's level)
    expect((yml.match(/\$\{\{ secrets\./g) ?? []).length).toBe(
      Object.values(where).reduce((n, list) => n + list.length, 0),
    );
  });

  it("signs, then verifies with the client's chain, in the sign job; converge verifies again before publish", () => {
    const sign = stepsOf("sign").map((step) => step.name);
    expect(sign.indexOf("Verify with the client's own chain (D8)")).toBeGreaterThan(
      sign.indexOf("Sign (TD-3, D8 — the release key, in this step alone)"),
    );
    expect(stepsOf("converge").map((s) => s.name)).toContain(
      "Verify again, on the bytes about to be published (D8)",
    );
    expect(/needs: \[plan, converge\]/.test(jobs.get("publish") ?? "")).toBe(true);
  });

  it("pins every third-party action to a commit SHA, in every workflow and composite action", () => {
    const files = [
      ...readdirSync(WORKFLOWS).map((name) => join(WORKFLOWS, name)),
      ...readdirSync(join(REPO, ".github", "actions")).map((dir) =>
        join(REPO, ".github", "actions", dir, "action.yml"),
      ),
    ];
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = m[1]!;
        if (ref.startsWith("./")) continue;
        expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});

// WP12 L3b-ii (B8; W8 as corrected 2026-10-15) — the packaged app's update config, asserted on the release build's app:
// electron-builder writes it only for a dmg or zip target, so `package:dir` never carries it.
describe("audit-app-update (B8): app-update.yml present, provider github, no token", () => {
  function appWith(yml: string | null): string {
    const app = join(scratch(), "VibeField.app");
    const resources = join(app, "Contents", "Resources");
    mkdirSync(resources, { recursive: true });
    if (yml !== null) writeFileSync(join(resources, "app-update.yml"), yml);
    return app;
  }
  const GOOD =
    "owner: vibefield\nrepo: vibefield\nprovider: github\nreleaseType: draft\nupdaterCacheDirName: vibefield-updater\n";

  it("passes electron-builder's own shape", () => {
    expect(auditAppUpdate(appWith(GOOD))).toEqual([]);
  });

  it("names a missing file, another provider, a token, and a missing cache name", () => {
    expect(auditAppUpdate(appWith(null))).toEqual([
      "app-update.yml is missing (built for a dmg or zip target?)",
    ]);
    expect(auditAppUpdate(appWith(GOOD.replace("provider: github", "provider: generic")))).toEqual([
      "app-update.yml does not name provider: github",
    ]);
    expect(auditAppUpdate(appWith(`${GOOD}token: ghp_x\n`))).toEqual([
      "app-update.yml carries a token",
    ]);
    expect(auditAppUpdate(appWith(GOOD.replace(/updaterCacheDirName.*\n/, "")))).toEqual([
      "app-update.yml names no updaterCacheDirName",
    ]);
  });

  it("release.yml's build job runs it on the packaged app, before the asar audit", () => {
    const yml = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
    const step = yml.indexOf("node scripts/audit-app-update.mjs --app");
    expect(step).toBeGreaterThan(yml.indexOf("\n  build:\n"));
    expect(step).toBeLessThan(yml.indexOf("\n  sign:\n"));
    expect(step).toBeLessThan(yml.indexOf("node scripts/audit-asar.mjs"));
  });
});
