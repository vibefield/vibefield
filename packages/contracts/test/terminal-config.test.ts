import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import { SCOPES, TAILNET_SCOPES } from "../src/registries";
import {
  SHELL_INTERNAL_PROVIDER_METHODS,
  ShellDialogPickFileParams,
  ShellDialogPickFileResult,
  ShellDialogSaveFileParams,
  ShellDialogSaveFileResult,
} from "../src/shell";
import {
  TERMINAL_CONFIG_MAX_BYTES,
  TerminalConfigConflict,
  TerminalConfigDocument,
  TerminalConfigExportResult,
  TerminalConfigImportResult,
  TerminalConfigSnapshot,
  TerminalConfigValidation,
  TerminalConfigWriteRefusal,
  TerminalConfigWriteResult,
  terminalConfigIncludeOps,
  terminalConfigIncludes,
  terminalConfigIncludesAllowed,
} from "../src/terminal";

/** A snapshot as fieldd projects ghosttea's ConfigSnapshot (GT-7). */
const SNAPSHOT = {
  revision: "effective-1",
  ghosttyVersion: "1.3.1",
  knownKeyCount: 202,
  sources: [
    { path: "/Users/me/.config/ghostty/config", kind: "ghostty-default" },
    {
      path: "/Users/me/Library/Application Support/VibeField/native/config.ghostty",
      kind: "ghosttea-overlay",
    },
  ],
  diagnostics: [
    {
      severity: "info",
      code: "recognized-not-applied",
      message:
        "Ghostty key `window-padding-balance` is recognized by the compatibility schema but is not applied yet",
      key: "window-padding-balance",
    },
    {
      severity: "error",
      code: "invalid-color",
      message: "invalid color `#12`",
      source: "/Users/me/Library/Application Support/VibeField/native/config.ghostty",
      line: 4,
      key: "background",
    },
  ],
  configuredKeys: [
    { key: "background", support: "applied", occurrences: 1 },
    { key: "font-family", support: "parsed", occurrences: 2 },
    { key: "window-padding-balance", support: "unsupported", occurrences: 1 },
  ],
  keybindings: [{ trigger: "super+k", action: "clear_screen" }],
  clearKeybindings: false,
  scrollbackBytes: 10_000_000,
  palette: [{ index: 1, color: "#d70000" }],
  fontSize: 13,
  fontFamilies: ["Berkeley Mono"],
};

describe("GT-7: the loader's snapshot on the product wire", () => {
  it("parses the projection and keeps a field the next ghosttea adds", () => {
    const parsed = TerminalConfigSnapshot.parse({ ...SNAPSHOT, somethingNew: { a: 1 } });
    expect(parsed.configuredKeys.map((key) => key.support)).toEqual([
      "applied",
      "parsed",
      "unsupported",
    ]);
    expect((parsed as Record<string, unknown>)["somethingNew"]).toEqual({ a: 1 });
  });

  it("keeps a source kind and a support level it has never seen (shown, not refused)", () => {
    const parsed = TerminalConfigSnapshot.parse({
      ...SNAPSHOT,
      sources: [{ path: "/x", kind: "remote-profile" }],
      configuredKeys: [{ key: "k", support: "experimental", occurrences: 1 }],
    });
    expect(parsed.sources[0]?.kind).toBe("remote-profile");
    expect(parsed.configuredKeys[0]?.support).toBe("experimental");
  });

  it("refuses a palette index outside 0–255", () => {
    expect(() =>
      TerminalConfigSnapshot.parse({ ...SNAPSHOT, palette: [{ index: 256, color: "#000000" }] }),
    ).toThrow();
  });

  it("carries the snapshot on the document and the write result, and tolerates its absence", () => {
    const document = {
      path: "/Users/me/Library/Application Support/VibeField/native/config.ghostty",
      text: "",
      revision: "r1",
      exists: false,
    };
    expect(TerminalConfigDocument.parse(document).config).toBeUndefined();
    expect(TerminalConfigDocument.parse({ ...document, config: SNAPSHOT }).config?.revision).toBe(
      "effective-1",
    );
    const written = TerminalConfigWriteResult.parse({
      ok: true,
      document,
      effectiveChanged: true,
      diagnostics: [],
      config: SNAPSHOT,
    });
    expect(written.config?.scrollbackBytes).toBe(10_000_000);
  });

  it("parses a validation, with and without the loaded snapshot", () => {
    const refused = TerminalConfigValidation.parse({
      documentRevision: "r1",
      includesAllowed: false,
      blocking: [],
    });
    expect(refused.config).toBeUndefined();
    const loaded = TerminalConfigValidation.parse({
      documentRevision: "r1",
      includesAllowed: true,
      blocking: [SNAPSHOT.diagnostics[1]],
      config: SNAPSHOT,
    });
    expect(loaded.blocking[0]?.code).toBe("invalid-color");
  });

  it("names why a write was refused, and what a conflict found", () => {
    expect(
      TerminalConfigWriteRefusal.parse({ reason: "includes-changed", blocking: [] }).reason,
    ).toBe("includes-changed");
    expect(() => TerminalConfigWriteRefusal.parse({ reason: "because", blocking: [] })).toThrow();
    const conflict = TerminalConfigConflict.parse({
      current: { path: "/p", text: "font-size = 14\n", revision: "r2", exists: true },
    });
    expect(conflict.current.revision).toBe("r2");
  });
});

