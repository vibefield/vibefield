// WP12b (build-wp12-updater.md D3, §2·A) — VibeField's UpdateProvider: a CUSTOM electron-updater provider
// (`setFeedURL({provider: "custom", updateProvider})`), which the D3 spike proved on electron-updater 6.8.9:
//   · `getLatestVersion()` runs once per check (AppUpdater.js:389), its result is cached (:413) and the download
//     reuses it (:436) — the feed is never re-fetched behind the verifier's back;
//   · the payload URLs are ours (`MacUpdater.js:53` takes them from `resolveFiles`);
//   · no GitHub-provider logic runs (`providerFactory.js:56-62` constructs only this class). electron-updater reads
//     `allowPrerelease` only as a default (`AppUpdater.js:218` turns it ON for a prerelease build, a nightly or a
//     beta) and filters nothing by it, so channel selection is the signed heads' alone (D4).
// This provider verifies the chain (verify-chain.ts) and hands electron-updater nothing it did not verify; the
// payload's sha512 check is electron-updater's own and now descends from the signed feed.

import type { ResolvedUpdateFileInfo, UpdateInfo } from "electron-updater";
import {
  Provider,
  type ProviderRuntimeOptions,
  parseUpdateInfo,
  resolveFiles,
} from "electron-updater/out/providers/Provider";
import { UpdateRefusal } from "./refusal";
import type { ChainResult, FetchBytes, VerifiedChain } from "./verify-chain";

/** What the provider needs from the controller: run the chain (the controller owns the remembered versions and
 * the channel) and report what was verified. Passed through `setFeedURL`'s options. */
export interface ProviderContext {
  verify(fetch: FetchBytes): Promise<ChainResult>;
  verified(result: VerifiedChain): void;
}

export interface VibeFieldFeedOptions {
  readonly provider: "custom";
  readonly updateProvider: typeof VibeFieldUpdateProvider;
  readonly vibefield: ProviderContext;
}

export class VibeFieldUpdateProvider extends Provider<UpdateInfo> {
  private readonly context: ProviderContext;
  private baseUrl: URL | null = null;

  constructor(
    options: VibeFieldFeedOptions,
    _updater: unknown,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.context = options.vibefield;
  }

  /** electron-updater's own HTTP executor (Chromium's network stack: the system proxy, direct HTTPS — EDP-38),
   * adapted to the chain's byte fetcher: a 404 is an absent file, every other failure propagates. The documents are
   * text; a body that is not UTF-8 changes on the round trip and fails its signature (fail closed). */
  private readonly fetchBytes: FetchBytes = async (url) => {
    try {
      const text = await this.httpRequest(new URL(url));
      return text === null ? null : Buffer.from(text, "utf8");
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return null;
      throw error;
    }
  };

  async getLatestVersion(): Promise<UpdateInfo> {
    const result = await this.context.verify(this.fetchBytes);
    if (!result.ok) throw new UpdateRefusal(result.state, result.detail);
    this.context.verified(result);
    this.baseUrl = new URL(result.headBase);
    return parseUpdateInfo(
      result.feedText,
      result.feedFile,
      new URL(result.feedFile, this.baseUrl),
    );
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    if (this.baseUrl === null) throw new Error("resolveFiles before a verified check");
    return resolveFiles(updateInfo, this.baseUrl);
  }
}
