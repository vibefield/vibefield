// The command line itself: the exit-code law, the two registers, and the
// promise that nothing prompts. `runCli` takes its IO, so every assertion here
// is about what a caller would actually see.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateRegistryKeypair } from "@vibefield/plugin-build";
import { describe, expect, it } from "vitest";
import { type CliIo, HELP, parseArgs, runCli } from "../src/cli";
import { EXIT_HARNESS, EXIT_OK, EXIT_REFUSED } from "../src/verdict";
import { baseManifest, freshDir, makePlugin, rendererModule } from "./fixtures";

function capture(): CliIo & { out: (line: string) => void; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: (line: string) => void lines.push(line),
    err: (line: string) => void errors.push(line),
  };
}

describe("argument parsing", () => {
  it("separates positionals from flags, with and without values", () => {
    const parsed = parseArgs(["check", "./plugin", "--json", "--out", "docs"]);
    expect(parsed.command).toEqual(["check", "./plugin"]);
    expect(parsed.flags.get("json")).toBe(true);
    expect(parsed.flags.get("out")).toBe("docs");
  });
});

describe("exit codes are law", () => {
  it("exits 0 when every row passes", async () => {
    const io = capture();
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    expect(await runCli(["check", root], io)).toBe(EXIT_OK);
  });

  it("exits 1 when a row refuses", async () => {
    const io = capture();
    const root = makePlugin({
      files: { "src/renderer.ts": 'import { app } from "electron";\n' },
    });
    expect(await runCli(["check", root], io)).toBe(EXIT_REFUSED);
    expect(io.lines.join("\n")).toContain("wall-violation");
  });

  it("exits 1 on a usage error rather than asking a question", async () => {
    const io = capture();
    expect(await runCli(["check"], io)).toBe(EXIT_REFUSED);
    expect(io.lines.join("\n")).toContain("usage: vibefield-plugin check <dir>");

    const unknown = capture();
    expect(await runCli(["frobnicate"], unknown)).toBe(EXIT_REFUSED);
    expect(unknown.lines.join("\n")).toContain("unknown command frobnicate");
  });

  it("exits 2 when the harness itself fails, and says it is not the plugin's fault", async () => {
    const io = capture();
    // A key file that exists but whose index does not — the failure is thrown
    // from inside the command, which is the harness's own error path.
    const brokenIo: CliIo = {
      out: () => {
        throw new Error("stdout is gone");
      },
      err: io.err,
    };
    expect(await runCli(["docs", "--out", freshDir("vf-docs-")], brokenIo)).toBe(EXIT_HARNESS);
    expect(io.errors.join("\n")).toContain("stdout is gone");
  });
});

describe("the two registers", () => {
  it("prints one JSON verdict per line under --json", async () => {
    const io = capture();
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    await runCli(["check", root, "--json"], io);

    expect(io.lines.length).toBeGreaterThan(3);
    for (const line of io.lines) {
      const verdict = JSON.parse(line) as {
        level: string;
        check: string;
        code: string;
        detail: string;
      };
      expect(["pass", "note", "refuse"]).toContain(verdict.level);
      expect(verdict.check.length).toBeGreaterThan(0);
      expect(verdict.code.length).toBeGreaterThan(0);
      expect(verdict.detail.length).toBeGreaterThan(0);
    }
  });

  it("carries pointer and expected on a refusal, in both registers", async () => {
    const jsonIo = capture();
    const root = makePlugin({
      rawManifest: `${JSON.stringify({ ...baseManifest(), title: "" }, null, 2)}\n`,
    });
    await runCli(["check", root, "--json"], jsonIo);
    const refusal = jsonIo.lines
      .map((line) => JSON.parse(line) as { level: string; pointer?: string; expected?: string })
      .find((v) => v.level === "refuse");
    expect(refusal?.pointer).toBe("/title");
    expect(refusal?.expected).toBeDefined();

    const humanIo = capture();
    await runCli(["check", root], humanIo);
    const human = humanIo.lines.join("\n");
    expect(human).toContain("at       /title");
    expect(human).toContain("expected ");
    expect(human).toContain("code     manifest-invalid");
  });

  it("answers inspect with one result object under --json", async () => {
    const io = capture();
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    expect(await runCli(["inspect", root, "--json"], io)).toBe(EXIT_OK);
    expect(io.lines).toHaveLength(1);

    const result = JSON.parse(io.lines[0] ?? "{}") as {
      result: string;
      id: string;
      manifestHash: string;
      contributions: { widgets: Array<{ type: string; states: number }> };
      totalStates: number;
    };
    expect(result.result).toBe("inspect");
    expect(result.id).toBe(baseManifest()["id"]);
    expect(result.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.contributions.widgets[0]?.states).toBe(1);
    expect(result.totalStates).toBe(1);
  });

  it("counts the playground's named states when the plugin declares them", async () => {
    const io = capture();
    const root = makePlugin({
      files: {
        "dist/renderer.js": rendererModule({}),
        "playground/states.js": `export const states = { "${baseManifest()["id"] as string}.card": { default: {}, empty: {}, long: {} } };\n`,
      },
    });
    await runCli(["inspect", root, "--json"], io);
    const result = JSON.parse(io.lines[0] ?? "{}") as {
      statesSource: string;
      totalStates: number;
    };
    expect(result.statesSource).toBe("playground");
    expect(result.totalStates).toBe(3);
  });
});

