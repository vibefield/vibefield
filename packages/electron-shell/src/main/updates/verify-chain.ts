// WP12b (build-wp12-updater.md §3, D4, D5; trust-and-distribution.md TD-3, TD-10, §4) — the update chain, verified
// BEFORE any payload download. Pure over a byte fetcher, so every refusal is a unit test; the UpdateProvider adapts
// electron-updater's HTTP executor to it and hands electron-updater only what this returns.
//
// The order (§3):
//   1. `releases.atom` → the NEWEST release's tag (its first entry). No atom → `releases/latest/download/`, which
//      always reaches stable (GitHub's own redirect), so a broken feed degrades to stable, never to nothing.
//   2. that release's `trust-root.json` + `.sig`, verified by the EMBEDDED root keys and judged for rollback/expiry.
//   3. its `channels.json` + `.sig`, verified by the trust-root's `release` keys and judged.
//   4. the head tag for the client's channel (null → channel-unresolved, quietly).
//   5. the NEWEST release's `update-policy.<channel>.json` + `.sig` (D5: every release carries all three, so a kill
//      switch for stable rides tomorrow's nightly), verified and judged; its `channel` must be the client's.
//   6. the HEAD release's `latest*.yml` + `.sig`, verified — and only now is anything handed to electron-updater,
//      whose own sha512 check of the payload descends from these signed bytes.
//   6b. (WP12d, L3b-i, B3) the HEAD release's `release-manifest.json` + `.sig`, verified, naming the head and its
//      version: the planes it touches are read by DIGEST from it (`native-plane.ts`). A release without one is `null`
//      (every plane counts as touched); one that does not verify, or names another release, refuses the chain.
// The policy's levers (killSwitch, yanked, floors, requireUserConfirmation, minSupported) are WP12d's: this chain
// verifies the document and returns it parsed, and `decide.ts` applies them (L3b-i, B1).
//
// Remembered versions (TD-10): each document is remembered the moment it is ACCEPTED, even when a later step
// refuses — a verified document is a fact, and forgetting it would let a replay of an older one through next time.

import {
  CHANNEL_HEADS_FILE,
  ChannelHeads,
  judgeSignedDocument,
  RELEASE_MANIFEST_FILE,
  ReleaseManifest,
  SIGNATURE_SUFFIX,
  TRUST_ROOT_FILE,
  type TrustRoot,
  UPDATES_SERVICE,
  type UpdateChannel,
  UpdatePolicy,
  type UpdatesUnavailableState,
  updatePolicyFile,
} from "@vibefield/contracts";
import { type TrustAnchor, verifySignedBytes, verifyTrustRoot } from "@vibefield/trust";

/** Fetch a URL's exact bytes: `null` when the file is absent (404); THROWS on a network failure (offline is not a
 * refusal — the controller says it quietly and retries). */
export type FetchBytes = (url: string) => Promise<Uint8Array | null>;

/** The last ACCEPTED version of each signed document (TD-10). `null` = never accepted one. */
export interface RememberedVersions {
  readonly trustRoot: number | null;
  readonly channels: number | null;
  readonly policy: Readonly<Record<UpdateChannel, number | null>>;
}

export const NOTHING_REMEMBERED: RememberedVersions = {
  trustRoot: null,
  channels: null,
  policy: { nightly: null, beta: null, stable: null },
};

export interface ChainInput {
  /** The frozen identity's `updateOrigin`, e.g. `https://github.com/vibefield/vibefield/releases` (EDP-30). */
  readonly origin: string;
  readonly channel: UpdateChannel;
  /** The root keys the client trusts: the app's EMBEDDED set (the staged identity's `trustRootKeys`, the only anchor
   * nothing remote can move), or the newest set it adopted by rotation from there (`root-chain.ts`, L3b-ii B5). */
  readonly rootKeys: readonly string[];
  readonly remembered: RememberedVersions;
  /** The build-time floor (the staged identity's `updateFloors`): every document is judged against
   * `max(remembered, floor)`, so a corrupt or hand-lowered client state resets to the build, never to zero. */
  readonly floors?: RememberedVersions;
  readonly now: number;
  /** The platform's feed file: `latest-mac.yml` · `latest-linux.yml` · `latest.yml`. */
  readonly feedFile: string;
  readonly fetch: FetchBytes;
}

