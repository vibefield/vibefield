import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LinkService, otherUserLinks } from "../src/link-service";
import { RpcCallError } from "../src/native-link";

// UA-3 — the link lifecycle at its seam: capture folds honest states from the
// native answers, the stored login never guesses, and unlink clears exactly
// the identity. Probes are driven directly; the timer loop is cadence only.

const mkRoot = () => mkdtempSync(join(tmpdir(), "vf-link-"));
const linkPath = (root: string) => join(root, "fieldd", "link.json");

interface Call {
  method: string;
  params?: unknown;
}

function build(
  root: string,
  respond: (method: string) => Promise<unknown>,
  extra: Partial<ConstructorParameters<typeof LinkService>[0]> = {},
) {
  const calls: string[] = [];
  const params: Call[] = [];
  const svc = new LinkService({
    dataDir: root,
    native: {
      request: (method: string, p?: unknown) => {
        calls.push(method);
        params.push({ method, ...(p !== undefined ? { params: p } : {}) });
        return respond(method);
      },
    },
    now: () => 1_754_000_000_000,
    ...extra,
  });
  return { svc, calls, params };
}

/** UA-P-0a — the default responder for a floor that has a node up and knows
 * who it is. `mesh.start`/`mesh.stop` answer their own shapes so the parse on
 * the fieldd side is exercised rather than stubbed past. */
const floorWithLogin =
  (login = "james@github", dnsName = "host.tail1234.ts.net") =>
  (method: string): Promise<unknown> => {
    if (method === "native.mesh.start") return Promise.resolve({ mode: "linked", started: true });
    if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
    if (method === "native.mesh.retire")
      return Promise.resolve({ retired: true, archivedTo: "/tmp/mesh.retired-1" });
    return Promise.resolve({ deviceId: "01DEVICE", dnsName, login });
  };

/** The timer loop is cadence only — every row drives the probe directly, so a
 * test never waits on a clock and a failure is never a flake. */
const probe = (svc: LinkService) => (svc as unknown as { probe: () => Promise<void> }).probe();

describe("UA-3 — LinkService", () => {
  it("captures the self-whois login once, with the tailnet suffix", async () => {
    const root = mkRoot();
    const { svc } = build(root, floorWithLogin());
    let changes = 0;
    svc.on("changed", () => changes++);
    await svc.begin();
    const written = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(written.login).toBe("james@github");
    expect(written.tailnet).toBe("tail1234.ts.net");
    expect(written.linkedAt).toBe(new Date(1_754_000_000_000).toISOString());
    expect(svc.status().link?.login).toBe("james@github");
    // second probe, same login: verified in memory, no disk churn
    const before = readFileSync(linkPath(root), "utf8");
    const settled = changes;
    await probe(svc);
    expect(readFileSync(linkPath(root), "utf8")).toBe(before);
    expect(changes).toBe(settled); // the verify changed nothing material
  });

  it("a login change under a live link rewrites the record, keeps linkedAt, and warns (UA-4)", async () => {
    const root = mkRoot();
    let login = "james@github";
    const warns: string[] = [];
    const spyLogger = {
      child: () => spyLogger,
      trace() {},
      debug() {},
      info() {},
      warn(event: string) {
        warns.push(event);
      },
      error() {},
      fatal() {},
      isLevelEnabled: () => true,
    };
    const svc = new LinkService({
      dataDir: root,
      native: {
        request: (method: string) =>
          method === "native.mesh.self"
            ? Promise.resolve({ deviceId: "01DEVICE", login })
            : Promise.resolve({ mode: "linked", started: true }),
      },
      now: () => 1_754_000_000_000,
      logger: spyLogger as unknown as import("@vibefield/logging").Logger,
    });
    await svc.begin();
    const first = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(first.login).toBe("james@github");
    expect(warns).toEqual([]);

    // the trust root moves under the node (account switch without unlink):
    // the stored value follows — the door's verdicts re-scope from here —
    // and the event is loud, not silent
    login = "other@github";
    await probe(svc);
    const second = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(second.login).toBe("other@github");
    expect(second.linkedAt).toBe(first.linkedAt);
    expect(warns).toEqual(["fieldd.link.login_changed"]);
  });

  it("unlink retires natively, clears the record, and reports the archive", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, floorWithLogin());
    await svc.begin();
    expect(existsSync(linkPath(root))).toBe(true);
    const result = await svc.unlink();
    expect(result).toMatchObject({ retired: true, archivedTo: "/tmp/mesh.retired-1" });
    expect(calls).toContain("native.mesh.retire");
    expect(existsSync(linkPath(root))).toBe(false);
    expect(svc.status()).toMatchObject({ link: null, meshEnabled: false, linkState: "offline" });
  });
});

