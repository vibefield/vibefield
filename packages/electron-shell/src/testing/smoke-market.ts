// MK-6 — THE PLUGINS POPUP OVER A PLUGIN LIST OF THE RUN'S OWN: `pnpm smoke:market` (desk-gates
// row 37; DESIGN.md §8 "Plugins — the frame's second popup", its words §9 "The plugins' words").
//
// `apps/desktop/packaging/stage-market-fixture.mjs` stages a signed plugin list as the registry
// rung will serve one (index v1 with `listing` and `featured`), on file:// and signed by keys it
// mints in memory: the example desk clock listed as VibeField's own (R1), a community dial beside
// it (no rung), their artifacts, and their pictures pinned by their hashes. It launches
// smoke:canvas with `--market` once a run, each keyed to its own copy of the list alone
// (`FIELDD_PLUGIN_REGISTRY_URL` and `_KEY`, fieldd's development seam; `FIELDD_PLUGIN_DEV_ROOTS`
// empty, so the clock comes from the list alone), and tells it by `VF_MARKET_FIXTURE` which run
// it is:
//   listed   — the list as signed;
//   tampered — one byte of the clock's artifact flipped after signing: the list verifies, the
//              download does not;
//   forged   — the same list signed by a stranger's key: nothing of it is used;
//   offline  — the list's address names no file: the read finds nothing;
//   update   — the clock installed at its first version, then the list moved to a second that
//              asks for one power more.
// Each run's rows are MARKET_ROWS, below. A row with no `needs` runs on what the lane has built:
// fieldd's own doors over main's fieldd client, and the popup's states. A row that drives
// the popup's acts names the slice it waits on, and is red until that slice is built, never
// skipped. A row whose part no slice of MK's order builds is PARKED instead (C36, VF-PM
// 2026-11-14 06:56Z: "A gate that is red at every landing teaches people to read past red"): it
// is left out of the run's rows and said, with its reason, on the run's SMOKE_MARKET_ROWS line.
// `VF_MARKET_ROWS` narrows a run to the rows it names, a parked row among them.
// Every popup word a row reads is held to §9's insides: no key, signature, hash, rung, registry,
// manifest, worker, process, restart, reload, repository or daemon, no address and no id (James,
// 2026-11-10 00:46Z: "a user does not care about key or custody … it is either the app runs or
// crashed").
// The rows' judgement is pure and here; the runner is smoke.ts's `--market` branch of
// runSmokeCanvas, which prints a run's `SMOKE_MARKET_ROWS {…}` line (marketRowsLine) before its
// rows and one `SMOKE_MARKET {…}` line after them.

import {
  type PluginRecord,
  type PluginRegistrySnapshot,
  type PluginsCatalog,
  PluginsCatalog as PluginsCatalogSchema,
  PluginsInstallPrepareResult,
  PluginsListResult,
} from "@vibefield/contracts";
import type { BrowserWindow } from "electron";
import {
  BOARD_SETTLED,
  handsOver,
  openInstalledPage,
  type Point,
  riseRows,
  sleep,
  wordsAt,
} from "./smoke-more";

/** The flag the stager passes after `--smoke-canvas`: the market's rows, not the canvas's. */
export const MARKET_FLAG = "--market";

/** The run's fixture, JSON (the stager's). */
export const MARKET_FIXTURE_ENV = "VF_MARKET_FIXTURE";

/** A part of a run's rows, by name, comma-separated, a parked row among them; unset, every row
 * of the run but the parked. */
export const MARKET_ROWS_ENV = "VF_MARKET_ROWS";

export const MARKET_RUNS = ["listed", "tampered", "forged", "offline", "update"] as const;
export type MarketRun = (typeof MARKET_RUNS)[number];

/** The pictures the stager draws, by their sizes: a day picture and a night one differ by a pixel
 * of width, so a row knows which the theme picked by its natural size alone. */
export const MARKET_PICTURE = {
  spread: { day: { w: 96, h: 60 }, night: { w: 97, h: 60 } },
  still: { day: { w: 48, h: 48 }, night: { w: 49, h: 48 } },
} as const;

/** One row of a run: its name, the slice whose acts it drives (null: the lane's), and, while it
 * is parked, why (C36): out of the run's rows unless `VF_MARKET_ROWS` names it. */
export interface MarketRow {
  readonly name: string;
  readonly needs: string | null;
  readonly parked?: string;
}

// C36's (2026-11-14): a row that waits on a part no slice of MK's order builds.
// Desk-gates row 37 says it, with the item and the owner it was given. CARRY was the other, until
// item 433 drew Discover's categories (2026-11-17): it runs by default now, after RISE, while the
// clock INSTALL took hangs its category on the board.
const PARKED_PICTURES =
  "waits on MK-E9's window half, behind ob/ui's custody fix; no slice of MK's order builds it";

const ACTS = "the Discover shelf, its tiles and a page's Install and Remove… (MK-4, mk-acts)";
export const MARKET_ROWS: Readonly<Record<MarketRun, readonly MarketRow[]>> = {
  listed: [
    { name: "READ", needs: null },
    { name: "COMMUNITY-CLOSED", needs: null },
    { name: "DOOR", needs: null },
    { name: "SHELF", needs: ACTS },
    {
      name: "PICTURES",
      needs: "the pictures through main's plugin scheme (MK-E9's window half)",
      parked: PARKED_PICTURES,
    },
    { name: "INSTALL", needs: `${ACTS}, the install card and its progress` },
    { name: "RISE", needs: "Show on the pegboard, MK-D8's fallback B (MK-4d)" },
    // after INSTALL and RISE: the clock's category hangs on the board only while the clock is
    // installed (the stager hands no development plugin), and REMOVE takes it away
    {
      name: "CARRY",
      needs: "More in Plugins… (MK-4d), Discover's categories (item 433), the clock INSTALL took",
    },
    { name: "REMOVE", needs: ACTS },
    { name: "COMMUNITY", needs: "the community tile and its switch (O3-D, mk-o3d)" },
  ],
  tampered: [
    { name: "READ", needs: null },
    { name: "DOOR", needs: null },
    { name: "FAILED", needs: ACTS },
  ],
  forged: [
    { name: "READ", needs: null },
    { name: "DOOR", needs: null },
  ],
  offline: [
    { name: "READ", needs: null },
    { name: "DOOR", needs: null },
  ],
  update: [
    { name: "SETUP", needs: null },
    { name: "COUNT", needs: null },
    { name: "UPDATE", needs: "the Updates rows and the update card (mk-uc, mk-acts)" },
  ],
};

