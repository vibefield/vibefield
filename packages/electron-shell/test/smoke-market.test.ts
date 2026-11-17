// MK-6 — smoke:market's pure half (testing/smoke-market.ts): the run's fixture as the stager hands
// it (`VF_MARKET_FIXTURE`), the rows a run runs, and each judge the rows hold the popup and
// fieldd's doors to. The rows themselves are held in the product: `pnpm smoke:market`, five
// launches over a plugin list of the run's own (desk-gates row 37).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  expectedCatalogState,
  judgeAbsent,
  judgeInsideWords,
  judgeListedRow,
  judgePictures,
  judgeRead,
  judgeRefused,
  judgeShelf,
  MARKET_FIXTURE_ENV,
  MARKET_PICTURE,
  MARKET_ROWS,
  MARKET_ROWS_ENV,
  MARKET_RUNS,
  type MarketFixture,
  type MarketRun,
  marketFixture,
  marketRows,
  marketRowsLine,
  NO_LIST_WORDS,
  READY_FOOT,
  refusalOf,
} from "../src/testing/smoke-market";

const CLOCK = "vibefield.example.desk-clock";
const DIAL = "acme.desk-dial";

function fixture(run: MarketRun): MarketFixture {
  return {
    run,
    list: "file:///tmp/vf-market-fixture-x/listed/index.json",
    vibefield: {
      id: CLOCK,
      title: "Desk clock",
      version: "0.1.0",
      objects: [{ type: CLOCK, label: "Clock", category: "things" }],
    },
    community: {
      id: DIAL,
      title: "Desk dial",
      version: "1.0.0",
      objects: [{ type: DIAL, label: "Dial", category: "things" }],
    },
    featured: [CLOCK],
    next:
      run === "update"
        ? {
            version: "0.2.0",
            asks: ["canvas.write"],
            index: "/tmp/vf-market-fixture-x/update/next/index.json",
            signature: "/tmp/vf-market-fixture-x/update/next/index.json.sig",
            into: "/tmp/vf-market-fixture-x/update/index.json",
            intoSignature: "/tmp/vf-market-fixture-x/update/index.json.sig",
          }
        : null,
  };
}

const release = {
  version: "0.1.0",
  artifactUrl: "artifacts/x.vfplugin",
  sha256: `sha256:${"a".repeat(64)}`,
  minApp: ">=0.0.0",
  minContracts: "^0.1.0",
  publishedAt: 1,
};

function catalog(over: Partial<PluginsCatalog> = {}): PluginsCatalog {
  return {
    state: "ready",
    checkedAt: 1_700_000_000_000,
    plugins: [
      { id: CLOCK, listedAs: "vibefield", latest: release, compatible: true },
      { id: DIAL, listedAs: "community", latest: release, compatible: true },
    ],
    featured: [CLOCK],
    updates: 0,
    ...over,
  } as PluginsCatalog;
}

const seen = (foot: string, body = "", tab = "Discover") => ({
  tab,
  count: null,
  foot,
  body,
  all: `${body} ${foot}`,
});

type Row = PluginRegistrySnapshot["plugins"][number];
const row = (id: string, over: Partial<Row> = {}): Row =>
  ({
    id,
    version: "0.1.0",
    title: id,
    source: "registry",
    state: "enabled",
    enabled: true,
    ...over,
  }) as Row;
const snapshot = (plugins: Row[]): PluginRegistrySnapshot => ({
  generation: 1,
  plugins,
  problems: [],
});

/** a refusal as the window's fieldd client raises one (fieldd-client's FielddRpcError's fields) */
function raised(kind: string, details: Record<string, unknown>): Error {
  return Object.assign(new Error("registry unreachable: ENOENT /tmp/x/index.json"), {
    kind,
    details,
  });
}

