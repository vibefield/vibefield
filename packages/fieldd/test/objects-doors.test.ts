import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext, ObjectIntent } from "@vibefield/contracts";
import { METHODS, ObjectsTakeBackResult, TAILNET_SCOPES } from "@vibefield/contracts";
import { AuditActionV1, type AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService, verifyAuditSegment } from "../src/audit-service";
import { DocumentService } from "../src/doc-service";
import type { DeskObjects } from "../src/objects/desk-objects";
import {
  boardKnownIn,
  type ObjectDoorsApi,
  type ObjectDoorsAudit,
  registerObjectDoors,
} from "../src/objects/doors";
import type { ToolPlaneAudit } from "../src/tool-plane";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import { cleanupWorlds, DOC, ordinaryWindow, type Survivor, world } from "./desk-fixtures";

// OB-3a — the window's door: ten `objects.*` rows, local-only, each held to a window's own token (a scope alone is not
// the person's window), and the person's acts audited. Rows are called through a fake API, as registerObjectDoors hands
// them to the real one. OB custody (C5): a hand and a take-back answer only once whoever outlives fieldd was told the
// grants' count, and a take-back answers `taken: true` whatever the disk said, with `kept: false` beside it then.
//
// Given an injected `bornFor`, `marks` and audit: every row here builds its desk through desk-fixtures.ts, which hands
// the store and the desk their collaborators, and hands the door a fake audit. The rows show the door's and the
// store's rule given those. That production binds the real ones is proved by the rows through the real daemon,
// `packages/fieldd/test/custody-boot.test.ts`.

afterEach(cleanupWorlds);

