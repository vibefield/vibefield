// WP8d (build-wp8-bundled-plugins.md W7) — smoke:bundled's pure half (testing/smoke-bundled.ts): the run's fixture as the
// stager hands it (`VF_BUNDLED_FIXTURE`), and each run judged from the renderer's staged count and fieldd's list. The
// rows themselves are held in the product: `pnpm smoke:bundled`, three launches on one staged root.
import { BUNDLED_PLUGIN_INDEX_FILE, type PluginRegistrySnapshot } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_FIXTURE_ENV,
  BUNDLED_REFUSAL_KIND,
  type BundledFixture,
  bundledFixture,
  judgeBundled,
} from "../src/testing/smoke-bundled";

const BROWSER = "vibefield.browser";
const PAD = "vibefield.comment-pad";
const ROOT = "/tmp/vf-bundled-fixture-x/loads/plugins/bundled";
const HASH = (c: string) => `sha256:${c.repeat(64)}`;

function fixture(run: BundledFixture["run"]): BundledFixture {
  return {
    run,
    root: ROOT,
    plugins: [BROWSER, PAD],
    renderers: [BROWSER, PAD],
    corrupted: run === "loads" ? null : { id: BROWSER, path: "dist/renderer.js" },
  };
}

type Row = PluginRegistrySnapshot["plugins"][number];

function verified(id: string, hash: string): Row {
  return {
    id,
    version: "0.1.0",
    title: id,
    source: "bundled",
    manifestHash: HASH("a"),
    installRevision: hash.slice("sha256:".length),
    registry: { indexRef: BUNDLED_PLUGIN_INDEX_FILE, artifactSha256: hash, publisher: "vibefield" },
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 0,
    contributions: { objects: [], behaviors: [], commands: [], surfaces: [], capabilities: [] },
    renderer: "inactive",
    service: "none",
  } as Row;
}

function refused(id: string, message: string): Row {
  const { registry: _registry, ...row } = verified(id, HASH("b"));
  return {
    ...row,
    state: "invalid",
    enabled: false,
    renderer: "none",
    lastError: { kind: BUNDLED_REFUSAL_KIND, message },
  } as Row;
}

const snapshot = (
  plugins: Row[],
  problems: PluginRegistrySnapshot["problems"] = [],
): PluginRegistrySnapshot => ({ generation: 1, plugins, problems });

describe("the fixture the stager hands the run", () => {
  it("is read whole, or the run says why it has none", () => {
    expect(bundledFixture({})).toEqual({ problem: expect.stringContaining(BUNDLED_FIXTURE_ENV) });
    expect(bundledFixture({ [BUNDLED_FIXTURE_ENV]: "{" })).toEqual({
      problem: `${BUNDLED_FIXTURE_ENV} is not JSON`,
    });
    expect(bundledFixture({ [BUNDLED_FIXTURE_ENV]: "null" })).toHaveProperty("problem");
    expect(
      bundledFixture({
        [BUNDLED_FIXTURE_ENV]: JSON.stringify({ ...fixture("loads"), run: "melted" }),
      }),
    ).toHaveProperty("problem");
    expect(
      bundledFixture({
        [BUNDLED_FIXTURE_ENV]: JSON.stringify({ ...fixture("loads"), plugins: [] }),
      }),
    ).toHaveProperty("problem");
    // a corrupt run that names no corrupted file — or a loads run that names one — is a stager's mistake, said
    expect(
      bundledFixture({
        [BUNDLED_FIXTURE_ENV]: JSON.stringify({ ...fixture("corrupt"), corrupted: null }),
      }),
    ).toHaveProperty("problem");
    for (const run of ["loads", "corrupt", "forged"] as const) {
      expect(bundledFixture({ [BUNDLED_FIXTURE_ENV]: JSON.stringify(fixture(run)) })).toEqual({
        fixture: fixture(run),
      });
    }
  });
});