describe("the fixture the stager hands the run", () => {
  it("is read whole, or the run says why it has none", () => {
    expect(marketFixture({})).toEqual({ problem: expect.stringContaining(MARKET_FIXTURE_ENV) });
    expect(marketFixture({ [MARKET_FIXTURE_ENV]: "{" })).toEqual({
      problem: `${MARKET_FIXTURE_ENV} is not JSON`,
    });
    expect(marketFixture({ [MARKET_FIXTURE_ENV]: "null" })).toHaveProperty("problem");
    const bad = (over: Record<string, unknown>) =>
      marketFixture({ [MARKET_FIXTURE_ENV]: JSON.stringify({ ...fixture("listed"), ...over }) });
    expect(bad({ run: "melted" })).toHaveProperty("problem");
    expect(bad({ list: 7 })).toHaveProperty("problem");
    expect(bad({ vibefield: { ...fixture("listed").vibefield, objects: [] } })).toHaveProperty(
      "problem",
    );
    expect(bad({ featured: [1] })).toHaveProperty("problem");
    for (const run of MARKET_RUNS) {
      expect(marketFixture({ [MARKET_FIXTURE_ENV]: JSON.stringify(fixture(run)) })).toEqual({
        fixture: fixture(run),
      });
    }
  });

  it("holds an update run to its second list, and every other run to none", () => {
    const update = fixture("update");
    expect(
      marketFixture({ [MARKET_FIXTURE_ENV]: JSON.stringify({ ...update, next: null }) }),
    ).toHaveProperty("problem");
    expect(
      marketFixture({
        [MARKET_FIXTURE_ENV]: JSON.stringify({ ...fixture("listed"), next: update.next }),
      }),
    ).toHaveProperty("problem");
  });
});

