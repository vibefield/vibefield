// PJ-1 — the ONE remote normalizer (`thinking-project-places.md` §4.1 E1;
// `build-pj.md` L4) and the project key (L5). A port of the prototype's
// `normRemote` (`draft/project-places/grouping.js`), which supersedes DS-D9's
// `familyOf`: `project-family.ts` now delegates here, a lockstep event under
// GROUPING_VERSION 1.
//
// A remote as IDENTITY: the transport is not identity (ssh, https, scp-like,
// `git+ssh` agree); userinfo, query and fragment are dropped in every branch
// (C20 — a token in a URL must never reach a key); a port is dropped (C11 —
// one Enterprise host serves ssh on 2222 and https on 8443); the host is
// lowercased, `www.` and a trailing dot dropped, an ssh host alias resolved
// through the device's own `ssh -G` (C10; the caller passes the map); the
// path is trimmed of slashes and `.git`, percent-decoded and LOWERCASED on
// every host. A remote that is a local path — `file:`, a drive letter, UNC,
// `./`, `../`, `/`, `~` — is `local:` and never joins across devices (C12b).
// An unrecognized shape is null, never the raw string.
//
// Where this port departs from the prototype, each pinned in
// test/project-normalize.test.ts:
//   - the host is what follows the LAST `@` of the authority (the prototype
//     took the first, so a password holding an `@` reached the key — C20);
//     a `file:` URL's userinfo is dropped too;
//   - empty path segments collapse (`//o//r` is `o/r`), a bracketed IPv6 host
//     keeps its brackets and its port is dropped, an scp path written into a
//     URL (`ssh://git@host:o/r`, which git refuses) reads as meant, and a host
//     with whitespace is no host — four spellings DS-D9's `familyOf` already
//     read this way, kept so delegating changes `family` strings only by L4's
//     own rules (path case, `www.`, percent-escapes);
//   - an alias map is read for its OWN keys only (`constructor` is a host).
import { createHash } from "node:crypto";
import { PROJECT_GROUPING } from "@vibefield/contracts";