export interface MarketObject {
  readonly type: string;
  /** its pegboard label (`tray.label`) */
  readonly label: string;
  /** the pegboard category it hangs under (`tray.category`) */
  readonly category: string;
}

export interface MarketPlugin {
  readonly id: string;
  /** its title as its manifest writes it */
  readonly title: string;
  readonly version: string;
  readonly objects: readonly MarketObject[];
}

/** The update run's second list: the version it moves the clock to, the powers it asks for more,
 * and the files the row copies over the list fieldd reads. */
export interface MarketNext {
  readonly version: string;
  readonly asks: readonly string[];
  readonly index: string;
  readonly signature: string;
  readonly into: string;
  readonly intoSignature: string;
}

export interface MarketFixture {
  readonly run: MarketRun;
  /** the address fieldd was handed */
  readonly list: string;
  /** the desk clock, listed as VibeField's own */
  readonly vibefield: MarketPlugin;
  /** the dial, listed with no rung: a community plugin */
  readonly community: MarketPlugin;
  readonly featured: readonly string[];
  readonly next: MarketNext | null;
}

const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

function pluginOf(v: unknown): MarketPlugin | null {
  const p = v as Partial<MarketPlugin> | null;
  if (p === null || typeof p !== "object") return null;
  if (typeof p.id !== "string" || typeof p.title !== "string" || typeof p.version !== "string")
    return null;
  if (!Array.isArray(p.objects) || p.objects.length === 0) return null;
  const objects = p.objects.filter(
    (o): o is MarketObject =>
      typeof o?.type === "string" && typeof o.label === "string" && typeof o.category === "string",
  );
  if (objects.length !== p.objects.length) return null;
  return { id: p.id, title: p.title, version: p.version, objects };
}

/** The update's second list; null when there is none; undefined when it does not parse. */
function nextOf(v: unknown): MarketNext | null | undefined {
  if (v === null || v === undefined) return null;
  const n = v as Partial<MarketNext>;
  if (
    typeof n.version !== "string" ||
    !strings(n.asks) ||
    typeof n.index !== "string" ||
    typeof n.signature !== "string" ||
    typeof n.into !== "string" ||
    typeof n.intoSignature !== "string"
  )
    return undefined;
  return {
    version: n.version,
    asks: n.asks,
    index: n.index,
    signature: n.signature,
    into: n.into,
    intoSignature: n.intoSignature,
  };
}

/** The run's fixture from the environment, or why there is none: never a guess. */
export function marketFixture(
  env: NodeJS.ProcessEnv,
): { fixture: MarketFixture } | { problem: string } {
  const raw = env[MARKET_FIXTURE_ENV];
  if (raw === undefined || raw.length === 0)
    return {
      problem: `${MARKET_FLAG} without ${MARKET_FIXTURE_ENV} (packaging/stage-market-fixture.mjs stages the list)`,
    };
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown> | null;
  } catch {
    return { problem: `${MARKET_FIXTURE_ENV} is not JSON` };
  }
  const bad = { problem: `${MARKET_FIXTURE_ENV} is not a market fixture` };
  if (parsed === null || typeof parsed !== "object") return bad;
  const run = parsed["run"] as MarketRun;
  const list = parsed["list"];
  const featured = parsed["featured"];
  const vibefield = pluginOf(parsed["vibefield"]);
  const community = pluginOf(parsed["community"]);
  const next = nextOf(parsed["next"]);
  if (
    !MARKET_RUNS.includes(run) ||
    typeof list !== "string" ||
    vibefield === null ||
    community === null ||
    !strings(featured) ||
    next === undefined
  )
    return bad;
  if ((run === "update") !== (next !== null))
    return { problem: `${MARKET_FIXTURE_ENV}: a ${run} run with next=${JSON.stringify(next)}` };
  return { fixture: { run, list, vibefield, community, featured, next } };
}

/** The rows a run runs, the parked rows of its own it leaves out, and the names no run has. */
export interface MarketRowsPicked {
  readonly rows: readonly MarketRow[];
  readonly parked: readonly MarketRow[];
  readonly unknown: readonly string[];
}

/** The rows a run runs: its own but the parked, or, when `VF_MARKET_ROWS` is set, those of its own
 * it names, parked or not (one list for every run); a name no run has is said. Every parked row
 * of the run it does not run is handed back, for the run's line to say (C36). */
