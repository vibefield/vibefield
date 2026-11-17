import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUSTODY } from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { describe, expect, it, type Mock, vi } from "vitest";
import { createShellCustody, type ShellCustody } from "../src/main/custody/custody";
import { FIELDD_NOT_STARTED } from "../src/main/custody/root";
import { FielddHandleCoordinator } from "../src/main/fieldd-handle-coordinator";
import { readCensus, readPlainCensus } from "../src/main/pair-stop";
import { type FakeKeystore, fakeDerive, fakeKeystore, OWN, vibefieldTree } from "./custody-fakes";

// OB custody, C1 — while the custody root is unavailable,
// ONLY A PERSON'S ASK reads it again. A timer reaches the gate (the updater's census watch, every minute while an
// update is staged and with no window open), and a reading is a call to the OS keystore: on a locked keychain it
// may be a prompt. So the gate reads for `person: true` alone, and every other ask is answered from the last reading.
// The pair's coordinator already knows a person's ask (item 212's `FielddEnsureOptions.person`: a window's bootstrap
// and its Retry, a switch to a person, the status item's Try Again); its `attempt()` now hands that on to the gate,
// and the gate takes it off again before the supervisor.
//
// These rows go through the pieces as main composes them: the real coordinator over the real custody's gate, the
// real ensure, the real census reads. They are GIVEN an injected keystore, an injected clock and an injected start
// (a supervisor's `ensure` that says what it was asked). `index.ts`, which binds them in production, is Electron's
// main module and cannot be loaded by a row: its lines are PINNED by the rows at the foot that read it, and the proof
// through the real root is owed to the signed build's witness (.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");

const APART = CUSTODY.ROOT_REREAD_MIN_MS;

/** A pair's handle as the coordinator needs one: a client that is ready and asks nothing of a socket. */
function handleOf(name: string): FielddHandle {
  return {
    info: { bootId: name, port: 4242 },
    client: {
      status: "ready",
      onStatusChange: () => () => undefined,
      request: vi.fn(async () => {
        throw new Error("no row here asks fieldd anything");
      }),
    },
    liveness: { kind: "responsive" },
    onLiveness: () => () => undefined,
  } as unknown as FielddHandle;
}

interface Composed {
  readonly keystore: FakeKeystore;
  readonly pace: { at: number };
  readonly custody: ShellCustody<FielddHandle>;
  /** the supervisor's own `ensure`, as `index.ts`'s `startPair` asks it */
  readonly startPair: Mock<FielddSupervisor["ensure"]>;
  readonly coordinator: FielddHandleCoordinator;
  /** main's `ensureFieldd` */
  readonly ensureFieldd: FielddSupervisor["ensure"];
}

/** What main composes for one pair: custody, the pair's start behind its gate, the pair's coordinator over that, and
 * main's ensure over the coordinator. */
function composed(level: "sealed" | "files", answers: boolean): Composed {
  const tree = vibefieldTree();
  const keystore = fakeKeystore();
  keystore.answers = answers;
  const pace = { at: 0 };
  const custody = createShellCustody<FielddHandle>({
    level: level === "sealed" ? { level, own: OWN } : { level },
    vibefieldRoot: tree.root,
    keystore: () => keystore,
    userRoots: () => tree.users,
    logRoot: tree.logRoot,
    derive: fakeDerive,
    monotonic: () => pace.at,
  });
  const up = handleOf("boot-1");
  const startPair = vi.fn<FielddSupervisor["ensure"]>(async () => up);
  const coordinator = new FielddHandleCoordinator({ upstreamEnsure: custody.gate(startPair) });
  // main's `ensureFieldd` (item 287), its pair attached: the coordinator's ensure, and no other road
  const ensureFieldd: FielddSupervisor["ensure"] = (options) => coordinator.ensure(options);
  return { keystore, pace, custody, startPair, coordinator, ensureFieldd };
}

