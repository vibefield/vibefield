// DK-10 — `vibefield-plugin try`: a plugin's kinds on the desk, in the product. The ten-minute bar's three agents all
// stopped at "put it on the desk" (dev-link names an in-app step, and nothing lays a plugin's kind before DK-13's
// pegboard); `try` stages the plugin in a dev root of its own and runs the app's try board. These rows hold its two
// halves without the app: what it reads out of the app's output and says (pure), and what it stages and hands the app
// (an injected runner). The app half itself is held in the product — the kit's own run on a plugin (drawn, exit 0) and
// on a copy whose WGSL names an undeclared value (refused at create, exit 1), recorded in DK-10's note.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { afterAll, describe, expect, it } from "vitest";
import {
  readTryOutput,
  TRY_SCRIPT,
  type TryRunner,
  tryPlugin,
  tryVerdicts,
} from "../src/try-command";

const roots: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const row = (fields: Record<string, unknown>): string =>
  `SMOKE_TRY_OBJECT ${JSON.stringify({ census: 1, faults: [], picked: { x0: 10, y0: 20, x1: 250, y1: 164 }, stills: { light: "/s/l.png", dark: "/s/d.png" }, ...fields })}`;

describe("what try reads out of the app's run", () => {
  it("reads every row, whatever the app logged between them", () => {
    const out = readTryOutput(
      [
        "[fieldd] boot noise",
        row({ type: "acme.card" }),
        'SMOKE_TRY_STILLS {"light":"/s/board-l.png"}',
        "SMOKE_TRY_NOTE the desk did not come to rest",
        "  SMOKE_TRY failed: acme.dice is not registered with the desk — x · y",
        "SMOKE_TRY_OK",
        'SMOKE_TRY_OBJECT {"not json',
      ].join("\n"),
    );
    expect(out.rows.map((r) => r.type)).toEqual(["acme.card"]);
    expect(out.notes).toEqual(["the desk did not come to rest"]);
    expect(out.board).toEqual({ light: "/s/board-l.png" });
    expect(out.failure).toBe("acme.dice is not registered with the desk — x · y");
    expect(out.ok).toBe(true);
  });
});

describe("what try says", () => {
  const log = "/shots/try.log";

  it("a kind on the board, made on the device, picked where it lies — DRAWN, with its box and its stills", () => {
    const verdicts = tryVerdicts(
      ["acme.card"],
      readTryOutput(`${row({ type: "acme.card" })}\nSMOKE_TRY_OK`),
      0,
      log,
    );
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ level: "pass", check: "try" });
    expect(verdicts[0]?.detail).toContain("acme.card is on the desk, DRAWN");
    expect(verdicts[0]?.detail).toContain("240 × 144 CSS px");
    expect(verdicts[0]?.detail).toContain("/s/l.png");
  });

  it("a kind the desk refused is refused with the desk's own reason — the compiler's line for WGSL", () => {
    const reason =
      "refused at create — WGSL acme.card/shaders.wgsl: acme.card/shaders.wgsl:73:47  unresolved value 'oops'";
    const verdicts = tryVerdicts(
      ["acme.card"],
      readTryOutput(
        `${row({ type: "acme.card", faults: [{ kind: "acme.card", reason }], picked: null })}\nSMOKE_TRY failed: x`,
      ),
      2,
      log,
    );
    expect(verdicts.map((v) => [v.level, v.code])).toEqual([["refuse", "try-kind-refused"]]);
    expect(verdicts[0]?.detail).toContain("shaders.wgsl:73:47  unresolved value 'oops'");
    expect(verdicts[0]?.pointer).toBe("acme.card");
  });

  it("a kind not laid says why, from the app's own words; one laid but not picked says what to look at", () => {
    const failure =
      'acme.dice is registered but the desk did not lay it — the row must provide "desk.object" · acme.card was laid but not picked';
    const verdicts = tryVerdicts(
      ["acme.dice", "acme.card"],
      readTryOutput(
        [
          row({ type: "acme.dice", census: 0, picked: null, stills: null }),
          row({ type: "acme.card", picked: null }),
          `SMOKE_TRY failed: ${failure}`,
        ].join("\n"),
      ),
      2,
      log,
    );
    expect(verdicts.map((v) => v.code)).toEqual(["try-not-laid", "try-not-picked"]);
    expect(verdicts[0]?.detail).toContain('must provide "desk.object"');
    expect(verdicts[1]?.detail).toContain("still: /s/l.png");
  });

  it("an app that failed before it judged a kind is refused with its log — the plugin named only by a row", () => {
    const verdicts = tryVerdicts(
      ["acme.card"],
      readTryOutput('SMOKE_TRY failed: no "DESK_READY " within 60000ms'),
      2,
      log,
    );
    expect(verdicts.map((v) => v.code)).toEqual(["try-app-failed"]);
    expect(verdicts[0]?.detail).toContain('no "DESK_READY " within 60000ms');
    expect(verdicts[0]?.detail).toContain(log);
  });

  it("a desk that never rests with the kind on it is a NOTE, never a refusal; the board's stills are a note", () => {
    const verdicts = tryVerdicts(
      ["acme.card"],
      readTryOutput(
        [
          row({ type: "acme.card" }),
          "SMOKE_TRY_NOTE the desk did not come to rest",
          'SMOKE_TRY_STILLS {"light":"/b.png"}',
          "SMOKE_TRY_OK",
        ].join("\n"),
      ),
      0,
      log,
    );
    expect(verdicts.map((v) => [v.level, v.code])).toEqual([
      ["pass", "ok"],
      ["note", "try-desk-awake"],
      ["note", "try-stills"],
    ]);
  });
});