describe("loads — the root as staged", () => {
  const rows = [verified(BROWSER, HASH("1")), verified(PAD, HASH("2"))];

  it("passes with every row enabled under its provenance and every renderer staged", () => {
    const judged = judgeBundled(fixture("loads"), 2, snapshot(rows));
    expect(judged.problems).toEqual([]);
    expect(judged.facts).toMatchObject({ run: "loads", stagedPlugins: 2, rootProblems: [] });
  });

  it("names a renderer that did not come through the staged path", () => {
    expect(judgeBundled(fixture("loads"), 1, snapshot(rows)).problems).toEqual([
      `1 plugin(s) came through the staged path, not 2 (${BROWSER}, ${PAD})`,
    ]);
  });

  it("names a row without its provenance, a disabled row, a missing row", () => {
    const { registry: _r, ...bare } = verified(PAD, HASH("2"));
    expect(
      judgeBundled(fixture("loads"), 2, snapshot([rows[0] as Row, bare as Row])).problems,
    ).toEqual([`${PAD}: no provenance block`]);
    const disabled = { ...verified(PAD, HASH("2")), state: "disabled", enabled: false } as Row;
    expect(
      judgeBundled(fixture("loads"), 2, snapshot([rows[0] as Row, disabled])).problems,
    ).toEqual([`${PAD}: disabled, not enabled`]);
    expect(judgeBundled(fixture("loads"), 2, snapshot([rows[0] as Row])).problems).toContain(
      `${PAD}: no row`,
    );
  });

  it("names an installRevision that is not the artifact hash", () => {
    const moved = { ...verified(PAD, HASH("2")), installRevision: "f".repeat(64) } as Row;
    expect(judgeBundled(fixture("loads"), 2, snapshot([rows[0] as Row, moved])).problems).toEqual([
      `${PAD}: installRevision ${"f".repeat(64)} is not the artifact hash ${HASH("2")}`,
    ]);
  });

  it("refuses a run whose fieldd also walked another root: its counts would prove nothing", () => {
    const dev = {
      ...verified("vibefield.example.desk-clock", HASH("3")),
      source: "dev-linked",
    } as Row;
    expect(judgeBundled(fixture("loads"), 3, snapshot([...rows, dev])).problems).toEqual([
      "rows from outside the staged root (dev-linked:vibefield.example.desk-clock) — the run's environment did not key fieldd to it alone",
      `3 plugin(s) came through the staged path, not 2 (${BROWSER}, ${PAD})`,
    ]);
  });

  it("names a root problem where the index verifies", () => {
    const problem = {
      root: "bundled",
      error: { kind: BUNDLED_REFUSAL_KIND, message: "x" },
    } as const;
    expect(judgeBundled(fixture("loads"), 2, snapshot(rows, [problem])).problems).toEqual([
      "root problem(s) where the index verifies: bundled: x",
    ]);
  });
});

describe("corrupt — one byte of one renderer flipped", () => {
  const said = "dist/renderer.js does not match the bundled index";

  it("passes with that row refused on its row, naming the file, and the other enabled and staged", () => {
    const judged = judgeBundled(
      fixture("corrupt"),
      1,
      snapshot([refused(BROWSER, said), verified(PAD, HASH("2"))]),
    );
    expect(judged.problems).toEqual([]);
    expect(judged.facts).toMatchObject({ corrupted: { id: BROWSER, path: "dist/renderer.js" } });
  });

  it("names a corrupted row that loaded, or was dropped instead of refused", () => {
    expect(
      judgeBundled(
        fixture("corrupt"),
        2,
        snapshot([verified(BROWSER, HASH("1")), verified(PAD, HASH("2"))]),
      ).problems,
    ).toEqual([
      `${BROWSER}: enabled with dist/renderer.js corrupted, not invalid`,
      `${BROWSER}: refused as nothing, not ${BUNDLED_REFUSAL_KIND}`,
      `${BROWSER}: the refusal does not name dist/renderer.js: ""`,
      `2 plugin(s) came through the staged path, not 1 (${PAD})`,
    ]);
    expect(
      judgeBundled(fixture("corrupt"), 1, snapshot([verified(PAD, HASH("2"))])).problems,
    ).toEqual([`${BROWSER}: no row — a corrupted copy is refused ON ITS ROW, never dropped`]);
  });

  it("names a refusal that does not say which file", () => {
    expect(
      judgeBundled(
        fixture("corrupt"),
        1,
        snapshot([refused(BROWSER, "something is wrong"), verified(PAD, HASH("2"))]),
      ).problems,
    ).toEqual([`${BROWSER}: the refusal does not name dist/renderer.js: "something is wrong"`]);
  });
});

describe("forged — the index re-signed by a stranger", () => {
  const forgedRoot = "/tmp/vf-bundled-fixture-x/forged/plugins/bundled";
  const forged = { ...fixture("forged"), root: forgedRoot };
  const problem = {
    root: "bundled",
    error: {
      kind: BUNDLED_REFUSAL_KIND,
      message: "the bundled index's signature does not verify against the app's bundled key",
    },
  } as const;

  it("passes with not one bundled row, one root problem naming the signature, nothing staged", () => {
    const judged = judgeBundled(forged, 0, snapshot([], [problem]));
    expect(judged.problems).toEqual([]);
    expect(judged.facts).toMatchObject({ run: "forged", rows: [], rootProblems: [problem] });
  });

  it("names a row from the refused root, a second problem, a problem that is not the signature", () => {
    expect(
      judgeBundled(forged, 1, snapshot([verified(PAD, HASH("2"))], [problem])).problems,
    ).toEqual([
      `1 bundled row(s) from a root whose index a stranger signed: ${PAD}`,
      "1 plugin(s) staged from a refused root, not 0",
    ]);
    expect(judgeBundled(forged, 0, snapshot([], [problem, problem])).problems).toEqual([
      "2 root problem(s), not exactly 1",
    ]);
    const other = {
      ...problem,
      error: { ...problem.error, message: "bundled-plugins.json is missing" },
    };
    expect(judgeBundled(forged, 0, snapshot([], [other])).problems).toEqual([
      'the root problem does not name the signature: "bundled-plugins.json is missing"',
    ]);
  });
});
