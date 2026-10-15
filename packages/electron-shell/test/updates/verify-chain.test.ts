import { describe, expect, it } from "vitest";
import {
  atLeast,
  feedVersionOf,
  NOTHING_REMEMBERED,
  newestTagFromAtom,
  type RememberedVersions,
  verifyUpdateChain,
  withFloors,
} from "../../src/main/updates/verify-chain";
import { FixtureOrigin, NOW, ORIGIN, PAST } from "./fixture-release";

// WP12b, W3 (build-wp12-updater.md §3, §5) — the chain verified BEFORE any download: the good chain and each
// refusal state, named, plus D4's resolution (heads, never a nightly for a beta client), D5's policy from the NEWEST
// release, and TD-10's memory (every accepted document remembered, even when a later step refuses).

const NIGHTLY = "nightly-20261016";
const BETA = "v0.9.0-beta.3";

function world(): FixtureOrigin {
  const fx = new FixtureOrigin();
  fx.setReleases([NIGHTLY, BETA]);
  fx.putRelease(NIGHTLY, { heads: { nightly: NIGHTLY, beta: BETA, stable: null } });
  fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016");
  fx.putFeed(BETA, "0.9.0-beta.3");
  return fx;
}

const run = (
  fx: FixtureOrigin,
  channel: "nightly" | "beta" | "stable" = "nightly",
  remembered: RememberedVersions = NOTHING_REMEMBERED,
) =>
  verifyUpdateChain({
    origin: ORIGIN,
    channel,
    rootKeys: fx.rootKeys,
    remembered,
    now: NOW,
    feedFile: "latest-mac.yml",
    fetch: fx.fetch,
  });

