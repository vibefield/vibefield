// The command line itself: the exit-code law, the two registers, and the
// promise that nothing prompts. `runCli` takes its IO, so every assertion here
// is about what a caller would actually see.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, HELP, parseArgs, runCli } from "../src/cli";
import { EXIT_HARNESS, EXIT_OK, EXIT_REFUSED } from "../src/verdict";
import { freshDir, unusedPath, VALID } from "./fixtures";

function capture(): CliIo & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: (line: string) => void lines.push(line),
    err: (line: string) => void errors.push(line),
  };
}

function args(dir: string, extra: string[] = []): string[] {
  return ["--id", VALID.id, "--title", VALID.title, "--dir", dir, ...extra];
}

describe("argument parsing", () => {
  it("separates positionals from flags, with and without values", () => {
    const parsed = parseArgs(["--id", "vendor.demo", "--json", "--dir", "./out"]);
    expect(parsed.flags.get("id")).toBe("vendor.demo");
    expect(parsed.flags.get("json")).toBe(true);
    expect(parsed.flags.get("dir")).toBe("./out");
  });
});

describe("exit codes are law", () => {
  it("exits 0 when the scaffold is written", async () => {
    const io = capture();
    const dir = unusedPath();
    expect(await runCli(args(dir), io)).toBe(EXIT_OK);
    expect(existsSync(join(dir, "vibefield.plugin.json"))).toBe(true);
  });

  it("exits 1 when a row refuses, and writes nothing", async () => {
    const io = capture();
    const dir = unusedPath();
    expect(await runCli(["--id", "demo", "--title", "Demo", "--dir", dir], io)).toBe(EXIT_REFUSED);
    expect(io.lines.join("\n")).toContain("id-invalid");
    expect(existsSync(dir)).toBe(false);
  });

  it("exits 1 on a missing flag rather than asking a question", async () => {
    const io = capture();
    expect(await runCli(["--id", VALID.id], io)).toBe(EXIT_REFUSED);
    const printed = io.lines.join("\n");
    expect(printed).toContain("usage");
    expect(printed).toContain("--title <title>");
    expect(printed).toContain("--dir <target>");
  });

  it("exits 2 when the scaffolder itself fails, and says it is not your input's fault", async () => {
    const io = capture();
    const brokenIo: CliIo = {
      out: () => {
        throw new Error("stdout is gone");
      },
      err: io.err,
    };
    expect(await runCli(args(unusedPath()), brokenIo)).toBe(EXIT_HARNESS);
    expect(io.errors.join("\n")).toContain("stdout is gone");
  });

  it("prints help and exits 0 for --help and for no arguments at all", async () => {
    const help = capture();
    expect(await runCli(["--help"], help)).toBe(EXIT_OK);
    expect(help.lines.join("\n")).toBe(HELP);

    const bare = capture();
    expect(await runCli([], bare)).toBe(EXIT_OK);
    expect(bare.lines.join("\n")).toBe(HELP);
  });
});

describe("the two registers", () => {
  it("prints one JSON verdict per line under --json, then a result object", async () => {
    const io = capture();
    const dir = unusedPath();
    expect(await runCli(args(dir, ["--json"]), io)).toBe(EXIT_OK);

    const parsed = io.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const row of parsed.slice(0, -1)) {
      expect(row["level"]).toMatch(/^(pass|note|refuse)$/);
      expect(typeof row["check"]).toBe("string");
      expect(typeof row["code"]).toBe("string");
      expect(typeof row["detail"]).toBe("string");
    }
    const result = parsed.at(-1);
    expect(result?.["result"]).toBe("create");
    expect(result?.["id"]).toBe(VALID.id);
    expect(result?.["packageName"]).toBe("@vendor/plugin-demo");
    expect(result?.["root"]).toBe(dir);
  });

  it("emits no result object when the run refused", async () => {
    const io = capture();
    await runCli(["--id", "demo", "--title", "Demo", "--dir", unusedPath(), "--json"], io);
    for (const line of io.lines) {
      expect(JSON.parse(line)).not.toHaveProperty("result");
    }
  });

  it("carries a pointer and an expectation on every refusal", async () => {
    const io = capture();
    await runCli(["--id", "demo", "--title", "Demo", "--dir", unusedPath(), "--json"], io);
    const refusals = io.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row["level"] === "refuse");
    expect(refusals.length).toBeGreaterThan(0);
    for (const row of refusals) {
      expect(typeof row["expected"]).toBe("string");
      expect(typeof row["pointer"]).toBe("string");
    }
  });
});

describe("the next three commands are named, verbatim", () => {
  it("names install, check and playground for a workspace member", async () => {
    // A temp directory made to look like a workspace: the note is about where
    // the scaffold LANDED, so the probe has to be exercised through a real one.
    const root = freshDir();
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "plugins/*"\n');
    mkdirSync(join(root, "plugins"), { recursive: true });

    const io = capture();
    await runCli(args(join(root, "plugins", "demo")), io);
    const printed = io.lines.join("\n");
    expect(printed).toContain("pnpm install");
    expect(printed).toContain("pnpm plugin check plugins/demo");
    expect(printed).toContain("pnpm playground plugins/demo");
  });

  it("drops install, and says why, for a scaffold outside the workspace", async () => {
    const io = capture();
    const dir = unusedPath();
    await runCli(args(dir), io);
    const printed = io.lines.join("\n");
    expect(printed).toContain("outside a pnpm workspace");
    expect(printed).toContain("FIELDD_PLUGIN_DEV_ROOTS");
    expect(printed).toContain(`pnpm plugin check ${dir}`);
    expect(printed).toContain(`pnpm playground ${dir}`);
    expect(printed).not.toContain("pnpm install");
  });

  it("carries the placement as a note-level code an agent can branch on", async () => {
    // The human register prints a code only for refusals (a note's class is its
    // guidance, not a failure to look up), so the branchable form is the JSON one.
    const io = capture();
    await runCli(args(unusedPath(), ["--json"]), io);
    const levels = new Map(
      io.lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((row) => typeof row["code"] === "string")
        .map((row) => [row["code"] as string, row["level"] as string]),
    );
    expect(levels.get("workspace-outside")).toBe("note");
    expect(levels.get("next-steps")).toBe("note");
  });
});
