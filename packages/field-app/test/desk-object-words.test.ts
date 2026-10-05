// @vitest-environment node
/**
 * DK-9 — THE BAR'S WORDS FOR AN OBJECT (field/desk/desk-object-words.ts; DK-D18 as amended: ICE's missing face is
 * the one face, and the selection bar prints the type's name). What the bar (DK-11's) prints for an object —
 * its title, and why the desk draws it as missing: its plugin is OFF, its plugin is NOT INSTALLED here (a ghost
 * stub's type), or its kind FAULTED; nothing more when its kind draws it.
 */
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { objectWords } from "../src/field/desk/desk-object-words";

const clockRecord = (enabled: boolean): PluginRecord =>
  ({
    id: "vibefield.example.desk-clock",
    enabled,
    contributions: {
      objects: [{ type: "vibefield.example.desk-clock", title: "Clock" }],
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

describe("the bar's words for an object (DK-9)", () => {
  it("a kind that draws it: its title alone", () => {
    expect(objectWords("vibefield.example.desk-clock", facts)).toEqual({
      type: "vibefield.example.desk-clock",
      title: "Clock",
      state: null,
      label: "Clock",
    });
    expect(objectWords("desk.note", facts).label).toBe("Note");
  });

  it('its plugin OFF — disabled in the registry, or the desk mounted without its kind: "Clock · plugin off"', () => {
    expect(
      objectWords("vibefield.example.desk-clock", {
        ...facts,
        snapshot: snapshotWith(clockRecord(false)),
      }).label,
    ).toBe("Clock · plugin off");
    expect(
      objectWords("vibefield.example.desk-clock", {
        ...facts,
        off: new Set(["vibefield.example.desk-clock"]),
      }).state,
    ).toBe("plugin off");
  });

  it('a type no plugin here declares and no kind draws — a ghost stub\'s: "not installed", by its type', () => {
    expect(objectWords("vendor.elsewhere.dial", { ...facts, kinded: false })).toEqual({
      type: "vendor.elsewhere.dial",
      title: "vendor.elsewhere.dial",
      state: "not installed",
      label: "vendor.elsewhere.dial · not installed",
    });
  });

  it('a kind the desk refused or quarantined: "faulted"', () => {
    expect(
      objectWords("vibefield.example.desk-clock", {
        ...facts,
        faults: ["vibefield.example.desk-clock"],
      }).label,
    ).toBe("Clock · faulted");
  });

  it('with no registry snapshot (the daemon away) a known kind is just its type, never "not installed"', () => {
    expect(objectWords("vibefield.example.desk-clock", { ...facts, snapshot: null })).toMatchObject(
      {
        title: "vibefield.example.desk-clock",
        state: null,
      },
    );
  });
});
