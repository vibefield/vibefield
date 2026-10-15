// WP12b test fixture — an in-memory GitHub-shaped release origin, signed with keys minted per test (no secret
// exists anywhere): the root pair signs the trust-root, the release key signs channels, policies and feeds. Every
// fetched URL is recorded, so a test can say "no payload, no feed, nothing past the refusal".

import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { UpdateChannel } from "@vibefield/contracts";
import type { FetchBytes } from "../../src/main/updates/verify-chain";

export const ORIGIN = "https://github.com/vibefield/vibefield/releases";
export const NOW = Date.parse("2026-10-16T00:00:00Z");
export const LATER = "2026-12-14T00:00:00Z";
export const PAST = "2026-10-01T00:00:00Z";

export interface Key {
  readonly pub: string;
  readonly secret: KeyObject;
}

export function mintKey(): Key {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    secret: privateKey,
  };
}

/** The kit's canonical JSON: keys sorted, 2-space indent, one trailing newline. */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function signText(text: string, key: Key): string {
  return `${sign(null, Buffer.from(text), key.secret).toString("base64")}\n`;
}

/** A document is generated before it expires (the schemas refuse otherwise): an expired one was generated a day
 * before its expiry, a fresh one just now. */
function generatedBefore(expires: string | undefined): number {
  return expires === undefined ? NOW - 1000 : Date.parse(expires) - 24 * 60 * 60 * 1000;
}

export class FixtureOrigin {
  readonly rootA = mintKey();
  readonly rootB = mintKey();
  readonly release = mintKey();
  readonly stranger = mintKey();
  readonly requests: string[] = [];
  private readonly files = new Map<string, string>();
  private tags: string[] = [];

  get rootKeys(): string[] {
    return [this.rootA.pub, this.rootB.pub];
  }

  trustRootDoc(
    version = 1,
    expires = LATER,
    releaseKeys = [this.release.pub],
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      version,
      expires,
      root: { threshold: 1, keys: this.rootKeys },
      roles: {
        release: { threshold: 1, keys: releaseKeys },
        bundled: { threshold: 1, keys: [mintKey().pub] },
        registry: { threshold: 1, keys: [mintKey().pub] },
      },
    };
  }

  /** Releases, newest first (the atom feed's order). */
  setReleases(tags: string[]): void {
    this.tags = tags;
  }

  put(tag: string, file: string, text: string, signer: Key | null): void {
    this.files.set(`${ORIGIN}/download/${encodeURIComponent(tag)}/${file}`, text);
    if (signer !== null) {
      this.files.set(
        `${ORIGIN}/download/${encodeURIComponent(tag)}/${file}.sig`,
        signText(text, signer),
      );
    }
  }

  putJson(tag: string, file: string, doc: unknown, signer: Key | null): void {
    this.put(tag, file, canonical(doc), signer);
  }

  /** A full newest release: trust-root (root-signed), channel heads and all three policies (release-signed). */
  putRelease(
    tag: string,
    opts: {
      heads: Record<UpdateChannel, string | null>;
      headsVersion?: number;
      headsExpires?: string;
      policyVersion?: Partial<Record<UpdateChannel, number>>;
      policyExpires?: string;
      trustRootVersion?: number;
      trustRootSigner?: Key;
    },
  ): void {
    const trust = canonical(this.trustRootDoc(opts.trustRootVersion ?? 1));
    this.put(tag, "trust-root.json", trust, opts.trustRootSigner ?? this.rootA);
    this.putJson(
      tag,
      "channels.json",
      {
        schemaVersion: 1,
        version: opts.headsVersion ?? 10,
        generatedAt: generatedBefore(opts.headsExpires),
        expires: opts.headsExpires ?? LATER,
        trustRootVersion: 1,
        heads: opts.heads,
      },
      this.release,
    );
    for (const channel of ["nightly", "beta", "stable"] as const) {
      this.putJson(
        tag,
        `update-policy.${channel}.json`,
        {
          version: opts.policyVersion?.[channel] ?? 3,
          generatedAt: generatedBefore(opts.policyExpires),
          expires: opts.policyExpires ?? LATER,
          channel,
          trustRootVersion: 1,
          yanked: [],
          killSwitch: false,
          requireUserConfirmation: false,
          floors: {},
        },
        this.release,
      );
    }
  }

  putFeed(tag: string, version: string, signer: Key | null = this.release): void {
    const zip = `VibeField-${version}-mac.zip`;
    this.put(
      tag,
      "latest-mac.yml",
      `version: ${version}\nfiles:\n  - url: ${zip}\n    sha512: AAAA\n    size: 10\npath: ${zip}\nsha512: AAAA\nreleaseDate: '2026-10-16T00:00:00.000Z'\n`,
      signer,
    );
  }

  readonly fetch: FetchBytes = async (url) => {
    this.requests.push(url);
    if (url === `${ORIGIN}.atom`) {
      if (this.tags.length === 0) return null;
      const entries = this.tags
        .map(
          (tag) =>
            `<entry><link rel="alternate" type="text/html" href="https://github.com/vibefield/vibefield/releases/tag/${encodeURIComponent(tag)}"/><title>${tag}</title></entry>`,
        )
        .join("");
      return Buffer.from(
        `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`,
      );
    }
    const text = this.files.get(url);
    return text === undefined ? null : Buffer.from(text);
  };
}