/** Host → the host `ssh -G` resolves it to, from the place's own device. */
export type RemoteHostAliases = Readonly<Record<string, string>>;

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** git's scp-like address: `[user@]host:path`, no slash before the colon */
const SCP_LIKE = /^(?:[^@/\s]+@)?(\[[^\]\s]+\]|[^:/\s]+):(?!\/\/)([^?#]+)/;

function isLocalPath(text: string): boolean {
  return (
    /^file:/i.test(text) ||
    /^[A-Za-z]:[\\/]/.test(text) ||
    /^\\\\/.test(text) ||
    /^\.{1,2}[\\/]/.test(text) ||
    text.startsWith("/") ||
    text.startsWith("~")
  );
}

/** A remote's identity key (`host/owner/repo`), `local:<path>` for a remote
 * that is a folder, or null for no remote or a shape that is not one. */
export function normalizeRemote(
  url: string | null | undefined,
  aliases?: RemoteHostAliases,
): string | null {
  if (!url) return null;
  const text = String(url).trim();
  if (isLocalPath(text)) {
    const local = text
      .replace(/\\/g, "/")
      .replace(/^(file:\/\/)[^/]*@/i, "$1")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
    return `local:${local}`;
  }

  let host: string;
  let path: string;
  const scheme = SCHEME.exec(text);
  if (scheme !== null) {
    const rest = text.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    path = slash === -1 ? "" : rest.slice(slash);
    let hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    const query = hostPort.search(/[?#]/);
    if (query !== -1) {
      hostPort = hostPort.slice(0, query);
      path = "";
    }
    const split = splitHostPort(hostPort);
    host = split.host;
    if (split.port !== "" && !/^\d+$/.test(split.port)) path = `${split.port}${path}`;
    path = path.replace(/[?#].*$/, "");
  } else {
    const scp = SCP_LIKE.exec(text);
    if (scp === null) return null;
    const named = scp[1] ?? "";
    host = named.slice(named.lastIndexOf("@") + 1);
    path = scp[2] ?? "";
  }

  host = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  if (host === "" || /\s/.test(host)) return null;
  if (aliases !== undefined && Object.hasOwn(aliases, host)) {
    host = String(aliases[host]).toLowerCase();
  }
  path = path
    .split("/")
    .filter((segment) => segment !== "")
    .join("/")
    .replace(/\.git$/i, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // a stray % stays as written
  }
  path = path.toLowerCase();
  if (path === "") return null;
  return `${host}/${path}`;
}

/** `host[:port]`, an IPv6 literal kept in its brackets. */
function splitHostPort(hostPort: string): { host: string; port: string } {
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1) return { host: hostPort, port: "" };
    const tail = hostPort.slice(close + 1);
    return { host: hostPort.slice(0, close + 1), port: tail.startsWith(":") ? tail.slice(1) : "" };
  }
  const colon = hostPort.indexOf(":");
  if (colon === -1) return { host: hostPort, port: "" };
  return { host: hostPort.slice(0, colon), port: hostPort.slice(colon + 1) };
}

/** Every remote's key, deduplicated in the order git listed them. */
export function normalizeRemotes(
  remotes: Readonly<Record<string, string>>,
  aliases?: RemoteHostAliases,
): string[] {
  const keys = new Set<string>();
  for (const url of Object.values(remotes)) {
    const key = normalizeRemote(url, aliases);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** E1 — the IDENTITY remote: the push remote (`branch.<b>.pushRemote`, else
 * `remote.pushDefault` — the caller names it) › `origin` › the only remote.
 * Normalized; null when there is none or it is a local path. Any other
 * remote only suggests (C8b, C8c). */
export function identityRemoteOf(
  remotes: Readonly<Record<string, string>>,
  pushRemote?: string,
  aliases?: RemoteHostAliases,
): string | null {
  const names = Object.keys(remotes);
  const pick =
    pushRemote !== undefined && Object.hasOwn(remotes, pushRemote) && remotes[pushRemote]
      ? pushRemote
      : Object.hasOwn(remotes, "origin") && remotes["origin"]
        ? "origin"
        : names.length === 1
          ? names[0]
          : undefined;
  const key = pick === undefined ? null : normalizeRemote(remotes[pick], aliases);
  return key !== null && !key.startsWith("local:") ? key : null;
}

// ── the key (L5) ──────────────────────────────────────────────────────────
//
// A record-less project's key is minted from its provisional identity (the
// strongest anchor no other group holds — engine §4.3). The record asked for
// a KEYED SHA-256, but no secret spans one person's desktops yet (pairing,
// sessions and terminal grants are device-local), so version 1 is unkeyed and
// domain-separated: keys travel only among the person's own devices, and
// `project.read` is never plugin-eligible. Keying it is a GROUPING_VERSION
// bump. 128 bits, lowercase RFC 4648 base32, unpadded: 26 characters.

const KEY_DOMAIN = "vibefield/project-key/v1\0";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function identityDigest(identity: string): Buffer {
  return createHash("sha256").update(`${KEY_DOMAIN}${identity}`, "utf8").digest();
}

/** `p1:` + base32 of the first 128 bits of SHA-256(domain ‖ identity). */
export function projectKey(identity: string): string {
  return `p1:${base32(identityDigest(identity).subarray(0, 16))}`;
}

/** A record-less project's ink, dealt from its identity (§4.3): stable while
 * the identity is, in `[0, PROJECT_GROUPING.INK_DEALS)`. A record's ink is
 * dealt once and kept, so this only colours a project nobody has acted on. */
export function provisionalInk(identity: string): number {
  return identityDigest(identity).readUInt32BE(16) % PROJECT_GROUPING.INK_DEALS;
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