export function marketRows(run: MarketRun, env: NodeJS.ProcessEnv): MarketRowsPicked {
  const own = MARKET_ROWS[run];
  const asked = (env[MARKET_ROWS_ENV] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const known = (name: string): boolean =>
    MARKET_RUNS.some((any) => MARKET_ROWS[any].some((row) => row.name === name));
  const rows =
    asked.length === 0
      ? own.filter((row) => row.parked === undefined)
      : own.filter((row) => asked.includes(row.name));
  return {
    rows,
    parked: own.filter((row) => row.parked !== undefined && !rows.includes(row)),
    unknown: asked.filter((name) => !known(name)),
  };
}

/** The run's SMOKE_MARKET_ROWS line: the rows it runs, by name, and each parked row it leaves out
 * with its reason, so a parked row is said, never silent (C36). */
export function marketRowsLine(run: MarketRun, picked: MarketRowsPicked): string {
  const rows = picked.rows.map((row) => row.name);
  const parked = Object.fromEntries(picked.parked.map((row) => [row.name, row.parked]));
  return `SMOKE_MARKET_ROWS ${JSON.stringify({ run, rows, parked })}`;
}

/** What fieldd's list should say on each run. */
export function expectedCatalogState(run: MarketRun): "ready" | "refused" | "unreachable" {
  if (run === "forged") return "refused";
  if (run === "offline") return "unreachable";
  return "ready";
}

/** With no list held and a read that failed (§9, MK-4a's; `plugins-words.ts` NO_LIST). */
export const NO_LIST_WORDS = {
  refused: "VibeField couldn't use the plugin list · Diagnostics has the details",
  unreachable: "Offline · no plugin list yet",
} as const;

/** A held list read and current (§9 "Reading the list"; `plugins-words.ts` CATALOG_FOOT.ready):
 * "12 plugins, 31 objects · checked 14:02", a list from another day with its day, and
 * "· community off" once that clause is built. */
export const READY_FOOT =
  /^\d+ plugins?, \d+ objects? · checked (?:[A-Z][a-z]{2} \d{1,2}, )?\d{2}:\d{2}(?: · community off)?$/u;

/** The popup as READ reads it. */
export interface PopupSeen {
  readonly tab: string | null;
  readonly count: string | null;
  readonly foot: string;
  readonly body: string;
  /** every word the popup shows, as the page lays it out */
  readonly all: string;
}

/** READ: the tab, fieldd's list, and the words for it. What is wrong, in words. */
export function judgeRead(
  fixture: MarketFixture,
  catalog: PluginsCatalog,
  seen: PopupSeen,
  tab: "Discover" | "Updates" = "Discover",
): string[] {
  const problems: string[] = [];
  if (seen.tab !== tab) problems.push(`the popup opened on ${seen.tab}, not ${tab}`);
  const want = expectedCatalogState(fixture.run);
  if (catalog.state !== want) problems.push(`fieldd's list is ${catalog.state}, not ${want}`);
  if (want === "ready") {
    if (catalog.checkedAt === null) problems.push("fieldd's list is ready with no time");
    for (const [plugin, kind] of [
      [fixture.vibefield, "vibefield"],
      [fixture.community, "community"],
    ] as const) {
      const listed = catalog.plugins.find((entry) => entry.id === plugin.id)?.listedAs;
      if (listed !== kind)
        problems.push(`${plugin.id} is listed as ${listed ?? "nothing"}, not ${kind}`);
    }
    if (JSON.stringify(catalog.featured) !== JSON.stringify(fixture.featured))
      problems.push(
        `the pick is ${JSON.stringify(catalog.featured)}, not ${JSON.stringify(fixture.featured)}`,
      );
    if (!READY_FOOT.test(seen.foot))
      problems.push(`the foot says "${seen.foot}", not "N plugins, N objects · checked HH:MM"`);
    return problems;
  }
  if (catalog.checkedAt !== null) problems.push("a list is held from a run that read none");
  const words = NO_LIST_WORDS[want];
  if (seen.foot !== words) problems.push(`the foot says "${seen.foot}", not "${words}"`);
  if (tab === "Discover" && !seen.body.includes(words))
    problems.push(`Discover says "${seen.body.slice(0, 160)}", not "${words}"`);
  return problems;
}

/** §9's insides (the plugins' words, its last bullet; §8 "Its words"): never read in the popup. */
export const INSIDE_WORDS = [
  "key",
  "keys",
  "signature",
  "signatures",
  "signed",
  "hash",
  "hashes",
  "rung",
  "rungs",
  "registry",
  "registries",
  "manifest",
  "sidecar",
  "custody",
  "token",
  "tokens",
  "daemon",
  "daemons",
  "worker",
  "workers",
  "process",
  "processes",
  "restart",
  "restarted",
  "reload",
  "reloaded",
  "repository",
] as const;

/** Every inside word, address and id the popup says, each with a little of what stood around it.
 * `literals` are the run's ids, object types and power ids, which a person never reads either. */
export function judgeInsideWords(text: string, literals: readonly string[]): string[] {
  const problems: string[] = [];
  const around = (at: number, length: number): string =>
    text.slice(Math.max(0, at - 30), at + length + 30).replace(/\s+/gu, " ");
  for (const word of INSIDE_WORDS) {
    const hit = new RegExp(`\\b${word}\\b`, "iu").exec(text);
    if (hit !== null)
      problems.push(`the popup says "${word}" (…${around(hit.index, word.length)}…)`);
  }
  const address = /\b(?:https?|file):\/\/\S*/iu.exec(text);
  if (address !== null) problems.push(`the popup shows an address (…${around(address.index, 8)}…)`);
  for (const literal of literals) {
    const at = text.indexOf(literal);
    if (at >= 0) problems.push(`the popup shows ${literal} (…${around(at, literal.length)}…)`);
  }
  return problems;
}

/** A refusal as main's fieldd client says it: its kind, and the plugin kind and reason
 * code fieldd put in its data. A `details` nested in the data is read too (the mgmt shape). */
export interface RefusalSeen {
  readonly kind: string | null;
  readonly pluginKind: string | null;
  readonly reasonCode: string | null;
}

export function refusalOf(error: unknown): RefusalSeen | null {
  if (!(error instanceof Error)) return null;
  const raised = error as Error & { kind?: unknown; details?: unknown };
  const details = (raised.details ?? null) as Record<string, unknown> | null;
  const inner = (details?.["details"] ?? null) as Record<string, unknown> | null;
  const field = (name: string): string | null => {
    const value = details?.[name] ?? inner?.[name];
    return typeof value === "string" ? value : null;
  };
  return {
    kind: typeof raised.kind === "string" ? raised.kind : null,
    pluginKind: field("pluginKind"),
    reasonCode: field("reasonCode"),
  };
}

/** A door that must refuse, judged by what it raised (null: it answered). Never the error's
 * message: a refusal's own words can carry an address. */
export function judgeRefused(label: string, raised: unknown, want: Partial<RefusalSeen>): string[] {
  if (raised === null) return [`${label}: answered, not refused`];
  const seen = refusalOf(raised);
  if (seen === null) return [`${label}: failed with no refusal of fieldd's`];
  const problems: string[] = [];
  for (const name of ["kind", "pluginKind", "reasonCode"] as const) {
    const wanted = want[name];
    if (wanted !== undefined && seen[name] !== wanted)
      problems.push(`${label}: refused with ${name} ${seen[name]}, not ${wanted}`);
  }
  return problems;
}

/** A row fieldd lists from the plugin list: installed, on, at its version. */
export function judgeListedRow(
  snapshot: PluginRegistrySnapshot,
  id: string,
  version: string,
): string[] {
  const row: PluginRecord | undefined = snapshot.plugins.find((r) => r.id === id);
  if (row === undefined) return [`${id}: no row`];
  const problems: string[] = [];
  if (row.source !== "registry") problems.push(`${id}: its row is ${row.source}, not registry`);
  if (row.state !== "enabled" || !row.enabled)
    problems.push(
      `${id}: ${row.state}${row.lastError ? ` (${row.lastError.kind})` : ""}, not enabled`,
    );
  if (row.version !== version) problems.push(`${id}: at ${row.version}, not ${version}`);
  return problems;
}

/** Nothing of the plugin was installed. */
export function judgeAbsent(snapshot: PluginRegistrySnapshot, id: string): string[] {
  return snapshot.plugins.some((r) => r.id === id) ? [`${id}: a row stands, installed`] : [];
}

/** A picture as the popup shows it. */
export interface PictureSeen {
  readonly src: string;
  readonly w: number;
  readonly h: number;
  readonly complete: boolean;
}

/** PICTURES: each picture loaded, none from a remote host or a file (MK-E9: fieldd's cache and
 * main's plugin scheme alone; EL2), and each the theme's own by its size. */
export function judgePictures(pictures: readonly PictureSeen[], theme: "light" | "dark"): string[] {
  if (pictures.length === 0) return ["the popup showed no picture"];
  const side = theme === "light" ? "day" : "night";
  const sizes = [MARKET_PICTURE.spread[side], MARKET_PICTURE.still[side]];
  const said = sizes.map((s) => `${s.w} × ${s.h}`).join(", ");
  const problems: string[] = [];
  for (const picture of pictures) {
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(picture.src)?.[1]?.toLowerCase() ?? "";
    if (scheme === "http" || scheme === "https" || scheme === "file" || scheme === "")
      problems.push(`a picture came from ${scheme === "" ? "no scheme" : `${scheme}:`}`);
    if (!picture.complete || picture.w === 0) {
      problems.push("a picture did not load");
      continue;
    }
    if (!sizes.some((size) => size.w === picture.w && size.h === picture.h))
      problems.push(`a picture ${picture.w} × ${picture.h} is not the ${side}'s (${said})`);
  }
  return problems;
}

/** SHELF: Discover's sets in their order (each by its plugin's id), and the community tile's
 * place among the shelf's tiles. */
export interface ShelfSeen {
  readonly sets: readonly string[];
  /** where "Community plugins" stands among the tiles: its index, or -1 */
  readonly communityTile: number;
  readonly tiles: number;
}

export function judgeShelf(
  fixture: MarketFixture,
  shelf: ShelfSeen,
  communityOn: boolean,
): string[] {
  const problems: string[] = [];
  const [first] = fixture.featured;
  if (first !== undefined && shelf.sets[0] !== first)
    problems.push(`the shelf opens on ${shelf.sets[0] ?? "nothing"}, not the pick ${first}`);
  const own = shelf.sets.indexOf(fixture.vibefield.id);
  const theirs = shelf.sets.lastIndexOf(fixture.community.id);
  if (own < 0) problems.push(`${fixture.vibefield.id} is not on the shelf`);
  if (!communityOn && theirs >= 0)
    problems.push(`${fixture.community.id} is on the shelf while community plugins are off`);
  if (communityOn && theirs < 0)
    problems.push(`${fixture.community.id} is not on the shelf with community plugins on`);
  if (communityOn && theirs >= 0 && own > theirs)
    problems.push("a community set stands before VibeField's");
  if (shelf.communityTile !== shelf.tiles - 1)
    problems.push(
      `"Community plugins" stands at ${shelf.communityTile} of ${shelf.tiles}, not at the end`,
    );
  return problems;
}

// ── the driver ────────────────────────────────────────────────────────────────────────────────

export interface MarketDriver {
  readonly win: BrowserWindow;
  readonly fixture: MarketFixture;
  readonly rows: readonly MarketRow[];
  /** a request over main's fieldd client (smoke.ts hands `opts.handle.client`'s, as its other
   * branches do), never the window's */
  readonly request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** copies a file over another (the update run's second list): the runner's, so this module
   * writes nothing */
  readonly copy: (from: string, to: string) => void;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

const POPUP = '.vf-plugins-pop[role="dialog"]';
const POPUP_OPEN = `document.querySelector('${POPUP}') !== null`;
const POPUP_SHUT = `document.querySelector('${POPUP}') === null`;
const PALETTE_OPEN = `document.querySelector(".vf-palette-layer[data-visible]") !== null`;
const ME_OPEN = `document.querySelector(".vf-me[data-open]") !== null`;
/** Item 646 (2026-11-21): what the window was when a row threw, read once in its catch: the desk's mount and
 * status, which of the popup, the palette and the Me menu stand, and the focused element by its tag and first
 * class. Facts of the chrome only, never an object's text. */
const WINDOW_FACTS = `(() => {
  const d = globalThis.__vfDesk;
  const a = document.activeElement;
  const first = a === null ? "" : String(a.className ?? "").split(" ")[0];
  return JSON.stringify({
    mount: d?.mount ?? null,
    desk: d?.status?.().state ?? null,
    popup: ${POPUP_OPEN},
    palette: ${PALETTE_OPEN},
    me: ${ME_OPEN},
    focus: a === null ? null : a.tagName + (first === "" ? "" : "." + first),
  });
})()`;
/** "Reading the plugin list…" (§9), the foot while a read runs */
const READING = "Reading the plugin list…";
/** The read on open done: the foot says it no more. */
const READ_DONE = `!(document.querySelector('${POPUP} .vf-plugins-said')?.textContent ?? "").startsWith(${JSON.stringify(READING)})`;
/** Discover's category chosen (item 433): the id its segment carries (the kit's `data-id`, `""`
 * All), or null while no category row stands. */
const CATEGORY_CHOSEN = `document.querySelector('${POPUP} .vf-plugins-body [data-id][aria-pressed="true"]')?.getAttribute("data-id") ?? null`;

/** The popup read whole: its tab, Updates' count, the foot, the body, its words, its pictures, and
 * its sets (MK-4's shelf, as this module asks it to mark them: `data-plugin` on a set's tile,
 * `data-community-tile` on the community tile). */
const POPUP_READ = `(() => {
  const pop = document.querySelector('${POPUP}');
  if (pop === null) return null;
  const text = (el) => (el?.textContent ?? "").replace(/\\s+/gu, " ").trim();
  const checked = pop.querySelector('.vf-plugins-seg [role="radio"][aria-checked="true"]');
  const tiles = [
    ...pop.querySelectorAll(".vf-plugins-body [data-plugin], .vf-plugins-body [data-community-tile]"),
  ];
  const pictures = [...pop.querySelectorAll("img")].map((i) => ({
    src: i.currentSrc || i.src,
    w: i.naturalWidth,
    h: i.naturalHeight,
    complete: i.complete,
  }));
  return {
    tab: checked?.childNodes[0]?.textContent?.trim() ?? null,
    count: pop.querySelector(".vf-plugins-count")?.textContent ?? null,
    foot: text(pop.querySelector(".vf-plugins-said")),
    body: text(pop.querySelector(".vf-plugins-body")),
    all: pop.innerText,
    pictures,
    shelf: {
      sets: tiles.filter((t) => t.hasAttribute("data-plugin")).map((t) => t.getAttribute("data-plugin")),
      communityTile: tiles.findIndex((t) => t.hasAttribute("data-community-tile")),
      tiles: tiles.length,
    },
  };
})()`;

interface PopupRead extends PopupSeen {
  readonly pictures: readonly PictureSeen[];
  readonly shelf: ShelfSeen;
}

/** §7's statement, word for word (§9 "Community plugins"; trust-and-distribution §7). */
const STATEMENT =
  "Community plugins run with the app's access. VibeField reviews the first listing and rebuilds every version from source; nothing isolates their code from yours.";

/** The market's rows for one run. The problems, each in words, and what each row saw. */
export async function marketRunRows(
  d: MarketDriver,
): Promise<{ problems: string[]; facts: Record<string, unknown> }> {
  const { fixture } = d;
  const hands = handsOver(d.win, d.shotDir);
  const { js, until, key } = hands;
  const problems: string[] = [];
  const facts: Record<string, unknown> = {};
  const installed = fixture.vibefield;
  const firstObject = installed.objects[0] as MarketObject;
  const literals = [
    fixture.vibefield.id,
    fixture.community.id,
    ...fixture.vibefield.objects.map((o) => o.type),
    ...fixture.community.objects.map((o) => o.type),
    ...(fixture.next?.asks ?? []),
    fixture.list,
  ];

  // fieldd's answers, parsed, never cast
  const plugins = async (): Promise<PluginRegistrySnapshot> =>
    PluginsListResult.parse(await d.request("plugins.list"));
  /** fieldd's list polled until `holds`; the snapshot either way, for the judge to say what
   * stands */
  const pluginsUntil = async (
    holds: (snapshot: PluginRegistrySnapshot) => boolean,
    timeoutMs: number,
  ): Promise<PluginRegistrySnapshot> => {
    const deadline = Date.now() + timeoutMs;
    let snapshot = await plugins();
    while (!holds(snapshot) && Date.now() < deadline) {
      await sleep(200);
      snapshot = await plugins();
    }
    return snapshot;
  };
  /** fieldd's list once a commit's record has reached it: the commit door can answer before it
   * has (`PluginsInstallResult`'s note), so a row read once could flake */
  const listedUntil = (id: string, version: string): Promise<PluginRegistrySnapshot> =>
    pluginsUntil(
      (s) => s.plugins.some((r) => r.id === id && r.version === version && r.enabled),
      20_000,
    );
  /** fieldd's list once an uninstall's row has left it, as REMOVE waits */
  const goneUntil = (id: string): Promise<PluginRegistrySnapshot> =>
    pluginsUntil((s) => !s.plugins.some((r) => r.id === id), 20_000);
  const catalog = async (): Promise<PluginsCatalog> =>
    PluginsCatalogSchema.parse(await d.request("plugins.catalog.get", {}));
  /** what a door raised, or null when it answered */
  const raisedBy = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    try {
      await d.request(method, params);
      return null;
    } catch (error) {
      return error;
    }
  };
  const prepare = async (id: string) =>
    PluginsInstallPrepareResult.parse(await d.request("plugins.install.prepare", { id }));

  // the popup, read and driven
  const swept = new Set<string>();
  const read = async (label: string): Promise<PopupRead> => {
    const seen = await js<PopupRead | null>(POPUP_READ);
    if (seen === null) throw new Error(`${label}: the popup is not open`);
    for (const p of judgeInsideWords(seen.all, literals)) {
      if (swept.has(p)) continue;
      swept.add(p);
      problems.push(`${label} WORDS: ${p}`);
    }
    return seen;
  };
  /** The popup opened by the palette's act (`plugins`: Discover; `plugins-updates`: Updates), and
   * its read on open awaited: it ends within fieldd's fetch timeout (20 s, plugin-install.ts). */
  const open = async (act: "plugins" | "plugins-updates" = "plugins"): Promise<void> => {
    await hands.chord("k");
    await until(
      "the palette",
      5_000,
      `document.querySelector(".vf-palette-layer[data-visible]") !== null`,
    );
    await hands.pressAt(`.vf-command-palette [data-row="${act}"]`);
    await until("Plugins open", 5_000, POPUP_OPEN);
    await until("the read on open done", 25_000, READ_DONE);
  };
  const fold = async (): Promise<void> => {
    for (let i = 0; i < 3 && !(await js<boolean>(POPUP_SHUT)); i += 1) await key("Escape");
    await until("the popup folded", 5_000, POPUP_SHUT);
  };
  const pressIn = async (words: readonly string[], label: string): Promise<void> => {
    if (!(await hands.pressWords(POPUP, words)))
      throw new Error(`${label}: no ${words.join(" / ")} in the popup`);
  };
  /** an expression: the popup says these words, its spaces folded */
  const saysIn = (words: string): string =>
    `(document.querySelector('${POPUP}')?.innerText ?? "").replace(/\\s+/gu, " ").includes(${JSON.stringify(words)})`;
  const installedSays = `[...document.querySelectorAll('${POPUP} .vf-plugins-page-act')].some((a) => a.textContent === "Installed")`;
  const pressPoint = async (expression: string, label: string): Promise<void> => {
    const at = await js<Point | null>(expression);
    if (at === null) throw new Error(label);
    await hands.press(at);
  };
  const centreOf = (selector: string): string => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`;
  const openTile = async (plugin: MarketPlugin): Promise<void> => {
    await pressPoint(
      centreOf(`${POPUP} [data-plugin="${plugin.id}"]`),
      `no tile of ${plugin.title} on the shelf`,
    );
    await until(
      `${plugin.title}'s page`,
      5_000,
      `document.querySelector(".vf-plugins-page") !== null`,
    );
  };

  // the desk under it
  const census = (): Promise<Record<string, number>> => js("globalThis.__vfDesk.census()");
  const mount = (): Promise<number> => js("globalThis.__vfDesk?.mount ?? -1");
  const remounted = (label: string, from: number): Promise<void> =>
    until(
      `${label} (the mount from ${from})`,
      30_000,
      `(globalThis.__vfDesk?.mount ?? -1) > ${from} && globalThis.__vfDesk.status().state === "ready"`,
    );
  const drawsAs = async (type: string): Promise<unknown> =>
    (await js<{ state: unknown }>(`globalThis.__vfDesk.words(${JSON.stringify(type)})`)).state;

  const rows: Record<string, () => Promise<void>> = {
    // the read on open: the palette's Plugins…, fieldd's list, the foot's words for it
    READ: async () => {
      await open();
      const seen = await read("READ");
      const held = await catalog();
      problems.push(...judgeRead(fixture, held, seen).map((p) => `READ: ${p}`));
      facts["READ"] = { state: held.state, foot: seen.foot, entries: held.plugins.length };
      await hands.shoot(`mk-6-market-${fixture.run}-read.png`);
      await fold();
    },
    // fieldd refuses a community install while community plugins are off, before it fetches
    // anything past the list (MK-2c)
    "COMMUNITY-CLOSED": async () => {
      const raised = await raisedBy("plugins.install.prepare", { id: fixture.community.id });
      problems.push(
        ...judgeRefused("COMMUNITY-CLOSED", raised, {
          kind: "PRECONDITION_FAILED",
          pluginKind: "PLUGIN_CAPABILITY_DENIED",
          reasonCode: "COMMUNITY_SWITCH_CLOSED",
        }),
        ...judgeAbsent(await plugins(), fixture.community.id).map((p) => `COMMUNITY-CLOSED: ${p}`),
      );
      facts["COMMUNITY-CLOSED"] = refusalOf(raised);
    },
    // the install card's doors (MK-O2B) over the run's list: what each run's list allows
    DOOR: async () => {
      if (fixture.run !== "listed") {
        const raised = await raisedBy("plugins.install.prepare", { id: installed.id });
        const want =
          fixture.run === "offline"
            ? { kind: "UNAVAILABLE", pluginKind: "PLUGIN_SOURCE_UNAVAILABLE" }
            : { kind: "PRECONDITION_FAILED", pluginKind: "PLUGIN_ARTIFACT_MISMATCH" };
        problems.push(
          ...judgeRefused("DOOR", raised, want),
          ...judgeAbsent(await plugins(), installed.id).map((p) => `DOOR: ${p}`),
        );
        facts["DOOR"] = refusalOf(raised);
        return;
      }
      // prepared, then thrown away: nothing installed
      const first = await prepare(installed.id);
      const named = `${first.record.id}@${first.record.version}`;
      if (named !== `${installed.id}@${installed.version}`)
        problems.push(`DOOR: the card's row is ${named}, not ${installed.id}@${installed.version}`);
      problems.push(
        ...judgeAbsent(await plugins(), installed.id).map((p) => `DOOR prepared: ${p}`),
      );
      const discarded = (await d.request("plugins.install.discard", {
        candidate: first.candidate,
      })) as { discarded?: unknown };
      if (discarded.discarded !== true) problems.push("DOOR: the discard held nothing");
      problems.push(
        ...judgeAbsent(await plugins(), installed.id).map((p) => `DOOR discarded: ${p}`),
      );
      // prepared and installed: its row, and the desk drawing its kind
      const from = await mount();
      const second = await prepare(installed.id);
      await d.request("plugins.install.commit", { candidate: second.candidate });
      problems.push(
        ...judgeListedRow(
          await listedUntil(installed.id, installed.version),
          installed.id,
          installed.version,
        ).map((p) => `DOOR installed: ${p}`),
      );
      await remounted("the desk remounted with the clock's kind", from);
      const state = await drawsAs(firstObject.type);
      if (state !== null)
        problems.push(`DOOR: the desk draws ${firstObject.type} as ${String(state)}`);
      // removed again, its data kept
      await d.request("plugins.uninstall", { id: installed.id });
      problems.push(
        ...judgeAbsent(await goneUntil(installed.id), installed.id).map(
          (p) => `DOOR removed: ${p}`,
        ),
      );
      facts["DOOR"] = { discarded: discarded.discarded, installed: true, removed: true };
    },
    // Discover's shelf: the pick first, VibeField's sets, the community tile last, no community
    // set while community plugins are off
    SHELF: async () => {
      await open();
      const seen = await read("SHELF");
      problems.push(...judgeShelf(fixture, seen.shelf, false).map((p) => `SHELF: ${p}`));
      // a set is found by one of its objects' labels (MK-D4), the caret in the field as the popup
      // opens; while community plugins are off the results say theirs are not searched
      for (const character of firstObject.label) await key(character, [], true);
      await sleep(300);
      const searched = await read("SHELF search");
      if (!searched.shelf.sets.includes(installed.id))
        problems.push(`SHELF: "${firstObject.label}" did not find ${installed.title}`);
      if (!searched.body.includes("Community plugins are off, so their objects aren't searched."))
        problems.push("SHELF: a search with community plugins off did not say so");
      facts["SHELF"] = { shelf: seen.shelf, searched: searched.shelf.sets };
      await fold();
    },
    // the pictures through fieldd's cache and main's plugin scheme, the theme's own by day and by
    // night
    PICTURES: async () => {
      for (const theme of ["light", "dark"] as const) {
        await js(`globalThis.vibefield.theme.set(${JSON.stringify(theme)})`);
        await until(
          `the desk dressed ${theme}`,
          10_000,
          `globalThis.__vfDesk.theme() === ${JSON.stringify(theme)}`,
        );
        await open();
        await until(
          "the shelf's pictures loaded",
          10_000,
          `(() => { const all = [...document.querySelectorAll('${POPUP} img')]; return all.length > 0 && all.every((i) => i.complete); })()`,
        );
        const seen = await read(`PICTURES ${theme}`);
        problems.push(...judgePictures(seen.pictures, theme).map((p) => `PICTURES ${theme}: ${p}`));
        await hands.shoot(`mk-6-market-shelf-${theme}.png`);
        await fold();
      }
      await js(`globalThis.vibefield.theme.set("light")`);
      await until("the desk dressed light", 10_000, `globalThis.__vfDesk.theme() === "light"`);
    },
    // More in Plugins… opens Discover on the board's chosen category (item 433): the board raised
    // and its slide done (its filters fade in over the slide's last 40 %, so a press before then
    // lands on the dimmed desk), then on All and then on the installed clock's category, each press
    // waited on (RISE left the board on that category, so a press on it alone would prove nothing),
    // the pill pressed, and Discover's categories read once the read on open is done (they are
    // drawn from the list it holds); the set on the shelf is the clock's, with no featured row
    // (the featured set stands under All alone), and the board folded as the popup opened
    CARRY: async () => {
      const boardOn = (category: string): string =>
        `globalThis.__vfDesk.pegboard()?.anchor.category === ${JSON.stringify(category)}`;
      await hands.pressAt(".vf-line-create");
      await until("the board's slide done", 10_000, BOARD_SETTLED);
      await sleep(350); // the filters' fade, the thumb's 300 ms (MORE's settled)
      await hands.pressAt('.vf-pegboard-track button[data-id=""]');
      await until("the board on All", 5_000, boardOn(""));
      await hands.pressAt(`.vf-pegboard-track button[data-id="${firstObject.category}"]`);
      await until(`the board on ${firstObject.category}`, 5_000, boardOn(firstObject.category));
      if (!(await hands.pressWords(".vf-pegboard", ["More in Plugins…"])))
        throw new Error("no More in Plugins… at the board's foot");
      await until("Plugins open from the pill", 5_000, POPUP_OPEN);
      await until("the read on open done", 25_000, READ_DONE);
      await until("Discover's categories drawn", 5_000, `(${CATEGORY_CHOSEN}) !== null`);
      const chosen = await js<string | null>(CATEGORY_CHOSEN);
      if (chosen !== firstObject.category)
        problems.push(
          `CARRY: Discover opened on ${JSON.stringify(chosen)}, not ${firstObject.category}`,
        );
      const seen = await read("CARRY");
      if (!seen.shelf.sets.includes(installed.id))
        problems.push(`CARRY: ${installed.title} is not on the shelf under its category`);
      const featured = await js<boolean>(
        `document.querySelector('${POPUP} .vf-plugins-body [data-featured="true"]') !== null`,
      );
      if (featured) problems.push("CARRY: the featured row stood under a category");
      const folded = await js<boolean>("globalThis.__vfDesk.pegboard()?.anchor.open !== true");
      if (!folded) problems.push("CARRY: the board did not fold as the pill opened Plugins");
      facts["CARRY"] = { chosen, sets: seen.shelf.sets, featured, folded };
      await hands.shoot("mk-6-market-carry.png");
      await fold();
    },
    // Install grows into the card; Cancel throws the download away; Install again, ↵, Installed
    INSTALL: async () => {
      await open();
      await openTile(installed);
      await pressIn(["Install"], "INSTALL");
      const question = `Install ${installed.title}?`;
      await until("the install card", 20_000, saysIn(question));
      const card = await read("INSTALL card");
      const cardWords = card.all.replace(/\s+/gu, " ");
      for (const words of [
        ...installed.objects.map((o) => o.label),
        "Nothing beyond drawing its own objects",
      ])
        if (!cardWords.includes(words)) problems.push(`INSTALL: the card does not say "${words}"`);
      if (!/It installs on this (?:Mac|PC)\./u.test(cardWords))
        problems.push("INSTALL: the card does not say where it installs");
      await hands.shoot("mk-6-market-card.png");
      await pressIn(["Cancel"], "INSTALL");
      await until("the act says Install again", 5_000, `!(${saysIn(question)})`);
      problems.push(
        ...judgeAbsent(await plugins(), installed.id).map((p) => `INSTALL cancelled: ${p}`),
      );
      const from = await mount();
      await pressIn(["Install"], "INSTALL again");
      await until("the install card again", 20_000, saysIn(question));
      await key("Return");
      await until("Installed", 30_000, installedSays);
      problems.push(
        ...judgeListedRow(
          await listedUntil(installed.id, installed.version),
          installed.id,
          installed.version,
        ).map((p) => `INSTALL: ${p}`),
      );
      await remounted("the desk remounted with the clock's kind", from);
      await read("INSTALL installed");
      facts["INSTALL"] = { installed: true };
      await fold();
    },
    // Show on the pegboard: the board on the set's first category, its first object focused
    RISE: async () => {
      problems.push(
        ...(await riseRows({
          win: d.win,
          shotDir: d.shotDir,
          say: d.say,
          first: firstObject,
          title: installed.title,
          openPlugins: () => open(),
        })),
      );
    },
    // Remove… asks, naming the objects on your desks; the row goes, and they draw as missing
    REMOVE: async () => {
      const onDesk = (await census())[firstObject.type] ?? 0;
      await open();
      await openInstalledPage(hands, installed.title);
      await pressIn(["Remove…"], "REMOVE");
      await until("Remove's question", 5_000, saysIn(`Remove ${installed.title}?`));
      const asked = await read("REMOVE question");
      if (onDesk > 0 && !asked.all.includes(firstObject.label))
        problems.push(`REMOVE: the question does not name the ${firstObject.label} on your desks`);
      await pressIn(["Remove"], "REMOVE");
      const gone = await pluginsUntil((s) => !s.plugins.some((r) => r.id === installed.id), 20_000);
      problems.push(...judgeAbsent(gone, installed.id).map((p) => `REMOVE: ${p}`));
      if (onDesk > 0)
        await until(
          "the clock on the desk drawn as missing",
          30_000,
          `globalThis.__vfDesk.words(${JSON.stringify(firstObject.type)}).state !== null`,
        );
      facts["REMOVE"] = { onDesk };
      await fold();
    },
    // the community tile's switch asks, in place, with §7's statement (this run's root is a fresh
    // desktop, so O3-D's shown-here mark has not been set); the dial then joins the shelf after
    // VibeField's sets, and fieldd prepares it
    COMMUNITY: async () => {
      await open();
      await pressPoint(
        centreOf(`${POPUP} [data-community-tile] [role="switch"]`),
        "no switch on the community tile",
      );
      await until("Turn on community plugins?", 5_000, saysIn("Turn on community plugins?"));
      const asked = await read("COMMUNITY ask");
      if (!asked.all.replace(/\s+/gu, " ").includes(STATEMENT))
        problems.push("COMMUNITY: the ask does not say §7's statement word for word");
      await pressIn(["Turn on community plugins"], "COMMUNITY");
      await until(
        "the dial on the shelf",
        20_000,
        `document.querySelector('${POPUP} [data-plugin="${fixture.community.id}"]') !== null`,
      );
      const seen = await read("COMMUNITY on");
      problems.push(...judgeShelf(fixture, seen.shelf, true).map((p) => `COMMUNITY: ${p}`));
      const prepared = await prepare(fixture.community.id);
      await d.request("plugins.install.discard", { candidate: prepared.candidate });
      facts["COMMUNITY"] = { shelf: seen.shelf };
      await fold();
    },
    // a download that does not match the list: plain words, a way to try again, nothing installed
    FAILED: async () => {
      await open();
      await openTile(installed);
      await pressIn(["Install"], "FAILED");
      const words = `VibeField didn't install ${installed.title}. Nothing changed.`;
      await until("the failed install's words", 20_000, saysIn(words));
      await read("FAILED");
      if ((await js<Point | null>(wordsAt(POPUP, ["Try again"]))) === null)
        problems.push("FAILED: no Try again");
      problems.push(...judgeAbsent(await plugins(), installed.id).map((p) => `FAILED: ${p}`));
      facts["FAILED"] = { said: true };
      await fold();
    },
    // the update run: the clock installed at its first version through the doors, then the list
    // moved on (its second, signed by the same key, copied over the one fieldd reads)
    SETUP: async () => {
      const next = fixture.next as MarketNext;
      const prepared = await prepare(installed.id);
      await d.request("plugins.install.commit", { candidate: prepared.candidate });
      problems.push(
        ...judgeListedRow(
          await listedUntil(installed.id, installed.version),
          installed.id,
          installed.version,
        ).map((p) => `SETUP: ${p}`),
      );
      d.copy(next.signature, next.intoSignature);
      d.copy(next.index, next.into);
      facts["SETUP"] = { installed: installed.version, next: next.version };
    },
    // the read finds it: Updates' count, and the Me menu's "1 update"
    COUNT: async () => {
      await open("plugins-updates");
      const seen = await read("COUNT");
      const held = await catalog();
      problems.push(...judgeRead(fixture, held, seen, "Updates").map((p) => `COUNT: ${p}`));
      if (held.updates !== 1) problems.push(`COUNT: fieldd counts ${held.updates} updates, not 1`);
      if (seen.count !== "1") problems.push(`COUNT: Updates carries ${seen.count}, not 1`);
      await fold();
      await hands.pressAt(".vf-me-face");
      await until("the Me menu", 5_000, `document.querySelector(".vf-me[data-open]") !== null`);
      const end = await js<string | null>(`(() => {
        const row = [...document.querySelectorAll(".vf-me-row")].find(
          (r) => r.querySelector(".vf-me-row-label")?.textContent === "Plugins…",
        );
        return row?.querySelector(".vf-me-row-end")?.textContent ?? null;
      })()`);
      if (end !== "1 update")
        problems.push(`COUNT: the Me menu's Plugins… ends ${JSON.stringify(end)}`);
      facts["COUNT"] = { updates: held.updates, count: seen.count, me: end };
      await key("Escape");
    },
    // Update asks for more, so its card shows; then Installed at the new version, the popup back
    // on the plugin's page once the window has come back (MK-E6)
    UPDATE: async () => {
      const next = fixture.next as MarketNext;
      await open("plugins-updates");
      await pressIn(["Update", "Update…"], "UPDATE");
      // the update card's question and its lead before the new powers (mk-uc's §9 words, ‹draft›)
      await until("the update's card", 20_000, saysIn(`Update ${installed.title}?`));
      const card = await read("UPDATE card");
      if (!card.all.replace(/\s+/gu, " ").includes("This version can also:"))
        problems.push('UPDATE: the card does not say "This version can also:"');
      const loads = await js<number>("performance.timeOrigin");
      await key("Return");
      // a new document, then the popup reopened on the plugin's page; while the document is
      // replaced a read can fail, so it is polled on
      const back = `performance.timeOrigin !== ${loads} && document.querySelector(".vf-plugins-page") !== null`;
      const deadline = Date.now() + 60_000;
      let fresh = false;
      while (!fresh && Date.now() < deadline) {
        fresh = await js<boolean>(back).catch(() => false);
        if (!fresh) await sleep(200);
      }
      if (!fresh) throw new Error("the window did not come back on the plugin's page in 60000ms");
      await until(
        "Installed at the new version",
        30_000,
        `${installedSays} && ${saysIn(next.version)}`,
      );
      await read("UPDATE installed");
      problems.push(
        ...judgeListedRow(await plugins(), installed.id, next.version).map((p) => `UPDATE: ${p}`),
      );
      facts["UPDATE"] = { version: next.version };
      await fold();
    },
  };

  /** Item 646 (2026-11-21) — after a row threw: the popup folded (its Esc answers the nearest first, so up to
   * three), the palette and the Me menu shut, and after the listed run's DOOR the clock it installed taken away
   * (DOOR throws before its own uninstall, so INSTALL found "Installed"). What it did, in words. */
  const tidy = async (name: string): Promise<string[]> => {
    const did: string[] = [];
    for (let i = 0; i < 3 && !(await js<boolean>(POPUP_SHUT)); i += 1) {
      await key("Escape");
      did.push("the popup: Esc");
    }
    if (await js<boolean>(PALETTE_OPEN)) {
      await key("Escape");
      did.push("the palette: Esc");
    }
    if (await js<boolean>(ME_OPEN)) {
      await key("Escape");
      did.push("the Me menu: Esc");
    }
    if (name === "DOOR" && fixture.run === "listed") {
      if ((await plugins()).plugins.some((r) => r.id === installed.id)) {
        await d.request("plugins.uninstall", { id: installed.id });
        const gone = await goneUntil(installed.id);
        did.push(
          gone.plugins.some((r) => r.id === installed.id)
            ? `${installed.id} still listed after its uninstall`
            : `${installed.id} uninstalled`,
        );
      }
    }
    return did;
  };

  for (const row of d.rows) {
    const run = rows[row.name];
    const before = problems.length;
    try {
      if (run === undefined) throw new Error(`no row named ${row.name}`);
      await run();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      const waits = row.needs !== null ? ` (it waits on ${row.needs})` : "";
      const seen = await js<string>(WINDOW_FACTS).catch(() => "unread");
      const listed = await plugins()
        .then((s) =>
          JSON.stringify(s.plugins.map((r) => `${r.id}@${r.version}${r.enabled ? "" : " off"}`)),
        )
        .catch(() => "unread");
      problems.push(`${row.name}: ${why}${waits} (window ${seen}; fieldd lists ${listed})`);
      // item 646 (2026-11-21): a red row runs its own tidy, so the next row starts where it would have and a
      // knock-on never reads as a second red; what the tidy did is said, never counted
      const did = await tidy(row.name).catch((e: unknown) => [
        `the tidy failed: ${e instanceof Error ? e.message : String(e)}`,
      ]);
      if (did.length > 0)
        d.say(`SMOKE_MARKET_TIDY ${fixture.run} ${row.name} ${JSON.stringify(did)}`);
    }
    const said = { ok: problems.length === before, problems: problems.slice(before) };
    d.say(
      `SMOKE_MARKET_ROW ${fixture.run} ${row.name} ${JSON.stringify({ ...said, facts: facts[row.name] ?? null })}`,
    );
  }
  return { problems, facts };
}
