// DS-D9 (RULED 2026-09-30) — the repository FAMILY: History's grouping key
// across desktops (design-06 §5 "Grouping"; design-04 §2's D30 note). rosetta's
// project id is a hash of a LOCAL path and carries no machine, so the same
// repository cloned on two desktops is two projects with two ids; the family
// is what says they are one repository. It is a CORRELATOR, never an identity
// (D30): a project stays `{device, path}`, and a family only groups.
//
// `family = normalize(git_repo)`: the host lowercased, the path without a
// trailing `.git`, the scheme and the userinfo dropped — so
// `git@github.com:o/r.git`, `https://github.com/o/r` and
// `ssh://git@github.com/o/r` agree on `github.com/o/r`. The input is rosetta's
// `ProjectRow.git_repo`: the origin remote as rosetta SANITIZED it (userinfo,
// query and `.git` already stripped, `git@host:p` spelled `host:p`), which is
// display metadata that keeps ssh and https apart. This function accepts that
// form and the raw spellings a remote can carry, and is idempotent on its own
// output's inputs (a sanitized spelling and its raw original agree).
//
// Choices the ruling's words do not spell, made here and pinned by the table
// in test/project-family.test.ts:
//   - the PORT is dropped with the scheme: `ssh://git@host:2222/o/r` and
//     `https://host/o/r` are one self-hosted repository reached two ways, and
//     a port is transport, not identity;
//   - only the HOST is case-folded. Paths keep their case — a host is
//     case-insensitive by DNS, a path is the server's business (GitHub folds
//     it, a plain git server does not), and a wrong merge is worse than a
//     missed one;
//   - a remote that is a LOCAL path (`/srv/git/r`, `../r`, `C:\repos\r`,
//     `file:///srv/git/r`) has NO family: the path names a folder on one
//     machine, and two desktops holding the same path are not one repository.
//     "A repository with no remote has no family" (DS-D9) extends to a remote
//     that is itself only a folder;
//   - a host with no path (`https://github.com`) is not a repository.
//
// Pure and synchronous: the follower stamps it on every `projects` row it
// republishes, and the mesh doors filter on it.

/** git's own test for an scp-like address (`connect.c` `parse_connect_url`):
 * `[user@]host:path` where no slash comes before the first colon. A single
 * letter before the colon is a Windows drive (`C:\…`, `c:/…`), not a host. */
const SCP_LIKE = /^(?:[^@/]+@)?(\[[^\]]+\]|[^/:]+):(.*)$/;

/** a URL scheme, as git and WHATWG both read one */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

export function familyOf(gitRepo: string | null | undefined): string | undefined {
  if (typeof gitRepo !== "string") return undefined;
  let text = gitRepo.trim();
  if (text === "") return undefined;
  // a query or a fragment is never identity (rosetta strips both too)
  const cut = text.search(/[?#]/);
  if (cut !== -1) text = text.slice(0, cut);

  let host: string;
  let path: string;
  const scheme = SCHEME.exec(text);
  if (scheme !== null) {
    if (scheme[1]?.toLowerCase() === "file") return undefined; // a folder, not a remote
    const rest = text.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    path = slash === -1 ? "" : rest.slice(slash);
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1); // userinfo dropped
    const split = splitHostPort(hostPort);
    host = split.host;
    // `ssh://git@host:o/r` — an scp path written into a URL: git reads `o` as
    // a port and refuses it; the person meant `host:o/r`, so read it that way
    if (split.port !== "" && !/^\d+$/.test(split.port)) path = `${split.port}${path}`;
  } else {
    if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\")) return undefined; // Windows
    const scp = SCP_LIKE.exec(text);
    if (scp === null) return undefined; // `/srv/git/r`, `../r`, `r` — a local path
    host = scp[1] ?? "";
    path = scp[2] ?? "";
    if (host.length === 1 && !host.startsWith("[")) return undefined; // `c:/…` — a drive
  }

  host = host.toLowerCase().replace(/\.$/, "");
  if (host === "" || /\s/.test(host)) return undefined;
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "");
  const last = segments.at(-1);
  if (last?.endsWith(".git")) {
    const bare = last.slice(0, -".git".length);
    if (bare === "") segments.pop();
    else segments[segments.length - 1] = bare;
  }
  if (segments.length === 0) return undefined; // a host is not a repository
  return `${host}/${segments.join("/")}`;
}

/** `host[:port]`, IPv6 literals kept in their brackets. */
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
