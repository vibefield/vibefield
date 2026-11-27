import { describe, expect, it } from "vitest";
import type { SocketLine, SocketRead } from "../src/testing/pages-listeners";
import {
  type CensusRow,
  type EngineSample,
  enginesIn,
  type FolderRead,
  joinVerdicts,
  judgeCensus,
  judgeEngineListeners,
  judgeEngineTcp,
  judgeMainControl,
  judgePeer,
  judgePeerTie,
  judgePidFile,
  judgeSocketHeld,
  judgeStreamPolls,
  judgeTries,
  judgeUdp,
  PAGES_OPEN_TRIES,
  PAGES_OPEN_WINDOW_MS,
  type PeerProbe,
  STREAM_POLL_MAX_GAP_MS,
  type StreamWatch,
} from "../src/testing/pages-witness-judge";

// Item 658 (2026-11-26): the pages smoke's verdict rules, on plain data. Three words: ok, red and
// blind. Blind is a row that could not see what it claims, and it is never folded into ok; red is
// never hidden by a blind or an ok beside it.

const read = (...lines: SocketLine[]): SocketRead => ({ seen: "read", lines });
const blindRead: SocketRead = { seen: "blind", why: "lsof did not answer" };
const listen = (name: string) => ({ name, state: "listen" }) as const;
const established = (name: string) => ({ name, state: "established" }) as const;
const BRIDGE = "127.0.0.1:53211";
const toBridge = established(`127.0.0.1:53300->${BRIDGE}`);

describe("joining verdicts", () => {
  it("lets red beat blind and blind beat ok, and calls nothing judged blind", () => {
    const ok = { verdict: "ok" } as const;
    const blind = { verdict: "blind", why: "b" } as const;
    const red = { verdict: "red", why: "r" } as const;
    expect(joinVerdicts([ok, ok]).verdict).toBe("ok");
    expect(joinVerdicts([ok, blind, ok])).toMatchObject({ verdict: "blind", why: "b" });
    expect(joinVerdicts([blind, red, ok])).toMatchObject({ verdict: "red", why: "r" });
    expect(joinVerdicts([red, blind])).toMatchObject({ verdict: "red", why: "r" });
    expect(joinVerdicts([]).verdict).toBe("blind");
  });

  it("keeps what every ok part said: a thing seen and not judged is not lost in the join", () => {
    const got = joinVerdicts([
      { verdict: "ok", said: ["no pid file was seen"] },
      { verdict: "ok" },
      { verdict: "ok", said: ["127.0.0.1:50000->127.0.0.1:53"] },
    ]);
    expect(got).toEqual({
      verdict: "ok",
      said: ["no pid file was seen", "127.0.0.1:50000->127.0.0.1:53"],
    });
    expect(joinVerdicts([{ verdict: "ok" }, { verdict: "ok" }])).toEqual({ verdict: "ok" });
  });
});

describe("main's control: the probe must see the bridge appear", () => {
  it("is ok only when a new loopback listener shows after the first call, and names it", () => {
    const before = read(listen("127.0.0.1:40000"));
    const after = read(listen("127.0.0.1:40000"), listen(BRIDGE));
    expect(judgeMainControl(before, after)).toMatchObject({ verdict: "ok", bridge: BRIDGE });
  });

  it("is blind when nothing new shows, when the new listener is not on loopback, or when either read is blind", () => {
    const one = read(listen("127.0.0.1:40000"));
    expect(judgeMainControl(one, one)).toMatchObject({ verdict: "blind", bridge: null });
    expect(judgeMainControl(read(), read(listen("*:53211")))).toMatchObject({
      verdict: "blind",
      bridge: null,
    });
    expect(judgeMainControl(blindRead, read(listen(BRIDGE))).verdict).toBe("blind");
    expect(judgeMainControl(read(), blindRead).verdict).toBe("blind");
    // two new loopback listeners: which is the bridge cannot be told, so the engine's control has no port
    expect(judgeMainControl(read(), read(listen(BRIDGE), listen("127.0.0.1:53212")))).toMatchObject(
      { verdict: "blind", bridge: null },
    );
  });
});