/** L3b-ii (B5) — the trust-root the chain ACCEPTED (verified and judged), as text and signature, with its root set: the
 * controller persists it when its root set differs from the anchor's (a rotation). */
export interface AcceptedRoot {
  readonly version: number;
  readonly doc: string;
  readonly sig: string;
  readonly rootKeys: readonly string[];
}

export interface VerifiedChain {
  readonly ok: true;
  /** The head release's tag, and its download base (with a trailing slash, for `resolveFiles`). */
  readonly head: string;
  readonly headBase: string;
  /** The verified feed's file name and exact text, for electron-updater's `parseUpdateInfo`. */
  readonly feedFile: string;
  readonly feedText: string;
  /** the verified feed's `version:` (null when the line is absent; electron-updater's own parse then refuses it) */
  readonly headVersion: string | null;
  /** the head's verified release manifest (6b); null for a release that carries none */
  readonly manifest: ReleaseManifest | null;
  readonly trustRoot: TrustRoot;
  readonly heads: ChannelHeads;
  readonly policy: UpdatePolicy;
  readonly remembered: RememberedVersions;
  readonly acceptedRoot: AcceptedRoot;
}

export interface RefusedChain {
  readonly ok: false;
  readonly state: UpdatesUnavailableState;
  /** For logs and doctor — never shown verbatim in privileged UI (EDP §11.1: no remote content). */
  readonly detail: string;
  readonly remembered: RememberedVersions;
  /** the trust-root accepted before a later step refused (a verified document is a fact, TD-10) */
  readonly acceptedRoot?: AcceptedRoot;
}

