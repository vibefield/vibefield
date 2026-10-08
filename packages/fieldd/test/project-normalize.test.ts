import { describe, expect, it } from "vitest";
import {
  identityRemoteOf,
  normalizeRemote,
  normalizeRemotes,
  projectKey,
  provisionalInk,
} from "../src/projects/normalize";
import { homeRelativeOf, placeKindOf } from "../src/projects/place-kind";

// PJ-1 — the one normalizer (thinking-project-places.md §4.1 E1; build-pj.md
// L4, L5). The first block is the prototype's own runner
// (draft/project-places/test/run-normalize.mjs), check for check: the
// spellings a person's desktops actually produce. The second pins where the
// port departs from it, each a spelling DS-D9's familyOf already read so.

describe("normalizeRemote — the prototype's cases (run-normalize.mjs)", () => {
  it.each([
    [
      [
        "git@github.com:vibefield/vibefield.git",
        "https://github.com/vibefield/vibefield",
        "https://github.com/VibeField/VibeField.git",
        "ssh://git@github.com:22/vibefield/vibefield.git",
        "github.com:vibefield/vibefield",
        "https://user:tok@github.com/vibefield/vibefield/",
        "git+ssh://git@GitHub.com./vibefield/vibefield.git",
        "https://github.com:443/vibefield/vibefield",
      ],
      "github.com/vibefield/vibefield",
    ],
    // the transport's port is not identity: one GitHub Enterprise serves ssh
    // on 2222 and https on 8443 (C11)
    [
      [
        "https://ghe.corp.example:8443/Platform/Tool.git",
        "ssh://git@ghe.corp.example:2222/platform/tool.git",
        "git@ghe.corp.example:Platform/Tool",
      ],
      "ghe.corp.example/platform/tool",
    ],
    [["https://git.example.org/a/b%20c.git", "git@git.example.org:a/b c"], "git.example.org/a/b c"],
  ])("one repository, every spelling: %j", (spellings, key) => {
    expect(new Set(spellings.map((url) => normalizeRemote(url)))).toEqual(new Set([key]));
  });

  it("two owners of one name stay two repositories", () => {
    expect(normalizeRemote("git@github.com:alice/ghostty.git")).not.toBe(
      normalizeRemote("git@github.com:bob/ghostty.git"),
    );
  });

  it.each([
    ["/Users/someone/Projects/vibe-field", "local:/users/someone/projects/vibe-field"],
    ["C:/repos/app.git", "local:c:/repos/app"],
    ["C:\\repos\\app.git", "local:c:/repos/app"],
    ["\\\\nas\\git\\app.git", "local://nas/git/app"],
    ["../mirror/app.git", "local:../mirror/app"],
    ["file:///srv/git/app.git", "local:file:///srv/git/app"],
    ["~/mirrors/app.git", "local:~/mirrors/app"],
  ])("a local path is never identity (C12b): %j → %j", (url, key) => {
    expect(normalizeRemote(url)).toBe(key);
  });

  it.each([
    "https://oauth2:SECRET@gitlab.example.com/team/app.git",
    "https://gitlab.example.com/team/app.git?private_token=SECRET",
    "https://gitlab.example.com/team/app#token=SECRET",
  ])("a secret never reaches a key (C20): %j", (url) => {
    expect(normalizeRemote(url)).toBe("gitlab.example.com/team/app");
  });

  it("an ssh host alias resolves through the device's own map (C10)", () => {
    expect(
      normalizeRemote("git@github-work:VibeField/VibeField.git", { "github-work": "github.com" }),
    ).toBe(normalizeRemote("https://github.com/vibefield/vibefield"));
  });

  it("an unrecognized shape is null, never the raw string", () => {
    expect(normalizeRemote("not a url at all")).toBeNull();
    expect(normalizeRemote("")).toBeNull();
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote(undefined)).toBeNull();
  });
});

describe("normalizeRemote — where the port departs from the prototype", () => {
  it("takes the host after the LAST @, so a password holding one never reaches the key", () => {
    // the prototype's `(?:[^@/]*@)?` stopped at the first @ and keyed `ss@host`
    expect(normalizeRemote("https://user:p@ss@gitlab.example.com/team/app.git")).toBe(
      "gitlab.example.com/team/app",
    );
    expect(normalizeRemote("deploy@key@github.com:o/r.git")).toBe("github.com/o/r");
    expect(normalizeRemote("file://user:SECRET@/srv/git/app.git")).toBe(
      "local:file:///srv/git/app",
    );
  });

  it.each([
    ["https://github.com//o//r", "github.com/o/r"],
    ["ssh://git@[::1]:22/o/r.git", "[::1]/o/r"],
    ["[::1]:o/r", "[::1]/o/r"],
    ["ssh://git@github.com:o/r.git", "github.com/o/r"],
  ])("reads %j as DS-D9's familyOf did: %j", (url, key) => {
    expect(normalizeRemote(url)).toBe(key);
  });

  it("refuses a host with whitespace, and reads an alias map for its own keys only", () => {
    expect(normalizeRemote("https://my host/o/r")).toBeNull();
    expect(normalizeRemote("git@constructor:o/r", {})).toBe("constructor/o/r");
  });
});