describe("while the root is unavailable only a person's ask reads it again (C1)", () => {
  it("a window's bootstrap reads the root again through the coordinator, and the pair starts once it opens", async () => {
    const { keystore, pace, custody, startPair, coordinator } = composed("sealed", false);
    expect(keystore.asked.available).toBe(1);

    // the splash's Retry, two seconds after the reading before it
    pace.at += APART;
    await expect(coordinator.ensure({ person: true })).rejects.toThrow(FIELDD_NOT_STARTED);
    expect(keystore.asked.available).toBe(2);
    expect(startPair).not.toHaveBeenCalled();

    keystore.answers = true;
    pace.at += APART;
    const handle = await coordinator.ensure({ person: true });
    expect(handle.info.bootId).toBe("boot-1");
    expect(keystore.asked.available).toBe(3);
    expect(custody.state()).toBe("ready");
    expect(startPair).toHaveBeenCalledTimes(1);
  });

  it("an ask nobody made reads nothing: the boot's own ensure, a timer's, an audit's", async () => {
    const { keystore, pace, startPair, coordinator, ensureFieldd } = composed("sealed", false);
    const signal = new AbortController().signal;

    // a hundred of them, a minute apart, on each road main has for them
    for (let tick = 0; tick < 100; tick += 1) {
      pace.at += 60_000;
      await expect(coordinator.ensure()).rejects.toThrow(FIELDD_NOT_STARTED);
      await expect(coordinator.ensure({ signal })).rejects.toThrow(FIELDD_NOT_STARTED);
      await expect(ensureFieldd()).rejects.toThrow(FIELDD_NOT_STARTED);
    }
    expect(keystore.asked).toEqual({ available: 1, wrap: 0, unwrap: 0 });
    expect(startPair).not.toHaveBeenCalled();
  });

  it("the updater's census watch reads nothing: nobody is on its road", async () => {
    const { keystore, pace, startPair, ensureFieldd } = composed("sealed", false);
    // the apply port's census, as `updates/install.ts` reads it over `index.ts`'s `ensure: () => ensureFieldd()`
    const client = async () => (await ensureFieldd()).client;

    // every minute while an update is staged: the floor's census, and fieldd's own
    for (let tick = 0; tick < 5; tick += 1) {
      pace.at += 60_000;
      expect(await readCensus(client)).toEqual({ known: false });
      expect(await readPlainCensus(client)).toEqual({ known: false });
    }
    // the census is unknown, as it is for any pair that is not up, and nothing was read to learn it
    expect(keystore.asked).toEqual({ available: 1, wrap: 0, unwrap: 0 });
    expect(startPair).not.toHaveBeenCalled();

    // main binds that road with no word of who asked, and the timer is the census alone
    const main = source("main/index.ts");
    expect(main).toContain("ensure: () => ensureFieldd(),");
    expect(main).toContain('if (updates.state.kind === "staged") void updates.refreshCensus();');
    expect(source("main/updates/install.ts")).toContain(
      "const client = async () => (await deps.fieldd.ensure()).client;",
    );
  });

  it("an ask nobody made is refused as a person's is: one plain Error with the one constant", async () => {
    const { pace, coordinator } = composed("sealed", false);
    const refusalOf = (asked: Promise<unknown>): Promise<unknown> =>
      asked.then(
        () => undefined,
        (error: unknown) => error,
      );

    const incidental = (await refusalOf(coordinator.ensure())) as Error;
    pace.at += APART;
    const fresh = (await refusalOf(coordinator.ensure({ person: true }))) as Error;
    for (const refusal of [incidental, fresh]) {
      expect(Object.getPrototypeOf(refusal)).toBe(Error.prototype);
      expect(String(refusal)).toBe(`Error: ${FIELDD_NOT_STARTED}`);
      expect(Object.keys(refusal)).toEqual([]);
    }
  });

  it.each(["sealed", "files"] as const)(
    "`person` never reaches the supervisor: the gate takes it off (%s)",
    async (level) => {
      const { startPair, coordinator, ensureFieldd } = composed(level, true);
      const signal = new AbortController().signal;

      await coordinator.ensure({ person: true });
      await coordinator.ensure({ person: true, signal });
      // an incidental ask with a handle up is answered by the supervisor too, as it always was
      await coordinator.ensure({ signal });
      await coordinator.ensure();
      await ensureFieldd();
      // what a supervisor's ensure always took: a signal, or nothing. Strictly: a `person` that is there and
      // `undefined` is not the same as one that is absent, and it must be absent
      expect(startPair.mock.calls).toStrictEqual([
        [undefined],
        [{ signal }],
        [{ signal }],
        [undefined],
        [undefined],
      ]);
      for (const [handed] of startPair.mock.calls) {
        expect(handed !== undefined && "person" in handed).toBe(false);
      }
    },
  );
});

describe("what hands a person's ask on, and who makes one (C1)", () => {
  it("the coordinator's attempt hands on who asked, and nothing else new", () => {
    // item 212's file (RV #29), changed for custody alone
    const coordinator = source("main/fieldd-handle-coordinator.ts");
    expect(coordinator).toContain("handle = await this.upstreamEnsure(upstreamAsk(options));");
    const handsOn = coordinator.slice(
      coordinator.indexOf("function upstreamAsk("),
      coordinator.indexOf("export interface FielddHandleCoordinatorOptions"),
    );
    expect(handsOn).toContain("if (options?.person !== true) {");
    expect(handsOn).toContain(
      "return options?.signal === undefined ? undefined : { signal: options.signal };",
    );
    expect(handsOn).toContain("return { person: true };");
    expect(handsOn).toContain("return { signal: options.signal, person: true };");
    // those are its only answers: a signal as before, and `person` when a person asked
    expect(handsOn.match(/\breturn\b/gu)).toHaveLength(3);
    expect(handsOn).not.toMatch(/\.\.\./u);
  });

  it("a person's asks in main are the bootstrap, the switch and Try Again; the boot's own ensure is nobody's", () => {
    const main = source("main/index.ts");
    expect(source("main/bootstrap.ts")).toContain("const handle = await ensure({ person: true });");
    expect(main).toContain("(options) => fielddHandles!.ensure(options),");
    expect(main).toContain("await bundle.handles.ensure({ person: true });");
    expect(main).toContain("await fielddHandles?.ensure({ person: true });");
    expect(main.match(/person: true/gu)).toHaveLength(2);
    expect(main).toContain("const fielddReady = fielddHandles.ensure();");
  });

  it("the gate alone reads who asked, and it is custody's", () => {
    const custody = source("main/custody/custody.ts");
    expect(custody).toContain("admit(ask?.person === true)");
    // nothing else on the way to a supervisor reads the word or sets it
    expect(source("main/fieldd.ts")).not.toMatch(/\.person\b|\bperson\??:/u);
  });
});
