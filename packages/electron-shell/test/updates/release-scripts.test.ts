import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChannelHeads,
  IsoInstant,
  ReleaseManifest,
  ReleaseNotes,
  releasePlatformKey,
  UpdatePolicy,
  UpdatePolicySource,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Exec,
  finalizeDmg,
  isTransient,
  NotarizeDmgError,
  notaryCredentials,
  RETRIES,
  TEAM_ID,
} from "../../../../apps/desktop/packaging/notarize-dmg.mjs";
import { auditAppUpdate } from "../../../../scripts/audit-app-update.mjs";
import { asarFiles, auditAsar, readAsarHeader } from "../../../../scripts/audit-asar.mjs";
import {
  checkReleaseAssets,
  dmgOfFeed,
  feedEntries,
  ReleaseAssetsError,
  refreshFeedEntry,
  STABLE_DMG_ALIAS,
  stableDmgAlias,
} from "../../../../scripts/release-assets.mjs";
import { hashPlanes, mergeManifest, planeOf } from "../../../../scripts/release-manifest.mjs";
import {
  capLine,
  computeNotes,
  logNotes,
  type NotesCommit,
  noteLine,
  ReleaseNotesError,
  readCommits,
  writtenNotes,
} from "../../../../scripts/release-notes.mjs";
import { planRelease, ReleasePlanError, tagAction } from "../../../../scripts/release-plan.mjs";
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

/** A release directory as the build matrix leaves it; AU-6: `notes`, when given, ride in its manifest as Merge writes
 * them (before the sign step signs it). */