describe("the identity remote (E1): push remote › origin › the only remote", () => {
  const remotes = {
    origin: "git@github.com:me/app.git",
    upstream: "https://github.com/them/app",
  };

  it("prefers the push remote, then origin, then a lone remote", () => {
    expect(identityRemoteOf(remotes)).toBe("github.com/me/app");
    expect(identityRemoteOf(remotes, "upstream")).toBe("github.com/them/app");
    expect(identityRemoteOf(remotes, "gone")).toBe("github.com/me/app");
    expect(identityRemoteOf({ fork: "https://github.com/me/app" })).toBe("github.com/me/app");
    // two remotes and neither is origin: no identity, each only suggests
    expect(identityRemoteOf({ a: "https://x.example/a/b", b: "https://x.example/c/d" })).toBeNull();
  });

  it("is never a local path, and every remote is listed once", () => {
    expect(identityRemoteOf({ origin: "../mirror/app.git" })).toBeNull();
    expect(
      normalizeRemotes({
        origin: "git@github.com:me/app.git",
        again: "https://github.com/me/app",
        local: "/srv/app.git",
      }),
    ).toEqual(["github.com/me/app", "local:/srv/app"]);
  });
});

describe("the project key (L5)", () => {
  it("is p1: and 26 base32 characters (128 bits), opaque and stable", () => {
    const key = projectKey("root:0123456789abcdef0123456789abcdef01234567");
    expect(key).toMatch(/^p1:[a-z2-7]{26}$/);
    expect(projectKey("root:0123456789abcdef0123456789abcdef01234567")).toBe(key);
    expect(projectKey("remote:github.com/me/app")).not.toBe(key);
    expect(key).not.toContain("0123456789abcdef");
  });

  it("pins the digest: SHA-256 over the domain, a NUL and the identity", () => {
    // computed independently (Python's hashlib + RFC 4648 base32): a change
    // here re-keys every record-less project, which is a GROUPING_VERSION bump
    expect(projectKey("bucket:home")).toBe("p1:awcwob35yexhb6iked3qg442py");
    expect(projectKey("")).toBe("p1:yftjd6oh2zzyjvscbalih2abzu");
  });

  it("deals a record-less ink inside the deal range, from the same identity", () => {
    const ink = provisionalInk("remote:github.com/me/app");
    expect(ink).toBeGreaterThanOrEqual(0);
    expect(ink).toBeLessThan(997);
    expect(provisionalInk("remote:github.com/me/app")).toBe(ink);
  });
});

describe("what the owner says a place is (L6)", () => {
  const mac = { home: "/Users/someone", taskRoots: ["~/Documents/Codex/*/*"] };
  const win = { home: "C:\\Users\\someone" };

  it.each([
    ["/Users/someone", mac, "home"],
    ["/Users/someone/", mac, "home"],
    ["/", mac, "home"],
    ["C:", win, "home"],
    ["c:\\users\\someone", win, "home"],
    ["/Users/someone/Projects/app", mac, "project"],
    ["/private/tmp/fixture", mac, "temp"],
    ["/tmp", mac, "temp"],
    ["/private/var/folders/x/T/run", mac, "temp"],
    ["C:\\Users\\someone\\AppData\\Local\\Temp\\vf-smoke", win, "temp"],
    ["/Users/someone/Documents/Codex/2026-09-10/thread", mac, "task"],
    ["/Users/someone/Documents/Codex/2026-09-10", mac, "project"],
  ] as const)("%j is %j", (path, owner, kind) => {
    expect(placeKindOf(path, owner)).toBe(kind);
  });

  it("spells a place below home relative to it, and nothing else", () => {
    expect(homeRelativeOf("/Users/someone/Projects/App", "/Users/someone")).toBe("Projects/App");
    expect(homeRelativeOf("C:\\Users\\someone\\src\\App", "C:\\Users\\someone")).toBe("src/App");
    expect(homeRelativeOf("/Users/someone", "/Users/someone")).toBeUndefined();
    expect(homeRelativeOf("/Volumes/Work/app", "/Users/someone")).toBeUndefined();
  });
});
