import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UPDATES_SERVICE } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRun,
  type FixtureServer,
  mintKeys,
  nextVersion,
  OPT_IN_RUNS,
  serveReleases,
  smokeTrustRoot,
  UPDATE_RUNS,
  type UpdateRunName,
} from "../../../../apps/desktop/packaging/update-fixture.mjs";
import { verifyReleaseDir } from "../../../../scripts/release-verify.mjs";
import {
  NOTHING_REMEMBERED,
  type RememberedVersions,
  verifyUpdateChain,
} from "../../src/main/updates/verify-chain";

// WP12 L4 (WP12f; build-wp12-updater.md §14, the PM's rulings 2026-10-15 21:41Z) — `smoke:update`'s fixture origin,
// served over loopback and walked by THE CLIENT'S OWN CHAIN (`verifyUpdateChain`, what the provider runs before any
// download). Each of the five runs reaches exactly the verdict the packaged app must: the good chain, and the four
// refusals with no payload asked for. EL7: the run's keys stay in this process; nothing secret is written.

const CURRENT = "0.1.0";
const dirs: string[] = [];
const servers: FixtureServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function served(name: UpdateRunName) {
  const root = mkdtempSync(join(tmpdir(), "vf-update-fixture-"));
  dirs.push(root);
  const keys = mintKeys();
  const trustRoot = smokeTrustRoot(keys);
  const run = buildRun(name, { root, keys, trustRoot, current: CURRENT });
  const server = await serveReleases(run.releases);
  servers.push(server);
  const rootKeys = (trustRoot.doc.root as { keys: string[] }).keys;
  const walk = (remembered: RememberedVersions = NOTHING_REMEMBERED) =>
    verifyUpdateChain({
      origin: server.origin,
      channel: "beta",
      rootKeys,
      remembered,
      now: Date.now(),
      feedFile: "latest-mac.yml",
      fetch: async (url) => {
        const response = await fetch(url);
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      },
    });
  return { root, keys, run, server, walk, rootKeys };
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true })
    .map((name) => join(dir, String(name)))
    .filter((path) => statSync(path).isFile());

describe("the fixture update origin (W9's five runs, by the client's own chain)", () => {
  it("names the five runs in order, and N is above N-1 for either channel", () => {
    expect(UPDATE_RUNS).toEqual(["staged", "forged", "rollback", "killed", "unresolved"]);
    // AU-5 (LC-29) — the quit run is opt-in: only `--runs quit` names it, never the row's default
    expect(OPT_IN_RUNS).toEqual(["quit"]);
    expect(UPDATE_RUNS).not.toContain("quit");
    expect(nextVersion("0.1.0", "beta")).toBe("0.1.1-beta.1");
    expect(nextVersion("0.1.0", "nightly", Date.parse("2026-10-16T01:00:00Z"))).toBe(
      "0.1.1-nightly.20261016",
    );
  });

  it("1 · staged: the good chain names N and the payload's sha512, and the chain asks for no payload", async () => {
    const { run, server, walk, rootKeys } = await served("staged");
    const release = run.releases[0]!;
    const result = await walk();
    expect(result).toMatchObject({ ok: true, head: release.tag, headVersion: release.version });
    if (!result.ok) return;
    expect(result.policy.requireUserConfirmation).toBe(true); // the silent apply stays shut in run 1
    const payload = readFileSync(join(release.dir, release.zip));
    expect(createHash("sha512").update(payload).digest("base64")).toBe(release.sha512);
    expect(result.feedText).toContain(`sha512: ${release.sha512}`);
    expect(server.payloadRequests()).toEqual([]);
    // and the release step's own offline verifier agrees (`release-verify`)
    await expect(
      verifyReleaseDir({ dir: release.dir, tag: release.tag, channel: "beta", rootKeys }),
    ).resolves.toMatchObject({ verified: expect.arrayContaining(["latest-mac.yml"]) });
  });

  it("2 · forged: a stranger's feed signature is feed-unverified after 9 requests, and no payload", async () => {
    const { server, walk } = await served("forged");
    expect(await walk()).toMatchObject({
      ok: false,
      state: UPDATES_SERVICE.STATE_FEED_UNVERIFIED,
    });
    expect(server.requests).toHaveLength(9); // the atom + 4 signed pairs (§2·A's spike count)
    expect(server.payloadRequests()).toEqual([]);
  });

  it("3 · rollback: policy v2 against a remembered v5 is policy-rollback, no payload", async () => {
    const { run, server, walk } = await served("rollback");
    expect(run.seed).toMatchObject({ remembered: { policy: { beta: 5 } } });
    expect(
      await walk({ ...NOTHING_REMEMBERED, policy: { nightly: null, beta: 5, stable: null } }),
    ).toMatchObject({ ok: false, state: UPDATES_SERVICE.STATE_POLICY_ROLLBACK });
    expect(server.payloadRequests()).toEqual([]);
  });

  it("4 · killed: the chain verifies a policy whose kill switch is on, advertising N (a lever bites on a FOUND update)", async () => {
    const { run, server, walk } = await served("killed");
    const result = await walk();
    expect(result).toMatchObject({
      ok: true,
      headVersion: run.releases[0]!.version,
      policy: { killSwitch: true },
    });
    expect(server.payloadRequests()).toEqual([]);
  });

  it("5 · unresolved: nightly-only heads leave a beta client channel-unresolved — the nightly's feed is never asked for", async () => {
    const { server, walk } = await served("unresolved");
    expect(await walk()).toMatchObject({
      ok: false,
      state: UPDATES_SERVICE.STATE_CHANNEL_UNRESOLVED,
    });
    expect(server.requests.some((request) => request.path.endsWith("latest-mac.yml"))).toBe(false);
    expect(server.payloadRequests()).toEqual([]);
  });

  it("AU-5 · quit (opt-in): the good chain with requireUserConfirmation off, staged first, then a person's quit", async () => {
    const { run, server, walk } = await served("quit");
    expect(run).toMatchObject({ seed: null, expect: "staged", next: "quit-install" });
    const result = await walk();
    expect(result).toMatchObject({ ok: true, headVersion: run.releases[0]!.version });
    if (!result.ok) return;
    // a policy that asks first would hold the quit's install (LC-24): this run's never does
    expect(result.policy.requireUserConfirmation).toBe(false);
    expect(server.payloadRequests()).toEqual([]);
  });

  it("EL7: a run's tree holds no secret — the keys never leave the process", async () => {
    const { root, keys } = await served("staged");
    const secrets = Object.values(keys).map((key) => key.secretKey);
    for (const file of filesUnder(root)) {
      const text = readFileSync(file).toString("latin1");
      for (const secret of secrets) expect(text.includes(secret), file).toBe(false);
    }
  });
});