function releaseDir(notes?: unknown): string {
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
        ...(notes !== undefined ? { notes } : {}),
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

  it("signs and verifies a numbered nightly with the client's complete trust chain", async () => {
    const trust = devTrust();
    const dir = releaseDir();
    const tag = "nightly-20261016.1";
    for (const name of ["latest-mac.yml", "release-manifest.json"]) {
      const path = join(dir, name);
      writeFileSync(
        path,
        readFileSync(path, "utf8")
          .replaceAll("nightly.20261016", "nightly.20261016.1")
          .replaceAll("nightly-20261016", tag),
      );
    }
    sign({ dir, tag, trustRoot: trust.path, secret: trust.release.secretKey });
    expect(
      ChannelHeads.parse(JSON.parse(readFileSync(join(dir, "channels.json"), "utf8"))).heads
        .nightly,
    ).toBe(tag);
    await expect(
      verifyReleaseDir({ dir, tag, channel: "nightly", rootKeys: trust.rootKeys, now: NOW + 1000 }),
    ).resolves.toEqual({
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

  // AU-6 (AU-D10 A; LC-19): the notes ride INSIDE the manifest, under its one release signature (no file, signature or
  // key of their own). A client DROPS a block it cannot read (verify-chain's 6c, never a refusal), so the chain passes
  // each bad block below; the publish refuses it, so a notes tool bug fails the release before any client meets it.
  it("AU-6: notes ride under the manifest's one signature; release-verify parses them strictly and refuses a bad block", async () => {
    const trust = devTrust();
    const notes = {
      kind: "written",
      since: null,
      lines: ["Updates wait for you.", "Settings says what is in a release before you restart."],
    };
    const dir = releaseDir(notes);
    const result = sign({ dir, trustRoot: trust.path, secret: trust.release.secretKey });
    expect(result.signed).toContain("release-manifest.json");
    expect(readdirSync(dir).filter((name) => name.includes("notes"))).toEqual([]);
    const signed = ReleaseManifest.parse(
      JSON.parse(readFileSync(join(dir, "release-manifest.json"), "utf8")),
    );
    expect(ReleaseNotes.parse(signed.notes)).toEqual(notes);
    await expect(
      verifyReleaseDir({
        dir,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: trust.rootKeys,
        now: NOW + 1000,
      }),
    ).resolves.toEqual({ unsigned: false, verified: ["latest-mac.yml", "release-manifest.json"] });

    for (const bad of [
      { ...notes, lines: ["one line\u202Etwo"] }, // a bidi override
      { ...notes, lines: Array.from({ length: 9 }, (_, i) => `note ${i + 1}`) }, // nine lines
      { kind: "markdown", since: null, lines: ["**What's new**"] }, // markup (EDP §11.1)
    ]) {
      const badDir = releaseDir(bad);
      sign({ dir: badDir, trustRoot: trust.path, secret: trust.release.secretKey });
      await expect(
        verifyReleaseDir({
          dir: badDir,
          tag: "nightly-20261016",
          channel: "nightly",
          rootKeys: trust.rootKeys,
          now: NOW + 1000,
        }),
      ).rejects.toThrow(/release-manifest\.json: its notes are not ReleaseNotes/);
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

  it("a nightly is skipped when main is red or unchanged since the last PUBLISHED nightly", () => {
    expect(planRelease({ ...base, event: "schedule", ref: "", mainGreen: false })).toMatchObject({
      skip: true,
      reason: expect.stringMatching(/red/),
    });
    expect(
      planRelease({ ...base, event: "schedule", ref: "", lastPublishedNightlyCommit: base.commit }),
    ).toMatchObject({ skip: true, reason: expect.stringMatching(/unchanged/) });
  });

  it("a nightly tag with no release never makes main 'unchanged': only a published nightly does (2026-10-26)", () => {
    // the tag is made at plan time, so a red nightly leaves `nightly-<day>` at main's commit with no release;
    // tomorrow's run on that unchanged main is still the first PUBLISHED nightly of it
    expect(
      planRelease({
        ...base,
        event: "schedule",
        ref: "",
        lastNightlyTag: "nightly-20261015",
        lastPublishedNightlyCommit: "b".repeat(40),
      }),
    ).toMatchObject({ skip: false, tag: "nightly-20261016" });
  });

  it("the run's tag is made once, at the planned commit: absent → create; there → present (a re-run); elsewhere → refused", () => {
    const tag = "nightly-20261016";
    expect(tagAction({ tag, commit: base.commit, existing: null })).toBe("create");
    expect(tagAction({ tag, commit: base.commit, existing: base.commit })).toBe("present");
    expect(() => tagAction({ tag, commit: base.commit, existing: "c".repeat(40) })).toThrow(
      /nightly-20261016 already points at c{40}, not at this run's commit a{40}/,
    );
  });

  it("schedules stay daily; dispatches use the next unused revision on the same UTC day", () => {
    for (const lastNightlyTag of ["nightly-20261016", "nightly-20261016.1"]) {
      expect(planRelease({ ...base, event: "schedule", ref: "", lastNightlyTag })).toMatchObject({
        skip: true,
        reason: expect.stringMatching(/today's nightly exists/),
      });
    }
    for (const [lastNightlyTag, suffix] of [
      ["nightly-20261015.9", ""],
      ["nightly-20261016", ".1"],
      ["nightly-20261016.1", ".2"],
      ["nightly-20261016.9", ".10"],
    ] as const) {
      expect(
        planRelease({ ...base, event: "workflow_dispatch", ref: "", lastNightlyTag }),
      ).toMatchObject({
        skip: false,
        tag: `nightly-20261016${suffix}`,
        version: `0.1.0-nightly.20261016${suffix}`,
      });
    }
    expect(
      planRelease({
        ...base,
        event: "workflow_dispatch",
        ref: "",
        lastNightlyTag: "nightly-20261016",
        mainGreen: false,
      }).skip,
    ).toBe(true);
    expect(
      planRelease({
        ...base,
        event: "workflow_dispatch",
        ref: "",
        lastNightlyTag: "nightly-20261016",
        lastPublishedNightlyCommit: base.commit,
      }).skip,
    ).toBe(true);
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

  // AU-6 (LC-18; X8): the plan time is the build's. The stage steps write it into the identity as `builtAt`, which the
  // stager parses strictly (IsoInstant: UTC, no offset); a nightly's agrees with the day its tag names.
  it("carries builtAt, the plan time in UTC, in every plan (AU-6)", () => {
    const builtAt = "2026-10-16T03:00:00.000Z";
    const plans = [
      planRelease({ ...base, event: "schedule", ref: "" }),
      planRelease({ ...base, event: "workflow_dispatch", ref: "", mainGreen: false }),
      planRelease({ ...base, event: "push", ref: "refs/tags/v0.1.0-beta.3" }),
      planRelease({ ...base, event: "push", ref: "refs/tags/v0.1.0" }),
    ];
    for (const plan of plans) {
      expect(plan.builtAt, plan.tag).toBe(builtAt);
      expect(IsoInstant.safeParse(plan.builtAt).success, plan.tag).toBe(true);
    }
    expect(plans[1]?.skip).toBe(true);
    expect(plans[0]?.tag).toBe(`nightly-${builtAt.slice(0, 10).replace(/-/g, "")}`);
  });
});

describe("release-manifest (D11): the planes are computed from bytes", () => {
  it("assigns each resources path to its plane", () => {
    expect(planeOf("bin/field-native")).toBe("field-native");
    expect(planeOf("bin/field-terminal-host")).toBe("field-native");
    // F1: the freeway host, which the floor execs from its own directory (`config.rs` `freeway_binary()`)
    expect(planeOf("bin/field-freeway-host")).toBe("field-native");
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

// AU-6 (AU-D10 A; LC-19) — the notes the sign job computes and Merge writes into the manifest. The core is pure over
// commit records (newest first, as `git log --no-merges` lists them), so it is driven here without git.
describe("release-notes (AU-6)", () => {
  const since = { version: "0.1.0-nightly.20261027", tag: "nightly-20261027" };
  const previous = { ...since, commit: "d".repeat(40) };
  const c = (subject: string, releaseNote?: string): NotesCommit => ({
    subject,
    ...(releaseNote !== undefined ? { releaseNote } : {}),
  });
  const never = (): NotesCommit[] => {
    throw new Error("the log is read for the log form only");
  };

  it("one line per track prefix, newest first, at most four; the docs count in commits, never in product or a line", () => {
    const notes = logNotes({
      since,
      commits: [
        c('TS-4b: the approval line on the claims strip — "It waited 14m for you."'),
        c("docs: LANDED — TS-4b (`257af5f6f`): the approval line on the claims strip"),
        c("TS-4b: an older subject of the same track, never shown"),
        c("FN: a run's exit is published before its workspace cleanup (item 87)"),
        c("docs(au): the plan's lead calls"),
        c("QW1 attach: the agent-plane pages name the helper environment"),
        c('AO: the History pane says "last used" against the clock it is given (item 84)'),
        c("AU-5: install on quit — a person's quit installs a staged update"),
      ],
    });
    expect(notes).toEqual({
      kind: "log",
      since,
      commits: 8,
      product: 6,
      lines: [
        { track: "TS-4b", text: "the approval line on the claims strip" },
        { track: "FN", text: "a run's exit is published before its workspace cleanup (item 87)" },
        { track: "QW1 attach", text: "the agent-plane pages name the helper environment" },
        {
          track: "AO",
          text: 'the History pane says "last used" against the clock it is given (item 84)',
        },
      ],
    });
    expect(ReleaseNotes.parse(notes)).toEqual(notes);
    // a docs subject is the docs however it is cased or scoped; "documentation:" is a track like any other
    const counted = logNotes({
      since,
      commits: [c("Docs: x"), c("docs(roadmap): y"), c("documentation: z")],
    });
    expect([counted.commits, counted.product, counted.lines]).toEqual([
      3,
      1,
      [{ track: "documentation", text: "z" }],
    ]);
  });

  it("cuts a subject at its first dash; a Release-note: trailer gives the line its words, under the subject's track", () => {
    expect(noteLine(c("B2: the canvas is alive — every card draws"))).toEqual({
      track: "B2",
      text: "the canvas is alive",
    });
    expect(
      noteLine(
        c(
          "AU-6: the notes tool — release-notes.mjs, its pure core and its CLI",
          "Settings says what is in a release before you restart — and what is new after",
        ),
      ),
    ).toEqual({
      track: "AU-6",
      text: "Settings says what is in a release before you restart — and what is new after",
    });
    // no track: a prefix over 24 characters, a sentence's quote, or no prefix at all
    expect(noteLine(c("a prefix far longer than a track: the words"))).toEqual({
      text: "a prefix far longer than a track: the words",
    });
    expect(noteLine(c('Revert "AU-6: the notes tool"'))).toEqual({
      text: 'Revert "AU-6: the notes tool"',
    });
    expect(noteLine(c("a subject with no prefix"))).toEqual({ text: "a subject with no prefix" });
    // the docs give no line, and neither does a subject with nothing visible in it
    expect(noteLine(c("docs: LANDED — AU-6"))).toBeNull();
    expect(noteLine(c("\u200B\u200B"))).toBeNull();
    // the untracked count as one track
    const untracked = logNotes({ since, commits: [c("one thing"), c("another thing")] });
    expect(untracked.lines).toEqual([{ text: "one thing" }]);
  });

  it("strips control and format characters, and cuts a line at 200 characters on a word boundary", () => {
    expect(noteLine(c("FN: one\u202E line\twith\u200B controls"))).toEqual({
      track: "FN",
      text: "one line with controls",
    });
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    // the room ends exactly on a word, and mid-word (shifted by three characters)
    for (const long of [words, `ab ${words}`]) {
      const text = noteLine(c(`AU-6: ${long}`))?.text ?? "";
      expect(text.length).toBeLessThanOrEqual(200);
      expect(text.endsWith("…")).toBe(true);
      const kept = text.slice(0, -1);
      expect(long.startsWith(kept)).toBe(true);
      expect(long[kept.length]).toBe(" ");
    }
    // one word longer than the room is cut where it stands, never inside a surrogate pair
    expect(capLine("x".repeat(300))).toBe(`${"x".repeat(199)}…`);
    expect(capLine("\u{1F600}".repeat(150))).toBe(`${"\u{1F600}".repeat(99)}…`);
    expect(capLine("short")).toBe("short");
  });

  it("a stable refuses without its file; a beta uses its file, else the log; no previous release, no notes", () => {
    const read: string[] = [];
    const log = (from: string): NotesCommit[] => {
      read.push(from);
      return [c("AU-6: the notes tool — its pure core")];
    };
    // a nightly's first release unless a row says otherwise; `log` is read only where the row passes it
    const compute = (over: Partial<Parameters<typeof computeNotes>[0]>) =>
      computeNotes({
        channel: "nightly",
        version: "0.1.0-nightly.20261028",
        previous: null,
        written: null,
        log: never,
        ...over,
      });
    const file = "# 0.2.0\nUpdates wait for you.\n\nYour devices say which version they run.\n";
    const lines = ["Updates wait for you.", "Your devices say which version they run."];
    // a stable: its file, or it refuses to publish
    expect(() => compute({ channel: "stable", version: "0.2.0" })).toThrow(ReleaseNotesError);
    expect(() => compute({ channel: "stable", version: "0.2.0" })).toThrow(
      /notes\/0\.2\.0\.txt is missing/,
    );
    const stable = { version: "0.1.0", tag: "v0.1.0", commit: "e".repeat(40) };
    expect(
      compute({ channel: "stable", version: "0.2.0", previous: stable, written: file }),
    ).toEqual({ kind: "written", since: { version: "0.1.0", tag: "v0.1.0" }, lines });
    // a beta: the file of its version's core when it is there, else the log since the previous beta
    const beta = { version: "0.2.0-beta.1", tag: "v0.2.0-beta.1", commit: "f".repeat(40) };
    const betaSince = { version: beta.version, tag: beta.tag };
    expect(
      compute({ channel: "beta", version: "0.2.0-beta.2", previous: beta, written: file }),
    ).toEqual({ kind: "written", since: betaSince, lines });
    expect(compute({ channel: "beta", version: "0.2.0-beta.2", previous: beta, log })).toEqual({
      kind: "log",
      since: betaSince,
      commits: 1,
      product: 1,
      lines: [{ track: "AU-6", text: "the notes tool" }],
    });
    expect(compute({ channel: "beta", version: "0.2.0-beta.1" })).toBeNull();
    // a nightly: the log since the previous nightly, never a file; the channel's first release carries none
    expect(compute({ previous, written: file, log })).toMatchObject({
      kind: "log",
      since,
      commits: 1,
    });
    expect(compute({})).toBeNull();
    expect(read).toEqual([beta.commit, previous.commit]);
  });

  it("a written file refuses more than 8 notes, a note over 200 characters, a control character, and saying nothing", () => {
    const notes = (n: number) => Array.from({ length: n }, (_, i) => `note ${i + 1}`);
    expect(() => writtenNotes(notes(9).join("\n"), null)).toThrow(
      /has 9 lines; a written release says at most 8/,
    );
    expect(() => writtenNotes(`fine\n${"x".repeat(201)}`, null)).toThrow(
      /line 2 is 201 characters/,
    );
    expect(() => writtenNotes("one\u202Etwo", null)).toThrow(
      /line 1 holds a control or format character/,
    );
    expect(() => writtenNotes("a tab\there", null)).toThrow(ReleaseNotesError);
    expect(() => writtenNotes("# only a comment\n\n", null)).toThrow(/says nothing/);
    // eight notes, Windows line ends, comments and blank lines between them
    const eight = writtenNotes(`# head\r\n${notes(8).join("\r\n\r\n")}\r\n`, null);
    expect(eight.lines).toEqual(notes(8));
    expect(ReleaseNotes.parse(eight)).toEqual(eight);
  });

  // Item 143 (2026-11-01) — this row is twelve `git` starts in a row (the fixture repo's eleven, then readCommits' log),
  // synchronous, so a loaded host stretches it, and vitest's 5 s default cut it at 5,074 ms (AL-6's light, load ~117).
  // Measured in this Mac's logged suites since the row came (AU-6b, 2026-10-29; 24 runs): a median 898 ms, p90 2,649,
  // the greens' worst 4,646; the mini's 116 verify runs, a median 1,001 and a worst 1,736. Then items 142–143's own
  // electron-shell whole (2026-11-01 05:13Z) ran it 7,436 ms, green, in the minute typed-agent's real-zsh row ran 7,573
  // (item 145): the host stretched, not the row. Its claim is the log's reading, never a time: 15 s, smoke-profile's
  // LAUNCHER_ROW_BUDGET_MS (item 93), is about twice the worst this Mac has logged.
  it("reads the log as git writes it: no merges, newest first, a folded Release-note: trailer unfolded", {
    timeout: 15_000,
  }, () => {
    const dir = scratch();
    let at = 1_790_000_000;
    // place-scanner's temporary repo: its own identity, no global or system config; each commit a minute later
    const git = (...args: string[]): string => {
      at += 60;
      return execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Ada",
          GIT_AUTHOR_EMAIL: "ada@example.com",
          GIT_COMMITTER_NAME: "Ada",
          GIT_COMMITTER_EMAIL: "ada@example.com",
          GIT_AUTHOR_DATE: `${at} +0000`,
          GIT_COMMITTER_DATE: `${at} +0000`,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      }).trim();
    };
    const commit = (...message: string[]) =>
      git("commit", "-q", "--allow-empty", ...message.flatMap((part) => ["-m", part]));
    git("init", "-q", "-b", "main");
    commit("the previous release");
    const from = git("rev-parse", "HEAD");
    commit("AU-6: the first change");
    git("checkout", "-q", "-b", "side");
    commit("FN: a change on a side branch");
    git("checkout", "-q", "main");
    commit("docs: the notes' own words");
    git("merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side");
    commit(
      "TS-7: the newest — words after the dash",
      "The body.",
      "Release-note: The phone opens\n  the door.",
    );
    const to = git("rev-parse", "HEAD");
    expect(readCommits(from, to, dir)).toEqual([
      {
        subject: "TS-7: the newest — words after the dash",
        releaseNote: "The phone opens the door.",
      },
      { subject: "docs: the notes' own words" },
      { subject: "FN: a change on a side branch" },
      { subject: "AU-6: the first change" },
    ]);
    expect(() => readCommits("HEAD", to, dir)).toThrow(/not two commits/);
  });

  it("merge writes the notes INTO the manifest the sign step signs, and refuses notes counted from another release", () => {
    const planes = {
      shell: { digest: "1".repeat(64), files: 1 },
      fieldd: { digest: "2".repeat(64), files: 1 },
      "field-native": { digest: "3".repeat(64), files: 1, members: ["bin/field-native"] },
    };
    const notes = logNotes({
      since: { version: "0.1.0-nightly.20261015", tag: "nightly-20261015" },
      commits: [c("AU-6: the notes tool")],
    });
    const input = {
      version: "0.1.0-nightly.20261016",
      tag: "nightly-20261016",
      channel: "nightly",
      commit: "c".repeat(40),
      builds: { "mac-arm64": planes },
      previous: { tag: "nightly-20261015", builds: {} },
    };
    const manifest = mergeManifest({ ...input, notes });
    expect(manifest.previous).toBe("nightly-20261015");
    expect(ReleaseManifest.parse(manifest).notes).toEqual(notes);
    expect(ReleaseNotes.parse(manifest.notes)).toEqual(notes);
    expect(mergeManifest(input)).not.toHaveProperty("notes");
    expect(() =>
      mergeManifest({ ...input, previous: { tag: "nightly-20261014", builds: {} }, notes }),
    ).toThrow(/count from nightly-20261015, but the manifest's previous is nightly-20261014/);
    expect(() => mergeManifest({ ...input, previous: null, notes })).toThrow(
      /manifest's previous is none/,
    );
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

// LP-1 (the 0.9 launch's rails) — the DMG a stranger downloads is signed, notarized and stapled AFTER electron-builder
// wrote it and its feed, so the feed's DMG entry is re-read from the stapled bytes and the DMG's blockmap dropped; the
// stable channel carries a fixed-name copy; release-verify holds every directory to those rules. Apple's tools are a
// fake here (`exec`): the real ones meet the first signed release, which is James's run.
describe("LP-1: the DMG — signed, notarized, stapled; the feed re-read; the stable download's fixed name", () => {
  // nightly-20261028's latest-mac.yml, byte for byte (`gh release download nightly-20261028 --pattern latest-mac.yml`)
  const NIGHTLY_ZIP = "VibeField-0.1.0-nightly.20261028-arm64-mac.zip";
  const NIGHTLY_DMG = "VibeField-0.1.0-nightly.20261028-arm64.dmg";
  const ZIP_SHA =
    "2JUAZL3zVWceLCdu5KbCIfoIyAc2BvUkb2u/4I165D7nhpv+7iQMezt2iBCF9m/xMei7jzXYRwckZz+qwSepAg==";
  const NIGHTLY_FEED = [
    "version: 0.1.0-nightly.20261028",
    "files:",
    `  - url: ${NIGHTLY_ZIP}`,
    `    sha512: ${ZIP_SHA}`,
    "    size: 198875667",
    `  - url: ${NIGHTLY_DMG}`,
    "    sha512: 0YigFnYM5e5pz0LJfZGmyXdHZGjkzLx1yWepf+ZqG29zIOGD7qD3lKKszHEq+0XjM3rWSJy2EBaXuR5BxPYskg==",
    "    size: 206468135",
    `path: ${NIGHTLY_ZIP}`,
    `sha512: ${ZIP_SHA}`,
    "releaseDate: '2026-10-28T16:56:06.353Z'",
    "",
  ].join("\n");
  const SUBMISSION = "2efe2717-52ef-43a5-96dc-0797e4ca1041";
  const IDENTITY_HASH = "A1".repeat(20);
  const APPLE_ENV = {
    CSC_LINK: `data:application/x-pkcs12;base64,${Buffer.from("the fixture's p12 bytes").toString("base64")}`,
    CSC_KEY_PASSWORD: "fixture-p12-password",
    APPLE_API_KEY: "/runner/temp/AuthKey_FIXTUREKEY1.p8",
    APPLE_API_KEY_ID: "FIXTUREKEY1",
    APPLE_API_ISSUER: "00000000-1111-2222-3333-444444444444",
  };
  const sha512Of = (path: string) =>
    createHash("sha512").update(readFileSync(path)).digest("base64");

  /** What electron-builder leaves in `release/`: the zip, the DMG, both blockmaps and the feed naming both. */
  function built(version = "0.9.0") {
    const dir = scratch();
    const zip = `VibeField-${version}-arm64-mac.zip`;
    const dmg = `VibeField-${version}-arm64.dmg`;
    writeFileSync(join(dir, zip), "the zip's bytes");
    writeFileSync(join(dir, `${zip}.blockmap`), "the zip's blockmap");
    writeFileSync(join(dir, dmg), "the disk image's bytes");
    writeFileSync(join(dir, `${dmg}.blockmap`), "the disk image's blockmap");
    const feed = [
      `version: ${version}`,
      "files:",
      `  - url: ${zip}`,
      `    sha512: ${sha512Of(join(dir, zip))}`,
      `    size: ${statSync(join(dir, zip)).size}`,
      `  - url: ${dmg}`,
      `    sha512: ${sha512Of(join(dir, dmg))}`,
      `    size: ${statSync(join(dir, dmg)).size}`,
      `path: ${zip}`,
      `sha512: ${sha512Of(join(dir, zip))}`,
      "releaseDate: '2026-11-05T01:00:00.000Z'",
      "",
    ].join("\n");
    writeFileSync(join(dir, "latest-mac.yml"), feed);
    return { dir, zip, dmg, feed };
  }

  /** A Mac's signing tools, as a fake: codesign, security, notarytool, stapler and spctl answer as Apple's do, the
   * staple appends a "ticket" to the DMG (so its bytes change), and every call is recorded. */
  function fakeMac(
    options: {
      stapleFailures?: string[];
      verdict?: string;
      gatekeeper?: "on" | "off" | "rejects";
      signed?: boolean;
    } = {},
  ) {
    const calls: string[][] = [];
    let signed = options.signed ?? false;
    let stapled = options.signed ?? false;
    const stapleFailures = [...(options.stapleFailures ?? [])];
    const ok = (stdout = "", stderr = "") => ({ code: 0, stdout, stderr });
    const exec: Exec = (command, args) => {
      calls.push([command, ...args]);
      const tool = command.split("/").pop();
      const target = args[args.length - 1] ?? "";
      if (tool === "security") {
        if (args[0] === "list-keychains" && args.length === 3)
          return ok('    "/Users/runner/Library/Keychains/login.keychain-db"\n');
        if (args[0] === "find-identity")
          return ok(
            `  1) ${IDENTITY_HASH} "Developer ID Application: James Yong (${TEAM_ID})"\n     1 valid identities found\n`,
          );
        return ok();
      }
      if (tool === "codesign") {
        if (args[0] === "--sign") {
          signed = true;
          return ok();
        }
        if (!signed)
          return { code: 1, stdout: "", stderr: `${target}: code object is not signed at all\n` };
        if (args[0] === "--display" && args.includes("--verbose=4"))
          return ok(
            "",
            [
              `Executable=${target}`,
              `Authority=Developer ID Application: James Yong (${TEAM_ID})`,
              "Authority=Developer ID Certification Authority",
              "Authority=Apple Root CA",
              "Timestamp=Nov 5, 2026 at 01:00:00",
              `TeamIdentifier=${TEAM_ID}`,
              "",
            ].join("\n"),
          );
        return ok();
      }
      if (tool === "xcrun" && args[0] === "notarytool") {
        if (args[1] === "submit")
          return ok(JSON.stringify({ id: SUBMISSION, message: "Successfully uploaded file" }));
        if (args[1] === "wait")
          return ok(
            JSON.stringify({
              id: SUBMISSION,
              status: options.verdict ?? "Accepted",
              message: "Processing complete",
            }),
          );
        if (args[1] === "log")
          return ok(
            JSON.stringify({ issues: [{ message: "The signature of the binary is invalid." }] }),
          );
      }
      if (tool === "xcrun" && args[0] === "stapler") {
        if (args[1] === "staple") {
          const failure = stapleFailures.shift();
          if (failure !== undefined) return { code: 65, stdout: "", stderr: failure };
          appendFileSync(target, "+ticket");
          stapled = true;
          return ok("The staple and validate action worked!\n");
        }
        if (args[1] === "validate")
          return stapled
            ? ok("The validate action worked!\n")
            : { code: 65, stdout: "", stderr: `${target} does not have a ticket stapled to it.\n` };
      }
      if (tool === "spctl") {
        if (options.gatekeeper === "rejects")
          return {
            code: 3,
            stdout: "",
            stderr: `${target}: rejected\nsource=no usable signature\n`,
          };
        return ok(
          "",
          options.gatekeeper === "off"
            ? `${target}: accepted\noverride=security disabled\n`
            : `${target}: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: James Yong (${TEAM_ID})\n`,
        );
      }
      return { code: 99, stdout: "", stderr: `the fake has no ${command} ${args.join(" ")}` };
    };
    /** each call as "<tool> <verb>" (notarytool and stapler by their subcommand) */
    const steps = () =>
      calls.map(([command, ...args]) => {
        const tool = command?.split("/").pop();
        return tool === "xcrun" ? `${tool} ${args[0]} ${args[1]}` : `${tool} ${args[0]}`;
      });
    return { exec, calls, steps };
  }

  it("re-states ONLY the DMG's entry from its bytes: the zip's entry, path and top-level sha512 stay byte for byte", () => {
    expect(feedEntries(NIGHTLY_FEED)).toEqual([
      { url: NIGHTLY_ZIP, sha512: ZIP_SHA, size: 198875667 },
      {
        url: NIGHTLY_DMG,
        sha512:
          "0YigFnYM5e5pz0LJfZGmyXdHZGjkzLx1yWepf+ZqG29zIOGD7qD3lKKszHEq+0XjM3rWSJy2EBaXuR5BxPYskg==",
        size: 206468135,
      },
    ]);
    expect(dmgOfFeed(NIGHTLY_FEED)).toBe(NIGHTLY_DMG);
    const stapledSha = `${"B".repeat(86)}==`;
    const refreshed = refreshFeedEntry(NIGHTLY_FEED, {
      url: NIGHTLY_DMG,
      sha512: stapledSha,
      size: 206474321,
    });
    const before = NIGHTLY_FEED.split("\n");
    const after = refreshed.split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual([
      `    sha512: ${stapledSha}`,
      "    size: 206474321",
    ]);
    // a blockMapSize names a blockmap the release no longer publishes: the re-stated entry drops it
    const withBlockmap = NIGHTLY_FEED.replace(
      "    size: 206468135\n",
      "    size: 206468135\n    blockMapSize: 215204\n",
    );
    expect(
      refreshFeedEntry(withBlockmap, { url: NIGHTLY_DMG, sha512: stapledSha, size: 206474321 }),
    ).toBe(refreshed);
    // a payload the feed does not name, or names twice, refuses — never a guess
    expect(() =>
      refreshFeedEntry(NIGHTLY_FEED, { url: "VibeField-other.dmg", sha512: stapledSha, size: 1 }),
    ).toThrow(ReleaseAssetsError);
    const twoDmgs = NIGHTLY_FEED.replace(
      `path: ${NIGHTLY_ZIP}`,
      `  - url: x.dmg\n    sha512: ${stapledSha}\n    size: 1\npath: ${NIGHTLY_ZIP}`,
    );
    expect(() => dmgOfFeed(twoDmgs)).toThrow(/names 2 DMGs/);
  });

  it("signs the DMG in a keychain of its own, notarizes, staples through a transient -1005, assesses, then re-reads the feed", () => {
    const { dir, zip, dmg, feed } = built();
    const mac = fakeMac({
      stapleFailures: [
        'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
      ],
    });
    const sleeps: number[] = [];
    const logs: string[] = [];
    const keychains = scratch();
    const result = finalizeDmg({
      dir,
      mode: "signed",
      env: APPLE_ENV,
      exec: mac.exec,
      sleep: (ms) => sleeps.push(ms),
      log: (line) => logs.push(line),
      cwd: dir,
      scratch: keychains,
    });
    expect(mac.steps()).toEqual([
      "codesign --display", // not yet signed: this step signs the DMG electron-builder just wrote
      "security list-keychains",
      "security create-keychain",
      "security set-keychain-settings",
      "security unlock-keychain",
      "security import",
      "security set-key-partition-list",
      "security list-keychains",
      "security find-identity",
      "codesign --sign",
      "security list-keychains", // the user's search list restored
      "security delete-keychain",
      "xcrun notarytool submit",
      "xcrun notarytool wait",
      "xcrun stapler staple", // NSURLErrorDomain -1005 (run 41726990250's failure)…
      "xcrun stapler staple", // …retried once, after the first bounded delay
      "codesign --verify",
      "codesign --display",
      "xcrun stapler validate",
      "spctl --assess",
    ]);
    expect(sleeps).toEqual([RETRIES.staple[0]]);
    const sign = mac.calls.find((call) => call[1] === "--sign") ?? [];
    expect(sign.slice(1, 6)).toEqual([
      "--sign",
      IDENTITY_HASH,
      "--timestamp",
      "--keychain",
      expect.stringContaining(keychains),
    ]);
    expect(sign[sign.length - 1]).toBe(join(dir, dmg));
    const submit = mac.calls.find((call) => call[2] === "submit") ?? [];
    expect(submit).toEqual(
      expect.arrayContaining(["--key-id", APPLE_ENV.APPLE_API_KEY_ID, "--output-format", "json"]),
    );
    expect(mac.calls.find((call) => call[1] === "--assess")?.slice(1, 6)).toEqual([
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
    ]);
    // the feed names the STAPLED bytes; the zip's lines are untouched; the DMG's blockmap is gone, the zip's stays
    const stapled = readFileSync(join(dir, dmg));
    expect(stapled.toString()).toBe("the disk image's bytes+ticket");
    expect(result).toMatchObject({
      mode: "signed",
      dmg,
      size: stapled.length,
      submission: SUBMISSION,
    });
    const refreshed = readFileSync(join(dir, "latest-mac.yml"), "utf8");
    expect(feedEntries(refreshed)).toEqual([
      feedEntries(feed)[0],
      { url: dmg, sha512: sha512Of(join(dir, dmg)), size: stapled.length },
    ]);
    expect(readdirSync(dir).sort()).toEqual([dmg, zip, `${zip}.blockmap`, "latest-mac.yml"].sort());
    expect(checkReleaseAssets({ dir, tag: "v0.9.0", channel: "stable" })).toEqual({
      checked: [zip, dmg],
    });
    // the run's keychain and its p12 are gone; no secret reached the log
    expect(readdirSync(keychains)).toEqual([]);
    const password = mac.calls.find((call) => call[1] === "create-keychain")?.[3] ?? "";
    expect(password.length).toBeGreaterThan(16);
    const log = logs.join("\n");
    for (const secret of [
      password,
      APPLE_ENV.CSC_KEY_PASSWORD,
      APPLE_ENV.APPLE_API_KEY_ID,
      APPLE_ENV.APPLE_API_ISSUER,
      APPLE_ENV.CSC_LINK,
    ])
      expect(log.includes(secret), secret).toBe(false);
    expect(log).toMatch(/transient network failure \(attempt 1 of 5\)/);
  });

  it("an Invalid verdict fetches Apple's log, never staples or retries, and leaves the feed and keychains as they were", () => {
    const { dir, feed } = built();
    const mac = fakeMac({ verdict: "Invalid" });
    const sleeps: number[] = [];
    const keychains = scratch();
    let message = "";
    try {
      finalizeDmg({
        dir,
        env: APPLE_ENV,
        exec: mac.exec,
        sleep: (ms) => sleeps.push(ms),
        log: () => {},
        cwd: dir,
        scratch: keychains,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/answered Invalid .*submission 2efe2717/);
    expect(message).toContain("The signature of the binary is invalid.");
    for (const secret of [APPLE_ENV.APPLE_API_KEY_ID, APPLE_ENV.APPLE_API_ISSUER])
      expect(message.includes(secret)).toBe(false);
    expect(mac.steps()).toContain("xcrun notarytool log");
    expect(mac.steps().some((step) => step.startsWith("xcrun stapler"))).toBe(false);
    expect(sleeps).toEqual([]);
    expect(readFileSync(join(dir, "latest-mac.yml"), "utf8")).toBe(feed);
    expect(readdirSync(keychains)).toEqual([]);
  });

  it("retries a staple only on a transient failure, and only a bounded number of times", () => {
    expect(
      isTransient(
        'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
        "wait",
      ),
    ).toBe(true);
    expect(isTransient('CloudKit query failed due to "Record not found"', "staple")).toBe(true);
    expect(isTransient('CloudKit query failed due to "Record not found"', "submit")).toBe(false);
    expect(isTransient('{"status":"Invalid"}', "wait")).toBe(false);
    expect(isTransient("HTTP status code: 401. Unable to authenticate.", "submit")).toBe(false);

    const propagating = built();
    const slow = fakeMac({
      stapleFailures: Array.from({ length: 5 }, () => 'failed due to "Record not found"'),
    });
    const sleeps: number[] = [];
    expect(() =>
      finalizeDmg({
        dir: propagating.dir,
        env: APPLE_ENV,
        exec: slow.exec,
        sleep: (ms) => sleeps.push(ms),
        log: () => {},
        cwd: propagating.dir,
        scratch: scratch(),
      }),
    ).toThrow(/stapler staple failed \(exit 65, attempt 5 of 5\)/);
    expect(sleeps).toEqual([...RETRIES.staple]);

    const broken = built();
    const refused = fakeMac({
      stapleFailures: ["The staple and validate action failed! Error 68."],
    });
    const none: number[] = [];
    expect(() =>
      finalizeDmg({
        dir: broken.dir,
        env: APPLE_ENV,
        exec: refused.exec,
        sleep: (ms) => none.push(ms),
        log: () => {},
        cwd: broken.dir,
        scratch: scratch(),
      }),
    ).toThrow(/attempt 1 of 5/);
    expect(none).toEqual([]);
  });

  it("the unsigned path signs nothing, says so, drops the DMG's blockmap, and leaves a true feed byte for byte", () => {
    const { dir, zip, dmg, feed } = built();
    const mac = fakeMac();
    const logs: string[] = [];
    finalizeDmg({ dir, mode: "unsigned", env: {}, exec: mac.exec, log: (line) => logs.push(line) });
    expect(mac.calls).toEqual([]);
    expect(logs[0]).toMatch(/^::warning title=Unsigned DMG::.*not signed, notarized or stapled/);
    expect(readFileSync(join(dir, "latest-mac.yml"), "utf8")).toBe(feed);
    expect(readdirSync(dir).sort()).toEqual([dmg, zip, `${zip}.blockmap`, "latest-mac.yml"].sort());
  });

  it("the credential modes are the preflight's: exactly one complete mode, refused before anything is signed", () => {
    expect(notaryCredentials(APPLE_ENV)).toEqual({
      mode: "app-store-connect-api-key",
      args: [
        "--key",
        APPLE_ENV.APPLE_API_KEY,
        "--key-id",
        APPLE_ENV.APPLE_API_KEY_ID,
        "--issuer",
        APPLE_ENV.APPLE_API_ISSUER,
      ],
    });
    expect(notaryCredentials({ APPLE_KEYCHAIN_PROFILE: "vibefield" }).mode).toBe(
      "keychain-profile",
    );
    expect(() => notaryCredentials({ ...APPLE_ENV, APPLE_API_ISSUER: "" })).toThrow(
      /must be supplied together/,
    );
    expect(() => notaryCredentials({ ...APPLE_ENV, APPLE_KEYCHAIN_PROFILE: "vibefield" })).toThrow(
      /exactly one complete notarization credential mode/,
    );
    expect(() =>
      notaryCredentials({ APPLE_ID: "a@b.invalid", APPLE_APP_SPECIFIC_PASSWORD: "x-y-z-w" }),
    ).toThrow(/APPLE_TEAM_ID must be the frozen team/);
    const { dir } = built();
    const mac = fakeMac();
    expect(() =>
      finalizeDmg({
        dir,
        env: { ...APPLE_ENV, APPLE_API_KEY_ID: "" },
        exec: mac.exec,
        log: () => {},
      }),
    ).toThrow(NotarizeDmgError);
    expect(mac.calls).toEqual([]);
  });

  it("validate-only assesses every DMG in a directory; a Gatekeeper that is off is said, a rejection is red", () => {
    const { dir, dmg } = built();
    const logs: string[] = [];
    expect(
      finalizeDmg({
        dir,
        mode: "validate-only",
        exec: fakeMac({ signed: true }).exec,
        log: (line) => logs.push(line),
      }),
    ).toEqual({ mode: "validate-only", dmgs: [dmg] });
    expect(logs).toEqual([
      expect.stringContaining(`${dmg} — Developer ID (${TEAM_ID}), notarized, stapled`),
    ]);
    const off: string[] = [];
    finalizeDmg({
      dir,
      mode: "validate-only",
      exec: fakeMac({ signed: true, gatekeeper: "off" }).exec,
      log: (line) => off.push(line),
    });
    expect(off[0]).toMatch(/^::warning title=Gatekeeper is off on this host::/);
    expect(() =>
      finalizeDmg({
        dir,
        mode: "validate-only",
        exec: fakeMac({ signed: true, gatekeeper: "rejects" }).exec,
        log: () => {},
      }),
    ).toThrow(/spctl --assess failed \(exit 3/);
    // nightly-20261028's DMG: not signed at all
    expect(() =>
      finalizeDmg({ dir, mode: "validate-only", exec: fakeMac().exec, log: () => {} }),
    ).toThrow(/codesign --verify failed/);
  });

  it("the stable download's fixed name: a byte copy on a stable, never on a nightly or a beta", () => {
    const { dir, dmg } = built("0.9.0");
    expect(stableDmgAlias({ dir, channel: "nightly", version: "0.9.0" })).toBeNull();
    expect(stableDmgAlias({ dir, channel: "beta", version: "0.9.0" })).toBeNull();
    expect(readdirSync(dir)).not.toContain(STABLE_DMG_ALIAS);
    expect(stableDmgAlias({ dir, channel: "stable", version: "0.9.0" })).toEqual({
      source: dmg,
      alias: "VibeField-mac-arm64.dmg",
    });
    expect(readFileSync(join(dir, STABLE_DMG_ALIAS))).toEqual(readFileSync(join(dir, dmg)));
    expect(() => stableDmgAlias({ dir, channel: "stable", version: "0.9.0" })).toThrow(); // never replaced
    expect(() => stableDmgAlias({ dir: scratch(), channel: "stable", version: "0.9.0" })).toThrow(
      /VibeField-0\.9\.0-arm64\.dmg is not in/,
    );
    expect(() => stableDmgAlias({ dir, channel: "stable", version: "0.9.0-beta.1" })).toThrow(
      /not a stable version/,
    );
  });

  it("checkReleaseAssets: no DMG blockmap, the alias only on a stable and only as the versioned DMG's bytes, every payload its feed's", () => {
    const stale = built();
    expect(() => checkReleaseAssets({ dir: stale.dir, tag: "v0.9.0", channel: "stable" })).toThrow(
      /blockmap goes stale/,
    );
    rmSync(join(stale.dir, `${stale.dmg}.blockmap`));
    expect(checkReleaseAssets({ dir: stale.dir, tag: "v0.9.0", channel: "stable" })).toEqual({
      checked: [stale.zip, stale.dmg],
    });
    // stapled after the feed was written, its entry not re-read
    appendFileSync(join(stale.dir, stale.dmg), "+ticket");
    expect(() => checkReleaseAssets({ dir: stale.dir, tag: "v0.9.0", channel: "stable" })).toThrow(
      /VibeField-0\.9\.0-arm64\.dmg's sha512 or size is not its bytes'/,
    );

    const aliased = built();
    rmSync(join(aliased.dir, `${aliased.dmg}.blockmap`));
    stableDmgAlias({ dir: aliased.dir, channel: "stable", version: "0.9.0" });
    expect(() =>
      checkReleaseAssets({ dir: aliased.dir, tag: "v0.9.0", channel: "stable" }),
    ).not.toThrow();
    for (const [tag, channel] of [
      ["nightly-20261105", "nightly"],
      ["v0.9.0-beta.1", "beta"],
    ] as const)
      expect(() => checkReleaseAssets({ dir: aliased.dir, tag, channel })).toThrow(
        new RegExp(`a ${channel} release never carries it`),
      );
    writeFileSync(join(aliased.dir, STABLE_DMG_ALIAS), "other bytes");
    expect(() =>
      checkReleaseAssets({ dir: aliased.dir, tag: "v0.9.0", channel: "stable" }),
    ).toThrow(/is not a byte copy of VibeField-0\.9\.0-arm64\.dmg/);
  });

  it("release-verify holds a release directory to the asset rules before the chain, signed or not", async () => {
    const dir = releaseDir();
    writeFileSync(join(dir, "VibeField-mac.zip"), "not the feed's bytes");
    await expect(
      verifyReleaseDir({
        dir,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: [],
        now: NOW,
      }),
    ).rejects.toThrow(/latest-mac\.yml: VibeField-mac\.zip's sha512 or size is not its bytes'/);
    const nightly = releaseDir();
    writeFileSync(join(nightly, STABLE_DMG_ALIAS), "a disk image");
    await expect(
      verifyReleaseDir({
        dir: nightly,
        tag: "nightly-20261016",
        channel: "nightly",
        rootKeys: [],
        now: NOW,
      }),
    ).rejects.toThrow(/a nightly release never carries it/);
  });

  it("the floor is one number in two places: electron-builder's minimumSystemVersion and every channel's floors.os", () => {
    const builder = readFileSync(join(REPO, "apps/desktop/packaging/electron-builder.yml"), "utf8");
    const declared = /^ {2}minimumSystemVersion: "([0-9.]+)"/m.exec(builder)?.[1];
    expect(declared).toBe("14.0");
    for (const ch of ["nightly", "beta", "stable"]) {
      const source = UpdatePolicySource.parse(
        JSON.parse(readFileSync(join(POLICIES, `${ch}.json`), "utf8")),
      );
      expect(source.floors.os, ch).toBe(declared);
      // the floor changed the body that nightly-20261028 published at version 1 (D5: a bump with every body change)
      expect(source.version, ch).toBeGreaterThanOrEqual(2);
    }
  });

  it("package:mac:release finalizes the DMG after electron-builder wrote it, in the step that holds the credentials", () => {
    const driver = readFileSync(join(REPO, "apps/desktop/packaging/run-macos-release.mjs"), "utf8");
    const finalize = driver.indexOf('"packaging/notarize-dmg.mjs", "--dir", "release"');
    expect(finalize).toBeGreaterThan(driver.indexOf('"packaging/run-electron-builder.mjs"'));
    expect(finalize).toBeGreaterThan(driver.indexOf('"packaging/verify-live-surface-release.mjs"'));
    expect(driver.slice(finalize)).not.toMatch(/--unsigned|--validate-only/);
  });

  // LP-6b's guard for a LOCAL release (VF-PM, 2026-11-05 03:58Z): the remap happens only under the release switch, so
  // package:mac:release refuses without it, before any signing preflight or build, on any host. Only refusals are run
  // here: with the switch set, the driver would go on to this Mac's signing identities and a real stage.
  it("package:mac:release refuses without VIBEFIELD_REMAP_BUILD_PATHS=1, before it builds or signs anything", () => {
    const driver = join(REPO, "apps/desktop/packaging/run-macos-release.mjs");
    const { VIBEFIELD_REMAP_BUILD_PATHS: _ignored, ...base } = process.env;
    for (const [value, said] of [
      [undefined, "unset"],
      ["0", '"0"'],
      ["", '""'],
      ["true", '"true"'],
    ] as const) {
      const env = value === undefined ? base : { ...base, VIBEFIELD_REMAP_BUILD_PATHS: value };
      const result = spawnSync(process.execPath, [driver], {
        env,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(result.status, String(value)).toBe(1);
      expect(result.stdout, String(value)).toBe("");
      const refusal = JSON.parse(result.stderr.trim()) as {
        ok: boolean;
        gate: string;
        error: string;
      };
      expect(refusal.ok).toBe(false);
      expect(refusal.gate).toBe("macOS-release-preflight");
      expect(refusal.error).toContain(`VIBEFIELD_REMAP_BUILD_PATHS is ${said}`);
      expect(refusal.error).toContain("pnpm siblings:build");
      expect(refusal.error).toContain("build-js mille");
      // prod-builder 04:11Z: the switch belongs to the release shell alone (the shared target rebuilds both ways)
      expect(refusal.error).toContain("in the release shell only");
    }
    const source = readFileSync(driver, "utf8");
    const guard = source.indexOf('process.env.VIBEFIELD_REMAP_BUILD_PATHS !== "1"');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf("const signing = signingPreflight();"));
    expect(guard).toBeLessThan(source.indexOf("await run("));
  });

  it("package:mac:release runs the packaged app's gate (host-links --app) after its checks, before the DMG is finalized", () => {
    const driver = readFileSync(join(REPO, "apps/desktop/packaging/run-macos-release.mjs"), "utf8");
    const gate = driver.indexOf('"../../scripts/host-links.mjs",\n  "--app",');
    expect(gate).toBeGreaterThan(driver.indexOf('"packaging/verify-live-surface-release.mjs"'));
    expect(gate).toBeLessThan(driver.indexOf('"packaging/notarize-dmg.mjs", "--dir", "release"'));
    // the same gate release.yml runs after packaging, signed or not
    const workflow = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain(
      'node scripts/host-links.mjs --app "apps/desktop/release/$OUT/VibeField.app"',
    );
  });
});

// The WORKFLOW LINT that runs in every verify (actionlint is the second one, by hand: `actionlint
// .github/workflows/*.yml`). release.yml is read as text — its jobs are its two-space keys under `jobs:` and its steps
// the `- ` items — and held to the PM's permissions table (2026-10-15 14:47Z): every secret in the ONE step that uses
// it, only the build and sign jobs in `release-signing`, only tag and publish writing contents (tag since 2026-10-26),
// only attest minting an OIDC token and writing attestations (LP-1, 2026-11-05), every third-party action SHA-pinned.
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
    expect([...jobs.keys()]).toEqual([
      "plan",
      "tag",
      "verify",
      "build",
      "sign",
      "converge",
      "attest",
      "publish",
    ]);
    expect(permissionsOf("plan")).toEqual({ contents: "read", actions: "read" });
    for (const job of ["verify", "build", "sign", "converge"])
      expect(permissionsOf(job), job).toEqual({ contents: "read" });
    for (const job of ["tag", "publish"])
      expect(permissionsOf(job), job).toEqual({ contents: "write" });
    // LP-1: provenance — the one job that may mint an OIDC token and write attestations
    expect(permissionsOf("attest")).toEqual({
      contents: "read",
      "id-token": "write",
      attestations: "write",
    });
  });

  // LP-1: the OIDC token can sign as this repository's workflow (Sigstore) — so it reaches the pinned attest action
  // alone: no other job is granted it, and the attest job checks nothing out, installs nothing and runs no shell.
  it("LP-1: only attest mints an OIDC token or writes attestations, over the final DMG and zip, before publish", () => {
    for (const [job, text] of jobs)
      if (job !== "attest") expect(text, job).not.toMatch(/id-token|attestations:/);
    expect(yml.slice(0, yml.indexOf("\njobs:\n"))).not.toMatch(
      /\n {2}id-token:|\n {2}attestations:/,
    );
    const attest = jobs.get("attest") ?? "";
    expect(attest).toMatch(/\n {4}needs: converge\n/);
    expect(attest).not.toMatch(/actions\/checkout|setup-node|pnpm|\n {8}run: /);
    expect(attest).not.toMatch(/environment:/);
    const steps = stepsOf("attest");
    expect(steps.map((step) => step.text.match(/uses: ([^@\s]+)@/)?.[1])).toEqual([
      "actions/download-artifact",
      "actions/attest-build-provenance",
    ]);
    expect(steps[0]?.text).toMatch(/\n {10}name: release-final\n/);
    expect(steps[1]?.text).toMatch(
      /\n {10}subject-path: \|\n {12}release-out\/\*\.dmg\n {12}release-out\/\*\.zip(\n|$)/,
    );
    expect(jobs.get("publish")).toMatch(/\n {4}needs: \[plan, converge, attest\]\n/);
    // the header's PERMISSIONS table states the row
    expect(yml).toMatch(/\n# {3}attest {5}— {18}contents: read, id-token: write, {5}/);
  });

  // LP-1: the DMG is signed, notarized and stapled INSIDE package:mac:release (the step that holds the Apple
  // credentials), so every later reader — the copy into the build artifact, the feed's sha512 the sign job signs,
  // release-verify, SHA256SUMS and the attestation — reads the final bytes.
  it("LP-1: the DMG is final before anything copies or hashes it; the DMG's blockmap is never published", () => {
    const build = stepsOf("build");
    const names = build.map((step) => step.name);
    const signed = build.find(
      (step) => step.name === "Package, signed (J4 — the Apple credentials exist)",
    );
    expect(signed?.text).toMatch(/APPLE_API_KEY="\$key" pnpm run package:mac:release/);
    expect(names.indexOf("Package, signed (J4 — the Apple credentials exist)")).toBeLessThan(
      names.indexOf("Hash the planes (D11)"),
    );
    const unsignedChecks = build.find(
      (step) =>
        step.name === "The packaged app's checks (as package:mac:release runs them, unsigned)",
    );
    expect(unsignedChecks?.text).toMatch(
      /\n {10}node packaging\/notarize-dmg\.mjs --dir release --unsigned\n/,
    );
    // AR-7j (row 34): the unsigned path runs the typed-agent witness as package:mac:release does, right after History's
    expect(unsignedChecks?.text).toMatch(
      /verify-history-package\.mjs --native-root "\$app\/Contents\/Resources\/bin"\n {10}node packaging\/verify-agents-package\.mjs --native-root "\$app\/Contents\/Resources\/bin"\n/,
    );
    const copy = build.find((step) => step.name === "Hash the planes (D11)")?.text ?? "";
    expect(copy).toMatch(/-name '\*\.zip\.blockmap'/);
    expect(copy).not.toMatch(/-name '\*\.blockmap'|-name '\*\.dmg\.blockmap'/);
    // the checksums are converge's, which waits on sign, which waits on build
    expect(jobs.get("sign")).toMatch(/\n {4}needs: \[plan, build\]\n/);
    expect(jobs.get("converge")).toMatch(/\n {4}needs: \[plan, sign\]\n/);
    const converge = stepsOf("converge").map((step) => step.name);
    const at = (name: string) => {
      const index = converge.indexOf(name);
      expect(index, name).toBeGreaterThan(-1);
      return index;
    };
    expect(at("The stable download's fixed name (LP-1 — stable only)")).toBeLessThan(
      at("Verify again, on the bytes about to be published (D8)"),
    );
    expect(at("The published DMG is signed, notarized and stapled (LP-1)")).toBeLessThan(
      at("Checksums"),
    );
    expect(at("Verify again, on the bytes about to be published (D8)")).toBeLessThan(
      at("Checksums"),
    );
    // the upload of release-final is the job's last step, after the sums
    expect(stepsOf("converge").at(-1)?.text).toMatch(/^ {6}- uses: actions\/upload-artifact@/);
  });

  it("LP-1: the fixed-name DMG is made on a stable alone, by the real script", () => {
    const step = stepsOf("converge").find(
      (entry) => entry.name === "The stable download's fixed name (LP-1 — stable only)",
    );
    expect(step?.text).toMatch(/\n {8}if: needs\.plan\.outputs\.channel == 'stable'\n/);
    const command = /\n {8}run: (node scripts\/release-assets\.mjs alias [^\n]+)/.exec(
      step?.text ?? "",
    )?.[1];
    expect(command).toBe(
      'node scripts/release-assets.mjs alias --dir release-out --channel "$CHANNEL" --version "$VERSION"',
    );
    // the name lives in release-assets.mjs; the workflow says it once, in that step's comment
    expect(yml.match(/VibeField-mac-arm64\.dmg/g)).toHaveLength(1);
    const script = realpathSync(join(REPO, "scripts", "release-assets.mjs"));
    const runnable = command!.replace(
      "node scripts/release-assets.mjs",
      `"${process.execPath}" "${script}"`,
    );
    for (const channel of ["nightly", "beta", "stable"]) {
      const dir = scratch();
      mkdirSync(join(dir, "release-out"));
      writeFileSync(join(dir, "release-out", "VibeField-0.9.0-arm64.dmg"), "the stapled DMG");
      execFileSync("bash", ["-euc", runnable], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, CHANNEL: channel, VERSION: "0.9.0" },
      });
      const names = readdirSync(join(dir, "release-out")).sort();
      expect(names, channel).toEqual(
        channel === "stable"
          ? ["VibeField-0.9.0-arm64.dmg", STABLE_DMG_ALIAS]
          : ["VibeField-0.9.0-arm64.dmg"],
      );
    }
  });

  // LP-1's review (2026-11-05): an UNSIGNED build's app is still signed — ad hoc. after-pack.mjs flips the fuses with
  // `resetAdHocDarwinSignature`, and @electron/fuses then runs `codesign --sign - --force --deep` on the whole .app;
  // with `identity: null` electron-builder leaves that signature in place. So `codesign --display` exits 0 on both
  // paths, and only a Developer ID Application authority on the app may make the DMG's assessment strict. The fake
  // answers as Apple's codesign does: on stderr, the authority chain only at --verbose=2 and up, exit 1 for an app that
  // carries no signature at all.
  const CODESIGN_DISPLAY = String.raw`#!/bin/sh
[ "$1" = "--display" ] || exit 99
loud=no
case "$2" in --verbose=[2-9]) loud=yes ;; esac
case "$APP_SIGNATURE" in
  developer-id)
    printf 'Executable=%s/Contents/MacOS/VibeField\nIdentifier=dev.vibefield.app\n' "$3" >&2
    if [ "$loud" = yes ]; then
      printf 'Signature size=9045\nAuthority=Developer ID Application: VibeField (9F79X9D26S)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTimestamp=5 Nov 2026 at 01:04:00\nNotarization Ticket=stapled\nTeamIdentifier=9F79X9D26S\n' >&2
    fi
    ;;
  adhoc)
    printf 'Executable=%s/Contents/MacOS/VibeField\nIdentifier=dev.vibefield.app\n' "$3" >&2
    if [ "$loud" = yes ]; then
      printf 'CodeDirectory v=20500 size=511 flags=0x20002(adhoc,linker-signed) hashes=5+7 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\n' >&2
    fi
    ;;
  *)
    printf '%s: code object is not signed at all\n' "$3" >&2
    exit 1
    ;;
esac
exit 0
`;

  it.each([
    ["developer-id", "strict"],
    ["adhoc", "warn"], // what every unsigned build's app really carries
    ["unsigned", "warn"],
    ["absent", "none"],
  ])(
    "LP-1: converge assesses the published DMG strictly only when the app inside carries a Developer ID (%s app)",
    (app, expected) => {
      const step = stepsOf("converge").find(
        (entry) => entry.name === "The published DMG is signed, notarized and stapled (LP-1)",
      );
      expect(step).toBeDefined();
      const dir = scratch();
      mkdirSync(join(dir, "bin"));
      if (app !== "absent") mkdirSync(join(dir, "unzipped", "VibeField.app"), { recursive: true });
      // codesign answers for the app; `node` records what the step asks of the assessor
      writeFileSync(join(dir, "bin", "codesign"), CODESIGN_DISPLAY, { mode: 0o755 });
      writeFileSync(
        join(dir, "bin", "node"),
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NODE_CALLS"\n',
        {
          mode: 0o755,
        },
      );
      const shell = step!.text.split("        run: |\n")[1]!.replace(/^ {10}/gm, "");
      const result = spawnSync("bash", ["-euc", shell], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(dir, "bin")}:${process.env.PATH}`,
          APP_SIGNATURE: app,
          NODE_CALLS: join(dir, "node-calls"),
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = readdirSync(dir).includes("node-calls")
        ? readFileSync(join(dir, "node-calls"), "utf8").trim().split("\n")
        : [];
      if (expected === "strict") {
        expect(calls).toEqual([
          "apps/desktop/packaging/notarize-dmg.mjs --dir release-out --validate-only",
        ]);
      } else {
        expect(calls).toEqual([]);
        expect(result.stdout).toContain(
          expected === "warn" ? "::warning title=Unsigned macOS build::" : "no macOS app",
        );
      }
    },
  );

  // 2026-10-26: GitHub refuses GITHUB_TOKEN a tag (and so a release that would create one) at a commit whose
  // .github/workflows differ from main's head. Nightly 40342606623's publish met that twice, after a push that changed
  // workflows. So the tag is made at plan time, when the planned commit IS main's head, and publish only asserts it.
  it("makes the run's tag right after plan, before verify; publish asserts it and never targets a commit", () => {
    const tag = jobs.get("tag") ?? "";
    expect(tag).toMatch(/\n {4}needs: plan\n/);
    expect(tag).toMatch(
      /node scripts\/release-plan\.mjs tag --tag "\$TAG" --commit "\$COMMIT" --existing "\$existing"/,
    );
    expect(tag).toMatch(/git\/refs/);
    expect(jobs.get("verify")).toMatch(/\n {4}needs: \[plan, tag\]\n/);
    expect(jobs.get("build")).toMatch(/\n {4}needs: \[plan, tag, verify\]\n/);
    const publish = stepsOf("publish").map((step) => step.name);
    expect(publish.indexOf("The tag points at the planned commit")).toBeGreaterThan(-1);
    expect(publish.indexOf("The tag points at the planned commit")).toBeLessThan(
      publish.indexOf("Draft, payloads, then metadata last"),
    );
    expect(jobs.get("publish")).not.toMatch(/--target/);
    // "unchanged since the last nightly" reads the newest PUBLISHED nightly, never the newest tag
    expect(jobs.get("plan")).toMatch(/--last-published-nightly-commit "\$LAST_PUBLISHED_COMMIT"/);
    expect(jobs.get("plan")).not.toMatch(/--last-nightly-commit/);
  });

  it.each(["flat", "named"])(
    "stages the downloaded build payloads from a %s artifact layout",
    (layout) => {
      const dir = scratch();
      const build = join(dir, "builds", ...(layout === "named" ? ["build-mac-arm64"] : []));
      mkdirSync(build, { recursive: true });
      mkdirSync(join(dir, "bin"));
      // No earlier release: exercise the workflow's real staging shell without GitHub access.
      writeFileSync(join(dir, "bin", "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(join(build, "VibeField.zip"), "installer bytes");
      writeFileSync(join(build, "latest-mac.yml"), "unsigned feed");
      writeFileSync(join(build, "hashes-mac-arm64.json"), "{}");
      const step = stepsOf("sign").find(
        (entry) => entry.name === "The previous releases' truth (D4, D5, D11)",
      );
      expect(step).toBeDefined();
      const shell = step!.text.split("        run: |\n")[1]!.replace(/^ {10}/gm, "");
      execFileSync("bash", ["-euc", shell], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${join(dir, "bin")}:${process.env.PATH}`,
          CHANNEL: "nightly",
          GITHUB_REPOSITORY: "test/release",
        },
      });
      expect(readdirSync(join(dir, "release-out")).sort()).toEqual([
        "VibeField.zip",
        "latest-mac.yml",
      ]);
      expect(readFileSync(join(dir, "release-out", "VibeField.zip"), "utf8")).toBe(
        "installer bytes",
      );
      expect(readFileSync(join(build, "hashes-mac-arm64.json"), "utf8")).toBe("{}");
    },
  );

  // 862e2e5da's TCP rule has ONE copy since LP-1's review (2026-11-05), the composite: every job whose steps reach
  // Apple's ticket service — build's signed package (notarytool, stapler staple) and converge's assessment of the
  // published DMG (stapler validate, spctl) — runs it first, under the same guard.
  const TCP_STEP = "Use TCP for Apple notarization tickets";
  const TCP_ACTION = join(REPO, ".github", "actions", "apple-tickets-over-tcp", "action.yml");

  it("routes Apple tickets over TCP before every step that reaches Apple's ticket service", () => {
    const reachesApple = /pnpm run package:mac:release|notarize-dmg\.mjs --dir \S+ --validate-only/;
    const first: Record<string, string> = {};
    for (const job of jobs.keys()) {
      const steps = stepsOf(job);
      const at = steps.findIndex((step) => reachesApple.test(step.text));
      if (at === -1) continue;
      first[job] = steps[at]!.name;
      const tcp = steps.findIndex((step) => step.name === TCP_STEP);
      expect(tcp, job).toBeGreaterThan(-1);
      expect(tcp, job).toBeLessThan(at);
      expect(steps[tcp]!.text, job).toContain(
        "if: runner.os == 'macOS' && vars.VIBEFIELD_MAC_SIGNING == 'true'",
      );
      expect(steps[tcp]!.text, job).toMatch(
        /\n {8}uses: \.\/\.github\/actions\/apple-tickets-over-tcp\n/,
      );
    }
    expect(first).toEqual({
      build: "Package, signed (J4 — the Apple credentials exist)",
      converge: "The published DMG is signed, notarized and stapled (LP-1)",
    });
    // the packet-filter rule lives in the composite alone
    expect(yml).not.toMatch(/pfctl/);
  });

  it.each(["Disabled", "Enabled", "unrecognized"])(
    "routes Apple tickets over TCP only with an inactive packet filter (%s)",
    (state) => {
      const action = readFileSync(TCP_ACTION, "utf8");
      expect(action).toMatch(/\nruns:\n {2}using: composite\n/);
      expect(action).toMatch(/\n {6}shell: bash\n/);
      const dir = scratch();
      mkdirSync(join(dir, "bin"));
      // Execute the composite's real shell, with every privileged call intercepted by the fixture.
      writeFileSync(
        join(dir, "bin", "sudo"),
        `#!/bin/sh
printf '%s\n' "$*" >> "$PF_CALLS"
case "$*" in
  'pfctl -s info') printf 'Status: %s\n' "$PF_STATE" ;;
  'pfctl -f -') cat > "$PF_RULES" ;;
  'pfctl -E') ;;
  *) exit 99 ;;
esac
`,
        { mode: 0o755 },
      );
      const shell = action.split("      run: |\n")[1]!.replace(/^ {8}/gm, "");
      const result = spawnSync("bash", ["-euc", shell], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(dir, "bin")}:${process.env.PATH}`,
          PF_STATE: state,
          PF_CALLS: join(dir, "calls"),
          PF_RULES: join(dir, "rules"),
        },
      });
      const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
      if (state === "Disabled") {
        expect(result.status, result.stderr).toBe(0);
        expect(calls).toEqual(["pfctl -s info", "pfctl -f -", "pfctl -E"]);
        expect(readFileSync(join(dir, "rules"), "utf8")).toBe(
          "block return out quick proto udp from any to any port 443\n",
        );
      } else {
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Refusing to replace");
        expect(calls).toEqual(["pfctl -s info"]);
        expect(readdirSync(dir)).not.toContain("rules");
      }
    },
  );

  it("chooses nightly revisions in numeric order, including .10 after .9", () => {
    const dir = scratch();
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init");
    git(
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
    for (const tag of [
      "nightly-20261102.99",
      "nightly-20261103",
      "nightly-20261103.1",
      "nightly-20261103.9",
      "nightly-20261103.10",
    ])
      git("tag", tag);
    const command = /last=\$\((git tag [^\n]+)\)/.exec(jobs.get("plan") ?? "")?.[1];
    expect(command).toBeDefined();
    expect(execFileSync("bash", ["-euc", command!], { cwd: dir, encoding: "utf8" }).trim()).toBe(
      "nightly-20261103.10",
    );
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
    expect(/needs: \[plan, converge, attest\]/.test(jobs.get("publish") ?? "")).toBe(true);
  });

  // AU-6 (LC-18; X8): the plan time rides from the plan job to every stage step, beside the channel, and the stager
  // writes it into the identity as `builtAt`.
  it("AU-6: plan outputs builtAt, and every stage step passes it as VIBEFIELD_BUILT_AT beside the channel", () => {
    expect(jobs.get("plan")).toMatch(/\n {6}builtAt: \$\{\{ steps\.plan\.outputs\.builtAt \}\}\n/);
    const stamped = stepsOf("build").filter((step) => /VIBEFIELD_RELEASE_CHANNEL:/.test(step.text));
    expect(stamped.map((step) => step.name)).toEqual([
      "Package, signed (J4 — the Apple credentials exist)",
      "Stage, release-keyed (TD-3 — the bundled index is signed here)",
    ]);
    for (const step of stamped)
      expect(step.text, step.name).toMatch(
        /\n {10}VIBEFIELD_BUILT_AT: \$\{\{ needs\.plan\.outputs\.builtAt \}\}(\n|$)/,
      );
  });

  // AU-6 (AU-D10 A; LC-19): the notes are computed in the sign job from its whole history, BEFORE Merge writes them
  // into the manifest the Sign step signs, and with no secret in reach (the release key stays the Sign step's alone).
  it("AU-6: the sign job reads the whole history; the notes step runs before Merge with no secret; Merge carries them", () => {
    const steps = stepsOf("sign");
    expect(steps[0]?.text).toMatch(/^ {6}- uses: actions\/checkout@/);
    expect(steps[0]?.text).toMatch(/\n {10}fetch-depth: 0(\n|$)/);
    const names = steps.map((step) => step.name);
    const truth = names.indexOf("The previous releases' truth (D4, D5, D11)");
    const notes = names.indexOf("The notes (AU-6 — signed with the manifest)");
    const merge = names.indexOf("Merge the planes (D11)");
    expect(truth).toBeGreaterThan(-1);
    expect([notes, merge]).toEqual([truth + 1, truth + 2]);
    expect(names.indexOf("Sign (TD-3, D8 — the release key, in this step alone)")).toBeGreaterThan(
      merge,
    );
    const step = steps[notes]?.text ?? "";
    // its env is the plan's four values, and nothing else: no secret, no token
    expect([...step.matchAll(/\n {10}([A-Z_]+): /g)].map((m) => m[1])).toEqual([
      "TAG",
      "CHANNEL",
      "VERSION",
      "COMMIT",
    ]);
    expect(step).not.toMatch(/secrets\.|github\.token|GH_TOKEN|VIBEFIELD_RELEASE_SECRET/);
    expect(step).toMatch(/node scripts\/release-notes\.mjs /);
    // the SAME previous manifest Merge names, and the file Merge reads
    expect(step).toMatch(/--previous previous-channel\/release-manifest\.json --out notes\.json/);
    expect(steps[merge]?.text).toMatch(/--previous previous-channel\/release-manifest\.json /);
    expect(steps[merge]?.text).toMatch(
      /--notes notes\.json --out release-out\/release-manifest\.json/,
    );
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

  // EL8 (2026-10-21): a `stable`-branch action installed the day's stable, and rustc 1.99.1's clippy reddened main while
  // the Mac held 1.97.1. rust-toolchain.toml is the ONE declaration (rustup reads it on both planes); a workflow's Rust
  // step is the bare install of the file it stands in, and names no toolchain of its own.
  it("declares the Rust toolchain once: rust-toolchain.toml at an exact release, every Rust step a bare install", () => {
    expect(readFileSync(join(REPO, "rust-toolchain.toml"), "utf8")).toMatch(
      /^channel = "\d+\.\d+\.\d+"$/m,
    );
    const files = [
      ...readdirSync(WORKFLOWS).map((name) => join(WORKFLOWS, name)),
      ...readdirSync(join(REPO, ".github", "actions")).map((dir) =>
        join(REPO, ".github", "actions", dir, "action.yml"),
      ),
    ];
    let steps = 0;
    for (const file of files) {
      // the lines a runner executes or reads as keys; comments may name the step in prose
      const lines = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"));
      for (const line of lines) {
        expect(line, file).not.toMatch(/rust-toolchain@|toolchain:\s|RUSTUP_TOOLCHAIN|cargo \+/);
        const rustup = /rustup (?:toolchain install|default|override set)\b.*/.exec(line);
        if (rustup === null) continue;
        expect(rustup[0], file).toBe("rustup toolchain install --no-self-update");
        steps += 1;
      }
    }
    expect(steps).toBe(4); // verify, release, audit, prepare-mille
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