/** A built plugin with one object kind, on disk. */
function builtPlugin(objects: readonly { type: string }[] = [{ type: "acme.card" }]): {
  root: string;
  manifest: PluginManifestV1;
} {
  const root = temp("dk-10-try-plugin-");
  const manifest = {
    manifestVersion: 1,
    id: "acme.card",
    version: "0.1.0",
    title: "Card",
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: [],
    capabilities: [],
    contributes: { objects },
  } as unknown as PluginManifestV1;
  writeFileSync(join(root, "vibefield.plugin.json"), `${JSON.stringify(manifest)}\n`);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "renderer.js"), "export default { activate() {} };\n");
  writeFileSync(join(root, "README.md"), "source, never staged\n");
  return { root, manifest };
}

/** A checkout with the try script. */
function app(): string {
  const repo = temp("dk-10-try-app-");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { [TRY_SCRIPT]: "x" } }));
  return repo;
}

describe("what try stages and hands the app", () => {
  it("a COPY of the bundle alone in a dev root of its own, named to the app with the types and the shots; the root gone after", async () => {
    const { root, manifest } = builtPlugin([{ type: "acme.card" }, { type: "acme.card.big" }]);
    const shots = join(temp("dk-10-try-shots-"), "shots");
    let seen: {
      devRoot?: string;
      staged?: string[];
      env?: NodeJS.ProcessEnv;
      args?: readonly string[];
    } = {};
    const runner: TryRunner = async (opts) => {
      const devRoot = opts.env["FIELDD_PLUGIN_DEV_ROOTS"] ?? "";
      seen = {
        devRoot,
        staged: [
          existsSync(join(devRoot, "acme.card", "vibefield.plugin.json")) ? "manifest" : "",
          existsSync(join(devRoot, "acme.card", "dist", "renderer.js")) ? "dist" : "",
          existsSync(join(devRoot, "acme.card", "README.md")) ? "README" : "",
        ].filter((s) => s.length > 0),
        env: opts.env,
        args: opts.args,
      };
      writeFileSync(opts.logPath, "log");
      return {
        code: 0,
        output: `${row({ type: "acme.card" })}\n${row({ type: "acme.card.big" })}\nSMOKE_TRY_OK`,
      };
    };
    const verdicts = await tryPlugin({ root, manifest, shots, repoRoot: app(), runner });
    expect(seen.staged).toEqual(["manifest", "dist"]); // the installed bundle, never the source
    expect(seen.env?.["VF_SMOKE_TRY"]).toBe("acme.card,acme.card.big");
    expect(seen.env?.["VF_SMOKE_SHOT_DIR"]).toBe(shots);
    expect(seen.args).toContain(TRY_SCRIPT);
    expect(existsSync(seen.devRoot ?? "")).toBe(false); // the dev root goes either way
    expect(readFileSync(join(shots, "try.log"), "utf8")).toBe("log");
    expect(verdicts.map((v) => v.level)).toEqual(["pass", "pass", "pass"]);
  });

  it("refuses before it launches anything: no object kind, an unbuilt renderer, no app beside the kit", async () => {
    let launched = 0;
    const runner: TryRunner = async () => {
      launched += 1;
      return { code: 0, output: "" };
    };
    const none = builtPlugin([]);
    expect((await tryPlugin({ ...none, repoRoot: app(), runner })).map((v) => v.code)).toEqual([
      "try-no-objects",
    ]);
    const unbuilt = builtPlugin();
    rmSync(join(unbuilt.root, "dist"), { recursive: true });
    expect((await tryPlugin({ ...unbuilt, repoRoot: app(), runner })).map((v) => v.code)).toEqual([
      "try-unbuilt",
    ]);
    expect(
      (await tryPlugin({ ...builtPlugin(), repoRoot: temp("dk-10-no-app-"), runner })).map(
        (v) => v.code,
      ),
    ).toEqual(["try-app-missing"]);
    expect(launched).toBe(0);
  });
});