describe("the rows a run runs", () => {
  it("are the run's own, the rows on the lane's code first in each run", () => {
    expect(marketRows("forged", {}).rows).toEqual(MARKET_ROWS.forged);
    for (const run of MARKET_RUNS) {
      const rows = MARKET_ROWS[run];
      const firstWaiting = rows.findIndex((r) => r.needs !== null);
      const after = firstWaiting < 0 ? [] : rows.slice(firstWaiting);
      expect(
        after.every((r) => r.needs !== null),
        run,
      ).toBe(true);
    }
    expect(MARKET_ROWS.forged.every((r) => r.needs === null)).toBe(true);
    expect(MARKET_ROWS.offline.every((r) => r.needs === null)).toBe(true);
  });

  it("narrow to the names VF_MARKET_ROWS gives, and say a name no run has", () => {
    const narrowed = marketRows("listed", { [MARKET_ROWS_ENV]: " READ,DOOR ,NOPE" });
    expect(narrowed.rows.map((r) => r.name)).toEqual(["READ", "DOOR"]);
    expect(narrowed.unknown).toEqual(["NOPE"]);
    // a narrowed run still says the parked row it leaves out (C36)
    expect(narrowed.parked.map((r) => r.name)).toEqual(["PICTURES"]);
    // one list for every run: a run runs those of its own it names, and another run's are no error
    expect(marketRows("update", { [MARKET_ROWS_ENV]: "READ,COUNT" })).toEqual({
      rows: [{ name: "COUNT", needs: null }],
      parked: [],
      unknown: [],
    });
  });

  it("park PICTURES alone, run CARRY after RISE, and run a parked row VF_MARKET_ROWS names (C36; item 433)", () => {
    const listed = marketRows("listed", {});
    // CARRY by default since Discover draws its categories (item 433), after INSTALL and RISE:
    // the clock's category hangs on the board while the clock is installed, until REMOVE
    expect(listed.rows.map((r) => r.name)).toEqual([
      "READ",
      "COMMUNITY-CLOSED",
      "DOOR",
      "SHELF",
      "INSTALL",
      "RISE",
      "CARRY",
      "REMOVE",
      "COMMUNITY",
    ]);
    expect(listed.parked.map((r) => r.name)).toEqual(["PICTURES"]);
    expect(MARKET_ROWS.listed.find((r) => r.name === "CARRY")?.parked).toBeUndefined();
    // each parked row waits on a part, and says why it is parked
    for (const row of listed.parked) {
      expect(row.needs, row.name).not.toBeNull();
      expect(row.parked, row.name).toMatch(/^waits on .+; no slice of MK's order builds it$/u);
    }
    // no other run parks a row
    for (const run of MARKET_RUNS.filter((r) => r !== "listed")) {
      expect(marketRows(run, {}), run).toEqual({
        rows: MARKET_ROWS[run],
        parked: [],
        unknown: [],
      });
    }
    // named, the parked row runs and is no longer said as parked; naming another leaves it said
    const named = marketRows("listed", { [MARKET_ROWS_ENV]: "PICTURES" });
    expect(named.rows.map((r) => r.name)).toEqual(["PICTURES"]);
    expect(named.parked).toEqual([]);
    expect(named.unknown).toEqual([]);
    const carry = marketRows("listed", { [MARKET_ROWS_ENV]: "CARRY" });
    expect(carry.rows.map((r) => r.name)).toEqual(["CARRY"]);
    expect(carry.parked.map((r) => r.name)).toEqual(["PICTURES"]);
  });

  it("say each parked row with its reason on the run's SMOKE_MARKET_ROWS line (C36)", () => {
    const said = (run: MarketRun, env: NodeJS.ProcessEnv = {}) => {
      const line = marketRowsLine(run, marketRows(run, env));
      expect(line.startsWith("SMOKE_MARKET_ROWS {")).toBe(true);
      return JSON.parse(line.slice("SMOKE_MARKET_ROWS ".length)) as {
        run: string;
        rows: string[];
        parked: Record<string, string>;
      };
    };
    const listed = said("listed");
    expect(listed.run).toBe("listed");
    expect(listed.rows).toEqual(marketRows("listed", {}).rows.map((r) => r.name));
    expect(Object.keys(listed.parked)).toEqual(["PICTURES"]);
    for (const [name, why] of Object.entries(listed.parked))
      expect(why, name).toBe(MARKET_ROWS.listed.find((r) => r.name === name)?.parked);
    expect(said("listed", { [MARKET_ROWS_ENV]: "CARRY,PICTURES" }).parked).toEqual({});
    expect(said("forged").parked).toEqual({});
  });
});

describe("READ — the read on open", () => {
  it("wants ready on listed, tampered and update; refused when forged; unreachable offline", () => {
    expect(MARKET_RUNS.map(expectedCatalogState)).toEqual([
      "ready",
      "ready",
      "refused",
      "unreachable",
      "ready",
    ]);
  });

  it("passes a ready list with both entries as listed, the pick and the foot's time", () => {
    const foot = "2 plugins, 2 objects · checked 14:02";
    expect(judgeRead(fixture("listed"), catalog(), seen(foot))).toEqual([]);
    expect(READY_FOOT.test("1 plugin, 1 object · checked Nov 6, 14:02")).toBe(true);
    expect(READY_FOOT.test("2 plugins, 2 objects · checked 14:02 · community off")).toBe(true);
    expect(READY_FOOT.test("Reading the plugin list… · showing the list from 14:02")).toBe(false);
  });

  it("names a community entry read as VibeField's, a missing pick, a foot with no time", () => {
    const flipped = catalog({
      plugins: [
        { id: CLOCK, listedAs: "vibefield", latest: release, compatible: true },
        { id: DIAL, listedAs: "vibefield", latest: release, compatible: true },
      ] as PluginsCatalog["plugins"],
      featured: [],
    });
    expect(judgeRead(fixture("listed"), flipped, seen("2 plugins, 2 objects"))).toEqual([
      `${DIAL} is listed as vibefield, not community`,
      `the pick is [], not ["${CLOCK}"]`,
      'the foot says "2 plugins, 2 objects", not "N plugins, N objects · checked HH:MM"',
    ]);
  });

  it("holds a forged and an offline run to the words for no list, in the foot and on Discover", () => {
    const refused = catalog({ state: "refused", checkedAt: null, plugins: [] });
    const words = NO_LIST_WORDS.refused;
    expect(judgeRead(fixture("forged"), refused, seen(words, words))).toEqual([]);
    const offline = catalog({ state: "unreachable", checkedAt: null, plugins: [] });
    expect(judgeRead(fixture("offline"), offline, seen(words, NO_LIST_WORDS.unreachable))).toEqual([
      `the foot says "${words}", not "${NO_LIST_WORDS.unreachable}"`,
    ]);
    expect(judgeRead(fixture("forged"), catalog(), seen(words, words))).toEqual([
      "fieldd's list is ready, not refused",
      "a list is held from a run that read none",
    ]);
  });

  it("names the tab it opened on", () => {
    const foot = "2 plugins, 2 objects · checked 14:02";
    expect(judgeRead(fixture("listed"), catalog(), seen(foot, "", "Installed"))).toEqual([
      "the popup opened on Installed, not Discover",
    ]);
    expect(judgeRead(fixture("update"), catalog(), seen(foot, "", "Updates"), "Updates")).toEqual(
      [],
    );
  });
});

describe("WORDS — no inside of VibeField's on screen", () => {
  it("passes the popup's own words", () => {
    const words =
      "Discover Installed Updates Nothing to discover yet The plugins that come with VibeField are in Installed. Show installed ↵ Offline · no plugin list yet Keyboard";
    expect(judgeInsideWords(words, [CLOCK])).toEqual([]);
  });

  it("names an inside word, an address and an id, each once with what stood around it", () => {
    const problems = judgeInsideWords(
      `The registry's signature didn't verify · ${CLOCK} from https://example.test/x`,
      [CLOCK],
    );
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^the popup says "signature"/u);
    expect(problems[1]).toMatch(/^the popup says "registry"/u);
    expect(problems[2]).toMatch(/^the popup shows an address/u);
    expect(problems[3]?.startsWith(`the popup shows ${CLOCK} (`)).toBe(true);
  });
});