const trails: string[] = [];
afterEach(() => {
  for (const dir of trails.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TEN = [
  "objects.intents.subscribe",
  "objects.intent.answer",
  "objects.ref",
  "objects.hand",
  "objects.undoAgent",
  "objects.takeBack",
  "objects.resolve",
  "objects.held",
  "objects.grants",
  "objects.presence.subscribe",
];

type Handler = (ctx: CallerContext, params: unknown) => unknown;
type SubHandler = (
  ctx: CallerContext,
  params: unknown,
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => { snapshot: unknown; start?: () => void; dispose(): void };

/** `real`: the audit the door is given in place of the recording fake (item 526's rows through the real writer).
 * `known`: the boards fieldd holds (item 521), the fixtures' one board unless a row gives its own. */
function doors(
  h: ReturnType<typeof world>,
  desk: DeskObjects = h.desk,
  real?: ObjectDoorsAudit,
  known: (docId: string) => boolean = (docId) => docId === DOC,
) {
  const rows = new Map<string, Handler>();
  const subs = new Map<string, SubHandler>();
  const audited: unknown[] = [];
  const record: ToolPlaneAudit["required"] = async (ctx, mutation, effect, describe) => {
    // the real writer refuses an action outside the audit's own grammar: the fake holds the door to it as well
    AuditActionV1.parse(mutation.action);
    const value = await effect();
    const described = describe?.(value);
    audited.push({
      action: mutation.action,
      target: mutation.target,
      attrs: mutation.attrs,
      principal: ctx.principal,
      outcome: described?.outcome,
      // what the act added to its line once it was done
      after: described?.attrs,
    });
    return value;
  };
  // the fake's revoke records as its required does: a refused attempt is the real writer's, in the rows below
  const fake: ObjectDoorsAudit = { required: record, revoke: record };
  const api: ObjectDoorsApi = {
    register: (method, handler) => rows.set(method, handler as Handler),
    registerSubscription: (method, handler) => subs.set(method, handler as SubHandler),
  };
  const windows = new Set(["tok-window"]);
  /** a row, called as the product API calls it: its answer, whether or not it awaits anything */
  const ask = async (method: string, ctx: CallerContext, params: unknown) => {
    const row = rows.get(method);
    if (row === undefined) throw new Error(`no row ${method}`);
    return row(ctx, params);
  };
  registerObjectDoors(api, {
    objects: desk,
    audit: real ?? fake,
    isWindowToken: (id) => windows.has(id),
    boardKnown: known,
    presenceIntervalMs: 1,
  });
  return { rows, subs, audited, windows, ask };
}

const ctxOf = (principal: CallerContext["principal"]): CallerContext => ({
  principal,
  transport: "ws-loopback",
  receivedAt: 0,
});
const WINDOW = ctxOf({ kind: "local-token", tokenId: "tok-window", scopes: ["objects.window"] });

describe("the window's door (OB-3a)", () => {
  it("is ten rows, every one `objects.window` and local, and the scope is never on the tailnet", () => {
    const rows = METHODS.filter((m) => m.method.startsWith("objects."));
    expect(rows.map((m) => m.method).sort()).toEqual([...TEN].sort());
    for (const row of rows) {
      expect(row.scope, row.method).toBe("objects.window");
      expect(row.locality, row.method).toBe("local");
    }
    expect(TAILNET_SCOPES).not.toContain("objects.window");
  });

  it("registers exactly those ten", () => {
    const h = world();
    const { rows, subs } = doors(h);
    expect([...rows.keys(), ...subs.keys()].sort()).toEqual([...TEN].sort());
  });

  it("refuses every row to anything but a window's own token, whatever scope it holds", async () => {
    const h = world();
    const { rows, subs } = doors(h);
    const strangers = [
      ctxOf({ kind: "local-token", tokenId: "tok-plugin", scopes: ["objects.window"] }),
      ctxOf({ kind: "shell-main", tokenId: "tok-window", scopes: ["objects.window"] }),
      ctxOf({ kind: "mcp-agent", sessionId: "run-a", scopes: ["objects.window"] }),
    ];
    for (const stranger of strangers) {
      for (const [method, handler] of rows)
        await expect(
          (async () => handler(stranger, { ref: "vf:obj/aaaaaaaa", run: "run-a" }))(),
          method,
        ).rejects.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
      for (const [method, handler] of subs)
        expect(() => handler(stranger, { docId: DOC }, () => undefined), method).toThrowError(
          /window's own/,
        );
    }
  });

  it("names an object, and resolves it back", async () => {
    const h = world();
    const { ask } = doors(h);
    const named = (await ask("objects.ref", WINDOW, { docId: DOC, key: "k1" })) as {
      ref: string;
    };
    expect(named.ref).toMatch(/^vf:obj\//);
    await expect(ask("objects.resolve", WINDOW, { ref: named.ref })).resolves.toEqual({
      found: true,
      docId: DOC,
      key: "k1",
    });
    await expect(ask("objects.resolve", WINDOW, { ref: "vf:obj/zzzzzzzz" })).resolves.toEqual({
      found: false,
    });
  });

  it("audits a hand and a take-back as the person's, by ref and run, and marks a refused hand denied", async () => {
    const h = world();
    const { ask, audited } = doors(h);
    const ref = h.refOf("k1");
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      handed: true,
    });
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-none" })).resolves.toMatchObject({
      handed: false,
    });
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      taken: true,
    });
    expect(audited).toEqual([
      expect.objectContaining({
        action: "objects.hand",
        target: { kind: "object", id: ref },
        attrs: { run: "run-a" },
        outcome: "succeeded",
      }),
      expect.objectContaining({ action: "objects.hand", outcome: "denied" }),
      expect.objectContaining({ action: "objects.take_back", attrs: { run: "run-a" } }),
    ]);
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
  });

  it("lists who holds what, so a forgotten grant can be found and taken back (§11)", async () => {
    const h = world();
    const { ask } = doors(h);
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    await expect(ask("objects.grants", WINDOW, {})).resolves.toEqual({
      grants: [
        expect.objectContaining({
          ref,
          docId: DOC,
          key: "k1",
          kind: "desk.note",
          holder: "run-a",
          name: "claude·a",
          how: "handed",
        }),
      ],
    });
    await expect(ask("objects.grants", WINDOW, { ref: "vf:obj/zzzzzzzz" })).resolves.toEqual({
      grants: [],
    });
    await expect(
      (async () => ask("objects.grants", WINDOW, { ref: "nope" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("refuses malformed params rather than guessing", async () => {
    const h = world();
    const { ask } = doors(h);
    await expect(
      (async () => ask("objects.hand", WINDOW, { ref: "not-a-ref", run: "run-a" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await expect(
      (async () => ask("objects.intent.answer", WINDOW, { intent: "x" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("carries a board's intents to its subscriber and takes the answer from that window alone", async () => {
    const h = world();
    const { ask, subs, windows } = doors(h);
    windows.add("tok-other");
    const sent: ObjectIntent[] = [];
    const sub = subs.get("objects.intents.subscribe")?.(WINDOW, { docId: DOC }, (intent) =>
      sent.push(intent as ObjectIntent),
    );
    expect(sub?.snapshot).toEqual({ docId: DOC });
    sub?.start?.();
    const asked = h.desk.intents.ask(DOC, { op: "list", run: "run-a", handle: "claude·a" });
    expect(sent).toHaveLength(1);
    const id = sent[0]?.intent;
    const other = ctxOf({ kind: "local-token", tokenId: "tok-other", scopes: ["objects.window"] });
    await expect(
      ask("objects.intent.answer", other, { intent: id, ok: true, value: {} }),
    ).resolves.toEqual({ taken: false });
    await expect(
      ask("objects.intent.answer", WINDOW, { intent: id, ok: true, value: { objects: [] } }),
    ).resolves.toEqual({ taken: true });
    await expect(asked).resolves.toEqual({ value: { objects: [] } });
    // the second answer is not taken
    await expect(
      ask("objects.intent.answer", WINDOW, { intent: id, ok: true, value: {} }),
    ).resolves.toEqual({ taken: false });
    sub?.dispose();
  });

  it("serves presence as whole lists", () => {
    const h = world();
    const { subs } = doors(h);
    const opened = subs.get("objects.presence.subscribe")?.(WINDOW, {}, () => undefined);
    expect(opened?.snapshot).toEqual({ objects: [] });
    opened?.dispose();
  });
});

describe("the answer waits for the count to be remembered (OB custody, C5)", () => {
  /** A survivor that answers only when the row says so. */
  function slow() {
    const waiting: (() => void)[] = [];
    const marks: Survivor = {
      noted: [],
      get: () => 0,
      note: (_name, value) =>
        new Promise((resolve) => {
          waiting.push(() => resolve(value));
        }),
    };
    const answer = () => {
      for (const tell of waiting.splice(0)) tell();
    };
    return { marks, answer };
  }

  /** Long enough for an answer that waits on nothing to have arrived. */
  const aMoment = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

  it("answers a hand only once the survivors were told: written and held first, then the answer", async () => {
    const { marks, answer } = slow();
    const h = world({ marks });
    const { ask } = doors(h);
    const ref = h.refOf("k1");
    let answered = false;
    const hand = ask("objects.hand", WINDOW, { ref, run: "run-a" }).then((value) => {
      answered = true;
      return value;
    });
    await aMoment();
    expect(h.desk.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(answered).toBe(false);
    answer();
    await expect(hand).resolves.toEqual({ handed: true });
  });

  it("answers a take-back only once the survivors were told", async () => {
    const { marks, answer } = slow();
    const h = world({ marks });
    const { ask } = doors(h);
    const ref = h.refOf("k1");
    h.desk.hand(ref, "run-a");
    answer();
    let answered = false;
    const taken = ask("objects.takeBack", WINDOW, { ref, run: "run-a" }).then((value) => {
      answered = true;
      return value;
    });
    await aMoment();
    // taken already: the agent's next call is refused whether or not anyone has answered
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(answered).toBe(false);
    answer();
    await expect(taken).resolves.toEqual({ taken: true });
  });

  it("answers within the wait when no survivor does: a floor that is not there refuses nothing", async () => {
    const { marks } = slow();
    const h = world({ marks, noteMs: 20 });
    const { ask } = doors(h);
    const ref = h.refOf("k1");
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      handed: true,
    });
  });
});

describe("a take-back the disk would not take (OB custody, C5; OB-D19 A)", () => {
  it("`objects.takeBack` answers `kept: false` then, and `taken: true` all the same", async () => {
    let failing = false;
    const h = world({
      retryMs: 60_000,
      writeFile: (path, text) => {
        if (failing) throw Object.assign(new Error("ENOSPC: no space"), { code: "ENOSPC" });
        writeFileSync(path, text, { mode: 0o600 });
      },
    });
    const { ask, audited } = doors(h);
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    await ask("objects.hand", WINDOW, { ref, run: "run-a" });
    await ask("objects.hand", WINDOW, { ref: other, run: "run-a" });
    failing = true;
    const answer = await ask("objects.takeBack", WINDOW, { ref, run: "run-a" });
    expect(answer).toEqual({ taken: true, kept: false });
    expect(ObjectsTakeBackResult.safeParse(answer).success).toBe(true);
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(audited.at(-1)).toMatchObject({
      action: "objects.take_back",
      attrs: { run: "run-a" },
      after: { holders: "run-a", kept: false },
    });
    // once the disk takes a write again, a take-back answers as it always did
    failing = false;
    await expect(ask("objects.takeBack", WINDOW, { ref: other, run: "run-a" })).resolves.toEqual({
      taken: true,
    });
  });
});

describe("a take-back's line says whom it took the object from (OB-D18 A)", () => {
  const VELA = "sp-7k2m9q4x";
  const LYRA = "sp-lyra00000";

  /** Vela and Lyra, each thinking in a run this fieldd launched, each handed one note. */
  function twoSparks() {
    const h = world();
    h.sparks.set(VELA, "Vela").set(LYRA, "Lyra");
    h.sparkRuns.set("run-1", VELA).set("run-l", LYRA);
    h.runs.set("run-1", "live").set("run-l", "live");
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    h.desk.hand(ref, "run-l");
    return { h, ref };
  }

  it("names the one holder a take-back from a run fieldd launched took it from, and the answer says no more", async () => {
    const { h, ref } = twoSparks();
    const { ask, audited } = doors(h);
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-1" })).resolves.toEqual({
      taken: true,
    });
    expect(audited.at(-1)).toMatchObject({ after: { holders: `spark:${VELA}` } });
    expect(h.desk.grants(ref).map((g) => g.holder)).toEqual([`spark:${LYRA}`]);
  });

  it("names every holder the fallback took it from, sorted, for a run fieldd did not launch; the answer's shape is the same", async () => {
    const { h, ref } = twoSparks();
    const again = h.reopen();
    again.reconcile();
    const { ask, audited } = doors(h, again);
    // run-1 came back re-attached: fieldd cannot say whose it is, and takes the object back from every spark
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-1" })).resolves.toEqual({
      taken: true,
    });
    expect(audited.at(-1)).toMatchObject({
      action: "objects.take_back",
      attrs: { run: "run-1" },
      after: { holders: `spark:${VELA},spark:${LYRA}` },
    });
    expect(again.grants(ref)).toEqual([]);
  });

  it("names nobody when there was nothing to take", async () => {
    const h = world();
    const { ask, audited } = doors(h);
    const ref = h.refOf("k1", "desk.note");
    await ask("objects.takeBack", WINDOW, { ref, run: "run-a" });
    expect(audited.at(-1)).toMatchObject({ action: "objects.take_back", after: {} });
    expect((audited.at(-1) as { after?: object }).after).not.toHaveProperty("holders");
  });
});

describe("a take-back always takes (item 526)", () => {
  /** A real audit service over a temp root, whose writer refuses every write while `fail.now` holds. */
  async function realAudit() {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doors-revoke-"));
    trails.push(dataDir);
    const fail = { now: false };
    const service = new AuditService({
      dataDir,
      bootId: "fieldd-doors-revoke",
      hooks: {
        beforeWrite: () => {
          if (fail.now) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      },
    });
    await service.start();
    return { service, fail };
  }

  it("ends the grant when its attempt record cannot be written, and answers AUDIT_UNAVAILABLE with the act applied", async () => {
    // main's revocation law: evidence failure is surfaced, but may never leave a grant live. The attempt's evidence
    // is owed, as a recovery marker, until the writer takes a line again.
    const { service, fail } = await realAudit();
    const h = world();
    const { ask } = doors(h, h.desk, service);
    const ref = h.refOf("k1", "desk.note");
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      handed: true,
    });
    expect(h.desk.grantOf(ref, "run-a")).toBeDefined();
    fail.now = true;
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-a" })).rejects.toMatchObject({
      kind: "AUDIT_UNAVAILABLE",
      details: { actionApplied: true },
    });
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(service.health()).toMatchObject({ state: "degraded", pendingRecoveryMarkers: 1 });
    fail.now = false;
    await service.close();
  });

  it("writes a take-back's attempt and outcome when the writer takes them, and answers as it always did", async () => {
    const { service } = await realAudit();
    const h = world();
    const { ask } = doors(h, h.desk, service);
    const ref = h.refOf("k1", "desk.note");
    await ask("objects.hand", WINDOW, { ref, run: "run-a" });
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      taken: true,
    });
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(service.health()).toMatchObject({ state: "healthy", pendingRecoveryMarkers: 0 });
    await service.close();
  });
});

describe("a board fieldd does not hold has no intents feed (item 521)", () => {
  /** What subscribing for `docId` throws, its feed started if it opens; undefined when nothing is refused. */
  const refusalOf = (subs: ReturnType<typeof doors>["subs"], docId: string): unknown => {
    try {
      subs
        .get("objects.intents.subscribe")?.(WINDOW, { docId }, () => undefined)
        .start?.();
      return undefined;
    } catch (refused) {
      return refused;
    }
  };

  it("refuses a board fieldd does not hold NOT_FOUND, before anything is installed", () => {
    const h = world();
    const { subs } = doors(h);
    expect(refusalOf(subs, "doc-nobody")).toMatchObject({ kind: "NOT_FOUND" });
    expect(h.desk.intents.holds("doc-nobody")).toBe(false);
    // the board it holds opens as it always did
    expect(refusalOf(subs, DOC)).toBeUndefined();
    expect(h.desk.intents.holds(DOC)).toBe(true);
  });

  it("reads a board deleted from fieldd's documents as one it does not hold, through the daemon's own wiring", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doors-boards-"));
    trails.push(dataDir);
    const docs = new DocumentService({ dataDir });
    try {
      const known = boardKnownIn(docs);
      const made = await docs.create("Q3 plan");
      expect(known(made.docId)).toBe(true);
      await docs.delete(made.docId);
      expect(known(made.docId)).toBe(false);
      expect(known("doc-nobody")).toBe(false);
      const h = world();
      const { subs } = doors(h, h.desk, undefined, known);
      expect(refusalOf(subs, made.docId)).toMatchObject({ kind: "NOT_FOUND" });
      expect(h.desk.intents.holds(made.docId)).toBe(false);
    } finally {
      docs.dispose();
    }
  });
});

describe("an undo the window was sent and never answered (item 559, LOG-45)", () => {
  const NO_ANSWER =
    "The window did not answer, so VibeField cannot tell whether this happened. Look before you try again.";

  /** Waits for `happened`, by a deadline and never by a count of turns: the real writer's sync takes what it takes. */
  async function until(happened: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!happened()) {
      if (Date.now() > deadline) throw new Error(`${what} did not happen within 10 s`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  async function trailOf(root: string): Promise<AuditRecordV1[]> {
    const kept: AuditRecordV1[] = [];
    for (const name of readdirSync(root)
      .filter((n) => n.endsWith(".jsonl"))
      .sort()) {
      const verified = await verifyAuditSegment(join(root, name));
      expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
      kept.push(...verified.records);
    }
    return kept;
  }

  it("records its effect as unknown, never denied, tells the window so, and keeps the change on offer", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doors-unknown-"));
    trails.push(dataDir);
    const service = new AuditService({ dataDir, bootId: "fieldd-doors-unknown" });
    await service.start();
    const h = world();
    const { ask } = doors(h, h.desk, service);
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = h.window((intent) => (intent.op === "undo" ? undefined : ordinaryWindow(intent)));
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    await verbs.object_act(
      { runtimeRunId: "run-a" },
      { doing: "Change", ref, tool: "write_text", input: { text: "a" } },
    );
    const first = ask("objects.undoAgent", WINDOW, { ref, run: "run-a" });
    // the inverse reaches the window, which reloads before it answers
    await until(() => win.seen.some((i) => i.op === "undo"), "the inverse reaching the window");
    h.window(ordinaryWindow);
    await expect(first).resolves.toEqual({ undone: false, reason: NO_ANSWER });
    // the change stays on offer: the window that came back can undo it
    await expect(ask("objects.undoAgent", WINDOW, { ref, run: "run-a" })).resolves.toMatchObject({
      undone: true,
    });
    expect(service.health()).toMatchObject({ state: "healthy", pendingRecoveryMarkers: 0 });
    await service.close();
    const kept = await trailOf(service.root);
    const undos = kept.filter((r) => r.action === "objects.undo_agent");
    expect(undos.map((r) => [r.phase, r.outcome])).toEqual([
      ["attempt", undefined],
      ["attempt", undefined],
      ["outcome", "succeeded"],
    ]);
    const closing = kept.filter(
      (r) => r.operationId === undos[0]?.operationId && r.action === "audit.outcome.recovery",
    );
    expect(closing).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "EFFECT_UNKNOWN",
        attrs: expect.objectContaining({
          originalAction: "objects.undo_agent",
          intendedOutcome: "unknown",
          effectResolution: "unknown",
        }),
      }),
    ]);
  });
});