describe("the update chain (TD §4, D4, D5)", () => {
  it("verifies the good chain and hands back the head's feed, its base and what it accepted", async () => {
    const fx = world();
    const result = await run(fx, "nightly");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.head).toBe(NIGHTLY);
    expect(result.headBase).toBe(`${ORIGIN}/download/${NIGHTLY}/`);
    expect(result.feedText).toMatch(/^version: 0\.9\.0-nightly\.20261016$/m);
    expect(result.policy.channel).toBe("nightly");
    expect(result.remembered).toEqual({
      trustRoot: 1,
      channels: 10,
      policy: { nightly: 3, beta: null, stable: null },
    });
  });

  it("resolves a beta client to the beta head — and the beta's feed — through the newest (nightly) release", async () => {
    const fx = world();
    const result = await run(fx, "beta");
    expect(result.ok && result.head).toBe(BETA);
    expect(result.ok && result.feedText).toMatch(/^version: 0\.9\.0-beta\.3$/m);
    // the policy came from the NEWEST release (D5), the feed from the head
    expect(fx.requests).toContain(`${ORIGIN}/download/${NIGHTLY}/update-policy.beta.json`);
    expect(fx.requests).toContain(`${ORIGIN}/download/${BETA}/latest-mac.yml`);
  });

  it("refuses a feed signed by a stranger: feed-unverified, and nothing past it", async () => {
    const fx = world();
    fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016", fx.stranger);
    const result = await run(fx);
    expect(result).toMatchObject({ ok: false, state: "feed-unverified" });
    expect(!result.ok && result.detail).toMatch(/latest-mac\.yml does not verify/);
  });

  it("refuses a policy signed by a stranger: feed-unverified, and never fetches the feed", async () => {
    const fx = world();
    fx.putJson(
      NIGHTLY,
      "update-policy.nightly.json",
      {
        version: 3,
        generatedAt: NOW - 1000,
        expires: "2026-12-14T00:00:00Z",
        channel: "nightly",
        trustRootVersion: 1,
        killSwitch: false,
        requireUserConfirmation: false,
      },
      fx.stranger,
    );
    const result = await run(fx);
    expect(result).toMatchObject({ ok: false, state: "feed-unverified" });
    expect(fx.requests.some((url) => url.endsWith("latest-mac.yml"))).toBe(false);
  });

  it("refuses a policy rolled back below the remembered version: policy-rollback", async () => {
    const fx = world();
    const remembered = { ...NOTHING_REMEMBERED, policy: { nightly: 9, beta: null, stable: null } };
    expect(await run(fx, "nightly", remembered)).toMatchObject({
      ok: false,
      state: "policy-rollback",
    });
  });

  it("refuses an expired policy: policy-expired (STALE fails closed)", async () => {
    const fx = world();
    fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: BETA, stable: null },
      policyExpires: PAST,
    });
    expect(await run(fx)).toMatchObject({ ok: false, state: "policy-expired" });
    // expired channel heads are STALE the same way, and nothing past them is fetched
    const heads = world();
    heads.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: BETA, stable: null },
      headsExpires: PAST,
    });
    expect(await run(heads)).toMatchObject({ ok: false, state: "policy-expired" });
    expect(heads.requests.some((url) => url.endsWith("update-policy.nightly.json"))).toBe(false);
  });

  it("refuses a trust-root signed by a key the app does not embed: trust-root-rejected", async () => {
    const fx = world();
    fx.putRelease(NIGHTLY, {
      heads: { nightly: NIGHTLY, beta: BETA, stable: null },
      trustRootSigner: fx.release,
    });
    const result = await run(fx);
    expect(result).toMatchObject({ ok: false, state: "trust-root-rejected" });
    expect(result.remembered.trustRoot).toBeNull();
  });

  it("says channel-unresolved when the heads name no release for the client's channel", async () => {
    const fx = world();
    expect(await run(fx, "stable")).toMatchObject({ ok: false, state: "channel-unresolved" });
  });

  it("never hands a beta client a nightly, whatever the atom feed lists", async () => {
    const fx = world();
    fx.putRelease(NIGHTLY, { heads: { nightly: NIGHTLY, beta: null, stable: null } });
    const result = await run(fx, "beta");
    expect(result).toMatchObject({ ok: false, state: "channel-unresolved" });
    expect(fx.requests.some((url) => url.endsWith(`${NIGHTLY}/latest-mac.yml`))).toBe(false);
  });

  it("refuses rolled-back channel heads and a rolled-back trust-root", async () => {
    const fx = world();
    expect(await run(fx, "nightly", { ...NOTHING_REMEMBERED, channels: 11 })).toMatchObject({
      ok: false,
      state: "policy-rollback",
    });
    expect(await run(fx, "nightly", { ...NOTHING_REMEMBERED, trustRoot: 2 })).toMatchObject({
      ok: false,
      state: "trust-root-rejected",
    });
  });

  it("refuses a policy that names another channel", async () => {
    const fx = world();
    fx.putJson(
      NIGHTLY,
      "update-policy.beta.json",
      {
        version: 3,
        generatedAt: NOW - 1000,
        expires: "2026-12-14T00:00:00Z",
        channel: "stable",
        trustRootVersion: 1,
        killSwitch: false,
        requireUserConfirmation: false,
      },
      fx.release,
    );
    const result = await run(fx, "beta");
    expect(result).toMatchObject({ ok: false, state: "feed-unverified" });
    expect(!result.ok && result.detail).toMatch(/names the stable channel/);
  });

  it("remembers every ACCEPTED document even when a later step refuses (TD-10)", async () => {
    const fx = world();
    fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016", fx.stranger);
    const result = await run(fx);
    expect(result.ok).toBe(false);
    expect(result.remembered).toEqual({
      trustRoot: 1,
      channels: 10,
      policy: { nightly: 3, beta: null, stable: null },
    });
  });

  it("with no atom feed, reads the newest STABLE release through releases/latest/download", async () => {
    const fx = new FixtureOrigin();
    // no releases listed: the atom fetch is absent
    const result = await run(fx, "stable");
    expect(fx.requests).toContain(`${ORIGIN}/latest/download/trust-root.json`);
    expect(result).toMatchObject({ ok: false, state: "channel-unresolved" });
  });

  it("judges against the BUILD's floor: an empty (or hand-lowered) memory never goes below it", async () => {
    const fx = world();
    const floors = {
      trustRoot: 2,
      channels: null,
      policy: { nightly: null, beta: null, stable: null },
    };
    const refused = await verifyUpdateChain({
      origin: ORIGIN,
      channel: "nightly",
      rootKeys: fx.rootKeys,
      remembered: NOTHING_REMEMBERED,
      floors,
      now: NOW,
      feedFile: "latest-mac.yml",
      fetch: fx.fetch,
    });
    expect(refused).toMatchObject({ ok: false, state: "trust-root-rejected" });
    expect(!refused.ok && refused.detail).toMatch(/older than the accepted v2/);
    const policyFloor = await verifyUpdateChain({
      origin: ORIGIN,
      channel: "nightly",
      rootKeys: fx.rootKeys,
      remembered: NOTHING_REMEMBERED,
      floors: { trustRoot: 1, channels: null, policy: { nightly: 5, beta: null, stable: null } },
      now: NOW,
      feedFile: "latest-mac.yml",
      fetch: fx.fetch,
    });
    expect(policyFloor).toMatchObject({ ok: false, state: "policy-rollback" });
  });

  it("a floor never lowers what the client remembers", () => {
    expect(
      withFloors(
        { trustRoot: 4, channels: 20, policy: { nightly: 7, beta: null, stable: 2 } },
        { trustRoot: 1, channels: null, policy: { nightly: 3, beta: 2, stable: null } },
      ),
    ).toEqual({ trustRoot: 4, channels: 20, policy: { nightly: 7, beta: 2, stable: 2 } });
    expect(atLeast(null, null)).toBeNull();
  });

  it("reads the newest tag from GitHub's atom feed — the FIRST entry", () => {
    const atom =
      '<feed><entry><link href="https://github.com/o/r/releases/tag/nightly-20261016"/></entry><entry><link href="https://github.com/o/r/releases/tag/v0.9.0-beta.3"/></entry></feed>';
    expect(newestTagFromAtom(atom)).toBe("nightly-20261016");
    expect(newestTagFromAtom("<feed></feed>")).toBeNull();
  });
});

