import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
 * the fieldd side is exercised rather than stubbed past.
 *
 * UA-P-4 — and it states its GATE, because a real floor always does: a node
 * that has captured a login is built with `login_allow = [that login]` (RFC 025
 * §3.1), so `loginAllow` is that one entry. A stand-in that omitted the field
 * would be standing in for a floor that does not exist — `MeshSelfIdentity`
 * requires it, so the capture would fail to parse and the link would never
 * land. Every responder below carries the value ITS posture would really have:
 * `[]` while capturing (no login yet, nothing to gate on) and `[login]` once
 * linked. */
const floorWithLogin =
  (login = "james@github", dnsName = "host.tail1234.ts.net") =>
  (method: string): Promise<unknown> => {
    if (method === "native.mesh.start") return Promise.resolve({ mode: "linked", started: true });
    if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
    if (method === "native.mesh.retire")
      return Promise.resolve({ retired: true, archivedTo: "/tmp/mesh.retired-1" });
    return Promise.resolve({ deviceId: "01DEVICE", dnsName, login, loginAllow: [login] });
  };

/** The timer loop is cadence only — every row drives the probe directly, so a
 * test never waits on a clock and a failure is never a flake. */
const probe = (svc: LinkService) => (svc as unknown as { probe: () => Promise<void> }).probe();

/** Let a fire-and-forget read (the boot's) settle on a real macrotask. */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

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
            ? Promise.resolve({ deviceId: "01DEVICE", login, loginAllow: [login] })
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
  it("an UNLINKED boot declares nothing, and only reads the floor for a capture it still holds", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, floorWithLogin());
    svc.start();
    // TS-1 — no start, and no probe loop: the one read asks whether the floor
    // still holds a capture a previous fieldd began (a capture outlives its
    // fieldd since P3); this floor's node names no capture posture
    await drain();
    expect(calls).toEqual(["native.mesh.self"]);
    expect(svc.status()).toMatchObject({
      linkState: "offline",
      linkDetail: null,
      meshEnabled: false,
      link: null,
    });
    // and the loop stays shut: reaching the probe from offline would be
    // probing a node that does not exist
    await probe(svc);
    expect(calls).toEqual(["native.mesh.self"]);
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
      // the gate follows the posture: nothing while capturing, the captured
      // login once there is one to gate on
      return Promise.resolve({
        deviceId: "01DEVICE",
        ...(login !== undefined ? { login } : {}),
        loginAllow: login !== undefined ? [login] : [],
      });
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
        : Promise.resolve({ deviceId: "01DEVICE", loginAllow: [] }),
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
          ? // up, and no user for it, ever — so never a gate either
            Promise.resolve({ deviceId: "01DEVICE", loginAllow: [] })
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

  it("a floor that cannot be reached does not move the posture to anything more open", async () => {
    // the link is still the link; the next probe or the next boot re-declares.
    // What must NOT happen is a silent downgrade to something more open.
    //
    // TS-1 — and a linked node whose floor offers a sign-in address is asked to
    // sign in again: the word is `expired` (its key's time unknown here), the
    // record and the scope stay exactly as they were. Before TS-1 this read as
    // plain `linked` while nothing could reach the desktop (gap 14).
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
      linkState: "expired",
      link: { login: "james@github" },
      meshEnabled: true,
      nodeState: "starting",
      authUrl: "https://login.tailscale.example/a/b",
    });
    svc.stop();
  });
});

// ---- UA-P-0j: a floor that restarts under fieldd gets its posture back ----
//
// The floor boots holding NO posture (services/mesh.rs: OFFLINE until fieldd
// asks), so a respawn under a live fieldd — the supervisor's crash respawn or
// its wedge restart — left a linked desktop off its tailnet until fieldd itself
// restarted (measured 2026-09-24: a wedge restart at 12:05:59, the node back at
// 14:46:19 with the next fieldd). The probe now reads the floor's own
// `disabled` and asks again, and a re-dial brings that probe forward. Only
// `setTimeout` is faked, so the boot's `schedule(0)` fires only when a row says
// so, and a real `setImmediate` drains a probe a timer started.