describe("the engine's TCP sockets over its life", () => {
  const sample = (at: number, r: SocketRead, o: Partial<EngineSample> = {}): EngineSample => ({
    startedAt: at,
    endedAt: at + 20,
    exitedBefore: false,
    exitedAfter: false,
    read: r,
    ...o,
  });
  const LIFE = { spawnedAt: 0, endedAt: 2500 };

  it("counts a read only when it shows the engine's own connection to the bridge, and is ok on three with no listener in any read", () => {
    const got = judgeEngineTcp(
      [
        // before main attached it: read, and it shows nothing a control could be told by
        sample(100, read()),
        sample(600, read(toBridge)),
        sample(1300, read(toBridge)),
        sample(2000, read(toBridge)),
      ],
      BRIDGE,
      LIFE,
    );
    expect(got).toMatchObject({
      verdict: "ok",
      counted: 3,
      bare: 1,
      discarded: 0,
      listeners: [],
    });
    // the largest gap between counted reads, from one's end to the next one's start
    expect(got.maxGapMs).toBe(680);
    // and the two stretches no counted read covers are said: the spawn to the first, the last to the end
    expect(got.headMs).toBe(600);
    expect(got.tailMs).toBe(480);
  });

  it("is blind when fewer than three reads bore the control, however many were read inside its life", () => {
    const got = judgeEngineTcp(
      [
        sample(100, read()),
        sample(600, read()),
        sample(1100, read()),
        sample(1600, read(toBridge)),
        sample(2100, read(toBridge)),
      ],
      BRIDGE,
      LIFE,
    );
    expect(got).toMatchObject({ verdict: "blind", counted: 2, bare: 3 });
    // an empty read after the control was seen is what lsof gives for a process that is gone and not
    // yet seen to exit: it is no third counted read
    const dying = judgeEngineTcp(
      [sample(600, read(toBridge)), sample(1300, read(toBridge)), sample(2000, read())],
      BRIDGE,
      LIFE,
    );
    expect(dying).toMatchObject({ verdict: "blind", counted: 2, bare: 1 });
    // a connection to some other port is not the control
    const other = established("127.0.0.1:53300->127.0.0.1:9");
    expect(
      judgeEngineTcp(
        [sample(0, read(other)), sample(600, read(other)), sample(1300, read(other))],
        BRIDGE,
        LIFE,
      ),
    ).toMatchObject({ verdict: "blind", counted: 0, bare: 3 });
    // with no counted read there is no stretch to say
    expect(judgeEngineTcp([sample(100, read())], BRIDGE, LIFE)).toMatchObject({
      headMs: null,
      tailMs: null,
    });
  });

  it("takes only an ESTABLISHED connection to the bridge as its control: a line to the same address in another state counts nothing", () => {
    const closing = { name: `127.0.0.1:53300->${BRIDGE}`, state: "other" } as const;
    const got = judgeEngineTcp(
      [sample(100, read(closing)), sample(700, read(closing)), sample(1300, read(closing))],
      BRIDGE,
      LIFE,
    );
    expect(got).toMatchObject({ verdict: "blind", counted: 0, bare: 3 });
  });

  it("is blind with no bridge known, and says that: there is nothing to look for", () => {
    const got = judgeEngineTcp(
      [sample(0, read(toBridge)), sample(600, read(toBridge)), sample(1300, read(toBridge))],
      null,
      LIFE,
    );
    expect(got).toMatchObject({ verdict: "blind", counted: 0 });
    expect(got.why).toMatch(/bridge is not known/u);
  });

  it("is red on any listener in any read, counted or not, named by its address, whatever else is blind", () => {
    const got = judgeEngineTcp(
      [
        sample(0, read(toBridge)),
        sample(600, read(toBridge, listen("127.0.0.1:53999"))),
        sample(1300, blindRead),
      ],
      BRIDGE,
      LIFE,
    );
    expect(got).toMatchObject({ verdict: "red", listeners: ["127.0.0.1:53999"] });
    expect(got.why).toContain("127.0.0.1:53999");
    // in a read that bore no control
    expect(
      judgeEngineTcp(
        [
          sample(100, read(listen("127.0.0.1:53999"))),
          sample(600, read(toBridge)),
          sample(1300, read(toBridge)),
          sample(2000, read(toBridge)),
        ],
        BRIDGE,
        LIFE,
      ).verdict,
    ).toBe("red");
    // and in a read that straddles the exit: it was read
    expect(
      judgeEngineTcp(
        [
          sample(0, read(toBridge)),
          sample(600, read(toBridge)),
          sample(1300, read(toBridge)),
          sample(1900, read(listen("127.0.0.1:53999")), { exitedAfter: true }),
        ],
        BRIDGE,
        LIFE,
      ).verdict,
    ).toBe("red");
  });

  it("discards a read the child did not live before and after, though it shows the control", () => {
    const got = judgeEngineTcp(
      [
        sample(0, read(toBridge)),
        sample(600, read(toBridge)),
        sample(1300, read(toBridge), { exitedAfter: true }),
        sample(1900, read(toBridge), { exitedBefore: true, exitedAfter: true }),
      ],
      BRIDGE,
      LIFE,
    );
    expect(got).toMatchObject({ verdict: "blind", counted: 2, discarded: 2 });
  });

  it("is blind when a read inside its life did not answer and none is red", () => {
    const got = judgeEngineTcp(
      [
        sample(0, read(toBridge)),
        sample(600, blindRead),
        sample(1300, read(toBridge)),
        sample(2000, read(toBridge)),
      ],
      BRIDGE,
      LIFE,
    );
    expect(got.verdict).toBe("blind");
    // a read that did not answer outside its life is discarded like any other
    expect(
      judgeEngineTcp(
        [
          sample(0, read(toBridge)),
          sample(600, read(toBridge)),
          sample(1300, read(toBridge)),
          sample(2000, blindRead, { exitedAfter: true }),
        ],
        BRIDGE,
        LIFE,
      ).verdict,
    ).toBe("ok");
  });
});

