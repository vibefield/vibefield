// @vitest-environment node
// OB-3c (§5.5, CP-D13) — the window's applier, on a real engine and a real document with no device. It proves the world's
// half of the frozen-desk answer: under a held freeze a place commits, projects and answers real, with no frame stepped.
// What a real window must still prove is the desk's half (see the head of applier.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Entity } from "@vibecook/ice";
import {
  Camera,
  ChildOf,
  Editing,
  guardedTransaction,
  Position,
  Size,
  setWidgetProps,
  Viewport,
} from "@vibecook/ice";
import { NOTE_TYPE, PHOTO_TYPE } from "@vibecook/ice/desk/objects";
import type { ObjectIntent, ObjectIntentAnswer } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import * as pane from "@vibefield/plugin-browser-pane";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApplierDeps,
  createDeskApplier,
  type DeskAgentDoor,
  declaredProps,
  followDeskAgent,
} from "../src/field/desk/agent/applier";
import { madePaneRemover } from "../src/field/desk/agent/made-panes";
import { type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { type RendererLogger, setRendererLogger } from "../src/logging";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

type Ok = Extract<ObjectIntentAnswer, { ok: true }>;

const BASE = { run: "run-1", handle: "claude·2", expiresAt: Number.MAX_SAFE_INTEGER };
let serial = 0;
const intent = (rest: Record<string, unknown>): ObjectIntent => {
  serial += 1;
  return { intent: `i${serial}`, ...BASE, ...rest } as ObjectIntent;
};

function mount() {
  const ce = createFieldEngine(buildRegistry());
  ce.docs.create();
  ce.step(1);
  const desk = {
    engine: ce,
    handle: {} as never,
    generation: 1,
    mount: 0,
    theme: "light",
    docId: "doc-1",
  } as MountedDesk;
  const hands = new Set<Entity>();
  const clock = { now: 1_000 };
  const applier = createDeskApplier(desk, {
    onCanvas: () => true,
    handOn: (e) => hands.has(e),
    now: () => clock.now,
  });
  const ok = (rest: Record<string, unknown>): Ok => {
    const answer = applier.apply(intent(rest));
    if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
    return answer;
  };
  const factOf = (rest: Record<string, unknown>): string => {
    const answer = applier.apply(intent(rest));
    return answer.ok ? "answered" : answer.fact;
  };
  const place = (props: Record<string, unknown> = {}, kind = NOTE_TYPE) => {
    const answer = ok({ op: "place", kind, props });
    const key = (answer.value as { key: string }).key;
    const store = ce.docs.current()?.store;
    return { key, answer, entity: store?.resolve(key as never) as Entity };
  };
  const countOf = (kind: string): number =>
    (ok({ op: "list" }).value as { objects: { kind: string }[] }).objects.filter(
      (object) => object.kind === kind,
    ).length;
  return { ce, desk, applier, ok, factOf, place, hands, clock, countOf };
}

/** What an object lies in: the board, or a mat. */
const parentOf = (ce: ReturnType<typeof mount>["ce"], key: string): Entity | undefined => {
  const e = ce.docs.current()?.store.resolve(key as never) as Entity;
  return ce.world.getRelation(e, ChildOf);
};

afterEach(() => vi.restoreAllMocks());

describe("reading", () => {
  it("opens an object with what it says now and that nobody's hand is on it", () => {
    const { ok, place } = mount();
    const { key } = place({ text: "hello" });
    const value = ok({ op: "open", key }).value as Record<string, unknown>;
    expect(value).toMatchObject({
      kind: NOTE_TYPE,
      title: NOTE_TYPE,
      now: { text: "hello" },
      heldByUser: false,
    });
  });

  it("runs a read handler and answers its result", () => {
    const { ok, place } = mount();
    const { key } = place({ text: "hello" });
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "hello" });
  });

  it("names the objects on the board by kind, never by what they say", () => {
    const { ok, place } = mount();
    const { key } = place({ text: "private words" });
    const value = ok({ op: "list" }).value as { objects: Record<string, unknown>[] };
    const row = value.objects.find((object) => object["key"] === key);
    expect(row).toMatchObject({ kind: NOTE_TYPE, title: NOTE_TYPE });
    expect(JSON.stringify(value)).not.toContain("private words");
  });

  it("says gone for a key the board no longer holds, and no-tool for a tool this object lacks", () => {
    const { factOf, place } = mount();
    const { key } = place();
    expect(factOf({ op: "open", key: "nothing" })).toBe("gone");
    expect(factOf({ op: "read", key, tool: "shout", input: {} })).toBe("no-tool");
    expect(factOf({ op: "read", key, tool: "write_text", input: {} })).toBe("no-tool");
  });

  it("lets a read through while the person holds the object", () => {
    const { factOf, place, hands } = mount();
    const { key, entity } = place();
    hands.add(entity);
    expect(factOf({ op: "read", key, tool: "read_text", input: {} })).toBe("answered");
  });
});