const linkedRoot = (link: Record<string, unknown> = {}) => {
  const root = mkRoot();
  mkdirSync(join(root, "fieldd"), { recursive: true });
  writeFileSync(
    linkPath(root),
    JSON.stringify({ login: "james@github", linkedAt: "2026-01-01T00:00:00.000Z", ...link }),
  );
  return root;
};

const notUp = (state: string): Promise<never> =>
  Promise.reject(
    new RpcCallError("UNAVAILABLE", "mesh node not up", true, { service: "mesh-gateway", state }),
  );

const starts = (params: Call[]) => params.filter((call) => call.method === "native.mesh.start");

/** Await the posture ask in flight, if any — the boot's is fire-and-forget. */
const askLanded = async (svc: LinkService) => {
  await (svc as unknown as { declaring: Promise<void> | null }).declaring;
};

/** A floor that holds a posture once asked, and holds none after `restart()`. */
function restartableFloor(
  mode: "linked" | "capture",
  whenHeld: (method: string) => Promise<unknown>,
) {
  let held = false;
  return {
    restart: () => {
      held = false;
    },
    respond: (method: string): Promise<unknown> => {
      if (method === "native.mesh.start") {
        held = true;
        return Promise.resolve({ mode, started: true });
      }
      return held ? whenHeld(method) : notUp("disabled");
    },
  };
}