describe("the listeners alone, for an engine main never leased", () => {
  const sample = (at: number, r: SocketRead, o: Partial<EngineSample> = {}): EngineSample => ({
    startedAt: at,
    endedAt: at + 20,
    exitedBefore: false,
    exitedAfter: false,
    read: r,
    ...o,
  });
  /** A read taken at once inside main's refusal line, with what the unix read after it said. */
  const atRefusal = (
    alive: NonNullable<EngineSample["alive"]>,
    r: SocketRead = read(),
  ): EngineSample => sample(40, r, { alive });

  it("for an engine that never answered main: ok on a read inside its life with no listener, and says that no read could bear the bridge control", () => {
    const got = judgeEngineListeners([sample(0, read()), sample(500, read())], "unanswered");
    expect(got).toMatchObject({
      verdict: "ok",
      inside: 2,
      discarded: 0,
      unborne: 0,
      listeners: [],
    });
    expect(got.said).toEqual([
      "2 reads of its sockets inside its life showed no listener; the engine never answered main, so none could bear the bridge control",
    ]);
  });

  it("for an engine main REFUSED: counts only a read taken at its refusal that the unix read after it showed alive, and says the named waiver", () => {
    const got = judgeEngineListeners([sample(0, read()), atRefusal("shown")], "refused");
    expect(got).toMatchObject({ verdict: "ok", inside: 1, unborne: 1, discarded: 0 });
    expect(got.said).toEqual([
      "1 read of its sockets showed no listener; the refused engine's TCP read has no bridge positive control; its life is tied by the unix read",
    ]);
    // a waited read, however many fell inside its life by the exit's word alone, is no read of a
    // refused engine: lsof's silence is also a process that is gone
    expect(judgeEngineListeners([sample(0, read()), sample(500, read())], "refused")).toMatchObject(
      {
        verdict: "blind",
        why: "no read of the refused engine's sockets was tied to its life by a read of its unix sockets after it",
        inside: 0,
        unborne: 2,
      },
    );
    // the unix read READ and did not show the socket: that read is set aside, and counted as set aside
    expect(
      judgeEngineListeners([sample(0, read()), atRefusal("not-shown")], "refused"),
    ).toMatchObject({ verdict: "blind", inside: 0, discarded: 1, unborne: 1 });
  });

  it("for an engine main refused: a unix read that could not be taken is BLIND, never a read set aside, whatever else was read", () => {
    const got = judgeEngineListeners(
      [sample(0, read()), atRefusal("shown"), atRefusal("unread")],
      "refused",
    );
    expect(got).toMatchObject({
      verdict: "blind",
      why: "the read of the refused engine's unix sockets could not be taken: its TCP read is not known to be of a living engine",
    });
    // and so is a TCP read at the refusal that did not answer
    expect(judgeEngineListeners([atRefusal("shown", blindRead)], "refused")).toMatchObject({
      verdict: "blind",
      why: "a read of the engine's sockets did not answer",
    });
  });

  it("for an engine that answered main and was gone: blind whatever was read, since no read of it has a control", () => {
    expect(
      judgeEngineListeners([sample(0, read()), sample(500, read())], "answered-gone"),
    ).toMatchObject({
      verdict: "blind",
      why: "the engine answered main and was gone before main read it: no read of its sockets has a control",
      // what was read inside its life is said, and the verdict stands on none of it
      inside: 0,
      unborne: 2,
    });
    expect(judgeEngineListeners([], "answered-gone").verdict).toBe("blind");
  });

  it("is red on a listener in any read, whatever the engine's class: one that straddles the exit, one set aside, one whose unix read could not be taken", () => {
    const heard = read(listen("*:9222"));
    for (const cls of ["unanswered", "refused", "answered-gone"] as const) {
      for (const one of [
        sample(500, heard),
        sample(0, heard, { exitedAfter: true }),
        atRefusal("shown", heard),
        atRefusal("not-shown", heard),
        atRefusal("unread", heard),
      ]) {
        expect(judgeEngineListeners([sample(0, read()), one], cls), cls).toMatchObject({
          verdict: "red",
          listeners: ["*:9222"],
        });
      }
    }
  });

  it("for an engine that never answered: blind when no read fell wholly inside its life, or one inside it did not answer", () => {
    expect(judgeEngineListeners([], "unanswered")).toMatchObject({ verdict: "blind", inside: 0 });
    expect(
      judgeEngineListeners(
        [
          sample(0, read(), { exitedAfter: true }),
          sample(500, read(), { exitedBefore: true, exitedAfter: true }),
        ],
        "unanswered",
      ),
    ).toMatchObject({ verdict: "blind", inside: 0, discarded: 2 });
    expect(
      judgeEngineListeners([sample(0, read()), sample(500, blindRead)], "unanswered").verdict,
    ).toBe("blind");
  });
});