describe("acting", () => {
  const WRITE = { op: "act", tool: "write_text", doing: "writing the plan" };

  it("is one change: the words land, its inverse carries what was there, and ⌘Z skips it", () => {
    const { ce, ok, place } = mount();
    const placed = place({ text: "old" });
    const session = ce.docs.current();
    if (session === undefined) throw new Error("no document");
    // the person's own change first, then the agent's
    setWidgetProps(session.store, ce.world, placed.entity, { pen: "felt" });
    const answer = ok({ ...WRITE, key: placed.key, input: { text: "new" } });
    expect(answer.value).toEqual({ chars: 3 });
    expect(answer.changed).toBe("Rewrote the note");
    expect(answer.inverse).toEqual({
      op: "props",
      // only what changed: a note whose seeds were already empty keeps them out of its undo
      after: { text: "new" },
      before: { text: "old" },
    });
    const text = () => ok({ op: "read", key: placed.key, tool: "read_text", input: {} }).value;
    expect(text()).toEqual({ text: "new" });
    expect(ce.docs.undo()).toBe(true); // the person's pen, not the agent's words
    ce.world.sync();
    expect(text()).toEqual({ text: "new" });
    expect(ok({ op: "open", key: placed.key }).value).toBeDefined();
  });

  it("uses the agent's own words for the change when the kind gives none", () => {
    const { desk, place } = mount();
    const { key } = place();
    const applier = createDeskApplier(desk, {
      halves: () => ({
        summary: () => null,
        act: {
          write_text: (api) => {
            api.setProps({ text: "x" });
            return undefined;
          },
        },
      }),
    });
    const answer = applier.apply(intent({ ...WRITE, key, doing: "drafting the plan", input: {} }));
    expect(answer).toMatchObject({ ok: true, changed: "drafting the plan" });
  });

  it("refuses held while the person's hand is on it, and changes nothing", () => {
    const { ok, factOf, place, hands } = mount();
    const { key, entity } = place({ text: "mine" });
    hands.add(entity);
    expect(factOf({ ...WRITE, key, input: { text: "theirs" } })).toBe("held");
    hands.clear();
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "mine" });
  });

  it("answers held on the real claim: an open editor on the note", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    ce.step(1);
    const desk = {
      engine: ce,
      handle: {} as never,
      generation: 1,
      mount: 0,
      theme: "light",
      docId: "d",
    } as MountedDesk;
    const applier = createDeskApplier(desk, { onCanvas: () => true });
    const placed = applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {} })) as Ok;
    const key = (placed.value as { key: string }).key;
    const e = ce.docs.current()?.store.resolve(key as never) as Entity;
    ce.world.addTag(e, Editing);
    const answer = applier.apply(intent({ ...WRITE, key, input: { text: "x" } }));
    expect(answer.ok ? "answered" : answer.fact).toBe("held");
  });

  it("writes nothing when a handler throws, and says what it said", () => {
    const { ce, place } = mount();
    const { key } = place({ text: "kept" });
    const desk = {
      engine: ce,
      handle: {} as never,
      generation: 1,
      mount: 0,
      theme: "light",
      docId: "d",
    } as MountedDesk;
    const applier = createDeskApplier(desk, {
      halves: () => ({
        summary: () => null,
        act: {
          write_text: (api) => {
            api.setProps({ text: "lost" });
            throw new Error("not today");
          },
        },
      }),
    });
    const answer = applier.apply(intent({ ...WRITE, key, input: { text: "x" } }));
    expect(answer).toMatchObject({ ok: false, fact: "failed", text: "not today" });
    const reader = createDeskApplier(desk);
    expect(
      (reader.apply(intent({ op: "read", key, tool: "read_text", input: {} })) as Ok).value,
    ).toEqual({
      text: "kept",
    });
  });

  it("answers an act that changes nothing with no inverse and no change to name", () => {
    const { ok, place } = mount();
    const { key } = place({ text: "same" });
    const answer = ok({ ...WRITE, key, input: { text: "same" } });
    expect(answer.inverse).toBeUndefined();
    expect(answer.changed).toBeUndefined();
  });
});

describe("undoing an agent's change", () => {
  it("applies the inverse only while the object still holds what the act set", () => {
    const { ok, factOf, place } = mount();
    const { key } = place({ text: "old" });
    const first = ok({ op: "act", tool: "write_text", doing: "x", key, input: { text: "new" } });
    expect(ok({ op: "undo", key, inverse: first.inverse }).value).toEqual({});
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "old" });

    const second = ok({ op: "act", tool: "write_text", doing: "x", key, input: { text: "two" } });
    ok({ op: "act", tool: "write_text", doing: "x", key, input: { text: "three" } });
    expect(factOf({ op: "undo", key, inverse: second.inverse })).toBe("conflict");
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "three" });
  });

  it("takes away a place, unless the object has changed since", () => {
    const { ce, ok, factOf, place } = mount();
    const kept = place({ text: "a" });
    expect(ok({ op: "undo", key: kept.key, inverse: kept.answer.inverse }).value).toEqual({});
    expect(factOf({ op: "open", key: kept.key })).toBe("gone");

    const changed = place({ text: "b" });
    const session = ce.docs.current();
    if (session === undefined) throw new Error("no document");
    setWidgetProps(session.store, ce.world, changed.entity, { text: "the person's now" });
    expect(factOf({ op: "undo", key: changed.key, inverse: changed.answer.inverse })).toBe(
      "conflict",
    );
  });

  it("brings a removed object back under a new key, as fieldd then remaps", () => {
    const { ok, factOf, place } = mount();
    const { key } = place({ text: "back" });
    const removed = ok({ op: "remove", key });
    expect(removed.value).toEqual({ removed: true });
    expect(factOf({ op: "open", key })).toBe("gone");
    const restored = ok({ op: "undo", key, inverse: removed.inverse }).value as { key: string };
    expect(restored.key).not.toBe(key);
    expect(ok({ op: "read", key: restored.key, tool: "read_text", input: {} }).value).toEqual({
      text: "back",
    });
  });

  describe("a removed object goes back where it lay", () => {
    function noteInMat() {
      const world = mount();
      const mat = world.place({}, "desk.minimat");
      const note = world.ce.ops.spawnWidget(NOTE_TYPE, {
        x: 0,
        y: 0,
        parent: mat.entity,
        props: { text: "inside" },
      });
      world.ce.world.sync();
      const key = world.ce.docs.current()?.store.keyOf(note) as unknown as string;
      return { ...world, mat, key };
    }

    it("into the mat it was taken from", () => {
      const { ce, ok, mat, key } = noteInMat();
      const removed = ok({ op: "remove", key });
      const restored = ok({ op: "undo", key, inverse: removed.inverse }).value as { key: string };
      expect(parentOf(ce, restored.key)).toBe(mat.entity);
      expect(ok({ op: "read", key: restored.key, tool: "read_text", input: {} }).value).toEqual({
        text: "inside",
      });
    });

    it("onto the board, while the person is inside a mat", () => {
      const { ce, ok, place } = mount();
      const mat = place({}, "desk.minimat");
      const { key } = place({ text: "on the board" });
      const board = parentOf(ce, key);
      expect(board).toBeDefined();
      const removed = ok({ op: "remove", key });
      ce.step(20); // the mat becomes a container at a frame
      ce.nav.enterContainer(mat.entity, { transition: "none" });
      ce.step(36);
      expect(ce.nav.depth()).toBe(1);
      const restored = ok({ op: "undo", key, inverse: removed.inverse }).value as { key: string };
      expect(parentOf(ce, restored.key)).toBe(board);
    });

    it("or not at all when that mat has gone", () => {
      const { ok, factOf, mat, key, countOf } = noteInMat();
      const removed = ok({ op: "remove", key });
      ok({ op: "remove", key: mat.key });
      expect(factOf({ op: "undo", key, inverse: removed.inverse })).toBe("conflict");
      expect(countOf(NOTE_TYPE)).toBe(0);
    });
  });

  it("treats an inverse it cannot read as a conflict", () => {
    const { factOf, place } = mount();
    const { key } = place();
    expect(factOf({ op: "undo", key, inverse: { op: "nonsense" } })).toBe("conflict");
  });
});

