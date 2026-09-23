import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hello, HelloAck } from "../src/envelope";
import { MeshRetireResult, MeshSelfIdentity } from "../src/mgmt";
import { ProductInfo } from "../src/shell";
import {
  LayoutStamp,
  TailscaleLink,
  UserLinkState,
  UserLinkStatus,
  UserRecord,
  UsersFile,
  UsersUpdateParams,
} from "../src/users";

const here = dirname(fileURLToPath(import.meta.url));

// UA-1 — the users.json vector. TS-only by design-01 §7 (no native consumer);
// the fixture is the deliberate-change tripwire AND the unknown-key witness.
describe("UsersFile (golden vector)", () => {
  const raw = readFileSync(join(here, "..", "fixtures", "users.vector.json"), "utf8");

  it("parses the vector", () => {
    const file = UsersFile.parse(JSON.parse(raw));
    expect(file.version).toBe(1);
    expect(file.users).toHaveLength(2);
    expect(file.users[0]?.fuid).toBe(1);
    expect(file.lastAttached).toBe(file.users[0]?.userId);
  });

  it("preserves unknown keys through a read-modify-write round trip (UA-D10)", () => {
    const file = UsersFile.parse(JSON.parse(raw));
    const first = file.users[0];
    if (first === undefined) throw new Error("vector has no users");
    first.name = "renamed";
    const republished = JSON.parse(JSON.stringify(UsersFile.parse(file)));
    expect(republished.futureTopLevel).toEqual({ alsoSurvives: true });
    expect(republished.users[0].futureUserField).toBe("must survive a read-modify-write");
    expect(republished.users[0].name).toBe("renamed");
  });

  it("reads a face and a legacy accent side by side (v0.3, UA-D17)", () => {
    const file = UsersFile.parse(JSON.parse(raw));
    // user 1 is the pre-v0.3 shape W6 must still read; user 2 wears a face,
    // and a field a later build adds to the face survives a round trip too.
    expect(file.users[0]?.color).toBe("accent-3");
    expect(file.users[0]?.face).toBeUndefined();
    expect(file.users[1]?.face).toMatchObject({ emoji: "🐙", frame: "coin" });
    const republished = JSON.parse(JSON.stringify(UsersFile.parse(file)));
    expect(republished.users[1].face.futureFaceField).toBe("survives too");
  });

  it("refuses structural corruption", () => {
    expect(() =>
      UsersFile.parse({ version: 2, nextFuid: 1, lastAttached: null, users: [] }),
    ).toThrow();
    expect(() => UserRecord.parse({ userId: "", fuid: 0, name: "", resident: true })).toThrow();
  });

  it("LayoutStamp parses both provenance values", () => {
    for (const previous of ["flat-v1", "fresh"] as const) {
      expect(
        LayoutStamp.parse({ layoutVersion: 2, migratedAt: "2026-08-05T00:00:00.000Z", previous })
          .previous,
      ).toBe(previous);
    }
  });
});