describe("the UDP reads", () => {
  const at = (t: number, r: SocketRead, o: Partial<EngineSample> = {}): EngineSample => ({
    startedAt: t,
    endedAt: t + 20,
    exitedBefore: false,
    exitedAfter: false,
    read: r,
    ...o,
  });
  const peer = { name: "127.0.0.1:50000->127.0.0.1:53", state: "none" } as const;
  const bound = { name: "*:5353", state: "none" } as const;
  /** A read of the engine's TCP sockets that shows it alive: its own connection to main's bridge. */
  const alive = (t: number, o: Partial<EngineSample> = {}) => at(t, read(toBridge), o);

  it("is ok only when a TCP read begun after it shows the engine's own connection to main's bridge: lsof's silence is also a process that is gone", () => {
    const udp = [at(100, read())];
    // the UDP read ended at 120, and a TCP read begun at that very stamp is one begun after it: the
    // witness takes an engine's waited reads one at a time, so the two cannot overlap
    expect(judgeUdp(udp, [alive(120)], BRIDGE)).toEqual({ verdict: "ok" });
    // no later sight of the engine alive: a counted read before it, one that began while it ran, a
    // bare one after it, one after it that the exit fell inside, none at all, no bridge known
    const none: [EngineSample[], string | null][] = [
      [[alive(0)], BRIDGE],
      [[alive(110)], BRIDGE],
      [[at(130, read())], BRIDGE],
      [[alive(130, { exitedAfter: true })], BRIDGE],
      [[], BRIDGE],
      [[alive(130)], null],
    ];
    for (const [tcp, bridge] of none) {
      expect(judgeUdp(udp, tcp, bridge), JSON.stringify(tcp)).toEqual({
        verdict: "blind",
        why: "no read of the engine's sockets after its UDP read showed it alive",
      });
    }
    // EVERY UDP read is borne out or none is: a second one with no sight of the engine after it
    expect(judgeUdp([at(100, read()), at(300, read())], [alive(130)], BRIDGE)).toEqual({
      verdict: "blind",
      why: "no read of the engine's sockets after its UDP read showed it alive",
    });
    expect(judgeUdp([at(100, read()), at(300, read())], [alive(330)], BRIDGE)).toEqual({
      verdict: "ok",
    });
  });

  it("says a socket that has a peer; and is red on one bound with no peer in ANY read, borne out or not, whatever a later read shows", () => {
    expect(judgeUdp([at(100, read(peer))], [alive(130)], BRIDGE)).toEqual({
      verdict: "ok",
      said: [peer.name],
    });
    const got = judgeUdp([at(100, read(peer, bound))], [alive(130)], BRIDGE);
    expect(got.verdict).toBe("red");
    expect(got.why).toContain("*:5353");
    // a later clean read does not undo it, and neither does having no sight of the engine alive
    expect(judgeUdp([at(100, read(bound)), at(200, read())], [alive(230)], BRIDGE).verdict).toBe(
      "red",
    );
    expect(judgeUdp([at(100, read(bound))], [], BRIDGE).verdict).toBe("red");
    expect(judgeUdp([at(100, read(bound), { exitedAfter: true })], [], null).verdict).toBe("red");
  });

  it("is blind when none was taken, when one did not answer, or when one fell outside the engine's life", () => {
    expect(judgeUdp([], [alive(130)], BRIDGE)).toEqual({
      verdict: "blind",
      why: "the engine's UDP sockets were not read",
    });
    expect(judgeUdp([at(100, blindRead)], [alive(130)], BRIDGE)).toEqual({
      verdict: "blind",
      why: "the engine's UDP sockets could not be read",
    });
    // one read that answered and was borne out does not excuse another that did not answer, though
    // a read of the engine alive followed that one too
    expect(
      judgeUdp([at(100, read()), at(200, blindRead)], [alive(130), alive(230)], BRIDGE),
    ).toEqual({ verdict: "blind", why: "the engine's UDP sockets could not be read" });
    for (const o of [{ exitedAfter: true }, { exitedBefore: true, exitedAfter: true }]) {
      expect(judgeUdp([at(100, read(), o)], [alive(130)], BRIDGE)).toEqual({
        verdict: "blind",
        why: "the engine's UDP sockets were not read wholly inside its life",
      });
    }
  });
});