describe("UA-P-0j — a floor that restarts under fieldd gets its posture back", () => {
  it("a LINKED desktop whose floor holds no posture asks for it again, naming the account", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const floor = restartableFloor("linked", floorWithLogin());
      const { svc, params } = build(linkedRoot(), floor.respond);
      svc.start();
      await askLanded(svc);
      await probe(svc); // up and verified: nothing to ask
      expect(starts(params)).toHaveLength(1);

      floor.restart(); // it holds nothing now…
      svc.floorReconnected(); // …and the mgmt link re-dialed it, as a respawn always does
      await probe(svc);
      expect(starts(params)).toEqual([
        { method: "native.mesh.start", params: { mode: "linked", login: "james@github" } },
        { method: "native.mesh.start", params: { mode: "linked", login: "james@github" } },
      ]);
      expect(svc.status()).toMatchObject({ linkState: "linked", link: { login: "james@github" } });

      await probe(svc); // it holds the posture again: nothing more to ask
      expect(starts(params)).toHaveLength(2);
      expect(svc.status().nodeState).toBe("up");
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("only `disabled` restores: a bring-up in flight, or a posture the floor still holds, is left alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      for (const state of ["starting", "degraded", "crashed"]) {
        const { svc, params } = build(linkedRoot(), (method) =>
          method === "native.mesh.start"
            ? Promise.resolve({ mode: "linked", started: true })
            : notUp(state),
        );
        svc.start();
        await askLanded(svc);
        await probe(svc);
        await probe(svc);
        // a second `start` before the node is installed would ABORT the
        // bring-up and begin another (services/mesh.rs `start`)
        expect(starts(params), state).toHaveLength(1);
        expect(svc.status().nodeState, state).toBe(state);
        svc.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("the boot's own ask is never doubled: not by a probe racing it, nor by a stale `disabled` read just after it lands", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let release = () => {};
      const landed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { svc, params } = build(linkedRoot(), (method) =>
        method === "native.mesh.start"
          ? landed.then(() => ({ mode: "linked", started: true }))
          : notUp("disabled"),
      );
      svc.start(); // the ask is on the wire and the floor has not installed it yet
      await probe(svc);
      expect(starts(params)).toHaveLength(1);

      release();
      await askLanded(svc);
      // UA-P-0k — landed, and the floor can still answer its boot default for
      // a beat: `native.mesh.self` reads its AGGREGATED health, which catches up
      // on its own task. That is not a forgotten posture, and a second `start`
      // would tear down the bring-up the first one began.
      await probe(svc);
      await probe(svc);
      expect(starts(params)).toHaveLength(1);

      // a re-dial is what makes `disabled` evidence again: a respawned floor
      svc.floorReconnected();
      await probe(svc);
      expect(starts(params)).toHaveLength(2);
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a capture interrupted by a floor restart is asked for again, in capture mode", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // capturing: the node is coming up and no login has landed yet
      const floor = restartableFloor("capture", () => notUp("starting"));
      const { svc, params } = build(mkRoot(), floor.respond);
      await svc.begin();
      expect(starts(params)).toEqual([
        { method: "native.mesh.start", params: { mode: "capture" } },
      ]);

      floor.restart();
      svc.floorReconnected();
      await probe(svc);
      expect(starts(params)).toEqual([
        { method: "native.mesh.start", params: { mode: "capture" } },
        { method: "native.mesh.start", params: { mode: "capture" } },
      ]);
      // and nothing names an account: the capture is still waiting for one
      expect(svc.status()).toMatchObject({ linkState: "capturing", link: null });
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a re-dial brings the probe forward while a posture is held, and does nothing offline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const floor = restartableFloor("linked", floorWithLogin());
      const { svc, params } = build(linkedRoot(), floor.respond);
      svc.start();
      await vi.advanceTimersByTimeAsync(0); // the boot's first probe: up, verified
      await drain();
      expect(starts(params)).toHaveLength(1);

      // the floor respawns under us; the next verify is minutes away
      floor.restart();
      await vi.advanceTimersByTimeAsync(60_000);
      await drain();
      expect(starts(params)).toHaveLength(1); // nothing noticed on its own yet

      svc.floorReconnected(); // the mgmt link dialed the new floor
      await vi.advanceTimersByTimeAsync(0);
      await drain();
      expect(starts(params)).toHaveLength(2);
      svc.stop();

      // an OFFLINE desktop holds no posture, so a re-dial asks for nothing —
      // the one read is the boot's (TS-1: a capture the floor still holds)
      const { svc: offline, calls } = build(mkRoot(), floorWithLogin());
      offline.start();
      offline.floorReconnected();
      await vi.advanceTimersByTimeAsync(60_000);
      await drain();
      expect(calls).toEqual(["native.mesh.self"]);
      offline.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a link click is asked for once: the probe begin() awaits may read the floor's stale `disabled` (UA-P-0k)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // the capture ask lands, and the floor's aggregated health has not caught
      // up yet — the read `begin()` awaits right after its ask
      const { svc, params } = build(mkRoot(), (method) =>
        method === "native.mesh.start"
          ? Promise.resolve({ mode: "capture", started: true })
          : notUp("disabled"),
      );
      await svc.begin();
      expect(starts(params)).toEqual([
        { method: "native.mesh.start", params: { mode: "capture" } },
      ]);
      expect(svc.status()).toMatchObject({ linkState: "capturing", link: null });
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an ask that never landed is asked again by the next probe that finds `disabled`, with no re-dial", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let refuse = true;
      const { svc, params } = build(linkedRoot(), (method) => {
        if (method === "native.mesh.start") {
          return refuse ? notUp("disabled") : Promise.resolve({ mode: "linked", started: true });
        }
        return notUp("disabled");
      });
      svc.start();
      await askLanded(svc); // refused: the floor never took it
      refuse = false;
      await probe(svc);
      expect(starts(params)).toHaveLength(2);
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
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
          ? // still CAPTURING when this answers: the promotion to linked is
            // the act that gets refused, so the node is not gated yet
            Promise.resolve({ deviceId: "01DEVICE", login: "james@github", loginAllow: [] })
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
          ? // still CAPTURING when this answers: the promotion to linked is
            // the act that gets refused, so the node is not gated yet
            Promise.resolve({ deviceId: "01DEVICE", login: "james@github", loginAllow: [] })
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

// ---- TS-1 (track TS): no dead ends ----
//
// The plumbing hid four states a person needs words for, and the act that ends
// a capture (gaps 11–15 of `thinking-tailscale-onboarding.md`). Each row drives
// the service against the floor's own answers: `MeshNotUpDetails` while there is
// no node, `MeshSelfIdentity` once there is.

const NOW = 1_754_000_000_000;

const notUpWith = (details: Record<string, unknown>): Promise<never> =>
  Promise.reject(
    new RpcCallError("UNAVAILABLE", "mesh node not up", true, {
      service: "mesh-gateway",
      ...details,
    }),
  );

describe("TS-1 — no dead ends", () => {
  it("a capture the tailnet's device approval holds is awaiting_approval, with the console and the machine's name", async () => {
    let approved = false;
    const { svc } = build(mkRoot(), (method) => {
      if (method === "native.mesh.start")
        return Promise.resolve({ mode: "capture", started: true });
      if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
      return approved
        ? Promise.resolve({ deviceId: "01DEVICE", login: "james@github", loginAllow: [] })
        : notUpWith({
            state: "starting",
            mode: "capture",
            needsApproval: true,
            adminUrl: "https://login.tailscale.com/admin/machines",
            machineName: "truffle-vibefield-studio",
          });
    });
    await svc.begin();
    expect(svc.status()).toMatchObject({
      linkState: "awaiting_approval",
      meshEnabled: true,
      link: null,
      authUrl: null,
      adminUrl: "https://login.tailscale.com/admin/machines",
      machineName: "truffle-vibefield-studio",
    });
    // the admin approves: the node comes up and the capture lands as ever
    approved = true;
    await probe(svc);
    expect(svc.status()).toMatchObject({ linkState: "linked", link: { login: "james@github" } });
    svc.stop();
  });

  it("the floor's mesh unit moving brings the probe forward (P2), once per change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let login: string | undefined;
      const { svc, calls } = build(mkRoot(), (method) => {
        if (method === "native.mesh.start")
          return Promise.resolve({
            mode: login === undefined ? "capture" : "linked",
            started: true,
          });
        return login === undefined
          ? notUpWith({ state: "starting", mode: "capture", authUrl: "https://login.example/a/1" })
          : Promise.resolve({ deviceId: "01DEVICE", login, loginAllow: [login] });
      });
      await svc.begin();
      expect(svc.status().linkState).toBe("capturing");
      const reads = () => calls.filter((call) => call === "native.mesh.self").length;
      const before = reads();

      // the person finishes in the browser and the unit says up: read at once,
      // not at the 15 s probe
      login = "james@github";
      svc.noteFloorHealth([{ unit: "mesh-gateway", state: "up", detail: "tailnet host" }]);
      await vi.advanceTimersByTimeAsync(100);
      await drain();
      expect(reads()).toBe(before + 1);
      expect(svc.status().linkState).toBe("linked");

      // the same word again, or another unit's, brings nothing forward
      const settled = reads();
      svc.noteFloorHealth([{ unit: "mesh-gateway", state: "up", detail: "tailnet host" }]);
      svc.noteFloorHealth([
        { unit: "mesh-gateway", state: "up", detail: "tailnet host" },
        { unit: "terminal", state: "up" },
      ]);
      await vi.advanceTimersByTimeAsync(100);
      await drain();
      expect(reads()).toBe(settled);
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel ends a capture: the node stops, its identity stays, and the desktop is offline again", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, (method) => {
      if (method === "native.mesh.start")
        return Promise.resolve({ mode: "capture", started: true });
      if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
      return notUpWith({
        state: "starting",
        mode: "capture",
        authUrl: "https://login.example/a/2",
      });
    });
    await svc.begin();
    expect(svc.status()).toMatchObject({
      linkState: "capturing",
      authUrl: "https://login.example/a/2",
    });
    const status = await svc.cancel();
    expect(status).toMatchObject({ linkState: "offline", meshEnabled: false, authUrl: null });
    expect(calls).toContain("native.mesh.stop");
    expect(calls).not.toContain("native.mesh.retire");
    expect(existsSync(linkPath(root))).toBe(false);
    // and the loop is over: nothing is left to probe
    const settled = calls.length;
    await probe(svc);
    expect(calls.length).toBe(settled);
    svc.stop();
  });

  it("cancel never ends a link: a capture that landed as the person clicked is a link, honestly", async () => {
    const { svc, calls } = build(mkRoot(), floorWithLogin());
    await svc.begin();
    expect(svc.status().linkState).toBe("linked");
    const status = await svc.cancel();
    expect(status).toMatchObject({ linkState: "linked", link: { login: "james@github" } });
    expect(calls).not.toContain("native.mesh.stop");
    svc.stop();
  });

  it("a linked node signed out of the tailnet is expired once its key's time has passed, removed while it had time", async () => {
    for (const [facts, word] of [
      [{ keyExpiresAt: NOW - 60_000 }, "expired"],
      [{ keyExpiresAt: NOW + 86_400_000 }, "removed"],
      [{ keyExpiryDisabled: true }, "removed"],
      [{}, "expired"], // its time unknown: "sign in again" is true either way
    ] as const) {
      const { svc } = build(linkedRoot(), (method) =>
        method === "native.mesh.start"
          ? Promise.resolve({ mode: "linked", started: true })
          : Promise.resolve({
              deviceId: "01DEVICE",
              login: "james@github",
              loginAllow: ["james@github"],
              mode: "linked",
              needsLogin: true,
              ...facts,
            }),
      );
      svc.start();
      await askLanded(svc);
      await probe(svc);
      expect(svc.status(), JSON.stringify(facts)).toMatchObject({
        linkState: word,
        meshEnabled: true,
        link: { login: "james@github" },
      });
      svc.stop();
    }
  });

  it("renew rebuilds the signed-out node with renew: true, and leaves a sign-in already on offer alone", async () => {
    let offered: string | undefined;
    const { svc, params } = build(linkedRoot(), (method) => {
      if (method === "native.mesh.start") {
        offered = "https://login.example/a/renew";
        return Promise.resolve({ mode: "linked", started: true });
      }
      return offered === undefined
        ? Promise.resolve({
            deviceId: "01DEVICE",
            login: "james@github",
            loginAllow: ["james@github"],
            needsLogin: true,
            keyExpiresAt: NOW - 1,
          })
        : notUpWith({ state: "starting", mode: "linked", authUrl: offered });
    });
    // the boot's ask
    svc.start();
    await askLanded(svc);
    offered = undefined;
    await probe(svc);
    expect(svc.status().linkState).toBe("expired");

    const renewed = await svc.renew();
    expect(starts(params).at(-1)).toEqual({
      method: "native.mesh.start",
      params: { mode: "linked", login: "james@github", renew: true },
    });
    expect(renewed).toMatchObject({
      linkState: "expired",
      authUrl: "https://login.example/a/renew",
      link: { login: "james@github" },
    });
    // asked again while that address is live: nothing is rebuilt
    const count = starts(params).length;
    await svc.renew();
    expect(starts(params)).toHaveLength(count);
    svc.stop();
  });

  it("renew is refused unless the link is waiting to be signed in again", async () => {
    const { svc: offline } = build(mkRoot(), floorWithLogin());
    await expect(offline.renew()).rejects.toThrow(/nothing to renew/);
    const { svc: linked } = build(mkRoot(), floorWithLogin());
    await linked.begin();
    await expect(linked.renew()).rejects.toThrow(/nothing to renew/);
    // and a second link is refused while one stands signed out: renew is its act
    const { svc: expired } = build(linkedRoot(), (method) =>
      method === "native.mesh.start"
        ? Promise.resolve({ mode: "linked", started: true })
        : Promise.resolve({
            deviceId: "01DEVICE",
            login: "james@github",
            loginAllow: ["james@github"],
            needsLogin: true,
          }),
    );
    expired.start();
    await askLanded(expired);
    await probe(expired);
    expect(expired.status().linkState).toBe("expired");
    await expect(expired.begin()).rejects.toThrow(/renew it/);
    offline.stop();
    linked.stop();
    expired.stop();
  });

  it("an auth key rides the one native.mesh.start and nothing else: not the status, not a log line", async () => {
    const KEY = "tskey-auth-kTS1test-0123456789abcdef";
    const lines: string[] = [];
    const spy = {
      child: () => spy,
      trace: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      debug: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      info: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      error: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      fatal: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      isLevelEnabled: () => true,
    };
    const { svc, params } = build(mkRoot(), floorWithLogin(), {
      logger: spy as unknown as import("@vibefield/logging").Logger,
    });
    await svc.begin({ authKey: KEY });
    expect(starts(params)[0]).toEqual({
      method: "native.mesh.start",
      params: { mode: "capture", authKey: KEY },
    });
    // the promotion that follows the capture carries no key: the node has one
    expect(starts(params).at(-1)).toEqual({
      method: "native.mesh.start",
      params: { mode: "linked", login: "james@github" },
    });
    expect(JSON.stringify(svc.status())).not.toContain("tskey");
    expect(lines.join("\n")).not.toContain("tskey");
    svc.stop();
  });

  it("a capture the floor still holds when fieldd boots is carried on, never orphaned", async () => {
    const { svc, calls } = build(mkRoot(), (method) =>
      method === "native.mesh.self"
        ? notUpWith({ state: "starting", mode: "capture", authUrl: "https://login.example/a/held" })
        : Promise.resolve({ mode: "capture", started: true }),
    );
    svc.start();
    await drain();
    await probe(svc);
    expect(svc.status()).toMatchObject({
      linkState: "capturing",
      authUrl: "https://login.example/a/held",
      link: null,
    });
    // it declared nothing: the posture was already the floor's
    expect(calls).not.toContain("native.mesh.start");
    svc.stop();
  });

  it("a floor that states its posture is never re-asked on a lagging `disabled` read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { svc, params } = build(linkedRoot(), (method) =>
        method === "native.mesh.start"
          ? Promise.resolve({ mode: "linked", started: true })
          : notUpWith({ state: "disabled", mode: "linked" }),
      );
      svc.start();
      await askLanded(svc);
      // even after a re-dial, which makes a bare `disabled` evidence (UA-P-0j)
      svc.floorReconnected();
      await probe(svc);
      await probe(svc);
      expect(starts(params)).toHaveLength(1);
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the key's expiry is kept in the record, written only when it moves", async () => {
    const root = linkedRoot();
    let expiry = NOW + 10 * 86_400_000;
    const { svc } = build(root, (method) =>
      method === "native.mesh.start"
        ? Promise.resolve({ mode: "linked", started: true })
        : Promise.resolve({
            deviceId: "01DEVICE",
            login: "james@github",
            loginAllow: ["james@github"],
            keyExpiresAt: expiry,
          }),
    );
    svc.start();
    await askLanded(svc);
    await probe(svc);
    expect(svc.status().keyExpiresAt).toBe(expiry);
    expect(JSON.parse(readFileSync(linkPath(root), "utf8")).keyExpiresAt).toBe(expiry);
    const written = readFileSync(linkPath(root), "utf8");
    await probe(svc);
    expect(readFileSync(linkPath(root), "utf8")).toBe(written); // a verify never churns the disk
    expiry += 180 * 86_400_000; // renewed in the console
    await probe(svc);
    expect(JSON.parse(readFileSync(linkPath(root), "utf8")).keyExpiresAt).toBe(expiry);
    svc.stop();

    // and a later boot whose node is down still knows the date
    const { svc: again } = build(root, () => notUpWith({ state: "starting", mode: "linked" }));
    expect(again.status().keyExpiresAt).toBe(expiry);
  });

  it("a floor with no sidecar to start says so: the failure rides the status", async () => {
    const { svc } = build(mkRoot(), (method) =>
      method === "native.mesh.start"
        ? Promise.resolve({ mode: "capture", started: true })
        : notUpWith({ state: "degraded", mode: "capture", failure: "sidecar_missing" }),
    );
    await svc.begin();
    expect(svc.status()).toMatchObject({ linkState: "capturing", failure: "sidecar_missing" });
    svc.stop();
  });
});

