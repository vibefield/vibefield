import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import {
  type CancellationLike,
  UpdateController,
  type UpdaterPort,
} from "../../src/main/updates/controller";
import { UpdateRefusal } from "../../src/main/updates/refusal";
import { type AdoptedRoot, anchorFrom, rotates } from "../../src/main/updates/root-chain";
import { type StoreFs, UpdateStateStore } from "../../src/main/updates/state-store";
import type { ChainResult, FetchBytes, VerifiedChain } from "../../src/main/updates/verify-chain";
import {
  canonical,
  FixtureOrigin,
  type Key,
  LATER,
  mintKey,
  NOW,
  ORIGIN,
  signText,
} from "./fixture-release";

// WP12d (L3b-ii, build-wp12-updater.md §12 B5; the PM's ruling 2026-10-15 16:03Z) — root rotation persisted as SIGNED
// DOCUMENTS, re-verified from the embedded keys at every load. TD's rule: a new root document is signed by an OLD root
// key and a new one; the client adopts the new set. Without persistence the SECOND rotation was refused.

/** A root document naming `root` as its root set (release key kept), signed by every key in `signers`. */
function rootDoc(
  fx: FixtureOrigin,
  version: number,
  root: readonly Key[],
  signers: readonly Key[],
) {
  const doc = canonical({
    schemaVersion: 1,
    version,
    expires: LATER,
    root: { threshold: 1, keys: root.map((key) => key.pub) },
    roles: {
      release: { threshold: 1, keys: [fx.release.pub] },
      bundled: { threshold: 1, keys: [mintKey().pub] },
      registry: { threshold: 1, keys: [mintKey().pub] },
    },
  });
  return {
    version,
    doc,
    sig: signers.map((key) => signText(doc, key)).join(""),
  } satisfies AdoptedRoot;
}

describe("the adopted chain, re-verified from the embedded keys (B5)", () => {
  const fx = new FixtureOrigin();
  const c = mintKey();
  const d = mintKey();
  const e = mintKey();
  const f = mintKey();
  // TD-1: a root is at least two keys (`trust-root.ts`), so every rotated root here names two
  const v2 = rootDoc(fx, 2, [c, d], [fx.rootA, c]);
  const v3 = rootDoc(fx, 3, [e, f], [c, e]);

  it("walks the rotations: embedded → v2 (signed by an embedded key) → v3 (signed by v2's)", () => {
    const one = anchorFrom(fx.rootKeys, [v2]);
    expect(one).toMatchObject({ anchor: { keys: [c.pub, d.pub], version: 2 }, dropped: 0 });
    // stored out of order, still walked oldest first
    const two = anchorFrom(fx.rootKeys, [v3, v2]);
    expect(two.anchor).toEqual({ keys: [e.pub, f.pub], version: 3 });
    expect(two.kept.map((root) => root.version)).toEqual([2, 3]);
    // v3 alone is NOT reachable from the embedded keys (the two-rotations-offline case, named for James)
    expect(anchorFrom(fx.rootKeys, [v3])).toMatchObject({ anchor: { version: null }, dropped: 1 });
  });

  it("a planted document verifies against nothing and is dropped, with everything after it", () => {
    // well-formed (two root keys), dropped for its signature alone
    const planted = rootDoc(fx, 2, [fx.stranger, mintKey()], [fx.stranger]);
    expect(anchorFrom(fx.rootKeys, [planted, v3])).toMatchObject({
      anchor: { keys: fx.rootKeys, version: null },
      kept: [],
      dropped: 2,
    });
    // a doc whose stored version disagrees with its text is dropped too
    expect(anchorFrom(fx.rootKeys, [{ ...v2, version: 7 }])).toMatchObject({ dropped: 1 });
    // a tampered text breaks its signature
    expect(
      anchorFrom(fx.rootKeys, [{ ...v2, doc: v2.doc.replace('"version": 2', '"version": 2 ') }]),
    ).toMatchObject({ dropped: 1 });
  });

  it("a rotation is a root set other than the anchor's", () => {
    expect(rotates({ keys: fx.rootKeys, version: null }, fx.rootKeys)).toBe(false);
    expect(rotates({ keys: fx.rootKeys, version: null }, [...fx.rootKeys].reverse())).toBe(false);
    expect(rotates({ keys: fx.rootKeys, version: null }, [c.pub, d.pub])).toBe(true);
  });
});

function memoryStore() {
  const files = new Map<string, string>();
  const fs: StoreFs = {
    readFile: (path) => files.get(path) ?? null,
    writeAtomic: (path, text) => {
      files.set(path, text);
    },
    moveAside: (path, to) => {
      const text = files.get(path);
      files.delete(path);
      if (text !== undefined) files.set(to, text);
    },
  };
  return { fs, files };
}