// WP12d (L3b-i, build-wp12-updater.md §12 B3) — step 6b: the head's signed release manifest, read so the native plane
// is judged by digest. Absent is honest (`null`: every plane counts as touched); one that does not verify, or names
// another release, refuses the chain like a bad feed.
describe("step 6b — the head's release manifest (B3)", () => {
  const NATIVE = {
    digest: "d".repeat(64),
    members: ["bin/field-native", "bin/field-terminal-host", "bin/sidecar-slim"],
  };

  it("a signed manifest naming the head comes back parsed, with the feed's version", async () => {
    const fx = world();
    fx.putManifest(NIGHTLY, "0.9.0-nightly.20261016", NATIVE);
    const result = await run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headVersion).toBe("0.9.0-nightly.20261016");
    expect(result.manifest?.builds["mac-arm64"]?.["field-native"]).toEqual({
      digest: NATIVE.digest,
      files: 3,
      members: NATIVE.members,
    });
  });

  it("a release without one is `null`, never a refusal", async () => {
    const result = await run(world());
    expect(result).toMatchObject({
      ok: true,
      manifest: null,
      headVersion: "0.9.0-nightly.20261016",
    });
  });

  it("refuses a manifest signed by another key, or naming another release", async () => {
    const forged = world();
    forged.putManifest(NIGHTLY, "0.9.0-nightly.20261016", NATIVE, { signer: forged.stranger });
    expect(await run(forged)).toMatchObject({
      ok: false,
      state: "feed-unverified",
      detail: "release-manifest.json does not verify by the release role",
    });
    const elsewhere = world();
    elsewhere.putManifest(NIGHTLY, "0.9.0-nightly.20261016", NATIVE, {
      nameTag: "nightly-20261015",
    });
    expect(await run(elsewhere)).toMatchObject({ ok: false, state: "feed-unverified" });
    const otherVersion = world();
    otherVersion.putManifest(NIGHTLY, "0.9.0-nightly.20261016", NATIVE, {
      nameVersion: "0.9.0-nightly.20261015",
    });
    expect(await run(otherVersion)).toMatchObject({ ok: false, state: "feed-unverified" });
  });

  it("refuses a manifest whose native plane does not name its members", async () => {
    const fx = world();
    fx.putManifest(NIGHTLY, "0.9.0-nightly.20261016", { digest: NATIVE.digest, members: [] });
    // `files` counts the members, so an empty list with files 0 is well-formed; a missing list is not:
    const result = await run(fx);
    expect(result.ok).toBe(true);
    fx.putJson(
      NIGHTLY,
      "release-manifest.json",
      {
        schemaVersion: 1,
        version: "0.9.0-nightly.20261016",
        tag: NIGHTLY,
        channel: "nightly",
        commit: "a".repeat(40),
        builds: { "mac-arm64": { "field-native": { digest: NATIVE.digest, files: 3 } } },
        touched: ["field-native"],
        previous: null,
      },
      fx.release,
    );
    expect(await run(fx)).toMatchObject({
      ok: false,
      state: "feed-unverified",
      detail: expect.stringMatching(/names its members/),
    });
  });

  it("reads the feed's version line, quoted or not", () => {
    expect(feedVersionOf("version: 0.9.0\nfiles: []\n")).toBe("0.9.0");
    expect(feedVersionOf("files: []\nversion: '1.2.3-beta.1'\n")).toBe("1.2.3-beta.1");
    expect(feedVersionOf("files: []\n")).toBeNull();
  });
});