describe("an intent past its deadline", () => {
  it("applies nothing and says so, because fieldd has stopped waiting and could offer no undo", () => {
    const { applier, countOf } = mount();
    const answer = applier.apply(
      intent({ op: "place", kind: NOTE_TYPE, props: {}, expiresAt: 1_000 }),
    );
    expect(answer).toMatchObject({ ok: false, fact: "failed" });
    expect(countOf(NOTE_TYPE)).toBe(0);
  });

  it("applies one still inside its deadline, and one that names none", () => {
    const { applier, countOf } = mount();
    expect(
      applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {}, expiresAt: 1_001 })).ok,
    ).toBe(true);
    expect(
      applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {}, expiresAt: undefined })).ok,
    ).toBe(true);
    expect(countOf(NOTE_TYPE)).toBe(2);
  });
});

describe("a title on a place", () => {
  it("names a kind that has a name of its own, and the answer says it", () => {
    const { ok } = mount();
    const answer = ok({ op: "place", kind: "desk.minimat", title: "Q3 plan", props: {} });
    expect(answer.value).toMatchObject({ title: "Q3 plan", now: { name: "Q3 plan" } });
  });

  it("is refused in words for a kind with nowhere to keep one, and nothing is placed", () => {
    const { applier, countOf } = mount();
    const answer = applier.apply(
      intent({ op: "place", kind: NOTE_TYPE, title: "Q3 plan", props: {} }),
    );
    expect(answer).toMatchObject({ ok: false, fact: "bad-input" });
    expect(answer.ok ? "" : answer.text).toContain("has no title");
    expect(countOf(NOTE_TYPE)).toBe(0);
  });

  it("is refused when the props name it otherwise, and takes the props that agree", () => {
    const { factOf } = mount();
    expect(
      factOf({ op: "place", kind: "desk.minimat", title: "One", props: { name: "Two" } }),
    ).toBe("bad-input");
    expect(
      factOf({ op: "place", kind: "desk.minimat", title: "One", props: { name: "One" } }),
    ).toBe("answered");
  });
});

describe("placing", () => {
  describe("on the board, wherever the person is looking", () => {
    /** A view so wide that anything near the origin lies in it: only being in another frame can keep an object off screen. */
    const wideView = (ce: ReturnType<typeof mount>["ce"]) => {
      ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
      ce.world.setResource(Camera, { x: -60_000, y: -40_000, zoom: 0.01, gesturing: false });
    };

    it("goes on the board and beside the mat, never into the mat the person is inside", () => {
      const { ce, ok, place } = mount();
      const mat = place({}, "desk.minimat");
      const board = parentOf(ce, place({ text: "already here" }).key);
      ce.step(20); // the mat becomes a container at a frame
      ce.nav.enterContainer(mat.entity, { transition: "none" });
      ce.step(36);
      wideView(ce);
      const value = ok({ op: "place", kind: NOTE_TYPE, props: {} }).value as {
        key: string;
        onScreen: boolean;
      };
      expect(parentOf(ce, value.key)).toBe(board);
      expect(value.onScreen).toBe(false);
      const e = ce.docs.current()?.store.resolve(value.key as never) as Entity;
      const matAt = ce.world.get(mat.entity, Position);
      const matSize = ce.world.get(mat.entity, Size);
      expect(ce.world.get(e, Position)?.x).toBeGreaterThanOrEqual(
        (matAt?.x ?? 0) + (matSize?.w ?? 0),
      );
    });

    it("says it is on screen when it lands in view on the board", () => {
      const { ce, ok } = mount();
      wideView(ce);
      const value = ok({ op: "place", kind: NOTE_TYPE, props: {} }).value as { onScreen: boolean };
      expect(value.onScreen).toBe(true);
    });
  });

  it("refuses a print an agent has no picture for, in words", () => {
    const { factOf } = mount();
    expect(factOf({ op: "place", kind: PHOTO_TYPE, props: {} })).toBe("needs-you");
  });

  it("says bad-input for an unknown kind or props the kind refuses", () => {
    const { factOf } = mount();
    expect(factOf({ op: "place", kind: "no.such.kind" })).toBe("bad-input");
    expect(factOf({ op: "place", kind: NOTE_TYPE, props: { nonsense: 1 } })).toBe("bad-input");
  });

  it("will not take away a mat that holds things the person put there", () => {
    const { ce, factOf, place } = mount();
    const mat = place({}, "desk.minimat");
    const note = place();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("no document");
    guardedTransaction(session.store, ce.world, (tx) => {
      tx.setRelation(note.entity, ChildOf, mat.entity);
    });
    ce.world.sync();
    expect(factOf({ op: "remove", key: mat.key })).toBe("needs-you");
    expect(factOf({ op: "open", key: mat.key })).toBe("answered");
  });

  it("does not touch a read-only board, in words", () => {
    const { desk, factOf, place } = mount();
    const { key } = place();
    Object.defineProperty(desk.engine.docs.current(), "readOnly", { value: true });
    expect(factOf({ op: "act", tool: "write_text", doing: "x", key, input: { text: "y" } })).toBe(
      "needs-you",
    );
    expect(factOf({ op: "place", kind: NOTE_TYPE, props: {} })).toBe("needs-you");
  });
});