class CheckingUpdater implements UpdaterPort {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  context: {
    verify(fetch: FetchBytes): Promise<ChainResult>;
    verified(r: VerifiedChain): void;
  } | null = null;
  constructor(readonly fx: FixtureOrigin) {}
  setFeedURL(options: unknown): void {
    this.context = (options as { vibefield: CheckingUpdater["context"] }).vibefield;
  }
  async checkForUpdates() {
    const result = await this.context!.verify(this.fx.fetch);
    if (!result.ok) throw new UpdateRefusal(result.state, result.detail);
    this.context!.verified(result);
    return { isUpdateAvailable: false };
  }
  async downloadUpdate(): Promise<unknown> {
    return [];
  }
  on(): unknown {
    return this;
  }
  removeListener(): unknown {
    return this;
  }
}

describe("the controller adopts a rotation, persists it, and the second rotation verifies against it (B5)", () => {
  const TAG = "nightly-20261016";

  /** The newest release carries `root` as its trust-root (and the usual heads, policies and feed). */
  function release(fx: FixtureOrigin, root: AdoptedRoot) {
    fx.setReleases([TAG]);
    fx.putRelease(TAG, { heads: { nightly: TAG, beta: null, stable: null } });
    fx.put(TAG, "trust-root.json", root.doc, null);
    fx.put(TAG, "trust-root.json.sig", root.sig, null);
    fx.putFeed(TAG, "0.9.0-nightly.20261016");
  }

  function controller(fx: FixtureOrigin, fs: StoreFs, audits: AuditAppendV1[] = []) {
    return new UpdateController({
      updater: new CheckingUpdater(fx),
      feedOptions: (context) => ({ provider: "custom", vibefield: context }),
      newCancellationToken: (): CancellationLike => ({ cancel: () => undefined }),
      origin: ORIGIN,
      rootKeys: fx.rootKeys,
      buildChannel: "nightly",
      feedFile: "latest-mac.yml",
      store: new UpdateStateStore("/state.json", fs, () => NOW),
      appendAudit: async (record) => {
        audits.push(record);
      },
      log: { info: vi.fn(), warn: vi.fn() },
      now: () => NOW,
    });
  }

  it("rotation one is adopted and persisted; rotation two verifies against it; a new launch rebuilds the anchor", async () => {
    const fx = new FixtureOrigin();
    const c = mintKey();
    const e = mintKey();
    const v2 = rootDoc(fx, 2, [c, mintKey()], [fx.rootA, c]);
    const v3 = rootDoc(fx, 3, [e, mintKey()], [c, e]);
    const { fs, files } = memoryStore();
    release(fx, v2);
    const first = controller(fx, fs);
    await first.check("manual");
    expect(first.state).toEqual({ kind: "not-available" });
    const stored = JSON.parse(files.get("/state.json")!) as { trustRoots: AdoptedRoot[] };
    expect(stored.trustRoots.map((root) => root.version)).toEqual([2]);
    // rotation two: signed by v2's key and its own — NOT by any embedded key
    release(fx, v3);
    await first.check("manual");
    expect(first.state).toEqual({ kind: "not-available" });
    // a new launch re-verifies [v2, v3] from the embedded keys and checks against v3's set
    const second = controller(fx, fs);
    await second.check("manual");
    expect(second.state).toEqual({ kind: "not-available" });
    expect(
      (JSON.parse(files.get("/state.json")!) as { trustRoots: AdoptedRoot[] }).trustRoots.map(
        (r) => r.version,
      ),
    ).toEqual([2, 3]);
  });

  it("without the persisted chain, the second rotation is refused (what B5 fixes)", async () => {
    const fx = new FixtureOrigin();
    const c = mintKey();
    const e = mintKey();
    const { fs } = memoryStore();
    release(fx, rootDoc(fx, 3, [e, mintKey()], [c, e]));
    const fresh = controller(fx, fs);
    await fresh.check("manual");
    expect(fresh.state).toMatchObject({
      kind: "error",
      unavailable: { state: "trust-root-rejected" },
    });
  });

  it("a planted root in the state file is dropped at load, loudly — and the chain judges from the embedded keys", async () => {
    const fx = new FixtureOrigin();
    const { fs, files } = memoryStore();
    files.set(
      "/state.json",
      JSON.stringify({
        schemaVersion: 1,
        trustRoots: [rootDoc(fx, 2, [fx.stranger, mintKey()], [fx.stranger])],
      }),
    );
    const audits: AuditAppendV1[] = [];
    const planted = controller(fx, fs, audits);
    expect(audits).toContainEqual(
      expect.objectContaining({ outcome: "failed", reasonCode: "ROOT_CHAIN_BROKEN" }),
    );
    expect((JSON.parse(files.get("/state.json")!) as { trustRoots: unknown[] }).trustRoots).toEqual(
      [],
    );
    // the stranger's next "rotation" is refused: nothing it planted is trusted
    release(fx, rootDoc(fx, 3, [fx.stranger, mintKey()], [fx.stranger]));
    await planted.check("manual");
    expect(planted.state).toMatchObject({
      kind: "error",
      unavailable: { state: "trust-root-rejected" },
    });
  });
});
