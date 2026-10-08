// DS-D9 (RULED 2026-09-30) — the repository FAMILY: History's grouping key
// across desktops (design-06 §5 "Grouping"; design-04 §2's D30 note). rosetta's
// project id is a hash of a LOCAL path and carries no machine, so the same
// repository cloned on two desktops is two projects with two ids; the family
// is what says they are one repository. It is a CORRELATOR, never an identity
// (D30): a project stays `{device, path}`, and a family only groups.
//
// Since PJ-1 (`build-pj.md` L4; PJ-D1/D2 RULED 2026-10-07, which answer
// DS-D9) the family is the ONE normalizer's key (`projects/normalize.ts`), so
// a family and a project's identity remote can never disagree about one
// remote. That is a lockstep event under GROUPING_VERSION 1, and it changed
// some `family` strings: the path is now LOWERCASED on every host (it kept
// case before), a `www.` host prefix is dropped, and percent-escapes are
// decoded. Clients treat a family as opaque; until both desktops run this
// build, a mixed mesh may disagree on a family — the recorded cost of L4.
//
// The input is rosetta's `ProjectRow.git_repo`: the origin remote as rosetta
// SANITIZED it (userinfo, query and `.git` already stripped, `git@host:p`
// spelled `host:p`), or any raw spelling a remote can carry; both agree. A
// remote that is a LOCAL path (`/srv/git/r`, `../r`, `C:\repos\r`,
// `file:///srv/git/r`) has NO family: it names a folder on one machine, and two
// desktops holding the same path are not one repository. A host with no path
// is not a repository. No ssh host alias is resolved here — the catalog row
// carries rosetta's string, not the device's ssh config.
//
// Pure and synchronous: the follower stamps it on every `projects` row it
// republishes, and the mesh doors filter on it.
import { normalizeRemote } from "./projects/normalize";

export function familyOf(gitRepo: string | null | undefined): string | undefined {
  if (typeof gitRepo !== "string") return undefined;
  const key = normalizeRemote(gitRepo);
  return key === null || key.startsWith("local:") ? undefined : key;
}