describe("under a cover: the desk frozen, no frame stepped", () => {
  it("a place is real at once: its key, its summary, then a read, an act, a remove, all with the loop parked", () => {
    const { ce, ok, factOf } = mount();
    const thaw = ce.frame.freeze("cover");
    const placed = ok({ op: "place", kind: NOTE_TYPE, props: { text: "from the agent" } });
    const value = placed.value as { key: string; now: unknown };
    expect(value.key).toBeTruthy();
    expect(value.now).toEqual({ text: "from the agent" });
    const key = value.key;
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({
      text: "from the agent",
    });
    ok({ op: "act", tool: "write_text", doing: "x", key, input: { text: "again" } });
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "again" });
    expect(factOf({ op: "open", key })).toBe("answered");
    thaw();
    ce.step(50);
    ce.step(66);
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "again" });
  });

  it("answers onScreen false while another view stands, so the agent is never told the person saw it", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    ce.step(1);
    const desk = {
      engine: ce,
      handle: {} as never,
      generation: 1,
      mount: 0,
      theme: "light",
      docId: "d",
    } as MountedDesk;
    const applier = createDeskApplier(desk, { onCanvas: () => false });
    const thaw = ce.frame.freeze("cover");
    const answer = applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {} })) as Ok;
    expect((answer.value as { onScreen: boolean }).onScreen).toBe(false);
    thaw();
  });

  it("a place under a cover then survives the thaw as one object, not two", () => {
    const { ce, ok } = mount();
    const thaw = ce.frame.freeze("cover");
    ok({ op: "place", kind: NOTE_TYPE, props: { text: "once" } });
    thaw();
    for (let i = 0; i < 4; i += 1) ce.step(100 + i * 16);
    const list = ok({ op: "list" }).value as { objects: { kind: string }[] };
    expect(list.objects.filter((object) => object.kind === NOTE_TYPE)).toHaveLength(1);
  });
});

describe("following the desk: the door", () => {
  function door() {
    const intents: ((payload: unknown) => void)[] = [];
    const answers: ObjectIntentAnswer[] = [];
    const held: unknown[] = [];
    let presence: ((payload: unknown) => void) | null = null;
    const offs = { intents: 0 };
    const value: DeskAgentDoor = {
      intents: async (docId, onIntent) => {
        expect(docId).toBe("doc-1");
        intents.push(onIntent);
        return () => {
          offs.intents += 1;
        };
      },
      answer: async (answer) => {
        answers.push(answer);
        return { taken: true };
      },
      presence: async (onSnapshot) => {
        presence = onSnapshot;
        return () => undefined;
      },
      held: async (params) => {
        held.push(params);
        return {};
      },
    };
    return {
      value,
      send: (payload: unknown) => intents.at(-1)?.(payload),
      answers,
      held,
      offs,
      presence: (payload: unknown) => presence?.(payload),
      subscribes: () => intents.length,
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("subscribes for the mounted board, answers each intent, and passes over one it cannot read", async () => {
    const { desk, ce } = mount();
    const unpublish = publishDesk(desk);
    const wire = door();
    const stop = followDeskAgent(wire.value, { onCanvas: () => true });
    await settle();
    wire.send({ op: "nonsense" });
    expect(wire.answers).toEqual([]);
    wire.send(intent({ op: "place", kind: NOTE_TYPE, props: {} }));
    await settle();
    expect(wire.answers[0]).toMatchObject({ ok: true });
    expect(ce.docs.current()).toBeDefined();
    stop();
    expect(wire.offs.intents).toBe(1);
    unpublish();
  });

  it("follows a new mount and lets go of the old one", async () => {
    const { desk } = mount();
    const unpublish = publishDesk(desk);
    const wire = door();
    const stop = followDeskAgent(wire.value, {});
    await settle();
    expect(wire.subscribes()).toBe(1);
    const next = { ...desk, mount: 1 } as MountedDesk;
    const unpublishNext = publishDesk(next);
    await settle();
    expect(wire.subscribes()).toBe(2);
    expect(wire.offs.intents).toBe(1);
    stop();
    unpublishNext();
    unpublish();
  });

  it("reports the person's hand onto an object a run has open, on and off, once each", async () => {
    const { desk, ce, place } = mount();
    const { key, entity } = place();
    const unpublish = publishDesk(desk);
    const wire = door();
    const hands = new Set<Entity>();
    const stop = followDeskAgent(wire.value, { handOn: (e) => hands.has(e) });
    await settle();
    wire.presence({
      objects: [
        {
          ref: "vf:obj/abcd1234",
          docId: "doc-1",
          key,
          agents: [{ run: "r", handle: "h", agent: "a", state: "open", since: 1 }],
        },
      ],
    });
    ce.step(20);
    expect(wire.held).toEqual([]);
    hands.add(entity);
    ce.step(40);
    ce.step(56);
    expect(wire.held).toEqual([{ docId: "doc-1", key, held: true }]);
    hands.clear();
    ce.step(72);
    expect(wire.held).toEqual([
      { docId: "doc-1", key, held: true },
      { docId: "doc-1", key, held: false },
    ]);
    stop();
    unpublish();
  });

  it("reads the feed as fieldd's fixture carries it, a run's ids and all (item 550): the hand is reported on its object", async () => {
    const { desk, ce, place } = mount();
    const { key, entity } = place();
    const unpublish = publishDesk(desk);
    const wire = door();
    const stop = followDeskAgent(wire.value, { handOn: (e) => e === entity });
    await settle();
    const fixture = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../contracts/fixtures/objects-presence.valid.json",
        ),
        "utf8",
      ),
    ) as { objects: Record<string, unknown>[] };
    wire.presence({
      objects: fixture.objects.map((object) => ({ ...object, docId: "doc-1", key })),
    });
    ce.step(20);
    ce.step(36);
    ce.step(52);
    expect(wire.held).toEqual([{ docId: "doc-1", key, held: true }]);
    stop();
    unpublish();
  });

  it("does not watch the hand when no run has an object open", async () => {
    const { desk, ce } = mount();
    const unpublish = publishDesk(desk);
    const wire = door();
    const hands = { calls: 0 };
    const stop = followDeskAgent(wire.value, {
      handOn: () => {
        hands.calls += 1;
        return false;
      },
    });
    await settle();
    ce.step(20);
    ce.step(36);
    expect(hands.calls).toBe(0);
    stop();
    unpublish();
  });
});

