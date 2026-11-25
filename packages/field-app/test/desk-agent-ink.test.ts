// @vitest-environment node
// IK (2026-11-25; ink-agent A) — the three ink tools through the window's applier, on a real engine and document: an
// agent's edit of a note, an honest no answered as the agent's bad input, and an object being typed in, whose open draft
// lands before the agent's act reads its words.
import type { Entity, WidgetType } from "@vibecook/ice";
import type { TypingDocs } from "@vibecook/ice/desk";
import { inkTyping } from "@vibecook/ice/desk/kit";
import { NOTE_TYPE } from "@vibecook/ice/desk/objects";
import type { ObjectIntent, ObjectIntentAnswer, PluginManifestV1 } from "@vibefield/contracts";
import * as pad from "@vibefield/plugin-comment-pad";
import { describe, expect, it } from "vitest";
import { type ApplierDeps, createDeskApplier } from "../src/field/desk/agent/applier";
import type { MountedDesk } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { type RendererLogger, setRendererLogger } from "../src/logging";

const { commentPadManifest } = pad;

let serial = 0;
const intent = (rest: Record<string, unknown>): ObjectIntent => {
  serial += 1;
  return {
    intent: `ink${serial}`,
    run: "run-1",
    handle: "claude·2",
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...rest,
  } as ObjectIntent;
};

/** A written sheet whose cell is the pad's own adoption of the ink (`marks` beside `text` and `seeds` in its `ink`), under
 * a type of its own: the pad's type is defined once per realm (the suite's setup registers it), so a second definition with
 * another cell cannot be made. It binds no kind, so it registers faceless — its cell is all the applier reads. */
const SHEET = "test.inksheet";
const sheetManifest = (): PluginManifestV1 => {
  const pad0 = commentPadManifest.contributes?.objects?.[0];
  if (pad0 === undefined) throw new Error("no pad row");
  const { sticker: _, ...row } = pad0;
  return {
    ...commentPadManifest,
    id: SHEET,
    title: "Ink sheet",
    activation: [`onObject:${SHEET}`],
    contributes: {
      objects: [
        {
          ...row,
          type: SHEET,
          title: "Ink sheet",
          provides: [SHEET, "desk.object"],
          props: { ...row.props, marks: { kind: "string", default: "", maxLength: 200_000 } },
          groups: { ink: ["text", "seeds", "marks"] },
          binding: { kind: "noKindHere" },
        },
      ],
    },
  };
};

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

function mount(withSheet = false, deps: ApplierDeps = {}) {
  setRendererLogger(QUIET); // the sheet's faceless registration says why, as it should
  const registry = withSheet
    ? buildRegistry({
        generation: -1,
        staged: [],
        bundled: [{ manifest: sheetManifest(), mod: pad.commentPadRenderer }],
      })
    : buildRegistry();
  const ce = createFieldEngine(registry);
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
  const applier = createDeskApplier(desk, {
    onCanvas: () => true,
    handOn: () => false,
    now: () => 1_000,
    ...deps,
  });
  const answer = (rest: Record<string, unknown>): ObjectIntentAnswer => applier.apply(intent(rest));
  const ok = (rest: Record<string, unknown>) => {
    const said = answer(rest);
    if (!said.ok) throw new Error(`refused: ${said.fact}: ${said.text}`);
    return said;
  };
  const place = (kind: string, props: Record<string, unknown>) => {
    const key = (ok({ op: "place", kind, props }).value as { key: string }).key;
    return { key, entity: ce.docs.current()?.store.resolve(key as never) as Entity };
  };
  return { ce, applier, answer, ok, place };
}

describe("the ink tools through the applier", () => {
  it("edits a note's words by quote as one change the person's ⌘Z skips", () => {
    const { ce, ok, place } = mount();
    const { key } = place(NOTE_TYPE, { text: "see you on Friday" });
    const said = ok({
      op: "act",
      key,
      tool: "edit_text",
      doing: "moving the day",
      input: { quote: "Friday", with: "Monday" },
    });
    expect(said.value).toEqual({ at: 11, chars: 17 });
    expect(said.changed).toBe('Changed "Friday" to "Monday"');
    expect(said.inverse).toMatchObject({ op: "props", before: { text: "see you on Friday" } });
    const read = () => ok({ op: "read", key, tool: "read_writing", input: {} }).value;
    expect(read()).toEqual({ text: "see you on Monday", pen: "fountain", runs: [] });
    expect(ce.docs.undo()).toBe(false); // the agent's change is not the person's to undo
  });

  it("answers an honest no as the agent's bad input, in the tool's words, and writes nothing", () => {
    const { answer, ok, place } = mount();
    const { key } = place(NOTE_TYPE, { text: "tea, then tea" });
    const refused = answer({
      op: "act",
      key,
      tool: "edit_text",
      doing: "x",
      input: { quote: "tea", with: "coffee" },
    });
    expect(refused).toMatchObject({
      ok: false,
      fact: "bad-input",
      text: '"tea" is written 2 times on this note. Say which with `occurrence`, 1 to 2.',
    });
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({
      text: "tea, then tea",
    });
  });

  it("marks a note's words where the note keeps marks, and says plainly where it does not", () => {
    const { ce, answer, place } = mount();
    const { key } = place(NOTE_TYPE, { text: "one two" });
    const keeps = ce.catalog.widget(NOTE_TYPE)?.propToGroup["marks"] !== undefined;
    const said = answer({
      op: "act",
      key,
      tool: "mark_text",
      doing: "x",
      input: { quote: "two", highlight: "yellow" },
    });
    if (keeps)
      expect(said).toMatchObject({ ok: true, changed: 'Marked "two": highlighted yellow' });
    else
      expect(said).toMatchObject({
        ok: false,
        fact: "bad-input",
        text: "This note keeps no marks: its words can be changed, not marked.",
      });
  });

  it("lands an open draft first, so the agent quotes the words the person is writing", () => {
    const { ce, ok } = mount(true, {
      // the pad's agent half, as the host reads it off the pad's binding
      halves: (type) => (type === SHEET ? pad.commentPad.agent : undefined),
    });
    const entity = ce.ops.spawnWidget(SHEET, { x: 0, y: 0, w: 220, h: 280, undoable: false });
    ce.world.sync();
    const key = ce.docs.current()?.store.keyOf(entity) as string;
    const widget = ce.catalog.widget(SHEET) as WidgetType;
    const typing = inkTyping({
      world: ce.world,
      docs: ce.docs as unknown as TypingDocs,
      object: widget,
    });
    expect(typing.begin(entity)).toBe(true);
    typing.input("hello world", 11);
    expect(typing.open()).toBe(true);
    // the board holds none of it yet: a read is of the board, and writes nothing
    expect(ok({ op: "read", key, tool: "read_text", input: {} }).value).toEqual({ text: "" });
    expect(typing.open()).toBe(true);
    const said = ok({
      op: "act",
      key,
      tool: "mark_text",
      doing: "x",
      input: { quote: "world", underline: true },
    });
    expect(said.changed).toBe('Marked "world": underlined');
    expect(typing.open()).toBe(false);
    expect(ok({ op: "read", key, tool: "read_writing", input: {} }).value).toEqual({
      text: "hello world",
      pen: "ball",
      runs: [{ from: 6, to: 11, text: "world", underline: true }],
    });
    // the draft landed as the person's own words, before the act was recorded: the agent's undo holds its marks alone
    expect(said.inverse).toEqual({
      op: "props",
      after: { marks: expect.any(String) },
      before: { marks: "" },
    });
    typing.end();
  });
});