export type ChainResult = VerifiedChain | RefusedChain;

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The newest release's tag from GitHub's atom feed: the FIRST entry's `releases/tag/<tag>` link. */
export function newestTagFromAtom(atom: string): string | null {
  const entry = atom.indexOf("<entry");
  if (entry === -1) return null;
  const match = atom.slice(entry).match(/\/releases\/tag\/([^"'<>\s]+)["']/);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** A verified feed's `version:` line (electron-builder writes it first, unquoted or quoted). */
export function feedVersionOf(feedText: string): string | null {
  const match = feedText.match(/^version:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*$/m);
  return match === null ? null : match[1]!;
}

/** The platform's feed file name, as electron-builder writes it. */
export function feedFileFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "linux") return "latest-linux.yml";
  return "latest.yml";
}

/** The higher of a remembered version and a floor (either may be absent). */
export function atLeast(remembered: number | null, floor: number | null): number | null {
  if (remembered === null) return floor;
  if (floor === null) return remembered;
  return Math.max(remembered, floor);
}

/** Remembered versions raised to the build's floor. */
export function withFloors(
  remembered: RememberedVersions,
  floors: RememberedVersions | undefined,
): RememberedVersions {
  if (floors === undefined) return remembered;
  return {
    trustRoot: atLeast(remembered.trustRoot, floors.trustRoot),
    channels: atLeast(remembered.channels, floors.channels),
    policy: {
      nightly: atLeast(remembered.policy.nightly, floors.policy.nightly),
      beta: atLeast(remembered.policy.beta, floors.policy.beta),
      stable: atLeast(remembered.policy.stable, floors.policy.stable),
    },
  };
}

export async function verifyUpdateChain(input: ChainInput): Promise<ChainResult> {
  const origin = input.origin.replace(/\/+$/, "");
  let remembered = withFloors(input.remembered, input.floors);
  let acceptedRoot: AcceptedRoot | undefined;
  const refuse = (state: UpdatesUnavailableState, detail: string): RefusedChain => ({
    ok: false,
    state,
    detail,
    remembered,
    ...(acceptedRoot !== undefined ? { acceptedRoot } : {}),
  });
  const releaseBase = (tag: string) => `${origin}/download/${encodeURIComponent(tag)}/`;
  const signed = async (base: string, file: string) => {
    const [bytes, sig] = await Promise.all([
      input.fetch(`${base}${file}`),
      input.fetch(`${base}${file}${SIGNATURE_SUFFIX}`),
    ]);
    return { bytes, sigText: sig === null ? null : Buffer.from(sig).toString("utf8") };
  };
  const json = (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes));

  // 1. the newest release
  const atom = await input.fetch(`${origin}.atom`);
  const newestTag = atom === null ? null : newestTagFromAtom(Buffer.from(atom).toString("utf8"));
  const newestBase = newestTag === null ? `${origin}/latest/download/` : releaseBase(newestTag);

  // 2. its trust-root, by the embedded root keys
  const root = await signed(newestBase, TRUST_ROOT_FILE);
  if (root.bytes === null || root.sigText === null) {
    if (newestTag === null)
      return refuse(UPDATES_SERVICE.STATE_CHANNEL_UNRESOLVED, "no release found");
    return refuse(
      UPDATES_SERVICE.STATE_TRUST_ROOT_REJECTED,
      `${newestTag} carries no signed trust-root`,
    );
  }
  const anchor: TrustAnchor = { keys: input.rootKeys, threshold: 1 };
  const rootVerdict = verifyTrustRoot(Buffer.from(root.bytes), root.sigText, anchor);
  if (!rootVerdict.ok) return refuse(UPDATES_SERVICE.STATE_TRUST_ROOT_REJECTED, rootVerdict.reason);
  if (rootVerdict.signers.length < rootVerdict.doc.root.threshold) {
    return refuse(
      UPDATES_SERVICE.STATE_TRUST_ROOT_REJECTED,
      `the trust-root needs ${rootVerdict.doc.root.threshold} root signatures; ${rootVerdict.signers.length} verified`,
    );
  }
  const trustRoot = rootVerdict.doc;
  const rootJudgement = judgeSignedDocument(trustRoot, {
    lastAcceptedVersion: remembered.trustRoot,
    now: input.now,
  });
  if (rootJudgement === "rollback") {
    return refuse(
      UPDATES_SERVICE.STATE_TRUST_ROOT_REJECTED,
      `trust-root v${trustRoot.version} is older than the accepted v${remembered.trustRoot}`,
    );
  }
  if (rootJudgement === "stale") {
    return refuse(
      UPDATES_SERVICE.STATE_TRUST_ROOT_REJECTED,
      `trust-root v${trustRoot.version} has expired`,
    );
  }
  remembered = { ...remembered, trustRoot: trustRoot.version };
  acceptedRoot = {
    version: trustRoot.version,
    doc: Buffer.from(root.bytes).toString("utf8"),
    sig: root.sigText,
    rootKeys: trustRoot.root.keys,
  };
  const accepted = acceptedRoot;
  const releaseAnchor: TrustAnchor = trustRoot.roles.release;

  // 3. the channel heads, by the release role
  const channelsDoc = await signed(newestBase, CHANNEL_HEADS_FILE);
  if (channelsDoc.bytes === null || channelsDoc.sigText === null) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      "the newest release carries no signed channel heads",
    );
  }
  if (!verifySignedBytes(Buffer.from(channelsDoc.bytes), channelsDoc.sigText, releaseAnchor)) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      "channels.json does not verify by the release role",
    );
  }
  let heads: ChannelHeads;
  try {
    const parsed = ChannelHeads.safeParse(json(channelsDoc.bytes));
    if (!parsed.success) {
      return refuse(
        UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
        `channels.json is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    heads = parsed.data;
  } catch {
    return refuse(UPDATES_SERVICE.STATE_FEED_UNVERIFIED, "channels.json is not JSON");
  }
  const headsJudgement = judgeSignedDocument(heads, {
    lastAcceptedVersion: remembered.channels,
    now: input.now,
  });
  if (headsJudgement === "rollback") {
    return refuse(
      UPDATES_SERVICE.STATE_POLICY_ROLLBACK,
      `channel heads v${heads.version} are older than the accepted v${remembered.channels}`,
    );
  }
  if (headsJudgement === "stale") {
    return refuse(
      UPDATES_SERVICE.STATE_POLICY_EXPIRED,
      `channel heads v${heads.version} have expired`,
    );
  }
  remembered = { ...remembered, channels: heads.version };

  // 4. the client's head
  const head = heads.heads[input.channel];
  if (head === null || head === undefined) {
    return refuse(UPDATES_SERVICE.STATE_CHANNEL_UNRESOLVED, `no ${input.channel} release yet`);
  }

  // 5. the policy for the client's channel, from the NEWEST release (D5)
  const policyDoc = await signed(newestBase, updatePolicyFile(input.channel));
  if (policyDoc.bytes === null || policyDoc.sigText === null) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      `the newest release carries no signed ${input.channel} policy`,
    );
  }
  if (!verifySignedBytes(Buffer.from(policyDoc.bytes), policyDoc.sigText, releaseAnchor)) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      `the ${input.channel} policy does not verify by the release role`,
    );
  }
  let policy: UpdatePolicy;
  try {
    const parsed = UpdatePolicy.safeParse(json(policyDoc.bytes));
    if (!parsed.success) {
      return refuse(
        UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
        `the ${input.channel} policy is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    policy = parsed.data;
  } catch {
    return refuse(UPDATES_SERVICE.STATE_FEED_UNVERIFIED, `the ${input.channel} policy is not JSON`);
  }
  if (policy.channel !== input.channel) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      `${updatePolicyFile(input.channel)} names the ${policy.channel} channel`,
    );
  }
  const policyJudgement = judgeSignedDocument(policy, {
    lastAcceptedVersion: remembered.policy[input.channel],
    now: input.now,
  });
  if (policyJudgement === "rollback") {
    return refuse(
      UPDATES_SERVICE.STATE_POLICY_ROLLBACK,
      `the ${input.channel} policy v${policy.version} is older than the accepted v${remembered.policy[input.channel]}`,
    );
  }
  if (policyJudgement === "stale") {
    return refuse(
      UPDATES_SERVICE.STATE_POLICY_EXPIRED,
      `the ${input.channel} policy v${policy.version} has expired`,
    );
  }
  remembered = {
    ...remembered,
    policy: { ...remembered.policy, [input.channel]: policy.version },
  };

  // 6. the head's feed, by the release role
  const headBase = releaseBase(head);
  const feed = await signed(headBase, input.feedFile);
  if (feed.bytes === null) {
    return refuse(UPDATES_SERVICE.STATE_CHANNEL_UNRESOLVED, `${head} carries no ${input.feedFile}`);
  }
  if (
    feed.sigText === null ||
    !verifySignedBytes(Buffer.from(feed.bytes), feed.sigText, releaseAnchor)
  ) {
    return refuse(
      UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
      `${input.feedFile} does not verify by the release role`,
    );
  }
  let feedText: string;
  try {
    feedText = decoder.decode(feed.bytes);
  } catch {
    return refuse(UPDATES_SERVICE.STATE_FEED_UNVERIFIED, `${input.feedFile} is not UTF-8`);
  }
  const headVersion = feedVersionOf(feedText);

  // 6b. the head's release manifest, by the release role (B3)
  const manifestDoc = await signed(headBase, RELEASE_MANIFEST_FILE);
  let manifest: ReleaseManifest | null = null;
  if (manifestDoc.bytes !== null) {
    if (
      manifestDoc.sigText === null ||
      !verifySignedBytes(Buffer.from(manifestDoc.bytes), manifestDoc.sigText, releaseAnchor)
    ) {
      return refuse(
        UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
        `${RELEASE_MANIFEST_FILE} does not verify by the release role`,
      );
    }
    let parsed: ReturnType<typeof ReleaseManifest.safeParse>;
    try {
      parsed = ReleaseManifest.safeParse(json(manifestDoc.bytes));
    } catch {
      return refuse(UPDATES_SERVICE.STATE_FEED_UNVERIFIED, `${RELEASE_MANIFEST_FILE} is not JSON`);
    }
    if (!parsed.success) {
      return refuse(
        UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
        `${RELEASE_MANIFEST_FILE} is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    if (parsed.data.tag !== head || parsed.data.version !== headVersion) {
      return refuse(
        UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
        `${RELEASE_MANIFEST_FILE} names ${parsed.data.tag} ${parsed.data.version}, not ${head} ${headVersion ?? "(no version)"}`,
      );
    }
    manifest = parsed.data;
  }
  return {
    ok: true,
    head,
    headBase,
    feedFile: input.feedFile,
    feedText,
    headVersion,
    manifest,
    acceptedRoot: accepted,
    trustRoot,
    heads,
    policy,
    remembered,
  };
}
