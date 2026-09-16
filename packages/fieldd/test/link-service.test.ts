import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LinkService } from "../src/link-service";
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