describe("help", () => {
  it("is real text, and lists every command", async () => {
    const io = capture();
    expect(await runCli(["--help"], io)).toBe(EXIT_OK);
    const help = io.lines.join("\n");
    expect(help).toBe(HELP);
    for (const command of [
      "check",
      "inspect",
      "pack",
      "dev-link",
      "submit",
      "release lookup",
      "index sign",
      "docs",
    ])
      expect(help).toContain(command);
    expect(help).toContain("exit codes:");
    expect(help).toContain("Nothing here prompts");
  });

  it("prints help rather than doing something when called with no arguments", async () => {
    const io = capture();
    expect(await runCli([], io)).toBe(EXIT_OK);
    expect(io.lines.join("\n")).toBe(HELP);
  });
});

describe("the whole loop, end to end", () => {
  it("checks, packs, submits, signs and looks up — without a network or a prompt", async () => {
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    const outDir = freshDir("vf-loop-");
    const artifact = join(outDir, "plugin.vfplugin");

    const check = capture();
    expect(await runCli(["check", root], check)).toBe(EXIT_OK);

    const pack = capture();
    expect(await runCli(["pack", root, "--out", artifact, "--json"], pack)).toBe(EXIT_OK);
    const packResult = pack.lines
      .map((line) => JSON.parse(line) as { result?: string; sha256?: string })
      .find((line) => line.result === "pack");
    expect(packResult?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);

    const submit = capture();
    expect(await runCli(["submit", root, "--artifact", artifact, "--json"], submit)).toBe(EXIT_OK);
    const row = submit.lines
      .map(
        (line) =>
          JSON.parse(line) as { result?: string; indexRow?: { latest: { sha256: string } } },
      )
      .find((line) => line.result === "submit");
    expect(row?.indexRow?.latest.sha256).toBe(packResult?.sha256);

    // Build the index by hand from that row — this is the human step `submit`
    // names — then sign it and look it up through the CLI.
    const keys = generateRegistryKeypair();
    const keyPath = join(outDir, "secret.key");
    const publicKeyPath = join(outDir, "public.key");
    writeFileSync(keyPath, keys.secretKey);
    writeFileSync(publicKeyPath, keys.publicKey);
    const indexPath = join(outDir, "index.json");
    writeFileSync(
      indexPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: 0,
          plugins: {
            [baseManifest()["id"] as string]: {
              id: baseManifest()["id"],
              repo: "https://example.test/plugins/fixture",
              latest: { ...row?.indexRow?.latest, artifactUrl: "artifacts/plugin.vfplugin" },
              history: [],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const sign = capture();
    expect(await runCli(["index", "sign", indexPath, "--key", keyPath], sign)).toBe(EXIT_OK);
    expect(readFileSync(`${indexPath}.sig`, "utf8").length).toBeGreaterThan(0);

    const lookup = capture();
    expect(
      await runCli(
        [
          "release",
          "lookup",
          baseManifest()["id"] as string,
          "--index",
          indexPath,
          "--key",
          publicKeyPath,
        ],
        lookup,
      ),
    ).toBe(EXIT_OK);
    expect(lookup.lines.join("\n")).toContain("index signature verifies");

    // And the control: a tampered index refuses.
    writeFileSync(
      indexPath,
      readFileSync(indexPath, "utf8").replace('"history": []', '"history":[]'),
    );
    const tampered = capture();
    expect(
      await runCli(
        [
          "release",
          "lookup",
          baseManifest()["id"] as string,
          "--index",
          indexPath,
          "--key",
          publicKeyPath,
        ],
        tampered,
      ),
    ).toBe(EXIT_REFUSED);
    expect(tampered.lines.join("\n")).toContain("signature-invalid");
  });

  it("dev-links and unlinks through the CLI", async () => {
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    const devRoot = freshDir("vf-dev-root-");

    const link = capture();
    expect(await runCli(["dev-link", root, "--root", devRoot], link)).toBe(EXIT_OK);
    const printed = link.lines.join("\n");
    expect(printed).toContain(devRoot);
    expect(printed).toContain("plugins.reload");

    const remove = capture();
    expect(await runCli(["dev-link", root, "--root", devRoot, "--remove"], remove)).toBe(EXIT_OK);
    expect(remove.lines.join("\n")).toContain("unlinked");
  });
});