describe("the doors' refusals", () => {
  it("reads a refusal's kind and its data, nested or not", () => {
    expect(
      refusalOf(raised("PRECONDITION_FAILED", { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" })),
    ).toEqual({
      kind: "PRECONDITION_FAILED",
      pluginKind: "PLUGIN_ARTIFACT_MISMATCH",
      reasonCode: null,
    });
    expect(
      refusalOf(
        raised("PRECONDITION_FAILED", { details: { reasonCode: "COMMUNITY_SWITCH_CLOSED" } }),
      )?.reasonCode,
    ).toBe("COMMUNITY_SWITCH_CLOSED");
    expect(refusalOf("no")).toBeNull();
  });

  it("names an answer where a refusal was owed, and a refusal of the wrong kind, never its message", () => {
    expect(judgeRefused("DOOR", null, { kind: "UNAVAILABLE" })).toEqual([
      "DOOR: answered, not refused",
    ]);
    const problems = judgeRefused(
      "DOOR",
      raised("UNAVAILABLE", { pluginKind: "PLUGIN_SOURCE_UNAVAILABLE" }),
      { kind: "PRECONDITION_FAILED", pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
    );
    expect(problems).toEqual([
      "DOOR: refused with kind UNAVAILABLE, not PRECONDITION_FAILED",
      "DOOR: refused with pluginKind PLUGIN_SOURCE_UNAVAILABLE, not PLUGIN_ARTIFACT_MISMATCH",
    ]);
    expect(problems.join(" ")).not.toContain("/tmp/x");
    expect(
      judgeRefused(
        "COMMUNITY-CLOSED",
        raised("PRECONDITION_FAILED", {
          pluginKind: "PLUGIN_CAPABILITY_DENIED",
          reasonCode: "COMMUNITY_SWITCH_CLOSED",
        }),
        {
          kind: "PRECONDITION_FAILED",
          pluginKind: "PLUGIN_CAPABILITY_DENIED",
          reasonCode: "COMMUNITY_SWITCH_CLOSED",
        },
      ),
    ).toEqual([]);
  });
});

describe("fieldd's rows", () => {
  it("holds an installed plugin to its row: from the list, on, at its version", () => {
    expect(judgeListedRow(snapshot([row(CLOCK)]), CLOCK, "0.1.0")).toEqual([]);
    expect(judgeListedRow(snapshot([]), CLOCK, "0.1.0")).toEqual([`${CLOCK}: no row`]);
    expect(
      judgeListedRow(
        snapshot([row(CLOCK, { source: "dev-linked", state: "disabled", enabled: false })]),
        CLOCK,
        "0.2.0",
      ),
    ).toEqual([
      `${CLOCK}: its row is dev-linked, not registry`,
      `${CLOCK}: disabled, not enabled`,
      `${CLOCK}: at 0.1.0, not 0.2.0`,
    ]);
  });

  it("holds a refused install to no row at all", () => {
    expect(judgeAbsent(snapshot([row(DIAL)]), CLOCK)).toEqual([]);
    expect(judgeAbsent(snapshot([row(CLOCK)]), CLOCK)).toEqual([
      `${CLOCK}: a row stands, installed`,
    ]);
  });
});

describe("PICTURES — through the app's own scheme, the theme's own", () => {
  const day = MARKET_PICTURE.spread.day;
  const night = MARKET_PICTURE.still.night;

  it("passes the day's pictures by day and the night's by night", () => {
    const src = "vibefield-plugin://listing/abc";
    expect(judgePictures([{ src, ...day, complete: true }], "light")).toEqual([]);
    expect(judgePictures([{ src, ...night, complete: true }], "dark")).toEqual([]);
  });

  it("names no picture, a remote or file picture, one unloaded, and the other theme's", () => {
    expect(judgePictures([], "light")).toEqual(["the popup showed no picture"]);
    expect(
      judgePictures([{ src: "https://example.test/a.png", ...day, complete: true }], "light"),
    ).toEqual(["a picture came from https:"]);
    expect(
      judgePictures([{ src: "file:///tmp/a.png", w: 0, h: 0, complete: false }], "light"),
    ).toEqual(["a picture came from file:", "a picture did not load"]);
    expect(
      judgePictures([{ src: "vibefield-plugin://x", ...day, complete: true }], "dark"),
    ).toHaveLength(1);
  });
});

describe("SHELF — the pick first, the community tile last", () => {
  it("passes the pick first and the community tile at the end, no community set while off", () => {
    const shelf = { sets: [CLOCK], communityTile: 1, tiles: 2 };
    expect(judgeShelf(fixture("listed"), shelf, false)).toEqual([]);
    const on = { sets: [CLOCK, DIAL], communityTile: 2, tiles: 3 };
    expect(judgeShelf(fixture("listed"), on, true)).toEqual([]);
  });

  it("names a community set while off, one before VibeField's, the tile out of place", () => {
    expect(
      judgeShelf(fixture("listed"), { sets: [CLOCK, DIAL], communityTile: 0, tiles: 3 }, false),
    ).toEqual([
      `${DIAL} is on the shelf while community plugins are off`,
      '"Community plugins" stands at 0 of 3, not at the end',
    ]);
    expect(
      judgeShelf(fixture("listed"), { sets: [DIAL, CLOCK], communityTile: 2, tiles: 3 }, true),
    ).toEqual([
      `the shelf opens on ${DIAL}, not the pick ${CLOCK}`,
      "a community set stands before VibeField's",
    ]);
  });
});

// Held in the source, as ES-6's row is (smoke-chat-night.test.ts): the script at both package
// roots, its place in the landing gate, and its row in desk-gates.
describe("smoke:market's row", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const read = (path: string): string => readFileSync(join(root, path), "utf8");

  it("names the script at both package roots, the desktop's staging the list first", () => {
    const desktop = JSON.parse(read("apps/desktop/package.json")) as {
      scripts: Record<string, string>;
    };
    const rootPackage = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(desktop.scripts["smoke:market"]).toMatch(
      /node packaging\/stage-market-fixture\.mjs -- node packaging\/run-smoke\.mjs --smoke-canvas --market$/u,
    );
    expect(rootPackage.scripts["smoke:market"]).toBe(
      "pnpm --filter @vibefield/desktop smoke:market",
    );
  });

  it("runs at the landing, after smoke:bundled", () => {
    const gate = read("scripts/gate-landing.mjs");
    const bundled = gate.indexOf('name: "smoke:bundled"');
    const market = gate.indexOf('name: "smoke:market"');
    expect(bundled).toBeGreaterThan(0);
    expect(market).toBeGreaterThan(bundled);
  });

  it("prints its rows line after the name check, before the GPU's and the desk's reds", () => {
    // a run red before its desk is revealed still says its parked rows (VF-PM, 2026-11-14 07:31Z)
    const smoke = read("packages/electron-shell/src/testing/smoke.ts");
    const call = "console.log(marketRowsLine(";
    const from = smoke.indexOf("const picked = marketRows(");
    const at = (text: string): number => smoke.indexOf(text, from);
    expect(from).toBeGreaterThan(0);
    expect(smoke.split(call)).toHaveLength(2);
    expect(at("no market row is named")).toBeGreaterThan(from);
    expect(at(call)).toBeGreaterThan(at("no market row is named"));
    expect(at(call)).toBeLessThan(at("the market's rows need the GPU"));
    expect(at(call)).toBeLessThan(at("the market's desk revealed"));
  });

  it("has its row in desk-gates, and its doors", () => {
    const gates = read("docs/desk-gates.md");
    expect(gates).toMatch(/\| 37 \| smoke:market \| `pnpm smoke:market`/u);
    expect(gates).toContain(`| \`${MARKET_FIXTURE_ENV}\` |`);
    expect(gates).toContain(`| \`${MARKET_ROWS_ENV}\` |`);
  });

  it("says in row 37 that each parked row is parked, by name, and CARRY runs (C36; item 433)", () => {
    const lines = read("docs/desk-gates.md").split("\n");
    const row37 = lines.find((line) => line.startsWith("| 37 | smoke:market |")) ?? "";
    expect(row37).toContain("**One row is parked**");
    const parked = MARKET_RUNS.flatMap((run) => marketRows(run, {}).parked.map((r) => r.name));
    expect(parked).toEqual(["PICTURES"]);
    for (const name of parked) expect(row37).toContain(`**${name}** — item `);
    expect(row37).not.toContain("**CARRY**, parked");
    // the doors' table says the same of an unset VF_MARKET_ROWS
    const door = lines.find((line) => line.startsWith(`| \`${MARKET_ROWS_ENV}\` |`)) ?? "";
    expect(door).toContain("unset, every row but the parked (PICTURES, row 37)");
    // and where they are said: each run's rows line, and the stager's last line, which the
    // landing gate's verdict quotes
    expect(row37).toContain("`SMOKE_MARKET_ROWS {run, rows, parked}`");
    expect(row37).toContain("`MARKET_FIXTURE_DONE {runs, parked}`");
  });
});