describe("GT-7: the file actions' results", () => {
  it("is cancelled or carries what moved", () => {
    expect(TerminalConfigImportResult.parse({ status: "cancelled" }).status).toBe("cancelled");
    const imported = TerminalConfigImportResult.parse({
      status: "imported",
      path: "/tmp/ghostty.conf",
      text: "font-size = 14\n",
    });
    expect(imported.status === "imported" && imported.text).toBe("font-size = 14\n");
    expect(() => TerminalConfigImportResult.parse({ status: "imported", path: "/x" })).toThrow();
    const exported = TerminalConfigExportResult.parse({
      status: "exported",
      path: "/tmp/out.ghostty",
      bytes: 15,
    });
    expect(exported.status === "exported" && exported.bytes).toBe(15);
  });

  it("declares the dry run and the three file actions on settings.manage, local only", () => {
    const table = Object.fromEntries(
      METHODS.filter((method) => method.method.startsWith("terminal.config.")).map((method) => [
        method.method,
        { scope: method.scope, idempotent: method.idempotent, locality: method.locality },
      ]),
    );
    expect(table).toEqual({
      "terminal.config.read": { scope: "settings.manage", idempotent: true, locality: "local" },
      "terminal.config.write": { scope: "settings.manage", idempotent: false, locality: "local" },
      "terminal.config.validate": { scope: "settings.manage", idempotent: true, locality: "local" },
      "terminal.config.import": { scope: "settings.manage", idempotent: true, locality: "local" },
      "terminal.config.export": { scope: "settings.manage", idempotent: false, locality: "local" },
      "terminal.config.reveal": { scope: "settings.manage", idempotent: true, locality: "local" },
    });
    expect(SCOPES).toContain("settings.manage");
    expect(TAILNET_SCOPES).not.toContain("settings.manage");
    expect(TERMINAL_CONFIG_MAX_BYTES).toBe(65_536);
  });

  it("reaches the dialogs through two INTERNAL shell provider verbs, each locked to one purpose", () => {
    expect(SHELL_INTERNAL_PROVIDER_METHODS).toContain("shell.dialog.pickFile");
    expect(SHELL_INTERNAL_PROVIDER_METHODS).toContain("shell.dialog.saveFile");
    // internal: no product client reaches them — the terminal service is the door
    expect(METHODS.some((method) => method.method.startsWith("shell.dialog.pickFile"))).toBe(false);
    expect(ShellDialogPickFileParams.safeParse({ purpose: "terminal.config.import" }).success).toBe(
      true,
    );
    expect(ShellDialogPickFileParams.safeParse({ purpose: "artifact.publish" }).success).toBe(
      false,
    );
    expect(
      ShellDialogSaveFileParams.safeParse({
        purpose: "terminal.config.export",
        defaultName: "config.ghostty",
      }).success,
    ).toBe(true);
    for (const defaultName of ["../x", "a/b", "a\\b", "", ".", "..", "nul\u0000"]) {
      expect(
        ShellDialogSaveFileParams.safeParse({ purpose: "terminal.config.export", defaultName })
          .success,
      ).toBe(false);
    }
    expect(
      ShellDialogPickFileResult.safeParse({ canceled: false, path: "relative/x" }).success,
    ).toBe(false);
    expect(
      ShellDialogSaveFileResult.parse({
        canceled: false,
        path: "/Users/me/Downloads/config.ghostty",
      }),
    ).toMatchObject({ canceled: false });
  });
});

describe("GT-7: the include queue", () => {
  it("reads the loader's config-file grammar and nothing else", () => {
    const text = [
      "font-size = 14",
      "config-file = themes/dark",
      'config-file = "with space/x"',
      "config-file = ?optional",
      'config-file = ?"quoted optional"',
      "  config-file   =   spaced  ",
      "# config-file = commented",
      "config-files = not-the-key",
      "config-file",
    ].join("\n");
    expect(terminalConfigIncludeOps(text)).toEqual([
      { kind: "include", path: "themes/dark", optional: false },
      { kind: "include", path: "with space/x", optional: false },
      { kind: "include", path: "optional", optional: true },
      { kind: "include", path: "quoted optional", optional: true },
      { kind: "include", path: "spaced", optional: false },
    ]);
  });

  it("empties the queue on a bare config-file line", () => {
    expect([
      ...terminalConfigIncludes("config-file = a\nconfig-file =\nconfig-file = b\n"),
    ]).toEqual(["b"]);
  });

  it("allows the queue kept exactly, cleared, or never there", () => {
    const current = "config-file = a\nfont-size = 13\nconfig-file = ?b\n";
    expect(terminalConfigIncludesAllowed(current, current)).toBe(true);
    expect(
      terminalConfigIncludesAllowed(current, "font-size = 14\nconfig-file = a\nconfig-file = ?b\n"),
    ).toBe(true);
    expect(terminalConfigIncludesAllowed(current, "font-size = 14\n")).toBe(true);
    expect(terminalConfigIncludesAllowed("", "palette = 1=#ff0000\n")).toBe(true);
    // a trailing reset leaves nothing queued — as empty as never including
    expect(terminalConfigIncludesAllowed(current, "config-file = a\nconfig-file =\n")).toBe(true);
  });

  it("refuses every restructuring of a queue that still reads something", () => {
    const current = "config-file = a\nconfig-file = ?b\n";
    // added
    expect(terminalConfigIncludesAllowed("", "config-file = /etc/hosts\n")).toBe(false);
    expect(terminalConfigIncludesAllowed(current, `${current}config-file = c\n`)).toBe(false);
    // reordered
    expect(terminalConfigIncludesAllowed(current, "config-file = ?b\nconfig-file = a\n")).toBe(
      false,
    );
    // one of two removed
    expect(terminalConfigIncludesAllowed(current, "config-file = a\n")).toBe(false);
    // swapped path, same position
    expect(terminalConfigIncludesAllowed(current, "config-file = x\nconfig-file = ?b\n")).toBe(
      false,
    );
    // optional flag changed
    expect(terminalConfigIncludesAllowed(current, "config-file = ?a\nconfig-file = ?b\n")).toBe(
      false,
    );
  });
});