describe("the door asks again while its desk is mounted (item 521)", () => {
  const QUIET: RendererLogger = {
    child: () => QUIET,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    isLevelEnabled: () => false,
  };
  // each row's follower and desk end here, so a row that fails cannot leave one following the next row's desk
  const ends: (() => void)[] = [];
  afterEach(() => {
    for (const end of ends.splice(0)) end();
    vi.useRealTimers();
    setRendererLogger(QUIET);
  });
  /** The board mounted and followed through `wire`, both ended after the row. */
  function follow(wire: { readonly value: DeskAgentDoor }, deps: ApplierDeps = {}) {
    const { desk } = mount();
    const unpublish = publishDesk(desk);
    const stop = followDeskAgent(wire.value, deps);
    ends.push(stop, unpublish);
    return stop;
  }
  /** What the desk's agent door warns, by event and attrs. */
  function capture() {
    const warned: Array<{ event: string; attrs: unknown }> = [];
    const logger: RendererLogger = {
      ...QUIET,
      child: () => logger,
      warn: (event, _message, attrs) => {
        warned.push({ event, attrs });
      },
    };
    setRendererLogger(logger);
    return warned;
  }
  /** A door whose feeds refuse their first asks with `refusals`, in order, and then open. */
  function refusing(refusals: { intents?: unknown[]; presence?: unknown[] }) {
    const asked = { intents: 0, presence: 0 };
    const intents: ((payload: unknown) => void)[] = [];
    const ended: {
      intents?: ((error: unknown) => void) | undefined;
      presence?: ((error: unknown) => void) | undefined;
    } = {};
    const answers: ObjectIntentAnswer[] = [];
    const value: DeskAgentDoor = {
      intents: async (docId, onIntent, onEnded) => {
        expect(docId).toBe("doc-1");
        asked.intents += 1;
        const refusal = refusals.intents?.shift();
        if (refusal !== undefined) throw refusal;
        intents.push(onIntent);
        ended.intents = onEnded;
        return () => undefined;
      },
      answer: async (answer) => {
        answers.push(answer);
        return { taken: true };
      },
      presence: async (_onSnapshot, onEnded) => {
        asked.presence += 1;
        const refusal = refusals.presence?.shift();
        if (refusal !== undefined) throw refusal;
        ended.presence = onEnded;
        return () => undefined;
      },
      held: async () => ({}),
    };
    return { value, asked, answers, ended, send: (payload: unknown) => intents.at(-1)?.(payload) };
  }
  const closedUnder = () => new FielddRpcError("UNAVAILABLE", "connection closed", true);
  const forRoom = () =>
    new FielddRpcError("RESOURCE_EXHAUSTED", "too many subscriptions", false, {
      resource: "subscriptions",
      limit: 4,
    });
  const forGood = () => new FielddRpcError("NOT_FOUND", "no such board: doc-1", false);
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it("asks the intents feed again when the socket closed under its first ask, and intents then flow", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wire = refusing({ intents: [closedUnder()] });
    follow(wire, { onCanvas: () => true });
    await tick(0);
    expect(wire.asked.intents).toBe(1);
    await tick(999);
    expect(wire.asked.intents).toBe(1);
    await tick(1);
    expect(wire.asked.intents).toBe(2);
    wire.send(intent({ op: "place", kind: NOTE_TYPE, props: {} }));
    await tick(0);
    expect(wire.answers[0]).toMatchObject({ ok: true });
  });

  it("asks again on the re-ask steps when refused for room: after 1 s, then 2 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wire = refusing({ intents: [forRoom(), forRoom()] });
    follow(wire, {});
    await tick(1_000);
    expect(wire.asked.intents).toBe(2);
    await tick(1_999);
    expect(wire.asked.intents).toBe(2);
    await tick(1);
    expect(wire.asked.intents).toBe(3);
  });

  it("never asks again a refusal for good, and says its kind in the log, not fieldd's words", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const warned = capture();
    const wire = refusing({ intents: [forGood()] });
    follow(wire, {});
    await tick(60_000);
    expect(wire.asked.intents).toBe(1);
    expect(warned).toEqual([
      { event: "renderer.desk.agent_door_refused", attrs: { kind: "NOT_FOUND", again: false } },
    ]);
    expect(JSON.stringify(warned)).not.toContain("no such board");
  });

  it("asks nothing once its desk has gone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wire = refusing({ intents: [closedUnder()], presence: [closedUnder()] });
    const stop = follow(wire, {});
    await tick(0);
    stop();
    await tick(60_000);
    expect(wire.asked).toEqual({ intents: 1, presence: 1 });
  });

  it("asks the presence feed again the same way, so the hand is reported again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wire = refusing({ presence: [closedUnder()] });
    follow(wire, {});
    await tick(1_000);
    expect(wire.asked.presence).toBe(2);
  });

  it("says in the log, by its kind, a feed the client ended for good, and asks it nothing more", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const warned = capture();
    const wire = refusing({});
    follow(wire, {});
    await tick(0);
    wire.ended.intents?.(forGood());
    wire.ended.presence?.(forGood());
    await tick(60_000);
    expect(warned).toEqual([
      { event: "renderer.desk.agent_door_ended", attrs: { kind: "NOT_FOUND" } },
      { event: "renderer.desk.agent_presence_ended", attrs: { kind: "NOT_FOUND" } },
    ]);
    expect(wire.asked).toEqual({ intents: 1, presence: 1 });
  });
});

