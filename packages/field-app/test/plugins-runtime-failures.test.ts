import {
  PluginRegistrySnapshot,
  PluginRuntimeDiagnosticsSnapshot,
  type PluginRuntimeDoctorIssueCode,
  type PluginsCatalog,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CATALOG_LISTED,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT,
  PLUGINS_FIXTURE_RUNTIME,
  PLUGINS_FIXTURE_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import { installedRows, runtimeFailures } from "../src/frame/plugins/plugins-model";
import * as words from "../src/frame/plugins/plugins-words";

// MK-5b — a plugin whose runtime failed, in the Plugins popup's model (DESIGN.md §8 "Plugins — the frame's second
// popup", Installed, MK-5b's drawing; §9 "Installed, off and Remove…"): which plugins fieldd's runtime read says
// failed, read by the Doctor's codes and never its words (`runtimeFailures`), and the rows that say so, the rows
// that offer Try again, and the line of a plugin that can't run. Pure: the popup's rows over the same fixtures are
// `plugins-popup.test.tsx`'s.

const failed = runtimeFailures(PLUGINS_FIXTURE_RUNTIME);

/** Installed's rows, with the window's own set of plugins that cannot start here and the plugins whose runtime
 * failed. */
const rowsOf = (
  snapshot: PluginRegistrySnapshot,
  catalog: PluginsCatalog | null,
  unstarted: ReadonlySet<string> = new Set<string>(),
  failing: ReadonlySet<string> = failed,
) => installedRows(snapshot, catalog, "", null, unstarted, failing);
const rowOf = (rows: ReturnType<typeof rowsOf>, id: string) =>
  rows.find((candidate) => candidate.id === id);

describe("which plugins' runtime failed (MK-5b)", () => {
  it("reads fieldd's runtime by the Doctor's codes: a failed service, or a failure in a window still connected", () => {
    // Comment pad's failure is the last report of a window that left, which is not read; whether Desk clock is on
    // is the registry's to say
    expect([...failed].sort()).toEqual([
      "example.desk-clock",
      "example.kv-service",
      "vibefield.simulator",
    ]);
  });

  it("reads a failed behavior generation and a suspended breaker, and no warning or other error", () => {
    const simulators = PLUGINS_FIXTURE_RUNTIME.plugins.find(
      (plugin) => plugin.pluginId === "vibefield.simulator",
    );
    if (simulators === undefined) throw new Error("the fixture holds no runtime for Simulators");
    const says = (code: PluginRuntimeDoctorIssueCode, severity: "warning" | "error"): boolean => {
      const issue = {
        code,
        severity,
        face: "behavior",
        participantId: "fixture-window",
        message: "fixture",
      };
      const runtime = PluginRuntimeDiagnosticsSnapshot.parse({
        ...PLUGINS_FIXTURE_RUNTIME,
        plugins: [{ ...simulators, issues: [issue] }],
      });
      return runtimeFailures(runtime).has("vibefield.simulator");
    };
    expect(says("behavior-generation-failed", "error")).toBe(true);
    expect(says("behavior-suspended", "error")).toBe(true);
    expect(says("behavior-blocked", "warning")).toBe(false);
    expect(says("cleanup-errors", "warning")).toBe(false);
    expect(says("scope-non-quiescent", "error")).toBe(false);
    expect(says("target-not-current", "error")).toBe(false);
    expect(says("update-failed", "error")).toBe(false);
  });

  it("reads a window as left by its renderer's own word too, when the Doctor's mark was cut", () => {
    const simulators = PLUGINS_FIXTURE_RUNTIME.plugins.find(
      (plugin) => plugin.pluginId === "vibefield.simulator",
    );
    if (simulators === undefined) throw new Error("the fixture holds no runtime for Simulators");
    // its failure is still among the issues, its window's renderer-disconnected mark past the limit
    const left = PluginRuntimeDiagnosticsSnapshot.parse({
      ...PLUGINS_FIXTURE_RUNTIME,
      plugins: [
        {
          ...simulators,
          renderers: simulators.renderers.map((renderer) => ({ ...renderer, connected: false })),
          omittedIssues: 1,
        },
      ],
    });
    expect(simulators.issues.map((issue) => issue.code)).toEqual(["controller-failed"]);
    expect(runtimeFailures(left).has("vibefield.simulator")).toBe(false);
  });
});

describe("Installed's rows of plugins that aren't working, and Try again (MK-5b)", () => {
  it("says a plugin that is on and whose runtime failed isn't working, with Try again on a Built in or Development one alone", () => {
    const rows = rowsOf(PLUGINS_FIXTURE_SNAPSHOT, null);
    expect(rowOf(rows, "vibefield.simulator")).toEqual({
      id: "vibefield.simulator",
      title: "Simulators",
      source: "Built in",
      community: false,
      line: words.INSTALLED_LINE.broken("Simulators"),
      onOff: true,
      retry: true,
    });
    // a Sideloaded plugin says it too, with no switch here and so no Try again
    const store = rowOf(rows, "example.kv-service");
    expect([store?.line, store?.onOff, store?.retry]).toEqual([
      words.INSTALLED_LINE.broken("Key-value store"),
      null,
      undefined,
    ]);
    // working, or off whatever its last report says: its own line and no Try again
    const pad = rowOf(rows, "vibefield.comment-pad");
    expect([pad?.line, pad?.retry]).toEqual(["1 object · 0.1.0 · comes with VibeField", undefined]);
    const clock = rowOf(rows, "example.desk-clock");
    expect([clock?.line, clock?.retry]).toEqual([words.INSTALLED_LINE.off, undefined]);
  });

  it("offers Try again on a plugin that cannot start in this window too (item 476), never on one fieldd stopped", () => {
    const unstarted = new Set(["vibefield.comment-pad"]);
    const rows = rowsOf(PLUGINS_FIXTURE_SNAPSHOT, null, unstarted, new Set<string>());
    const comment = rowOf(rows, "vibefield.comment-pad");
    expect([comment?.line, comment?.retry]).toEqual([
      words.INSTALLED_LINE.broken("Comment pad"),
      true,
    ]);
    // stopped after it kept crashing: its own line, its switch off, and a press on it starts it again
    const stopped = PluginRegistrySnapshot.parse({
      ...PLUGINS_FIXTURE_SNAPSHOT,
      plugins: PLUGINS_FIXTURE_SNAPSHOT.plugins.map((plugin) =>
        plugin.id === "vibefield.simulator" ? { ...plugin, service: "quarantined" } : plugin,
      ),
    });
    const simulators = rowOf(rowsOf(stopped, null), "vibefield.simulator");
    expect([simulators?.line, simulators?.onOff, simulators?.retry]).toEqual([
      words.INSTALLED_LINE.stopped,
      false,
      undefined,
    ]);
  });

  it("offers no Try again on a plugin from the plugin list: its switch is Settings → Plugins'", () => {
    const none = new Set<string>();
    const only = new Set(["acme.kanban"]);
    const rows = rowsOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, CATALOG_LISTED, none, only);
    const kanban = rowOf(rows, "acme.kanban");
    expect([kanban?.line, kanban?.onOff, kanban?.retry]).toEqual([
      words.INSTALLED_LINE.broken("Kanban"),
      null,
      undefined,
    ]);
  });

  it("says a line of its own for a plugin that can't run, in MK's draft words, with no switch and no Try again", () => {
    expect(words.INSTALLED_LINE.cantRun("Gauge")).toBe("Gauge can't run on this VibeField");
    // the catalog's plate: Gauge, in development and incompatible, whatever its runtime says
    const failing = new Set(["example.gauge"]);
    const rows = rowsOf(PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT, null, new Set<string>(), failing);
    const gauge = rowOf(rows, "example.gauge");
    expect([gauge?.line, gauge?.onOff, gauge?.retry]).toEqual([
      words.INSTALLED_LINE.cantRun("Gauge"),
      null,
      undefined,
    ]);
  });
});