// ---- TS-D14/D15/D16 and T11 (track TS): truffle 0.7.24's surface ----
//
// The node sends Tailscale no client logs unless the person said to (D15); a
// tailnet that requires them keeps it down, a named state with its act (D16);
// Disconnect signs out first (D14); Tailnet Lock and the embedded client reach
// the status (T11). Each row drives the service against the floor's answers.

const storedLink = (root: string) => JSON.parse(readFileSync(linkPath(root), "utf8"));

describe("TS-D14/D15/D16 and T11 — on truffle 0.7.24's surface", () => {
  it("a capture the tailnet refuses for sending no logs is logs_required, and begins again with Send logs on this network", async () => {
    let sending = false;
    const root = mkRoot();
    const { svc, params } = build(root, (method) => {
      if (method === "native.mesh.start")
        return Promise.resolve({ mode: "capture", started: true });
      if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
      return sending
        ? Promise.resolve({ deviceId: "01DEVICE", login: "james@github", loginAllow: [] })
        : notUpWith({ state: "degraded", mode: "capture", failure: "logging_required" });
    });
    await svc.begin();
    expect(svc.status()).toMatchObject({
      linkState: "logs_required",
      meshEnabled: true,
      link: null,
      failure: "logging_required",
      sendLogs: false,
    });
    // VibeField's default (D15): the first ask sent no opt-in
    expect(starts(params)[0]?.params).toEqual({ mode: "capture" });

    sending = true;
    await svc.begin({ sendLogs: true });
    expect(starts(params)[1]?.params).toEqual({ mode: "capture", clientLogUpload: true });
    expect(svc.status()).toMatchObject({ linkState: "linked", sendLogs: true });
    // capture keeps the opt-in in the new link.json, and the promotion asks with it
    expect(storedLink(root)).toMatchObject({ login: "james@github", sendLogs: true });
    expect(starts(params).at(-1)?.params).toEqual({
      mode: "linked",
      login: "james@github",
      clientLogUpload: true,
    });
    svc.stop();
  });

  it("a capture refused for its logs can be cancelled, and the desktop is offline again", async () => {
    const { svc, calls } = build(mkRoot(), (method) => {
      if (method === "native.mesh.start")
        return Promise.resolve({ mode: "capture", started: true });
      if (method === "native.mesh.stop") return Promise.resolve({ stopped: true });
      return notUpWith({ state: "degraded", mode: "capture", failure: "logging_required" });
    });
    await svc.begin();
    expect(svc.status().linkState).toBe("logs_required");
    await svc.cancel();
    expect(calls).toContain("native.mesh.stop");
    expect(svc.status()).toMatchObject({ linkState: "offline", meshEnabled: false });
    svc.stop();
  });

  it("a standing link the tailnet keeps down for its logs is logs_required; Send logs on this network keeps it in link.json and builds the node again", async () => {
    let sending = false;
    const root = linkedRoot();
    const { svc, params } = build(root, (method) => {
      if (method === "native.mesh.start") return Promise.resolve({ mode: "linked", started: true });
      return sending
        ? Promise.resolve({
            deviceId: "01DEVICE",
            login: "james@github",
            loginAllow: ["james@github"],
            clientLogUpload: true,
          })
        : notUpWith({ state: "degraded", mode: "linked", failure: "logging_required" });
    });
    svc.start();
    await drain();
    await probe(svc);
    expect(svc.status()).toMatchObject({ linkState: "logs_required", meshEnabled: true });
    // a standing link is not linked again: its act is Send logs on this network
    await expect(svc.begin()).rejects.toThrow(/requires device logs/);

    sending = true;
    await svc.logs(true);
    expect(storedLink(root)).toMatchObject({ login: "james@github", sendLogs: true });
    expect(starts(params).at(-1)?.params).toEqual({
      mode: "linked",
      login: "james@github",
      clientLogUpload: true,
    });
    expect(svc.status()).toMatchObject({ linkState: "linked", sendLogs: true });

    // the same answer twice changes nothing
    const asked = starts(params).length;
    await svc.logs(true);
    expect(starts(params)).toHaveLength(asked);

    // and off again: the node is built again sending none
    await svc.logs(false);
    expect(storedLink(root).sendLogs).toBe(false);
    expect(starts(params).at(-1)?.params).toEqual({ mode: "linked", login: "james@github" });
    expect(svc.status().sendLogs).toBe(false);
    svc.stop();
  });

  it("Send logs on this network needs a link that stands", async () => {
    const { svc } = build(mkRoot(), floorWithLogin());
    await expect(svc.logs(true)).rejects.toThrow(/no tailscale link/);
  });

  it("a link's opt-in survives fieldd's restart: the boot asks for the node with it", async () => {
    const root = linkedRoot({ sendLogs: true });
    const { svc, params } = build(root, floorWithLogin());
    svc.start();
    await Promise.resolve(); // the declare is fire-and-forget off start()
    expect(params[0]).toEqual({
      method: "native.mesh.start",
      params: { mode: "linked", login: "james@github", clientLogUpload: true },
    });
    expect(svc.status().sendLogs).toBe(true);
    svc.stop();
  });

  it("Tailnet Lock's hold and the embedded client reach the status, and the hold goes with the node", async () => {
    let answer: () => Promise<unknown> = () =>
      Promise.resolve({
        deviceId: "01DEVICE",
        login: "james@github",
        loginAllow: ["james@github"],
        needsSignature: true,
        tailscaleVersion: "1.104.1",
      });
    const { svc } = build(linkedRoot(), (method) =>
      method === "native.mesh.start"
        ? Promise.resolve({ mode: "linked", started: true })
        : answer(),
    );
    svc.start();
    await drain();
    await probe(svc);
    expect(svc.status()).toMatchObject({
      linkState: "linked",
      needsSignature: true,
      tailscaleVersion: "1.104.1",
    });
    answer = () =>
      Promise.resolve({
        deviceId: "01DEVICE",
        login: "james@github",
        loginAllow: ["james@github"],
      });
    await probe(svc);
    expect(svc.status()).toMatchObject({ needsSignature: false, tailscaleVersion: "1.104.1" });
    answer = () => notUpWith({ state: "degraded", mode: "linked", failure: "sidecar_exited" });
    await probe(svc);
    expect(svc.status()).toMatchObject({ needsSignature: false, tailscaleVersion: "1.104.1" });
    svc.stop();
  });

  it("unlink signs out first, with the floor's bound plus a margin, and says whether Tailscale took it", async () => {
    for (const signedOut of [true, false]) {
      const deadlines: unknown[] = [];
      const svc = new LinkService({
        dataDir: linkedRoot(),
        native: {
          request: (method: string, _params?: unknown, opts?: { deadlineMs?: number }) => {
            if (method === "native.mesh.retire") {
              deadlines.push(opts?.deadlineMs);
              return Promise.resolve({
                retired: true,
                archivedTo: "/tmp/mesh.retired-1",
                signedOut,
              });
            }
            return floorWithLogin()(method);
          },
        },
        now: () => NOW,
      });
      const result = await svc.unlink();
      expect(result.signedOut).toBe(signedOut);
      // truffle's LOGOUT_TIMEOUT is 12 s: the default 10 s deadline would give up first
      expect(deadlines).toEqual([20_000]);
      svc.stop();
    }
  });

  it("an offline Disconnect answers signedOut inside its deadline: the floor's 12 s bound, then no sign-out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const svc = new LinkService({
        dataDir: linkedRoot(),
        native: {
          request: (method: string) =>
            method === "native.mesh.retire"
              ? new Promise((resolve) =>
                  setTimeout(
                    () =>
                      resolve({
                        retired: true,
                        archivedTo: "/tmp/mesh.retired-1",
                        signedOut: false,
                      }),
                    12_000,
                  ),
                )
              : floorWithLogin()(method),
        },
        now: () => NOW,
      });
      const unlinking = svc.unlink();
      await vi.advanceTimersByTimeAsync(12_000);
      const result = await unlinking;
      expect(result).toMatchObject({ retired: true, signedOut: false });
      expect(svc.status()).toMatchObject({ linkState: "offline", link: null });
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