describe("main's connection, tied to the child by the kernel's own addresses", () => {
  // lsof names a unix socket by its kernel address (the DEVICE column) and a connected one's peer as
  // `->` that address. While main holds a connection to the session's socket open, THE LINE OF
  // MAIN'S THAT IS THAT CONNECTION, found by its descriptor, must name as its peer a socket the
  // CHILD holds. Another socket of main's that names one of the child's says nothing of the
  // connection the leg holds.
  const unix = (name: string, device?: string, fd?: number): SocketLine => ({
    name,
    state: "none",
    ...(device === undefined ? {} : { device }),
    ...(fd === undefined ? {} : { fd }),
  });
  const child = (r: SocketRead, o: Partial<EngineSample> = {}): EngineSample => ({
    startedAt: 0,
    endedAt: 20,
    exitedBefore: false,
    exitedAfter: false,
    read: r,
    ...o,
  });
  const PATH = "/tmp/vf-501/pg-0a1b2c3d/sock/namespaces/pages/run/0123456789abcdef.sock";
  /** the held connection's descriptor in main */
  const HELD = 31;
  // main's sockets: the held connection, which names its peer by a kernel address; another that
  // names a peer so; one bound at a path; and one that names its peer by a PATH, as an lsof may
  const mainRead = read(
    unix("->0xaaa1", "0xbbb1", 12),
    unix("->0xccc3", "0xddd4", HELD),
    unix("/x.sock", "0xeee5", 13),
    unix(`->${PATH}`, "0xfff6", 14),
  );

  it("is ok when main's held connection names as its peer a socket the child holds, whatever that socket is named, and counts every socket of main's that names one", () => {
    // the child's accepted socket may carry the listener's bound path, or main's address as its peer
    for (const accepted of [unix(PATH, "0xccc3"), unix("->0xddd4", "0xccc3")]) {
      const got = judgePeerTie(mainRead, child(read(unix(PATH, "0x1111"), accepted)), HELD);
      expect(got).toEqual({ verdict: "ok", mainPeers: 2, childSockets: 2, ties: 1 });
    }
    // a second socket of main's that names one of the child's is counted, and changes nothing
    const both = child(read(unix(PATH, "0xaaa1"), unix(PATH, "0xccc3")));
    expect(judgePeerTie(mainRead, both, HELD)).toEqual({
      verdict: "ok",
      mainPeers: 2,
      childSockets: 2,
      ties: 2,
    });
  });

  it("is blind when ANOTHER socket of main's names one of the child's and the held connection does not: the leg's own connection is the one that must be tied", () => {
    // main's socket 12 names the child's; the held connection (31) names a stranger's
    const other = child(read(unix(PATH, "0x1111"), unix(PATH, "0xaaa1")));
    expect(judgePeerTie(mainRead, other, HELD)).toEqual({
      verdict: "blind",
      why: "the peer of main's held connection is no socket of the child's: main's connection is not tied to the child",
      mainPeers: 2,
      childSockets: 2,
      ties: 1,
    });
    // no socket of main's names one of the child's at all
    const strangers = child(read(unix(PATH, "0x1111"), unix("->0xffff", "0x2222")));
    expect(judgePeerTie(mainRead, strangers, HELD)).toEqual({
      verdict: "blind",
      why: "the peer of main's held connection is no socket of the child's: main's connection is not tied to the child",
      mainPeers: 2,
      childSockets: 2,
      ties: 0,
    });
    // an address said by a line with no kernel address of its own ties nothing
    expect(judgePeerTie(mainRead, child(read(unix("->0xccc3"))), HELD).verdict).toBe("blind");
    // main naming its OWN socket as a peer ties nothing
    expect(
      judgePeerTie(read(unix("->0xbbb1", "0xbbb1", HELD)), child(read(unix(PATH, "0x1111"))), HELD)
        .verdict,
    ).toBe("blind");
  });

  it("is blind when the held connection's descriptor is not known, is in no line of main's, is in two, or is a line that names no peer by a kernel address", () => {
    const held = child(read(unix(PATH, "0xccc3")));
    expect(judgePeerTie(mainRead, held, null)).toMatchObject({
      verdict: "blind",
      why: "the descriptor of main's held connection could not be read",
      ties: 1,
    });
    expect(judgePeerTie(mainRead, held, 99)).toMatchObject({
      verdict: "blind",
      why: "main's held connection is not in the read of main's own sockets",
    });
    // a list with no descriptors at all: the tie cannot be made, though an address matches
    const bare = read(unix("->0xccc3", "0xddd4"));
    expect(judgePeerTie(bare, held, HELD)).toMatchObject({
      verdict: "blind",
      why: "main's held connection is not in the read of main's own sockets",
      ties: 1,
    });
    const twice = read(unix("->0xccc3", "0xddd4", HELD), unix("->0xccc3", "0xddd5", HELD));
    expect(judgePeerTie(twice, held, HELD)).toMatchObject({
      verdict: "blind",
      why: "main's held connection is not in the read of main's own sockets",
    });
    // the held line names its peer by the socket's PATH, or names none: no kernel address to match
    for (const name of [`->${PATH}`, PATH, ""]) {
      const byPath = read(unix("->0xccc3", "0xddd4", 12), unix(name, "0xfff6", HELD));
      expect(judgePeerTie(byPath, held, HELD), name).toMatchObject({
        verdict: "blind",
        why: "main's held connection names no peer by a kernel address",
        ties: 1,
      });
    }
  });

  it("is blind when either read did not answer, or the child's was not wholly inside its life, and says no address", () => {
    const held = child(read(unix(PATH, "0xccc3")));
    expect(judgePeerTie(blindRead, held, HELD)).toEqual({
      verdict: "blind",
      why: "main's own unix sockets could not be read",
      mainPeers: null,
      childSockets: null,
      ties: null,
    });
    expect(judgePeerTie(mainRead, child(blindRead), HELD)).toEqual({
      verdict: "blind",
      why: "the child's unix sockets could not be read",
      mainPeers: 2,
      childSockets: null,
      ties: null,
    });
    const late = judgePeerTie(
      mainRead,
      child(read(unix(PATH, "0xccc3")), { exitedAfter: true }),
      HELD,
    );
    expect(late).toMatchObject({
      verdict: "blind",
      why: "the child's unix sockets were not read wholly inside its life",
    });
    expect(JSON.stringify(late)).not.toMatch(/0x[0-9a-f]+/u);
  });
});

describe("the socket's holder, by the kernel", () => {
  const SOCKET = "/tmp/vf-501/pg-0a1b2c3d/sock/namespaces/pages/run/0123456789abcdef.sock";
  const unix = (name: string) => ({ name, state: "none" }) as const;
  const inside = (r: SocketRead, o: Partial<EngineSample> = {}): EngineSample => ({
    startedAt: 0,
    endedAt: 20,
    exitedBefore: false,
    exitedAfter: false,
    read: r,
    ...o,
  });

  it("is ok when the child holds a unix socket bound at the session's own path, and says no path", () => {
    const got = judgeSocketHeld(inside(read(unix("->0x7b2a"), unix(SOCKET))), SOCKET);
    expect(got).toEqual({ verdict: "ok" });
    // the same place as the system may name it
    expect(judgeSocketHeld(inside(read(unix(`/private${SOCKET}`))), SOCKET).verdict).toBe("ok");
  });

  it("is blind when the child holds no socket there, when the read is not inside its life, or when it did not answer", () => {
    for (const lines of [[], [unix("->0x7b2a")], [unix(`${SOCKET}.other`)], [unix("")]]) {
      const got = judgeSocketHeld(inside(read(...lines)), SOCKET);
      expect(got.verdict, JSON.stringify(lines)).toBe("blind");
      expect(got.why).not.toContain("/tmp");
    }
    expect(judgeSocketHeld(inside(read(unix(SOCKET)), { exitedAfter: true }), SOCKET).verdict).toBe(
      "blind",
    );
    expect(judgeSocketHeld(inside(blindRead), SOCKET).verdict).toBe("blind");
  });
});

