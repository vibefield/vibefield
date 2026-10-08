import { describe, expect, it } from "vitest";
import { familyOf } from "../src/project-family";

// DS-D9 — the repository family (design-06 §5 "Grouping"). The table pins the
// ruling's three words — host lowercased, `.git` dropped, scheme and userinfo
// dropped — and every choice made where the words stop: ports are transport,
// a local path has no family. Since PJ-1 (L4) the family is the one
// normalizer's key, and three choices changed with it: the path FOLDS its case
// on every host (DS-D9's "a path is the server's business" is answered by
// PJ-D1 — the evidence rule needs one spelling per repository), a `www.` host
// prefix is dropped, and percent-escapes are decoded.

describe("familyOf (DS-D9)", () => {
  it("the ruling's example: scp, https and ssh spellings of one repository agree", () => {
    const family = familyOf("git@github.com:o/r.git");
    expect(family).toBe("github.com/o/r");
    expect(familyOf("https://github.com/o/r")).toBe(family);
    expect(familyOf("ssh://git@github.com/o/r")).toBe(family);
  });

  it.each([
    // rosetta's own sanitized spellings (project.rs sanitize_remote) — what
    // `ProjectRow.git_repo` actually carries at the pin
    ["https://github.com/o/r", "github.com/o/r"],
    ["ssh://github.com/o/r", "github.com/o/r"],
    ["github.com:o/r", "github.com/o/r"],
    // raw remotes, as a person or another reader spells them
    ["git@github.com:o/r.git", "github.com/o/r"],
    ["https://github.com/o/r.git", "github.com/o/r"],
    ["git://github.com/o/r.git", "github.com/o/r"],
    ["git+ssh://git@github.com/o/r.git", "github.com/o/r"],
    ["ssh://git@github.com/o/r.git", "github.com/o/r"],
    ["http://github.com/o/r", "github.com/o/r"],
    // userinfo, with and without a secret in it
    ["https://token@github.com/o/r.git", "github.com/o/r"],
    ["https://user:s3cret@github.com/o/r", "github.com/o/r"],
    ["deploy@github.com:o/r", "github.com/o/r"],
    // ports are transport: a self-hosted server reached over ssh:2222 and https
    ["ssh://git@gitlab.example.com:2222/team/app.git", "gitlab.example.com/team/app"],
    ["https://gitlab.example.com:8443/team/app", "gitlab.example.com/team/app"],
    ["https://gitlab.example.com/team/app", "gitlab.example.com/team/app"],
    // an scp path written into a URL (`:o` is not a port) — read as meant
    ["ssh://git@github.com:o/r.git", "github.com/o/r"],
    // trailing slashes, doubled slashes, a query, a fragment
    ["https://github.com/o/r/", "github.com/o/r"],
    ["https://github.com/o/r.git/", "github.com/o/r"],
    ["https://github.com//o//r", "github.com/o/r"],
    ["https://github.com/o/r.git?ref=main#readme", "github.com/o/r"],
    ["git@github.com:/o/r.git", "github.com/o/r"],
    // the host folds, and since PJ-1 (L4) the path folds too — these two
    // rows read `github.com/O/R` under DS-D9's own normalizer
    ["https://GitHub.COM/O/R", "github.com/o/r"],
    ["git@GITHUB.com:O/R.git", "github.com/o/r"],
    ["https://github.com./o/r", "github.com/o/r"],
    // PJ-1 (L4): `www.` is not part of the host, and an escape is its letter
    ["https://www.github.com/o/r", "github.com/o/r"],
    ["https://git.example.org/a/b%20c.git", "git.example.org/a/b c"],
    // nested groups and IPv6 literals
    ["https://gitlab.com/group/sub/app.git", "gitlab.com/group/sub/app"],
    ["ssh://git@[::1]:22/o/r.git", "[::1]/o/r"],
    ["[::1]:o/r", "[::1]/o/r"],
    // surrounding whitespace (a config line's tail)
    ["  git@github.com:o/r.git \n", "github.com/o/r"],
    // only ONE trailing .git is the suffix
    ["https://github.com/o/r.git.git", "github.com/o/r.git"],
  ])("%j → %j", (input, expected) => {
    expect(familyOf(input)).toBe(expected);
  });

  it.each([
    // no remote at all
    [null],
    [undefined],
    [""],
    ["   "],
    // a local path is not a URL and names a folder on ONE machine
    ["/srv/git/repo.git"],
    ["/Users/me/src/app"],
    ["../other-checkout"],
    ["./foo:bar"],
    ["repo"],
    ["file:///srv/git/repo.git"],
    ["FILE:///srv/git/repo"],
    ["C:\\repos\\app"],
    ["c:/repos/app"],
    ["\\\\server\\share\\repo"],
    // a host is not a repository
    ["https://github.com"],
    ["https://github.com/"],
    ["git@github.com:"],
  ])("%j has no family", (input) => {
    expect(familyOf(input)).toBeUndefined();
  });

  it("is idempotent over rosetta's sanitizer: a raw remote and its sanitized form agree", () => {
    // rosetta strips userinfo, the query and `.git`, and spells scp `host:path`
    // (project.rs remote_secrets_are_not_part_of_project_identity)
    const pairs: Array<[string, string]> = [
      ["ssh://user:secret@example.com/acme/repo.git?token=nope", "ssh://example.com/acme/repo"],
      ["git@example.com:acme/repo.git", "example.com:acme/repo"],
      ["https://token@example.com/acme/repo.git", "https://example.com/acme/repo"],
    ];
    for (const [raw, sanitized] of pairs) {
      expect(familyOf(raw)).toBe(familyOf(sanitized));
      expect(familyOf(raw)).toBe("example.com/acme/repo");
    }
  });

  it("different repositories stay different families", () => {
    expect(familyOf("git@github.com:o/r.git")).not.toBe(familyOf("git@github.com:o/r2.git"));
    expect(familyOf("git@github.com:o/r.git")).not.toBe(familyOf("git@gitlab.com:o/r.git"));
    expect(familyOf("https://github.com/fork/r")).not.toBe(familyOf("https://github.com/o/r"));
  });
});
