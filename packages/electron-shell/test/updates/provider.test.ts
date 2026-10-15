import { describe, expect, it } from "vitest";
import { VibeFieldUpdateProvider } from "../../src/main/updates/provider";
import { UpdateRefusal } from "../../src/main/updates/refusal";
import { type FetchBytes, verifyUpdateChain } from "../../src/main/updates/verify-chain";
import { FixtureOrigin, NOW, ORIGIN } from "./fixture-release";

// WP12b (D3, §2·A) — the provider over electron-updater's own Provider base: it adapts the HTTP executor to the
// chain's byte fetcher (a 404 is an absent file), throws UpdateRefusal before electron-updater sees any feed, and
// resolves payload URLs against the HEAD release.

const NIGHTLY = "nightly-20261016";

function providerOver(fx: FixtureOrigin) {
  const requested: string[] = [];
  // electron-updater's executor contract: request(options) → the body text; an HTTP error carries statusCode
  const executor = {
    request: async (options: {
      protocol?: string;
      hostname?: string;
      port?: string | number;
      path?: string;
    }) => {
      const url = `${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path}`;
      requested.push(url);
      const bytes = await fx.fetch(url);
      if (bytes === null) throw Object.assign(new Error("404"), { statusCode: 404 });
      return Buffer.from(bytes).toString("utf8");
    },
  };
  const verified: unknown[] = [];
  const provider = new VibeFieldUpdateProvider(
    {
      provider: "custom",
      updateProvider: VibeFieldUpdateProvider,
      vibefield: {
        verify: (fetch: FetchBytes) =>
          verifyUpdateChain({
            origin: ORIGIN,
            channel: "nightly",
            rootKeys: fx.rootKeys,
            remembered: {
              trustRoot: null,
              channels: null,
              policy: { nightly: null, beta: null, stable: null },
            },
            now: NOW,
            feedFile: "latest-mac.yml",
            fetch,
          }),
        verified: (result) => verified.push(result),
      },
    },
    null,
    // biome-ignore lint/suspicious/noExplicitAny: electron-updater's executor type is its Electron net executor
    { isUseMultipleRangeRequest: false, platform: "darwin", executor: executor as any },
  );
  return { provider, requested, verified };
}

function world(): FixtureOrigin {
  const fx = new FixtureOrigin();
  fx.setReleases([NIGHTLY]);
  fx.putRelease(NIGHTLY, { heads: { nightly: NIGHTLY, beta: null, stable: null } });
  fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016");
  return fx;
}

describe("VibeFieldUpdateProvider (D3)", () => {
  it("returns the verified feed and resolves its payload against the head release", async () => {
    const { provider, verified } = providerOver(world());
    const info = await provider.getLatestVersion();
    expect(info.version).toBe("0.9.0-nightly.20261016");
    expect(verified).toHaveLength(1);
    const files = provider.resolveFiles(info);
    expect(files[0]?.url.href).toBe(
      `${ORIGIN}/download/${NIGHTLY}/VibeField-0.9.0-nightly.20261016-mac.zip`,
    );
  });

  it("throws UpdateRefusal before handing electron-updater anything, on a forged feed", async () => {
    const fx = world();
    fx.putFeed(NIGHTLY, "0.9.0-nightly.20261016", fx.stranger);
    const { provider, verified } = providerOver(fx);
    const error = await provider.getLatestVersion().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpdateRefusal);
    expect((error as UpdateRefusal).state).toBe("feed-unverified");
    expect(verified).toHaveLength(0);
    expect(() =>
      provider.resolveFiles({ version: "x", files: [], path: "", sha512: "", releaseDate: "" }),
    ).toThrow(/before a verified check/);
  });

  it("reads a 404 as an absent file, never as a refusal of its own", async () => {
    const fx = new FixtureOrigin(); // nothing published at all
    const { provider } = providerOver(fx);
    const error = await provider.getLatestVersion().catch((e: unknown) => e);
    expect((error as UpdateRefusal).state).toBe("channel-unresolved");
  });
});