describe("the stream file, polled for the engine's whole life", () => {
  const SOCK = "sock/namespaces/pages/run/0123456789abcdef.sock";
  const polls = (until: number, extra: (at: number) => string[] = () => []): FolderRead[] => {
    const out: FolderRead[] = [];
    for (let at = 0; at <= until; at += 100) {
      out.push({ at, names: [SOCK, ...extra(at)], complete: true });
    }
    return out;
  };
  const watch = (o: Partial<StreamWatch> = {}): StreamWatch => ({
    spawnedAt: 0,
    exitedAt: 3000,
    endedAt: 3000,
    reads: polls(3000),
    socket: SOCK,
    plant: null,
    answeredAt: 800,
    ...o,
  });

  it("is ok when every read is close to the last, the socket was seen before the first answer, and no stream file ever shows", () => {
    expect(judgeStreamPolls(watch())).toMatchObject({
      verdict: "ok",
      polls: 31,
      holes: 0,
      maxGapMs: 100,
      lifeMs: 3000,
      socketSeen: true,
      plantSeen: false,
    });
    expect(STREAM_POLL_MAX_GAP_MS).toBe(1000);
    // a child still living has no life to say yet
    expect(judgeStreamPolls(watch({ exitedAt: null })).lifeMs).toBeNull();
  });

  it("is red on a stream file anywhere under the root, in any one read, and names it by its place in the root", () => {
    for (const name of [
      "sock/namespaces/pages/run/0123456789abcdef.stream",
      "home/.agent-browser/x.stream",
      "sock/other.stream",
    ]) {
      const got = judgeStreamPolls(
        watch({ reads: polls(3000, (at) => (at === 1500 ? [name] : [])) }),
      );
      expect(got.verdict, name).toBe("red");
      expect(got.why).toContain(name);
    }
  });

  it("takes the leg's own plant, by its exact place alone, and says it was seen", () => {
    const plant = "sock/namespaces/pages/run/control.stream";
    expect(judgeStreamPolls(watch({ plant, reads: polls(3000, () => [plant]) }))).toMatchObject({
      verdict: "ok",
      plantSeen: true,
    });
    // the same name in another folder, or another stream file beside the plant, is not the plant
    expect(
      judgeStreamPolls(watch({ plant, reads: polls(3000, () => [plant, "home/control.stream"]) }))
        .verdict,
    ).toBe("red");
    // a plant that was asked for and never seen: the poll did not look where main looks
    expect(judgeStreamPolls(watch({ plant }))).toMatchObject({
      verdict: "blind",
      plantSeen: false,
    });
    // with no plant asked, a file of the plant's name is a stream file like any other
    expect(judgeStreamPolls(watch({ reads: polls(3000, () => [plant]) })).verdict).toBe("red");
  });

  it("is blind when the poll has a hole over a second, starts late, ends early, or never ran", () => {
    const holed = polls(3000).filter((r) => r.at < 1000 || r.at > 2100);
    expect(judgeStreamPolls(watch({ reads: holed }))).toMatchObject({
      verdict: "blind",
      maxGapMs: 1300,
    });
    expect(judgeStreamPolls(watch({ reads: polls(3000).filter((r) => r.at > 1100) })).verdict).toBe(
      "blind",
    );
    expect(judgeStreamPolls(watch({ reads: polls(1800) })).verdict).toBe("blind");
    expect(judgeStreamPolls(watch({ reads: [] })).verdict).toBe("blind");
    // a child that never exited is watched to the leg's end
    expect(judgeStreamPolls(watch({ exitedAt: null, endedAt: 3000 })).verdict).toBe("ok");
    expect(judgeStreamPolls(watch({ exitedAt: null, endedAt: 5000 })).verdict).toBe("blind");
  });

  it("counts no read taken before the spawn or after the end among its polls: what such a read shows is read, and it closes no gap", () => {
    const inside = polls(3000);
    const before: FolderRead = { at: -50, names: [], complete: true };
    const after: FolderRead = { at: 3050, names: [], complete: true };
    expect(judgeStreamPolls(watch({ reads: [before, ...inside, after] }))).toMatchObject({
      verdict: "ok",
      polls: inside.length,
      maxGapMs: 100,
    });
    // reads outside the life alone: the folders were never read while it lived
    expect(judgeStreamPolls(watch({ reads: [before, after] }))).toMatchObject({
      verdict: "blind",
      polls: 0,
      why: "the engine's folders were never read while it lived",
    });
    // a stream file one of them shows is red all the same
    const late: FolderRead = { at: 3050, names: ["home/x.stream"], complete: true };
    expect(judgeStreamPolls(watch({ reads: [...inside, late] })).verdict).toBe("red");
  });

  it("counts no read that failed or was cut short: it is a hole, never a clean poll", () => {
    // the folder could not be read from 1000 to 2100: the same hole as no read at all
    const failed = polls(3000).map((r) =>
      r.at >= 1000 && r.at <= 2100 ? { at: r.at, names: [], complete: false } : r,
    );
    expect(judgeStreamPolls(watch({ reads: failed }))).toMatchObject({
      verdict: "blind",
      polls: 19,
      holes: 12,
      maxGapMs: 1300,
    });
    // every read failed: the folders were never read
    const none = polls(3000).map((r) => ({ at: r.at, names: [], complete: false }));
    expect(judgeStreamPolls(watch({ reads: none }))).toMatchObject({
      verdict: "blind",
      polls: 0,
      holes: 31,
    });
    // one failed read among good ones is said and leaves no hole over the bound
    const one = polls(3000).map((r) => (r.at === 1500 ? { ...r, complete: false } : r));
    expect(judgeStreamPolls(watch({ reads: one }))).toMatchObject({
      verdict: "ok",
      polls: 30,
      holes: 1,
      maxGapMs: 200,
    });
    // what a cut read did show is read all the same: a stream file in it is red, the socket is seen
    const cut = polls(3000).map((r) =>
      r.at === 1500 ? { at: r.at, names: [SOCK, "home/x.stream"], complete: false } : r,
    );
    expect(judgeStreamPolls(watch({ reads: cut })).verdict).toBe("red");
  });

  it("is blind when the engine's own socket was never seen before its first answer: the folder read is not the engine's", () => {
    const never = polls(3000).map((r) => ({ ...r, names: [] as string[] }));
    expect(judgeStreamPolls(watch({ reads: never }))).toMatchObject({
      verdict: "blind",
      socketSeen: false,
    });
    const late = polls(3000).map((r) => ({ ...r, names: r.at >= 900 ? [SOCK] : [] }));
    expect(judgeStreamPolls(watch({ reads: late })).verdict).toBe("blind");
    // a read from before the spawn is of another engine's folder: it is no sight of this one's socket
    const early = [
      { at: -50, names: [SOCK], complete: true },
      ...polls(3000).map((r) => ({ ...r, names: [] as string[] })),
    ];
    expect(judgeStreamPolls(watch({ reads: early }))).toMatchObject({
      verdict: "blind",
      socketSeen: false,
    });
  });

  it("says, and does not judge, the socket of an engine that never answered main", () => {
    const never = polls(3000).map((r) => ({ ...r, names: [] as string[] }));
    const got = judgeStreamPolls(watch({ answeredAt: null, reads: never }));
    expect(got).toMatchObject({ verdict: "ok", socketSeen: false });
    expect(got.said).toHaveLength(1);
    expect(got.said?.[0]).toMatch(/never answered/u);
    // seen at any read of its life, it is simply seen
    const late = polls(3000).map((r) => ({ ...r, names: r.at >= 900 ? [SOCK] : [] }));
    expect(judgeStreamPolls(watch({ answeredAt: null, reads: late }))).toEqual(
      expect.objectContaining({ verdict: "ok", socketSeen: true }),
    );
    expect(judgeStreamPolls(watch({ answeredAt: null, reads: late })).said).toBeUndefined();
    // and nothing else of it is waived: a hole is still a hole
    const holed = never.filter((r) => r.at < 1000 || r.at > 2100);
    expect(judgeStreamPolls(watch({ answeredAt: null, reads: holed })).verdict).toBe("blind");
  });

  it("is red on a stream file even through a hole: what was read is not unread", () => {
    const holed = polls(3000, (at) => (at === 2500 ? ["sock/x.stream"] : [])).filter(
      (r) => r.at < 1000 || r.at > 2100,
    );
    expect(judgeStreamPolls(watch({ reads: holed })).verdict).toBe("red");
  });
});

