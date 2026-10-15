import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RegistryIndexV2 } from "../src/plugin-distribution";
import {
  Ed25519SpkiBase64,
  judgeSignedDocument,
  TRUST_FRESHNESS_DAYS,
  TrustRoot,
  trustRoleKeys,
} from "../src/trust-root";
import {
  CHANNEL_HEADS_FILE,
  ChannelHeads,
  UPDATE_CHANNELS,
  UPDATES_SERVICE,
  UpdatePolicy,
  updatePolicyFile,
} from "../src/update-policy";

// TD-0 (specs/trust-and-distribution.md §2, §3, §6.3; TD-1, TD-9, TD-10) — the refusals each shape
// owes, made inline from the golden fixtures (every file in fixtures/ must parse, so a refusal case
// cannot be a fixture). The fixture keys are public halves minted for the fixture; no secret exists.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const fixture = <T>(name: string): T => JSON.parse(read(name)) as T;
type Json = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const issues = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);

/** The kit's canonicalJson for plain JSON (keys sorted recursively, 2-space indent, one newline). */
const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Json)
              .sort()
              .map((k) => [k, sort((v as Json)[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
};

describe("the trust-root (§2, TD-1)", () => {
  const base = fixture<
    Json & { root: { keys: string[] }; roles: Record<string, { keys: string[] }> }
  >("trust-root.valid.json");

  it("the fixture is the canonical form assemble writes, so its bytes are signable as they stand", () => {
    expect(read("trust-root.valid.json")).toBe(canonical(base));
  });

  it("names every key once, and a role's keys by name", () => {
    const doc = TrustRoot.parse(base);
    expect(trustRoleKeys(doc, "root").keys).toHaveLength(2);
    expect(trustRoleKeys(doc, "bundled").keys).toEqual(base.roles["bundled"]?.keys);
  });

  it("refuses a root key named as an online role's (the root is offline)", () => {
    const doc = clone(base);
    doc.roles["release"] = { keys: [doc.root.keys[0] as string] };
    (doc.roles["release"] as Json)["threshold"] = 1;
    expect(issues(TrustRoot.safeParse(doc)).join()).toMatch(/also a key of root/);
  });

  it("refuses one key shared by two roles (a registry key signing the bundled index)", () => {
    const doc = clone(base);
    (doc.roles["bundled"] as { keys: string[] }).keys = [...(doc.roles["registry"]?.keys ?? [])];
    expect(issues(TrustRoot.safeParse(doc)).join()).toMatch(/also a key of bundled/);
  });

  it("refuses a threshold the keys cannot meet, a duplicate key, and a zero threshold", () => {
    const over = clone(base);
    (over.root as Json)["threshold"] = 3;
    expect(issues(TrustRoot.safeParse(over)).join()).toMatch(/cannot be met by 2/);
    const twice = clone(base);
    twice.root.keys = [twice.root.keys[0] as string, twice.root.keys[0] as string];
    expect(issues(TrustRoot.safeParse(twice)).join()).toMatch(/listed twice/);
    const zero = clone(base);
    (zero.root as Json)["threshold"] = 0;
    expect(TrustRoot.safeParse(zero).success).toBe(false);
  });

  it("refuses a root of one key (TD-1: two keys, so one lost device strands no client)", () => {
    const single = clone(base);
    single.root.keys = [single.root.keys[0] as string];
    expect(issues(TrustRoot.safeParse(single)).join()).toMatch(/at least two keys/);
  });

  it("refuses a missing role, another schema, a fractional version and an unzoned expiry", () => {
    const missing = clone(base);
    delete missing.roles["registry"];
    expect(TrustRoot.safeParse(missing).success).toBe(false);
    expect(TrustRoot.safeParse({ ...clone(base), schemaVersion: 2 }).success).toBe(false);
    expect(TrustRoot.safeParse({ ...clone(base), version: 1.5 }).success).toBe(false);
    expect(TrustRoot.safeParse({ ...clone(base), expires: "2027-04-12 00:00" }).success).toBe(
      false,
    );
  });

  it("an Ed25519 public key passes; a secret, another curve and a truncation never do", () => {
    const key = base.root.keys[0] as string;
    expect(Ed25519SpkiBase64.safeParse(key).success).toBe(true);
    // a PKCS#8 secret's encoding (header MC4CAQAw…, 64 characters) — the confusion this rule exists for
    const secretShaped = `MC4CAQAwBQYDK2VwBCIEI${"A".repeat(43)}`;
    expect(Ed25519SpkiBase64.safeParse(secretShaped).success).toBe(false);
    // an X25519 public key has the same length and a different OID
    expect(Ed25519SpkiBase64.safeParse(`MCowBQYDK2VuAyEA${key.slice(16)}`).success).toBe(false);
    expect(Ed25519SpkiBase64.safeParse(key.slice(0, -2)).success).toBe(false);
  });

  it("tolerates an unknown field (the tolerant reader) and keeps it", () => {
    const doc = TrustRoot.parse({ ...clone(base), comment: "rotated 2027" }) as Json;
    expect(doc["comment"]).toBe("rotated 2027");
  });
});

describe("a signed document's freshness (TD-10)", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  const doc = { version: 4, expires: "2026-12-13T00:00:00Z" };

  it("accepts a newer or the same version that has not expired", () => {
    expect(judgeSignedDocument(doc, { lastAcceptedVersion: null, now })).toBe("accepted");
    expect(judgeSignedDocument(doc, { lastAcceptedVersion: 3, now })).toBe("accepted");
    expect(judgeSignedDocument(doc, { lastAcceptedVersion: 4, now })).toBe("accepted");
  });

  it("refuses a lower version than the last accepted (a rollback), before anything else", () => {
    expect(judgeSignedDocument(doc, { lastAcceptedVersion: 5, now })).toBe("rollback");
    expect(
      judgeSignedDocument(doc, { lastAcceptedVersion: 5, now: Date.parse("2030-01-01T00:00:00Z") }),
    ).toBe("rollback");
  });

  it("calls an expired (or unreadable) expiry STALE, never accepted", () => {
    expect(judgeSignedDocument(doc, { lastAcceptedVersion: 4, now: Date.parse(doc.expires) })).toBe(
      "stale",
    );
    expect(
      judgeSignedDocument({ version: 4, expires: "soon" }, { lastAcceptedVersion: null, now }),
    ).toBe("stale");
  });

  it("states the spec's lifetimes", () => {
    expect(TRUST_FRESHNESS_DAYS).toEqual({ trustRoot: 180, updatePolicy: 60, registryIndex: 90 });
  });
});

describe("the update policy (EDP-37 + TD-3/TD-10)", () => {
  const base = fixture<Json>("update-policy.valid.json");

  it("parses with the TD fields and fills the defaults of a minimal policy", () => {
    const minimal = UpdatePolicy.parse({
      version: 1,
      generatedAt: 0,
      expires: "2026-12-13T00:00:00Z",
      channel: "nightly",
      trustRootVersion: 1,
      killSwitch: false,
      requireUserConfirmation: true,
    });
    expect(minimal.yanked).toEqual([]);
    expect(minimal.floors).toEqual({});
  });

  it("refuses a policy without its freshness fields (an unsigned-era asset is no policy at all)", () => {
    for (const field of ["version", "generatedAt", "expires", "channel", "trustRootVersion"]) {
      const policy = clone(base);
      delete policy[field];
      expect(UpdatePolicy.safeParse(policy).success, field).toBe(false);
    }
  });

  it("refuses an unknown channel, a yank listed twice and an expiry before generation", () => {
    expect(UpdatePolicy.safeParse({ ...clone(base), channel: "canary" }).success).toBe(false);
    expect(
      issues(UpdatePolicy.safeParse({ ...clone(base), yanked: ["0.9.0", "0.9.0"] })).join(),
    ).toMatch(/yanked twice/);
    expect(
      issues(UpdatePolicy.safeParse({ ...clone(base), expires: "1970-01-01T00:00:00Z" })).join(),
    ).toMatch(/expire before/);
  });
});

describe("the channel heads (WP12-D4) and the per-channel policy names (WP12-D5)", () => {
  const base = fixture<Json & { heads: Json }>("channel-heads.valid.json");

  it("names one policy file per channel and the heads file", () => {
    expect(UPDATE_CHANNELS.map(updatePolicyFile)).toEqual([
      "update-policy.nightly.json",
      "update-policy.beta.json",
      "update-policy.stable.json",
    ]);
    expect(CHANNEL_HEADS_FILE).toBe("channels.json");
  });

  it("accepts a channel with no head yet (null), and a head of each channel's own tag shape", () => {
    const heads = ChannelHeads.parse({
      ...clone(base),
      heads: { nightly: "nightly-20261016", beta: null, stable: "v0.9.0" },
    });
    expect(heads.heads.beta).toBeNull();
  });

  it("refuses a head of another channel's shape — a beta client must never resolve a nightly", () => {
    for (const [channel, head] of [
      ["beta", "nightly-20261016"],
      ["stable", "v0.9.0-beta.3"],
      ["nightly", "v0.9.0"],
      ["beta", "v0.9.0"],
    ] as const) {
      const doc = clone(base);
      doc.heads = { ...doc.heads, [channel]: head };
      expect(issues(ChannelHeads.safeParse(doc)).join(), `${channel} ← ${head}`).toMatch(
        new RegExp(`${channel} head`),
      );
    }
  });

  it("refuses heads without their freshness fields, and an expiry before generation", () => {
    for (const field of [
      "schemaVersion",
      "version",
      "generatedAt",
      "expires",
      "trustRootVersion",
      "heads",
    ]) {
      const doc = clone(base);
      delete doc[field];
      expect(ChannelHeads.safeParse(doc).success, field).toBe(false);
    }
    expect(
      issues(ChannelHeads.safeParse({ ...clone(base), expires: "1970-01-01T00:00:00Z" })).join(),
    ).toMatch(/expire before/);
  });

  it("states the updater's honest states, TD §4's four clauses among them", () => {
    expect(UPDATES_SERVICE.SERVICE).toBe("updates");
    const states = Object.entries(UPDATES_SERVICE)
      .filter(([key]) => key !== "SERVICE")
      .map(([, state]) => state);
    for (const clause of [
      "feed-unverified",
      "policy-expired",
      "policy-rollback",
      "trust-root-rejected",
    ]) {
      expect(states).toContain(clause);
    }
    expect(new Set(states).size).toBe(states.length);
  });
});

describe("the registry index v2 (§6.3, TD-9)", () => {
  const base = fixture<Json & { plugins: Record<string, Json>; publishers: Record<string, Json> }>(
    "registry-index-v2.valid.json",
  );
  const entry = (index: typeof base): Json => index.plugins["acme.jupyter"] as Json;

  it("parses, with each release's source and attestation", () => {
    const index = RegistryIndexV2.parse(base);
    const plugin = index.plugins["acme.jupyter"];
    expect(plugin?.latest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(plugin?.history[0]?.prerelease).toBe(false);
  });

  it("refuses a plugin outside its publisher's namespace, or under an unregistered publisher", () => {
    const outside = clone(base);
    entry(outside)["publisher"] = "vibefield";
    expect(issues(RegistryIndexV2.safeParse(outside)).join()).toMatch(
      /not in the vibefield namespace/,
    );
    const unregistered = clone(base);
    delete unregistered.publishers["acme"];
    expect(issues(RegistryIndexV2.safeParse(unregistered)).join()).toMatch(
      /not a registered publisher/,
    );
  });

  it("refuses an entry listed under another id, and a kill switch without its reason", () => {
    const misfiled = clone(base);
    misfiled.plugins["acme.other"] = entry(misfiled);
    expect(issues(RegistryIndexV2.safeParse(misfiled)).join()).toMatch(/listed under acme.other/);
    const killed = clone(base);
    entry(killed)["disabled"] = true;
    expect(issues(RegistryIndexV2.safeParse(killed)).join()).toMatch(/says why/);
    entry(killed)["disabledReason"] = "exfiltrates the clipboard (advisory 2026-10-20)";
    expect(RegistryIndexV2.safeParse(killed).success).toBe(true);
  });

  it("refuses a release without its source commit or attestation, and a v1 index", () => {
    const noCommit = clone(base);
    delete (entry(noCommit)["latest"] as Json)["sourceCommit"];
    expect(RegistryIndexV2.safeParse(noCommit).success).toBe(false);
    const shortAttestation = clone(base);
    (entry(shortAttestation)["latest"] as Json)["attestation"] = "sha256:abc";
    expect(RegistryIndexV2.safeParse(shortAttestation).success).toBe(false);
    expect(RegistryIndexV2.safeParse({ ...clone(base), schemaVersion: 1 }).success).toBe(false);
  });

  it("refuses an unknown rung and a capability that is neither a core scope nor x.<plugin>.<name>", () => {
    const rung = clone(base);
    entry(rung)["rung"] = "R9";
    expect(RegistryIndexV2.safeParse(rung).success).toBe(false);
    const capability = clone(base);
    entry(capability)["capabilities"] = ["everything"];
    expect(RegistryIndexV2.safeParse(capability).success).toBe(false);
  });
});
