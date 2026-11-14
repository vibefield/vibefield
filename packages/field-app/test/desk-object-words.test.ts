// @vitest-environment node
/**
 * DK-9, DK-11 — THE BAR'S WORDS FOR AN OBJECT (field/desk/desk-object-words.ts; DK-D18 as amended: ICE's missing
 * face is the one face, and the selection bar prints the type's name; DESIGN.md §8 "The missing face", R12, R24).
 * What the chrome says of an object — its human name, and why the desk draws it as missing, in one of FIVE words:
 * "plugin off" (disabled) · "plugin gone" (uninstalled) · "can't draw here" (never registered) · "reload to draw it"
 * (its plugin on, the desk mounted without its kind — I25) · "can't draw" (its kind faulted — I24); nothing more
 * when its kind draws it. MK-4d (the MK inventory's N23): never the type id — with no record, the title the window
 * staged its plugin with, else "Object".
 */
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  eyebrowOf,
  objectWords,
  stagedTitles,
  UNNAMED_OBJECT,
} from "../src/field/desk/desk-object-words";

const CLOCK = "vibefield.example.desk-clock";

const clockRecord = (enabled: boolean): PluginRecord =>
  ({
    id: CLOCK,
    enabled,
    contributions: {
      objects: [{ type: CLOCK, title: "Clock" }],
    },
  }) as unknown as PluginRecord;

const snapshotWith = (...plugins: PluginRecord[]): PluginRegistrySnapshot =>
  ({ generation: 1, plugins, problems: [] }) as unknown as PluginRegistrySnapshot;

const facts = {
  snapshot: snapshotWith(clockRecord(true)),
  off: new Set<string>(),
  faults: [] as string[],
  kinded: true,
  builtIn: { "desk.note": "Note" },
};

describe("the bar's words for an object (DK-9, DK-11)", () => {
  it("a kind that draws it: its human name alone — the manifest's title, a built-in's tray label", () => {
    expect(objectWords(CLOCK, facts)).toEqual({
      type: CLOCK,
      title: "Clock",
      state: null,
      label: "Clock",
    });
    expect(objectWords("desk.note", facts).label).toBe("Note");
  });

  it('its plugin DISABLED: "Clock · plugin off" — whether or not the desk has remounted without it yet', () => {
    const disabled = { ...facts, snapshot: snapshotWith(clockRecord(false)) };
    expect(objectWords(CLOCK, disabled).label).toBe("Clock · plugin off");
    expect(objectWords(CLOCK, { ...disabled, off: new Set([CLOCK]) }).state).toBe("plugin off");
  });

  it('its plugin UNINSTALLED — the desk mounted without its kind, no record left in the registry: "plugin gone", by the name it was staged with', () => {
    const gone = { ...facts, snapshot: snapshotWith(), off: new Set([CLOCK]) };
    // MK-4d (N23): the window keeps the record it staged the plugin with, so the object keeps its name
    expect(objectWords(CLOCK, { ...gone, staged: { [CLOCK]: "Clock" } })).toEqual({
      type: CLOCK,
      title: "Clock",
      state: "plugin gone",
      label: "Clock · plugin gone",
    });
    // with no name here at all, "Object" — never the type id
    expect(objectWords(CLOCK, gone)).toEqual({
      type: CLOCK,
      title: UNNAMED_OBJECT,
      state: "plugin gone",
      label: "Object · plugin gone",
    });
  });

  it("a type this build never registered — a ghost stub's, no kind and no plugin: \"can't draw here\", as Object (MK-4d, N23)", () => {
    expect(objectWords("vendor.elsewhere.dial", { ...facts, kinded: false })).toEqual({
      type: "vendor.elsewhere.dial",
      title: "Object",
      state: "can't draw here",
      label: "Object · can't draw here",
    });
  });

  it('its plugin ON but the desk mounted without its kind (I25): "reload to draw it" — turned on again, or new to this engine', () => {
    // on again: the record enabled, the mount's off set still holding it
    expect(objectWords(CLOCK, { ...facts, off: new Set([CLOCK]) }).label).toBe(
      "Clock · reload to draw it",
    );
    // new to this engine: enabled, and no kind in its catalog
    expect(objectWords(CLOCK, { ...facts, kinded: false }).state).toBe("reload to draw it");
  });

  it("a kind the desk refused or quarantined (I24): \"can't draw\" — never the desk's raw fault", () => {
    expect(objectWords(CLOCK, { ...facts, faults: [CLOCK] }).label).toBe("Clock · can't draw");
  });

  it('with no registry snapshot (the daemon away): a known kind is the name it was staged with, and one the desk was mounted without is "plugin off"', () => {
    const away = { ...facts, snapshot: null, staged: { [CLOCK]: "Clock" } };
    expect(objectWords(CLOCK, away)).toMatchObject({ title: "Clock", state: null });
    expect(objectWords(CLOCK, { ...away, off: new Set([CLOCK]) }).label).toBe("Clock · plugin off");
    // nothing staged: "Object", never the type id (MK-4d, N23)
    expect(objectWords(CLOCK, { ...facts, snapshot: null })).toMatchObject({
      title: "Object",
      state: null,
    });
  });

  it("says the grown menu's eyebrow in capitals: the name, and a missing face's word", () => {
    expect(eyebrowOf(objectWords("desk.note", facts))).toBe("NOTE");
    expect(
      eyebrowOf(objectWords(CLOCK, { ...facts, snapshot: snapshotWith(clockRecord(false)) })),
    ).toBe("CLOCK · PLUGIN OFF");
    expect(eyebrowOf(objectWords("vendor.elsewhere.dial", { ...facts, kinded: false }))).toBe(
      "OBJECT · CAN'T DRAW HERE",
    );
  });

  it("reads the names a window staged its plugins with from each record at staging (MK-4d, N23)", () => {
    const staged = [
      { record: clockRecord(true) },
      {
        record: {
          id: "vibefield.desk-things",
          enabled: false,
          contributions: {
            objects: [
              { type: "DeskThingsRuler", title: "Ruler" },
              { type: "DeskThingsTimer", title: "Timer" },
            ],
          },
        } as unknown as PluginRecord,
      },
      // a plugin that adds no object names nothing
      { record: { id: "example.kv-service", contributions: {} } as unknown as PluginRecord },
    ];
    expect(stagedTitles(staged)).toEqual({
      [CLOCK]: "Clock",
      DeskThingsRuler: "Ruler",
      DeskThingsTimer: "Timer",
    });
    expect(stagedTitles([])).toEqual({});
  });

  it("never names an object by its type id where nothing here names it, whatever its word (MK-4d, N23)", () => {
    const lost = { ...facts, snapshot: snapshotWith() };
    for (const words of [
      objectWords(CLOCK, lost),
      objectWords(CLOCK, { ...lost, off: new Set([CLOCK]) }),
      objectWords(CLOCK, { ...lost, kinded: false }),
      objectWords(CLOCK, { ...lost, faults: [CLOCK] }),
      objectWords(CLOCK, { ...facts, snapshot: null, off: new Set([CLOCK]) }),
    ]) {
      expect(words.title).toBe("Object");
      expect(words.label).not.toContain(CLOCK);
    }
  });
});