describe("the engine's pid file", () => {
  it("is ok when it names the hooked child or was never seen, and blind when it names another process", () => {
    expect(judgePidFile("match").verdict).toBe("ok");
    expect(judgePidFile("none")).toMatchObject({ verdict: "ok", said: ["no pid file was seen"] });
    expect(judgePidFile("other").verdict).toBe("blind");
  });
});

describe("the foreign peer", () => {
  const dropped: PeerProbe = {
    connected: true,
    wrote: true,
    bytesRead: 0,
    closed: true,
    error: null,
    ms: 40,
  };

  it("is ok (refused) when the probe connected and was dropped with no byte, while main's same line was answered before and after", () => {
    expect(judgePeer("answered", dropped, "answered")).toEqual({
      verdict: "ok",
      said: ["refused", "the probe's line was written"],
    });
    // dropped before the line could be written is a refusal too, and is said as it was
    expect(judgePeer("answered", { ...dropped, wrote: false, error: "EPIPE" }, "answered")).toEqual(
      { verdict: "ok", said: ["refused", "the probe's line was not written"] },
    );
    for (const error of ["ECONNRESET", "EPIPE"]) {
      expect(
        judgePeer("answered", { ...dropped, closed: false, error }, "answered").verdict,
        error,
      ).toBe("ok");
    }
  });

  it("is red when the probe read any byte, whatever main's own line did", () => {
    const answered = { ...dropped, bytesRead: 37 };
    expect(judgePeer("answered", answered, "answered").verdict).toBe("red");
    expect(judgePeer("unanswered", answered, "unanswered").verdict).toBe("red");
    expect(judgePeer("refused", { ...answered, closed: false }, "answered").verdict).toBe("red");
  });

  it("is blind when a refusal cannot be told from a wrong socket, a slow engine or no probe", () => {
    expect(judgePeer("unanswered", dropped, "answered").verdict).toBe("blind");
    expect(judgePeer("answered", dropped, "unanswered").verdict).toBe("blind");
    // main's own line answered success:false: the engine is there but not answering as itself
    expect(judgePeer("refused", dropped, "answered").verdict).toBe("blind");
    expect(judgePeer("answered", dropped, "refused").verdict).toBe("blind");
    expect(
      judgePeer(
        "answered",
        { ...dropped, connected: false, closed: false, error: "ENOENT" },
        "answered",
      ).verdict,
    ).toBe("blind");
    // connected and held open with no answer for the probe's whole bound
    expect(judgePeer("answered", { ...dropped, closed: false, ms: 5000 }, "answered").verdict).toBe(
      "blind",
    );
    // an error that is no drop
    expect(
      judgePeer("answered", { ...dropped, closed: false, error: "ETIMEDOUT" }, "answered").verdict,
    ).toBe("blind");
    expect(judgePeer("answered", null, "answered").verdict).toBe("blind");
  });
});