// EY-1 (1f, 2026-11-19) — A PAGE AN AGENT'S RUN MADE, placed by fieldd's pages room (`made`): only where the desk
// has room for one more agent's page without resting one of the person's (item 581, the live service's `agentRoom`).
// No room: nothing is placed, and main lets the page go at once. Placed: the pane's first mint adopts it. And the ONE
// path a run's pane leaves the desk by (made-panes.ts).
describe("EY-1 (1f): a page an agent's run made", () => {
  const MADE = "surface_fedcba9876543210";
  /** The desk with a live service under the test's hand: its room, and what it was told. */
  function live(room: number) {
    const told = { adopted: [] as [string, string][], declined: [] as string[] };
    const service = {
      agentRoom: () => room,
      adoptMade: (key: string, made: string) => told.adopted.push([key, made]),
      declineMade: (made: string) => told.declined.push(made),
    };
    const m = mount();
    const desk = { ...m.desk, live: service as never } as MountedDesk;
    const applier = createDeskApplier(desk, { onCanvas: () => true, handOn: () => false });
    return { ...m, applier, told };
  }

  it("places the pane where the desk has room, and its first mint adopts the made page", () => {
    const { applier, told, countOf } = live(1);
    const answer = applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {}, made: MADE }));
    if (!answer.ok) throw new Error(`refused: ${answer.fact}`);
    const key = (answer.value as { key: string }).key;
    expect(told.adopted).toEqual([[key, MADE]]);
    expect(told.declined).toEqual([]);
    expect(countOf(NOTE_TYPE)).toBe(1);
  });

  it("places nothing on a desk with no room: desk-full, in the room's words, and main lets the page go", () => {
    const { applier, told, countOf } = live(0);
    const answer = applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {}, made: MADE }));
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.fact).toBe("desk-full");
    expect(answer.text).toBe(
      "The desk has no room for another live page right now. Close a page you no longer need, or carry on in this one.",
    );
    expect(told.declined).toEqual([MADE]);
    expect(told.adopted).toEqual([]);
    expect(countOf(NOTE_TYPE)).toBe(0);
  });

  it("lets the made page go when its pane is refused, and places none in a window with no live pages", () => {
    const { applier, told, countOf } = live(3);
    const refused = applier.apply(
      intent({ op: "place", kind: NOTE_TYPE, props: { nonsense: 1 }, made: MADE }),
    );
    expect(refused.ok ? "answered" : refused.fact).toBe("bad-input");
    expect(told.declined).toEqual([MADE]);
    expect(countOf(NOTE_TYPE)).toBe(0);
    const { factOf } = mount();
    expect(factOf({ op: "place", kind: NOTE_TYPE, props: {}, made: MADE })).toBe("failed");
  });

  it("asks nothing of the live service for a place with no made page", () => {
    const { applier, told } = live(0);
    expect(applier.apply(intent({ op: "place", kind: NOTE_TYPE, props: {} })).ok).toBe(true);
    expect(told).toEqual({ adopted: [], declined: [] });
  });

  it("takes a run's pane off the document by the one path: not undone by the person's undo; nothing on a read-only board", () => {
    const { ce, place, countOf } = mount();
    const removeMadePane = madePaneRemover(ce);
    const pane = place();
    expect(removeMadePane(pane.entity, "never-reached")).toBe(true);
    expect(countOf(NOTE_TYPE)).toBe(0);
    ce.docs.undo();
    ce.world.sync();
    expect(countOf(NOTE_TYPE)).toBe(0);
    // gone already: nothing
    expect(removeMadePane(pane.entity, "run-ended")).toBe(false);
    const other = place();
    Object.defineProperty(ce.docs.current(), "readOnly", { value: true });
    expect(removeMadePane(other.entity, "run-ended")).toBe(false);
  });
});