// UA-3 — the link lifecycle shapes.
describe("link lifecycle (UA-3)", () => {
  it("TailscaleLink tolerates the pre-capture null login", () => {
    const link = TailscaleLink.parse({ login: null, linkedAt: "2026-08-05T00:00:00.000Z" });
    expect(link.login).toBeNull();
    expect(
      TailscaleLink.parse({
        login: "james@github",
        tailnet: "tail1234.ts.net",
        linkedAt: "2026-08-05T00:00:00.000Z",
      }).tailnet,
    ).toBe("tail1234.ts.net");
  });

  it("UserLinkStatus carries every honest degraded shape", () => {
    const off = UserLinkStatus.parse({
      link: null,
      meshEnabled: false,
      nodeState: "disabled",
      authUrl: null,
      linkState: "offline",
      linkDetail: null,
    });
    expect(off.meshEnabled).toBe(false);
    const pending = UserLinkStatus.parse({
      link: null,
      meshEnabled: true,
      nodeState: "starting",
      authUrl: "https://login.example/x",
      linkState: "capturing",
      linkDetail: null,
    });
    expect(pending.authUrl).toContain("https://");
  });

  // UA-P-0a (D1) — the posture is a CLOSED enum, and four of its six arms are
  // refusals that carry a sentence. The shape is what makes an Account pane
  // able to say "move this file" or "unlink that user" instead of a blank.
  it("UA-P-0a — every refusal state parses, and the ones that need a sentence carry one", () => {
    for (const state of [
      "offline",
      "capturing",
      "linked",
      "link_corrupt",
      "login_unavailable",
      "login_already_linked",
    ] as const) {
      expect(UserLinkState.parse(state)).toBe(state);
    }
    expect(UserLinkState.safeParse("enabled").success).toBe(false);

    const corrupt = UserLinkStatus.parse({
      link: null,
      meshEnabled: false,
      nodeState: null,
      authUrl: null,
      linkState: "link_corrupt",
      linkDetail: "link.json is present but unusable: /u/1/fieldd/link.json",
    });
    // the PATH is the point: a state a human cannot act on is a blank with a
    // name on it
    expect(corrupt.linkDetail).toContain("link.json");
    expect(corrupt.meshEnabled).toBe(false);

    // and the posture is not optional — a status without it would let a stale
    // producer read as "offline" by omission
    expect(
      UserLinkStatus.safeParse({
        link: null,
        meshEnabled: false,
        nodeState: null,
        authUrl: null,
      }).success,
    ).toBe(false);
  });

  it("MeshSelfIdentity never requires what the node cannot know", () => {
    // `login` is a TAILNET fact and the tailnet may decline to state it — a
    // tagged node has no user profile at all — so it is optional, and absence
    // is a typed pre-capture state rather than an error.
    expect(MeshSelfIdentity.parse({ deviceId: "01D", loginAllow: [] }).login).toBeUndefined();
    expect(
      MeshSelfIdentity.parse({
        deviceId: "01D",
        ip: "100.64.0.1",
        login: "a@b",
        loginAllow: ["a@b"],
      }).login,
    ).toBe("a@b");
  });

  it("MeshSelfIdentity DOES require the gate, because the node always knows it", () => {
    // UA-P-4 — the other side of the rule above, and the distinction is the
    // whole of it. `loginAllow` is not a fact the tailnet supplies; it is the
    // allow-list the floor HANDED truffle when it built this node (RFC 025
    // §3.1 fixes it for the node's lifetime). A floor either has a node and
    // knows what it built it with, or has no node to describe at all.
    //
    // So it is required, and `[]` is a real answer — truffle's "no gate" —
    // rather than a missing one. Optional would give the question a third
    // state, and the reader most in need of it ("is this node admitting only
    // my account?") would read absence as "ungated": the fail-OPEN shape
    // UA-P-0 spent itself closing.
    expect(MeshSelfIdentity.safeParse({ deviceId: "01D" }).success).toBe(false);
    expect(MeshSelfIdentity.parse({ deviceId: "01D", loginAllow: [] }).loginAllow).toEqual([]);
    expect(
      MeshSelfIdentity.parse({ deviceId: "01D", loginAllow: ["me@example.com"] }).loginAllow,
    ).toEqual(["me@example.com"]);
  });

  it("MeshRetireResult reports both the archive and the honest no-op", () => {
    expect(MeshRetireResult.parse({ retired: false, archivedTo: null }).retired).toBe(false);
    expect(
      MeshRetireResult.parse({ retired: true, archivedTo: "/x/mesh.retired-1" }).archivedTo,
    ).toContain("retired");
  });

  it("UsersUpdateParams tolerates unknown fields and refuses invalid ones", () => {
    expect(UsersUpdateParams.parse({ name: "james", future: 1 }).name).toBe("james");
    expect(() => UsersUpdateParams.parse({ name: "" })).toThrow();
  });
});

// UA-2 — identity threading shapes: the pair asserts which user it serves.
describe("identity threading (UA-2)", () => {
  const base = { contractsVersion: "1.0.0", minCompatible: "1.0.0", clientKind: "shell-main" };

  it("Hello carries an optional user expectation", () => {
    expect(Hello.parse({ ...base, userId: "01X" }).userId).toBe("01X");
    expect(Hello.parse(base).userId).toBeUndefined();
  });

  it("HelloAck asserts the server's user — string, null, or pre-UA-2 absent", () => {
    const ack = { contractsVersion: "1.0.0", serverKind: "fieldd", grantedScopes: [] };
    expect(HelloAck.parse({ ...ack, userId: "01X" }).userId).toBe("01X");
    expect(HelloAck.parse({ ...ack, userId: null }).userId).toBeNull();
    expect(HelloAck.parse(ack).userId).toBeUndefined();
  });

  it("ProductInfo records the served user; absence stays adoptable (tolerance)", () => {
    const info = {
      port: 4242,
      pid: 1,
      bootId: "b",
      contractsVersion: "1.0.0",
      startedAt: 0,
      nativePid: null,
    };
    expect(ProductInfo.parse({ ...info, userId: "01X" }).userId).toBe("01X");
    expect(ProductInfo.parse({ ...info, userId: null }).userId).toBeNull();
    expect(ProductInfo.parse(info).userId).toBeUndefined();
    expect(() => ProductInfo.parse({ ...info, userId: "" })).toThrow();
  });
});