describe("the census: one engine, the hooked child, and nothing beneath it", () => {
  const MAIN = 100;
  const CHILD = 4242;
  const rows = (...more: CensusRow[]): CensusRow[] => [
    { pid: MAIN, ppid: 1, name: "electron" },
    { pid: 101, ppid: MAIN, name: "electron-helper" },
    { pid: CHILD, ppid: MAIN, name: "agent-browser" },
    ...more,
  ];

  it("is ok when the hooked child is the run's one engine and has no process beneath it", () => {
    expect(judgeCensus(rows(), CHILD).verdict).toBe("ok");
    // the probe is main's child, not the engine's
    expect(judgeCensus(rows({ pid: 5000, ppid: MAIN, name: "electron" }), CHILD).verdict).toBe(
      "ok",
    );
  });

  it("is red on a process of the run beneath the engine, named by its command and never by a pid", () => {
    const got = judgeCensus(rows({ pid: 6000, ppid: CHILD, name: "Google Chrome" }), CHILD);
    expect(got.verdict).toBe("red");
    expect(got.why).toContain("Google Chrome");
    expect(got.why).not.toMatch(/\d{4}/u);
    expect(judgeCensus(rows({ pid: 6000, ppid: CHILD, name: "sh" }), CHILD).verdict).toBe("red");
  });

  it("is red on a second engine of the run, whatever the census shows of the hooked child", () => {
    expect(judgeCensus(rows({ pid: 7000, ppid: MAIN, name: "agent-browser" }), CHILD).verdict).toBe(
      "red",
    );
    // the hooked child is not shown and ANOTHER engine is: that engine was read, and it is not main's child
    const without = rows().filter((r) => r.pid !== CHILD);
    expect(
      judgeCensus([...without, { pid: 7000, ppid: 1, name: "agent-browser" }], CHILD),
    ).toMatchObject({ verdict: "red" });
    // the hooked child is shown under another name and an engine is beside it
    expect(
      judgeCensus(
        [
          ...without,
          { pid: CHILD, ppid: MAIN, name: "node" },
          { pid: 7000, ppid: 1, name: "agent-browser" },
        ],
        CHILD,
      ).verdict,
    ).toBe("red");
  });

  it("is blind when the census does not show the hooked child: the reads may be of the wrong process", () => {
    const without = rows().filter((r) => r.pid !== CHILD);
    expect(judgeCensus(without, CHILD).verdict).toBe("blind");
    expect(judgeCensus([], CHILD).verdict).toBe("blind");
  });

  it("is blind when the census names the hooked child otherwise than as the engine: its count of engines sees nothing", () => {
    const renamed = rows().map((r) => (r.pid === CHILD ? { ...r, name: "node" } : r));
    const got = judgeCensus(renamed, CHILD);
    expect(got.verdict).toBe("blind");
    expect(got.why).toMatch(/names/u);
    expect(enginesIn(renamed)).toBe(0);
  });
});

describe("the open's tries", () => {
  it("is ok when an open was answered inside its bounds: three tries, 120 s", () => {
    expect(PAGES_OPEN_TRIES).toBe(3);
    expect(PAGES_OPEN_WINDOW_MS).toBe(120_000);
    expect(judgeTries({ opens: 1, elapsedMs: 9000, answered: true })).toEqual({ verdict: "ok" });
    expect(judgeTries({ opens: 3, elapsedMs: 120_000, answered: true }).verdict).toBe("ok");
  });

  it("is blind when no open was answered or the tries left their bounds", () => {
    expect(judgeTries({ opens: 3, elapsedMs: 90_000, answered: false }).verdict).toBe("blind");
    expect(judgeTries({ opens: 4, elapsedMs: 9000, answered: true }).verdict).toBe("blind");
    expect(judgeTries({ opens: 1, elapsedMs: 120_001, answered: true }).verdict).toBe("blind");
  });
});

describe("the engines a census holds", () => {
  it("counts the rows named as the engine, whoever their parent is, and nothing else", () => {
    expect(enginesIn([])).toBe(0);
    expect(
      enginesIn([
        { pid: 1, ppid: 0, name: "electron" },
        { pid: 2, ppid: 1, name: "agent-browser" },
        { pid: 3, ppid: 77, name: "agent-browser" },
        { pid: 4, ppid: 1, name: "fieldd" },
        { pid: 5, ppid: 1, name: "not-agent-browser" },
      ]),
    ).toBe(2);
  });
});