// EY-1 (1f, 2026-11-24) — THE BROWSER PANE ITSELF, as the pages room places it: `made`, its run (`agentRun`) and the
// address the room asked the page to open (`url`, an http(s) one or about:blank). And the window's own defence: a kind
// whose tools are a room's is placed by its room, with the page main made for the run. With no `made` it is refused, so
// no door can put a pane on the desk that would open in the person's own signed-in profile.
describe("EY-1 (1f): the browser pane a run's pages room places", () => {
  const MADE = "surface_0123456789abcdef";
  const RUN = "run_7a9c";
  function paneBoard(room = 1, o: { readonly leaveMade?: boolean } = {}) {
    const ce = createFieldEngine(
      buildRegistry({
        generation: -1,
        staged: [],
        bundled: [
          {
            manifest: pane.browserPaneManifest,
            mod: pane.browserPaneRenderer,
            objectBindings: objectBindingsFrom(
              pane,
              pane.browserPaneManifest.contributes?.objects ?? [],
            ),
          },
        ],
      }),
    );
    ce.docs.create();
    ce.step(1);
    const told = { adopted: [] as [string, string][], declined: [] as string[] };
    const left: string[] = [];
    const service = {
      agentRoom: () => room,
      adoptMade: (key: string, made: string) => told.adopted.push([key, made]),
      declineMade: (made: string) => told.declined.push(made),
      // a mount with the host's one leaving path (desk-live's leaveMade): the pane is handed to it
      ...(o.leaveMade === true
        ? {
            leaveMade: (key: string) => {
              left.push(key);
              return true;
            },
          }
        : {}),
    };
    const desk = {
      engine: ce,
      handle: {} as never,
      generation: 1,
      mount: 0,
      theme: "light",
      docId: "doc-1",
      live: service as never,
    } as MountedDesk;
    const applier = createDeskApplier(desk, { onCanvas: () => true, handOn: () => false });
    const panes = (): number => {
      const answer = applier.apply(intent({ op: "list" }));
      if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
      return (answer.value as { objects: { kind: string }[] }).objects.filter(
        (object) => object.kind === pane.BROWSER_PANE_TYPE,
      ).length;
    };
    const propsOf = (key: string): Record<string, unknown> =>
      declaredProps(ce, ce.docs.current()?.store.resolve(key as never) as Entity);
    return { ce, applier, told, panes, propsOf, left };
  }

  // A run's own close (2026-11-24): the pages room removes a run's pane when its run closes the page (browser_close).
  // Destroyed at once, the pane cut its at-work mark's leaving short; it is handed to the host's one leaving path,
  // which waits out the mark and never takes the pane from under the hand.
  it("a run's own close of its pane hands the pane to the host's leaving, which waits out its mark: removed, with its inverse", () => {
    const { applier, panes, left } = paneBoard(1, { leaveMade: true });
    const placed = applier.apply(
      intent({ op: "place", kind: pane.BROWSER_PANE_TYPE, props: { agentRun: RUN }, made: MADE }),
    );
    if (!placed.ok) throw new Error(`refused: ${placed.fact}: ${placed.text}`);
    const key = (placed.value as { key: string }).key;
    const removed = applier.apply(intent({ op: "remove", key }));
    if (!removed.ok) throw new Error(`refused: ${removed.fact}: ${removed.text}`);
    expect(removed.value).toEqual({ removed: true });
    expect(removed.inverse).toMatchObject({ op: "remove", type: pane.BROWSER_PANE_TYPE });
    expect(left).toEqual([key]);
    // still on the desk until its mark has left: the leaver takes it off, not the applier
    expect(panes()).toBe(1);
  });

  it("a mount with no leaving path removes a run's pane at once, as before", () => {
    const { applier, panes, left } = paneBoard();
    const placed = applier.apply(
      intent({ op: "place", kind: pane.BROWSER_PANE_TYPE, props: { agentRun: RUN }, made: MADE }),
    );
    if (!placed.ok) throw new Error(`refused: ${placed.fact}: ${placed.text}`);
    const key = (placed.value as { key: string }).key;
    const removed = applier.apply(intent({ op: "remove", key }));
    if (!removed.ok) throw new Error(`refused: ${removed.fact}: ${removed.text}`);
    expect(removed.value).toEqual({ removed: true });
    expect(left).toEqual([]);
    expect(panes()).toBe(0);
  });

  it("places a made pane with its run and the address the room opened, and its first mint adopts the page", () => {
    for (const url of ["about:blank", "https://example.com/start"]) {
      const { applier, told, panes, propsOf } = paneBoard();
      const answer = applier.apply(
        intent({
          op: "place",
          kind: pane.BROWSER_PANE_TYPE,
          props: { agentRun: RUN, url },
          made: MADE,
        }),
      );
      if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
      const key = (answer.value as { key: string }).key;
      expect(told.adopted).toEqual([[key, MADE]]);
      expect(told.declined).toEqual([]);
      // PI-1 (2026-11-24): the address the room opened is the pane's runAddress, never its url
      expect(propsOf(key)).toMatchObject({ agentRun: RUN, runAddress: url });
      expect(propsOf(key)["url"]).toBe(pane.SAMPLE_URL);
      expect(panes()).toBe(1);
    }
  });

  // PI-1 (2026-11-24): the document never holds a run's address in `url`, the prop a reader that does not know the run
  // (an older build, another device on one) turns into a live page in the person's signed-in profile
  it("PI-1: keeps the address the room opened out of url: it is the pane's runAddress, and url is no page to any reader", () => {
    for (const props of [
      { agentRun: RUN, url: "https://example.com/start" },
      { agentRun: RUN, runAddress: "https://example.com/start", url: "about:blank" },
    ]) {
      const { applier, told, propsOf } = paneBoard();
      const answer = applier.apply(
        intent({ op: "place", kind: pane.BROWSER_PANE_TYPE, props, made: MADE }),
      );
      if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
      const key = (answer.value as { key: string }).key;
      expect(told.adopted).toEqual([[key, MADE]]);
      const kept = propsOf(key);
      expect(kept["agentRun"]).toBe(RUN);
      expect(kept["runAddress"], JSON.stringify(props)).toBe("https://example.com/start");
      // as main's own record reads a pane (isPageUrl): no page, so never a mint into the desk's profile
      expect(pane.isPageUrl(String(kept["url"]), pane.SAMPLE_URL), JSON.stringify(props)).toBe(
        false,
      );
    }
  });

  it("places a made pane with its run alone (the room before it sends an address): the pane's own default stands", () => {
    const { applier, told, propsOf } = paneBoard();
    const answer = applier.apply(
      intent({ op: "place", kind: pane.BROWSER_PANE_TYPE, props: { agentRun: RUN }, made: MADE }),
    );
    if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
    const key = (answer.value as { key: string }).key;
    expect(told.adopted).toEqual([[key, MADE]]);
    expect(propsOf(key)["agentRun"]).toBe(RUN);
  });

  it("refuses a pane that names no made page, run or none, and places nothing: the room places it, never a bare place", () => {
    const { applier, told, panes } = paneBoard();
    for (const props of [{}, { url: "https://example.com" }, { agentRun: RUN }]) {
      const answer = applier.apply(intent({ op: "place", kind: pane.BROWSER_PANE_TYPE, props }));
      expect(answer.ok, JSON.stringify(props)).toBe(false);
      if (answer.ok) continue;
      expect(answer.fact).toBe("no-tool");
      // the mount names no words here, so the kind is named by its type
      expect(answer.text).toBe(
        `${pane.BROWSER_PANE_TYPE} is placed by the pages room's own tools, with the page they open, never with canvas_place.`,
      );
    }
    expect(told).toEqual({ adopted: [], declined: [] });
    expect(panes()).toBe(0);
  });

  // L8 (2026-11-24, the first live run): the agent's pane landed on top of the person's own browser pane, covering part
  // of it. An object an agent places lands in the free place nearest the middle of the person's view, never over an
  // object already on the board (DESIGN.md §8, "pages an agent's run opens", as added 2026-11-24).
  it("L8: lands in free space near the middle of the view, never over the person's own pane", () => {
    const { ce, applier, propsOf } = paneBoard(3);
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 0.25, gesturing: false });
    // the view is 4800 × 3200 in the world: its middle (2400, 1600). The person's own pane lies there
    const size = { w: 1280, h: 800 };
    const mine = ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, {
      x: 2400 - size.w / 2,
      y: 1600 - size.h / 2,
      w: size.w,
      h: size.h,
      props: { url: "https://example.com/mine" },
    });
    ce.world.sync();
    const rectOf = (e: Entity) => {
      const at = ce.world.get(e, Position);
      const across = ce.world.get(e, Size);
      if (at === undefined || across === undefined) throw new Error("no place");
      return { x: at.x, y: at.y, w: across.w, h: across.h };
    };
    const overlap = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const placed: ReturnType<typeof rectOf>[] = [rectOf(mine)];
    for (let n = 0; n < 3; n += 1) {
      const answer = applier.apply(
        intent({
          op: "place",
          kind: pane.BROWSER_PANE_TYPE,
          props: { agentRun: RUN, url: "about:blank" },
          made: `surface_${String(n).repeat(16)}`,
        }),
      );
      if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
      const key = (answer.value as { key: string; onScreen: boolean }).key;
      expect(propsOf(key)["agentRun"]).toBe(RUN);
      const e = ce.docs.current()?.store.resolve(key as never) as Entity;
      const rect = rectOf(e);
      // over nothing already there: the person's pane, nor the agent's earlier ones
      for (const other of placed)
        expect(overlap(rect, other), JSON.stringify([rect, other])).toBe(false);
      // and near the middle: in the view the person is looking at
      expect((answer.value as { onScreen: boolean }).onScreen).toBe(true);
      placed.push(rect);
    }
  });

  it("L8: lands at the middle of the view when nothing lies there", () => {
    const { ce, applier } = paneBoard(3);
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 0.25, gesturing: false });
    // the person's pane far off to one side
    ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x: 0, y: 0, w: 640, h: 400, props: {} });
    ce.world.sync();
    const answer = applier.apply(
      intent({
        op: "place",
        kind: pane.BROWSER_PANE_TYPE,
        props: { agentRun: RUN, url: "about:blank" },
        made: MADE,
      }),
    );
    if (!answer.ok) throw new Error(`refused: ${answer.fact}: ${answer.text}`);
    const e = ce.docs.current()?.store.resolve((answer.value as { key: string }).key as never);
    const at = ce.world.get(e as Entity, Position);
    const across = ce.world.get(e as Entity, Size);
    expect((at?.x ?? 0) + (across?.w ?? 0) / 2).toBeCloseTo(2400, 2);
    expect((at?.y ?? 0) + (across?.h ?? 0) / 2).toBeCloseTo(1600, 2);
  });

  it("declines a made pane on a desk with no room: desk-full, nothing placed", () => {
    const { applier, told, panes } = paneBoard(0);
    const answer = applier.apply(
      intent({
        op: "place",
        kind: pane.BROWSER_PANE_TYPE,
        props: { agentRun: RUN, url: "about:blank" },
        made: MADE,
      }),
    );
    expect(answer.ok ? "answered" : answer.fact).toBe("desk-full");
    expect(told.declined).toEqual([MADE]);
    expect(panes()).toBe(0);
  });
});
