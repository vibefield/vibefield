// @vitest-environment node
/**
 * DK-9, DK-11 — THE BAR'S WORDS FOR AN OBJECT (field/desk/desk-object-words.ts; DK-D18 as amended: ICE's missing
 * face is the one face, and the selection bar prints the type's name; DESIGN.md §8 "The missing face", R12, R24).
 * What the chrome says of an object — its human name, and why the desk draws it as missing, in one of FIVE words:
 * "plugin off" (disabled) · "plugin gone" (uninstalled) · "no kind" (never registered) · "remount to draw it"
 * (its plugin on, the desk mounted without its kind — I25) · "can't draw" (its kind faulted — I24); nothing more
 * when its kind draws it.
 */
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { eyebrowOf, objectWords } from "../src/field/desk/desk-object-words";

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

  it('its plugin UNINSTALLED — the desk mounted without its kind, no record left in the registry: "plugin gone", by its type', () => {
    expect(
      objectWords(CLOCK, { ...facts, snapshot: snapshotWith(), off: new Set([CLOCK]) }),
    ).toEqual({
      type: CLOCK,
      title: CLOCK,
      state: "plugin gone",
      label: `${CLOCK} · plugin gone`,
    });
  });

  it('a type this build never registered — a ghost stub\'s, no kind and no plugin: "no kind", by its type', () => {
    expect(objectWords("vendor.elsewhere.dial", { ...facts, kinded: false })).toEqual({
      type: "vendor.elsewhere.dial",
      title: "vendor.elsewhere.dial",
      state: "no kind",
      label: "vendor.elsewhere.dial · no kind",
    });
  });

  it('its plugin ON but the desk mounted without its kind (I25): "remount to draw it" — turned on again, or new to this engine', () => {
    // on again: the record enabled, the mount's off set still holding it
    expect(objectWords(CLOCK, { ...facts, off: new Set([CLOCK]) }).label).toBe(
      "Clock · remount to draw it",
    );
    // new to this engine: enabled, and no kind in its catalog
    expect(objectWords(CLOCK, { ...facts, kinded: false }).state).toBe("remount to draw it");
  });

  it("a kind the desk refused or quarantined (I24): \"can't draw\" — never the desk's raw fault", () => {
    expect(objectWords(CLOCK, { ...facts, faults: [CLOCK] }).label).toBe("Clock · can't draw");
  });

  it('with no registry snapshot (the daemon away): a known kind is its type, and one the desk was mounted without is "plugin off"', () => {
    expect(objectWords(CLOCK, { ...facts, snapshot: null })).toMatchObject({
      title: CLOCK,
      state: null,
    });
    expect(objectWords(CLOCK, { ...facts, snapshot: null, off: new Set([CLOCK]) }).state).toBe(
      "plugin off",
    );
  });

  it("says the grown menu's eyebrow in capitals: the name, and a missing face's word", () => {
    expect(eyebrowOf(objectWords("desk.note", facts))).toBe("NOTE");
    expect(
      eyebrowOf(objectWords(CLOCK, { ...facts, snapshot: snapshotWith(clockRecord(false)) })),
    ).toBe("CLOCK · PLUGIN OFF");
  });
});
