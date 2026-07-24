import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import type { CommandInvocation } from "@vibefield/plugin-sdk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { fieldToolsManifest, fieldToolsRenderer } from "../src";
import { COMMENT_COMMAND } from "../src/commands";

// C1b/P3a: the canonical manifest V1-validates; container and sweepContained
// ride as DATA on the manifest itself (no registry round-trip needed);
// ACTIVATION binds exactly the declared widget types (§12.1, proven against
// the SDK's mock host — no engine, no registry). Host-side integration
// (prefab building, tray silhouettes) lives in field-app's own suites.
describe("plugin-field-tools", () => {
  it("activation binds exactly the manifest's declared widget types", async () => {
    const declared = (fieldToolsManifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(fieldToolsRenderer, {
      id: fieldToolsManifest.id,
      version: fieldToolsManifest.version,
      declaredWidgets: declared,
    });
    expect([...session.bindings.keys()]).toEqual(declared);
    for (const binding of session.bindings.values()) expect(binding.component).toBeDefined();
  });

  it("folder is the one container; comment's membership is spatial (sweepContained)", () => {
    const widgets = fieldToolsManifest.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "vibefield.field-tools.folder")?.container).toEqual({
      accepts: ["widget"],
      provides: ["widget"],
    });
    expect(
      widgets.find((w) => w.type === "vibefield.field-tools.comment")?.interaction?.sweepContained,
    ).toBe(true);
  });

  it("declares the comment command with palette + canvas-context placements (§8.3)", () => {
    const commands = fieldToolsManifest.contributes?.commands ?? [];
    const cmd = commands.find((c) => c.id === COMMENT_COMMAND);
    expect(cmd).toBeDefined();
    expect(cmd?.placements).toEqual(["palette", "canvas-context"]);
    // the command spawns a widget → a canvas write (§12.7)
    expect(fieldToolsManifest.capabilities).toContain("canvas.write");
  });

  it("activation binds the comment command; no engine → honest warn + no-op (§13/§12.7)", async () => {
    const declaredWidgets = (fieldToolsManifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(fieldToolsRenderer, {
      id: fieldToolsManifest.id,
      version: fieldToolsManifest.version,
      declaredWidgets,
      declaredCommands: [COMMENT_COMMAND],
      // ctx.canvas deliberately ABSENT (no canvasEngine) — the honest no-op path
    });
    const handler = session.commands.get(COMMENT_COMMAND);
    expect(handler).toBeDefined();

    const invocation: CommandInvocation = {
      source: "canvas-context",
      windowId: "test",
      selection: [],
      userGesture: true,
    };
    // The handler is synchronous here (returns void); awaiting a non-promise is
    // harmless and still fails the test if it throws — the honest no-op must not.
    await handler?.(undefined, invocation);
    expect(session.logs.some((l) => l.level === "warn" && /no canvas engine/.test(l.message))).toBe(
      true,
    );
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(fieldToolsManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