// ---- UA-P-0a (D1): the posture derives from the link ----
//
// Six states, and the point of every row here is that FOUR of them are honest
// refusals rather than blanks. What the mock floor stands in for is the thing
// no test on this plane can have: a real tailnet bring-up drives an interactive
// browser login, so what these rows witness is the STATE MACHINE and the verbs
// it sends — which is exactly the half that decides whether a door opens.

describe("UA-P-0a — the mesh posture", () => {
  it("an UNLINKED boot asks the floor for nothing", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, floorWithLogin());
    svc.start();
    expect(calls).toEqual([]); // no start, and no probe of a node nobody asked for
    expect(svc.status()).toMatchObject({
      linkState: "offline",
      linkDetail: null,
      meshEnabled: false,
      link: null,
    });
    // and the loop stays shut: reaching the probe from offline would be
    // probing a node that does not exist
    await probe(svc);
    expect(calls).toEqual([]);
    svc.stop();
  });

  it("a LINKED boot asks for the node in linked mode, naming the account", async () => {
    const root = mkRoot();
    mkdirSync(join(root, "fieldd"), { recursive: true });
    writeFileSync(
      linkPath(root),
      JSON.stringify({ login: "james@github", linkedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const { svc, params } = build(root, floorWithLogin());
    svc.start();
    await Promise.resolve(); // the declare is fire-and-forget off start()
    expect(params[0]).toEqual({
      method: "native.mesh.start",
      params: { mode: "linked", login: "james@github" },
    });
    expect(svc.status()).toMatchObject({ linkState: "linked", meshEnabled: true });
    svc.stop();
  });

  it("the LINK ACT starts capture, and nothing names an account until the login lands", async () => {
    const root = mkRoot();
    let login: string | undefined;
    const { svc, params } = build(root, (method) => {
      if (method === "native.mesh.start")
        return Promise.resolve({ mode: login === undefined ? "capture" : "linked", started: true });
      return Promise.resolve({ deviceId: "01DEVICE", ...(login !== undefined ? { login } : {}) });
    });

    await svc.begin();
    // capture names NO login: the tailnet has not answered who this node is
    expect(params).toEqual([
      { method: "native.mesh.start", params: { mode: "capture" } },
      { method: "native.mesh.self" },
    ]);
    expect(svc.status()).toMatchObject({ linkState: "capturing", link: null });
    // and nothing was written — a capture window writes no identity record
    expect(existsSync(linkPath(root))).toBe(false);

    // the login lands: the record is written and the floor is promoted
    login = "james@github";
    await probe(svc);
    expect(svc.status()).toMatchObject({ linkState: "linked", linkDetail: null });
    expect(params.at(-1)).toEqual({
      method: "native.mesh.start",
      params: { mode: "linked", login: "james@github" },
    });
    expect(JSON.parse(readFileSync(linkPath(root), "utf8")).login).toBe("james@github");
    svc.stop();
  });

  it("a second link act while capturing re-declares, and a link act while LINKED is refused", async () => {
    const root = mkRoot();
    const { svc } = build(root, (method) =>
      method === "native.mesh.start"
        ? Promise.resolve({ mode: "capture", started: false })
        : Promise.resolve({ deviceId: "01DEVICE" }),
    );
    await svc.begin();
    await svc.begin(); // idempotent: still capturing, no throw
    expect(svc.status().linkState).toBe("capturing");
    svc.stop();

    const linked = mkRoot();
    const { svc: two } = build(linked, floorWithLogin());
    await two.begin();
    expect(two.status().linkState).toBe("linked");
    // relinking a different account is unlink-then-link: unlink is the act
    // that retires the tailnet identity, and skipping it would leave two
    // accounts' state under one node
    await expect(two.begin()).rejects.toThrow(/already linked/);
    two.stop();
  });

  it("a CORRUPT link.json is offline and loud, and names the file", async () => {
    const root = mkRoot();
    mkdirSync(join(root, "fieldd"), { recursive: true });
    writeFileSync(linkPath(root), "{ not json");
    const { svc, calls } = build(root, floorWithLogin());
    svc.start();
    // it used to PAUSE CAPTURE FOREVER with `link: null` — a linked desktop
    // serving an open door under a UI that said "not linked". Now: offline.
    expect(calls).toEqual([]);
    const status = svc.status();
    expect(status.linkState).toBe("link_corrupt");
    expect(status.meshEnabled).toBe(false);
    expect(status.linkDetail).toContain(linkPath(root));
    // and the record is never overwritten by a guess (the older law, intact)
    expect(readFileSync(linkPath(root), "utf8")).toBe("{ not json");
    // linking again is refused until a human moves it aside
    await expect(svc.begin()).rejects.toThrow(/unusable/);
    svc.stop();
  });

  it("a TAGGED node ends capture as login_unavailable and stops the node", async () => {
    const root = mkRoot();
    const { svc, calls } = build(
      root,
      (method) =>
        method === "native.mesh.self"
          ? Promise.resolve({ deviceId: "01DEVICE" }) // up, and no user for it, ever
          : Promise.resolve({ mode: "capture", started: true, stopped: true }),
      { captureAttempts: 3 },
    );
    await svc.begin(); // probe 1
    expect(svc.status().linkState).toBe("capturing");
    await probe(svc); // 2
    expect(svc.status().linkState).toBe("capturing");
    await probe(svc); // 3 — the bound
    const status = svc.status();
    expect(status.linkState).toBe("login_unavailable");
    expect(status.meshEnabled).toBe(false);
    expect(status.linkDetail).toContain("tagged");
    // the node is STOPPED, not retired: the keys stay, so a node that is
    // later given a user can link without minting a new identity
    expect(calls).toContain("native.mesh.stop");
    expect(calls).not.toContain("native.mesh.retire");
    expect(existsSync(linkPath(root))).toBe(false);
    // and the loop is over — a forever-retry is not a state a person can act on
    const settled = calls.length;
    await probe(svc);
    expect(calls.length).toBe(settled);
    svc.stop();
  });

  it("unlink stops the loop as well as the node", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, floorWithLogin());
    await svc.begin();
    expect(svc.status().linkState).toBe("linked");
    await svc.unlink();
    expect(svc.status()).toMatchObject({ linkState: "offline", meshEnabled: false });
    const settled = calls.length;
    await probe(svc);
    expect(calls.length).toBe(settled); // nothing left to probe
    svc.stop();
  });

  it("a floor that cannot be reached does not move the posture", async () => {
    // the link is still the link; the next probe or the next boot re-declares.
    // What must NOT happen is a silent downgrade to something more open.
    const root = mkRoot();
    mkdirSync(join(root, "fieldd"), { recursive: true });
    writeFileSync(
      linkPath(root),
      JSON.stringify({ login: "james@github", linkedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const { svc } = build(root, () =>
      Promise.reject(
        new RpcCallError("UNAVAILABLE", "mesh node not up", true, {
          service: "mesh-gateway",
          state: "starting",
          authUrl: "https://login.tailscale.example/a/b",
        }),
      ),
    );
    svc.start();
    await probe(svc);
    expect(svc.status()).toMatchObject({
      linkState: "linked",
      link: { login: "james@github" },
      nodeState: "starting",
      authUrl: "https://login.tailscale.example/a/b",
    });
    svc.stop();
  });
});

// ---- UA-P-0b (D8): one local user per tailscale account ----
//
// The law has no place to live in `users.json` — `UserRecord` has no account
// field, and the one-to-one binding IS the containment of `link.json` inside
// `users/<fuid>/`. So it is enforced at the one moment a login enters a user's
// tree: capture. These rows build real two-user roots, because the enumeration
// walks a real directory and a mocked one would prove nothing about the shape.

/** A `<root>/users/<fuid>/` machine, optionally with users.json and links. */
function machine(users: Array<{ fuid: number; name: string; login?: string }>) {
  const root = mkdtempSync(join(tmpdir(), "vf-uap0b-"));
  for (const user of users) {
    const dir = join(root, "users", String(user.fuid));
    mkdirSync(join(dir, "fieldd"), { recursive: true });
    if (user.login !== undefined) {
      writeFileSync(
        join(dir, "fieldd", "link.json"),
        JSON.stringify({ login: user.login, linkedAt: "2026-09-15T00:00:00.000Z" }),
      );
    }
  }
  writeFileSync(
    join(root, "users.json"),
    JSON.stringify({
      version: 1,
      nextFuid: users.length + 1,
      lastAttached: null,
      users: users.map((u) => ({
        userId: `01USER${u.fuid}`.padEnd(26, "X"),
        fuid: u.fuid,
        name: u.name,
        resident: true,
        onboarded: true,
        createdAt: "2026-09-15T00:00:00.000Z",
      })),
    }),
  );
  return { root, dirFor: (fuid: number) => join(root, "users", String(fuid)) };
}

describe("UA-P-0b — one local user per tailscale account", () => {
  it("enumerates the OTHER users' held logins, with their names", () => {
    const { root, dirFor } = machine([
      { fuid: 1, name: "James", login: "james@github" },
      { fuid: 2, name: "Work", login: "james@corp.example" },
      { fuid: 3, name: "Unlinked" },
    ]);
    // never its own, and never a user that holds nothing
    expect(otherUserLinks(dirFor(1))).toEqual([{ label: "Work", login: "james@corp.example" }]);
    expect(
      otherUserLinks(dirFor(3))
        .map((o) => o.login)
        .sort(),
    ).toEqual(["james@corp.example", "james@github"]);
    expect(root).toContain("vf-uap0b-");
  });

  it("a data dir that is not <root>/users/<fuid> has no siblings, and says so quietly", () => {
    // dev roots, embedded roots, the headless boot: there is no machine scope
    // above them, so the honest answer is nothing rather than a guessed one
    expect(otherUserLinks(mkRoot())).toEqual([]);
  });

  it("REFUSES a capture of a login another user holds, and names that user", async () => {
    const { dirFor } = machine([
      { fuid: 1, name: "James", login: "james@github" },
      { fuid: 2, name: "Work" },
    ]);
    // user 2 links, and the node comes up under the SAME tailscale account
    const { svc, calls } = build(
      dirFor(2),
      (method) =>
        method === "native.mesh.self"
          ? Promise.resolve({ deviceId: "01DEVICE", login: "james@github" })
          : Promise.resolve({ mode: "capture", started: true, stopped: true }),
      { otherUserLinks: () => otherUserLinks(dirFor(2)) },
    );
    const status = await svc.begin();

    expect(status.linkState).toBe("login_already_linked");
    expect(status.meshEnabled).toBe(false);
    // the SENTENCE is the point: "already linked" with no name is a dead end
    expect(status.linkDetail).toContain("James");
    // nothing was written into user 2's tree — the account did not move
    expect(existsSync(linkPath(dirFor(2)))).toBe(false);
    // and the node is STOPPED, never retired: the keys stay, so linking again
    // after user 1 unlinks costs no new tailnet identity
    expect(calls).toContain("native.mesh.stop");
    expect(calls).not.toContain("native.mesh.retire");
    svc.stop();
  });

  it("the comparison is case-insensitive, because a tailnet login is", async () => {
    const { dirFor } = machine([
      { fuid: 1, name: "James", login: "James@GitHub" },
      { fuid: 2, name: "Work" },
    ]);
    const { svc } = build(
      dirFor(2),
      (method) =>
        method === "native.mesh.self"
          ? Promise.resolve({ deviceId: "01DEVICE", login: "james@github" })
          : Promise.resolve({ mode: "capture", started: true, stopped: true }),
      { otherUserLinks: () => otherUserLinks(dirFor(2)) },
    );
    expect((await svc.begin()).linkState).toBe("login_already_linked");
    svc.stop();
  });

  it("captures normally once that user unlinks", async () => {
    const { dirFor } = machine([
      { fuid: 1, name: "James", login: "james@github" },
      { fuid: 2, name: "Work" },
    ]);
    // user 1 unlinks: the file goes, and the enumeration is re-read at capture
    // rather than cached at boot — a resident background pair can unlink at any
    // time (UA-D3), and the answer that matters is the one true right now
    rmSync(linkPath(dirFor(1)), { force: true });
    const { svc } = build(dirFor(2), floorWithLogin(), {
      otherUserLinks: () => otherUserLinks(dirFor(2)),
    });
    const status = await svc.begin();
    expect(status.linkState).toBe("linked");
    expect(JSON.parse(readFileSync(linkPath(dirFor(2)), "utf8")).login).toBe("james@github");
    svc.stop();
  });

  it("a DIFFERENT account on the same machine is not a collision", async () => {
    const { dirFor } = machine([
      { fuid: 1, name: "James", login: "james@github" },
      { fuid: 2, name: "Work" },
    ]);
    const { svc } = build(dirFor(2), floorWithLogin("james@corp.example"), {
      otherUserLinks: () => otherUserLinks(dirFor(2)),
    });
    expect((await svc.begin()).linkState).toBe("linked");
    svc.stop();
  });
});
