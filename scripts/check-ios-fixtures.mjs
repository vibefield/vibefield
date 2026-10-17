#!/usr/bin/env node
// Every golden the iOS test bundles carry must be the contracts' own bytes.
//
// EL9 says a seam is pinned by fixtures parsed on BOTH sides; the phone is the
// third side, and it holds COPIES because its bundle cannot reach across the
// workspace. A copy is only evidence while it is identical — and this lane
// shipped a "byte for byte" claim that was already false by one line of
// formatting, with nothing to notice. This is the thing that notices.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const contracts = join(root, "packages/contracts/fixtures");
const searchRoots = [
  join(root, "apps/ios/VibeFieldKit/Tests"),
  join(root, "apps/ios/VibeFieldKit/Sources"),
];

/** Every `*.json` under a tree, however deep. */
function jsonFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // An asset catalog's `Contents.json` files are Xcode's, never a golden.
    if (entry.isDirectory() && entry.name.endsWith(".xcassets")) continue;
    if (entry.isDirectory()) found.push(...jsonFiles(path));
    else if (entry.name.endsWith(".json")) found.push(path);
  }
  return found;
}

// The ONLY phone-side JSON files with no contracts origin: fixtures a kit lane
// authored for itself (recorded TRF1 frames, not a wire shape). Anything else
// with no origin is an ORPHAN — a golden that was deleted or renamed upstream
// while its copy stayed behind, unchecked. Before 2026-09-14 (TM review, T-H2)
// such a copy was silently skipped and `checked` merely dropped by one; a gate
// that stops gating without a red is the failure this script exists to catch,
// so the copy half now has the pin half's posture below.
const LANE_AUTHORED = new Set(["trf1-frames.lane.json", "spawn-bloom-geometry.lane.json"]);

// Goldens whose origin is another package than the contracts — a design
// decision both apps compute, not a wire shape — compared byte for byte all
// the same. PJ-7: the project ink's table (DESIGN.md §2.9), which the design
// kit's own test reads too.
const OTHER_ORIGINS = new Map([
  ["project-ink.golden.json", join(root, "packages/design-kit/fixtures/project-ink.golden.json")],
]);

const problems = [];
let checked = 0;

// FS-2: required mirrors are named as well as compared below. Deleting a
// workspace golden must not silently reduce the third-side coverage count.
const workspaceFixtures = [
  "workspace-roots.valid.json",
  "workspace-list.valid.json",
  "workspace-search.valid.json",
  "workspace-list-params.valid.json",
  "workspace-search-params.valid.json",
  "agent-catalog.valid.json",
];
// PJ-7: the phone's `project.*` reads (History) and its launch sheet's reads
// and asks, named the same way — a project set and a launch set.
const projectFixtures = [
  "place-ref.valid.json",
  "project-list.valid.json",
  "project-list.tailnet.json",
  "project-summary.valid.json",
  "project-summary.tailnet.json",
  "project-summary.home.json",
  "project-summary.recipe.json",
  "project-summary.hidden.json",
  "project-summary.recipe-place.json",
  "project-get.valid.json",
  "project-get.moved.json",
  "project-sessions.valid.json",
  "project-figures.valid.json",
  "project-figures-day.valid.json",
  "project-changes-open.snapshot.json",
  "project-changes-delta.regrouped.json",
  "project-refusal.path-in-request.json",
  "project-refusal.key-moved.json",
  "error-data.projects-grouping.json",
  "index-sessions.keyed.json",
  "project-list-params.valid.json",
  "project-get-params.key.json",
  "project-get-params.anchor.json",
  "project-sessions-params.valid.json",
  "project-figures-params.valid.json",
  "project-figures-day-params.valid.json",
  "project-subscribe-params.valid.json",
];
const launchFixtures = [
  "agent-models.valid.json",
  "agent-models.stale.json",
  "agent-models.auth-required.json",
  "agent-models-params.valid.json",
  "agent-spawn-params.model-selection.json",
  "agent-spawn-params.place.json",
  "agents-profile-sets.valid.json",
  "agent-field-snapshot.native-session.json",
];
// History's ledger reads them: the fixture door serves these, its tests read them.
const historyFixtures = [
  "project-list.valid.json",
  "project-get.valid.json",
  "project-sessions.valid.json",
  "project-figures.valid.json",
  "project-changes-open.snapshot.json",
];
// fix7 — the ledger reads its door's index beside it: ready, failed, rebuilding.
const indexFixtures = [
  "index-status.valid.json",
  "index-status.failed.json",
  "index-status.rebuilding.json",
];
// The launch sheet reads these (its tests, and the DEBUG fixture door the first two).
const sheetFixtures = [
  "agents-profile-sets.valid.json",
  "agent-models.valid.json",
  "agent-models.stale.json",
  "agent-models.auth-required.json",
  "project-summary.recipe-place.json",
];
// F1 — the freeway's frame bytes, which the kit's codec is held to.
const freewayFixtures = ["freeway-frames.vector.json"];
const requiredMirrors = [
  ["freeway", freewayFixtures, ["Tests/FieldFreewayTests"]],
  ["workspace", workspaceFixtures, ["Tests/FieldWorkspaceTests", "Sources/FieldWorkspace"]],
  ["project", projectFixtures, ["Tests/FieldProductTests"]],
  ["project", historyFixtures, ["Tests/FieldHistoryTests", "Sources/FieldHistory"]],
  ["index", indexFixtures, ["Tests/FieldHistoryTests"]],
  ["launch", launchFixtures, ["Tests/FieldProductTests"]],
  ["launch", sheetFixtures, ["Tests/FieldWorkspaceTests"]],
  ["launch", sheetFixtures.slice(0, 2), ["Sources/FieldWorkspace"]],
];
for (const [set, fixtures, folders] of requiredMirrors) {
  for (const folder of folders) {
    for (const fixture of fixtures) {
      const copy = join(root, "apps/ios/VibeFieldKit", folder, "Fixtures", fixture);
      try {
        statSync(copy);
      } catch {
        problems.push(`required ${set} mirror is missing: ${relative(root, copy)}`);
      }
    }
  }
}

for (const searchRoot of searchRoots) {
  for (const copy of jsonFiles(searchRoot)) {
    const name = copy.slice(copy.lastIndexOf("/") + 1);
    const origin = OTHER_ORIGINS.get(name) ?? join(contracts, name);
    try {
      statSync(origin);
    } catch {
      if (!LANE_AUTHORED.has(name)) {
        problems.push(
          `${relative(root, copy)} has no origin in packages/contracts/fixtures — a golden was ` +
            "deleted or renamed and this phone-side copy is now unchecked\n" +
            "  fix: delete the copy, or add its basename to LANE_AUTHORED in this script",
        );
      }
      continue;
    }
    checked += 1;
    const a = readFileSync(origin);
    const b = readFileSync(copy);
    if (!a.equals(b)) {
      problems.push(
        `${relative(root, copy)} differs from ${relative(root, origin)}\n` +
          `  fix: cp ${relative(root, origin)} ${relative(root, copy)}`,
      );
    }
  }
}

// PJ-7 — the OS marks (Simple Icons, kept exact: DESIGN.md §13, PJ-D24) ship
// on the phone as template SVGs beside the glyphs. They are COPIES of the
// desktop's `os-marks.tsx` paths, held to them here the way a golden is.
const OS_MARKS_TSX = join(root, "packages/field-app/src/godview/os-marks.tsx");
const OS_MARKS_IOS = join(
  root,
  "apps/ios/VibeFieldKit/Sources/FieldDesign/Resources/OSMarks.xcassets",
);
{
  const source = readFileSync(OS_MARKS_TSX, "utf8");
  const start = source.indexOf("const MARKS");
  const block = source.slice(start, source.indexOf("};", start));
  const marks = [...block.matchAll(/(\w+): \{\s*d: "([^"]+)",(\s*evenOdd: true,)?/g)];
  if (marks.length === 0) problems.push(`no OS marks read from ${relative(root, OS_MARKS_TSX)}`);
  for (const [, os, d, evenOdd] of marks) {
    const copy = join(OS_MARKS_IOS, `os-${os}.imageset`, `os-${os}.svg`);
    let svg = "";
    try {
      svg = readFileSync(copy, "utf8");
    } catch {
      problems.push(`the phone's ${os} mark is missing: ${relative(root, copy)}`);
      continue;
    }
    checked += 1;
    const sameRule = svg.includes('fill-rule="evenodd"') === Boolean(evenOdd);
    if (!svg.includes(` d="${d}"`) || !sameRule) {
      problems.push(
        `${relative(root, copy)} is not ${relative(root, OS_MARKS_TSX)}'s ${os} mark\n` +
          "  fix: copy the path (and its fill rule) from the desktop's mark, exactly",
      );
    }
  }
}

// The same argument one level up: the REGISTRY VALUES the phone speaks.
//
// `registries.ts` says ports, scopes, stores and the app id exist there and
// nowhere else, but the kit is outside `pnpm verify` and has no generator
// pointed at it, so every registry value it needs is a hand-written string
// that can drift. One did, silently: the phone started its truffle node in
// ghosttea's `ghosttea-terminal` namespace while every desktop floor joined
// `vibefield`, and since a node admits a peer only by the `truffle-{appId}-`
// hostname prefix, a signed-in phone read `0 peers in reach` beside a serving
// desktop. Nothing in the tree could have noticed. This is the thing that
// notices.
const REGISTRIES = "packages/contracts/src/registries.ts";
const ROUTED_CONTRACT = "apps/ios/VibeFieldKit/Sources/FieldRoutedTerminal/RoutedContract.swift";

/**
 * TM-4 — a TPv3 number the phone's routed T1 client BRANCHES on.
 *
 * The captured text is compared verbatim, which is why the Swift literals carry
 * the same `_` grouping the TypeScript does. Numbers the client does not branch
 * on are never copied: they arrive on the wire in `ConnectionAccepted`.
 *
 * `indent` is the Swift declaration's indentation — 2 for a top-level member of
 * `RoutedTerminalContract`, 4 for one nested in its `CloseCode`.
 */
function tpPin(key, swiftName, indent = 2) {
  return {
    name: key,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^ {2}${key}: ([0-9_]+),$`, "m"),
      label: `TERMINAL_PIPELINE.${key}`,
    },
    copy: {
      file: ROUTED_CONTRACT,
      pattern: new RegExp(`^ {${indent}}public static let ${swiftName} = ([0-9_]+)$`, "m"),
      label: `RoutedTerminalContract.${swiftName}`,
    },
  };
}

/**
 * UA-P-1a — the product serve's tailnet port.
 *
 * **ARMED since 2026-09-15 (UA-P-0e).** When this pin was written the registry
 * carried no product-serve row and could not: `productServeSpec` declared no
 * `listenPort`, so the floor fell the listener back to the TARGET port, which
 * since UA-5 is fieldd's EPHEMERAL control port — a per-boot random number no
 * phone can dial. UA-P-0e fixed that at the source: the tailnet listener is now
 * `PORTS.FIELDD_PRODUCT_SERVE` while the loopback control plane stays ephemeral
 * (`packages/fieldd/src/daemon.ts`, `productServeSpec`), because a peer DERIVES
 * the coordinate and a derivation needs the same number on every device.
 *
 * **ERRATUM (2026-09-15):** this pin was first written against a bare
 * `PRODUCT_SERVE`, which is the name the row did NOT get — the lane followed the
 * `FIELDD_*` prefix of the neighbouring rows. A pin whose pattern misses reads
 * exactly like a row that does not exist, which is why the miss printed a
 * reassuring NOTICE instead of a red.
 *
 * The self-arming shape STAYS, and not as a leftover: it joins `pins` whenever
 * the registry row is readable and prints a NOTICE when it is not, so if the
 * row is ever renamed or removed the run says so instead of going quiet. A gate
 * that stops gating without a red is the exact failure this script exists to
 * catch, and an unarmed pin nobody is told about is one.
 */
/**
 * SP-2 (g) — the phone's connection budget (`PHONE_BUDGET`; SP-D12 is OPEN).
 * The kit ENFORCES these — a dial beyond the budget waits for a slot — so a
 * number that moved on one side only is a phone holding more sockets, or
 * fewer, than the registry says it may. Pinned like every other value here:
 * verbatim, `_` grouping included.
 */
const PHONE_BUDGET_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldProduct/PhoneBudget.swift";
function phoneBudgetPin(key, swiftName) {
  return {
    name: key,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^ {2}${key}: ([0-9_]+),$`, "m"),
      label: `PHONE_BUDGET.${key}`,
    },
    copy: {
      file: PHONE_BUDGET_SWIFT,
      pattern: new RegExp(`^ {2}public static let ${swiftName} = ([0-9_]+)$`, "m"),
      label: `PhoneBudget.${swiftName}`,
    },
  };
}

/**
 * SP-2 (b) — the door's tick interval, which the phone's receive deadline is
 * measured in until the door's first `system.tick` names its own (2.5 × it).
 *
 * SELF-ARMING, like `productServePin` below, and for a stated reason: the row
 * is SP-1's (`PRODUCT_API_LIMITS.TICK_INTERVAL_MS`, built by a sibling lane in
 * DS wave 2), and the kit's literal landed first. Until the row is readable
 * this prints a NOTICE instead of a red; the day it is, the pin arms itself and
 * a disagreement is a red like every other.
 */
const doorTickPin = {
  name: "TICK_INTERVAL_MS",
  origin: {
    file: REGISTRIES,
    pattern: /^ {2}TICK_INTERVAL_MS: ([0-9_]+),$/m,
    label: "PRODUCT_API_LIMITS.TICK_INTERVAL_MS",
  },
  copy: {
    file: "apps/ios/VibeFieldKit/Sources/FieldProduct/ProductTransport.swift",
    pattern: /^ {2}public static let doorTickIntervalMs: Int64 = ([0-9_]+)$/m,
    label: "FieldProductContract.doorTickIntervalMs",
  },
};

const productServePin = {
  name: "FIELDD_PRODUCT_SERVE",
  origin: {
    file: REGISTRIES,
    pattern: /^ {2}FIELDD_PRODUCT_SERVE: ([0-9_]+),$/m,
    label: "PORTS.FIELDD_PRODUCT_SERVE",
  },
  copy: {
    file: "apps/ios/VibeFieldKit/Sources/FieldMesh/FieldMeshContract.swift",
    pattern: /^ {2}public static let productServePort = ([0-9_]+)$/m,
    label: "FieldMeshContract.productServePort",
  },
};

const pins = [
  {
    name: "appID",
    origin: {
      file: REGISTRIES,
      pattern: /^export const APP_ID = "([^"]*)"/m,
      label: "APP_ID",
    },
    copy: {
      file: "apps/ios/VibeFieldKit/Sources/FieldMesh/FieldMeshContract.swift",
      pattern: /^ {2}public static let appID = "([^"]*)"/m,
      label: "FieldMeshContract.appID",
    },
  },
  // The handshake the phone offers and the liveness it keeps.
  tpPin("PROTOCOL_MAJOR", "protocolMajor"),
  tpPin("PROTOCOL_MINOR", "protocolMinor"),
  tpPin("HEARTBEAT_INTERVAL_MS", "heartbeatIntervalMs"),
  tpPin("HEARTBEAT_TTL_MS", "heartbeatTtlMs"),
  // The two limits the client applies to a grant BEFORE it spends a socket on
  // one — the cell applies the same pair, and a silent 1008 is what disagreeing
  // about them looks like from the phone.
  tpPin("MAX_CLOCK_SKEW_MS", "maxClockSkewMs"),
  tpPin("MAX_GRANT_LIFETIME_MS", "maxGrantLifetimeMs"),
  // Input closes this far before an attach grant expires without a renewal.
  tpPin("ATTACH_RENEWAL_MARGIN_MS", "attachRenewalMarginMs"),
  // Every close code the client branches on. `1008` is the silent
  // pre-authentication class and the rest are always named by the cell.
  tpPin("POLICY_PRE_AUTH", "policyPreAuth", 4),
  tpPin("SERVER_ERROR", "serverError", 4),
  tpPin("STALE_ROUTE", "staleRoute", 4),
  tpPin("FENCED", "fenced", 4),
  tpPin("SUPERSEDED", "superseded", 4),
  tpPin("PROTOCOL", "protocolError", 4),
  tpPin("LEG_TIMEOUT", "legTimeout", 4),
  // The phone's connection budget, which the kit enforces (SP-2).
  phoneBudgetPin("DOORS_PER_DESKTOP", "doorsPerDesktop"),
  phoneBudgetPin("TERMINAL_LEGS", "terminalLegs"),
  phoneBudgetPin("WEB_VIEWS", "webViews"),
];

/**
 * F1 — a freeway value the phone's link BRANCHES on, read from ITS OWN block of registries.ts.
 * The block matters: `FREEWAY_CODES.PROTOCOL` is 4400 and `TERMINAL_PIPELINE_CLOSE_CODES.PROTOCOL`
 * is 4003, and a whole-file pattern would read the first. The match may not leave the block.
 * Captured text is compared verbatim (`_` grouping, `30 * 60_000`, `0x00`).
 */
const FREEWAY_CONTRACT = "apps/ios/VibeFieldKit/Sources/FieldFreeway/FreewayContract.swift";
const NUMBER = "[0-9_]+(?: \\* [0-9_]+)*";
const HEX = "0x[0-9A-Fa-f]+";
function freewayPin(block, key, swiftName, { indent = 2, value = NUMBER, type = "" } = {}) {
  return {
    name: `${block}.${key}`,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(
        `export const ${block} = \\{(?:(?!\\n\\} as const;)[\\s\\S])*?\\n {2}${key}: (${value}),\\n`,
      ),
      label: `${block}.${key}`,
    },
    copy: {
      file: FREEWAY_CONTRACT,
      pattern: new RegExp(`^ {${indent}}public static let ${swiftName}${type} = (${value})$`, "m"),
      label: `FreewayContract.${swiftName}`,
    },
  };
}
pins.push(
  freewayPin("PORTS", "FREEWAY_SERVE", "servePort"),
  freewayPin("FREEWAY", "PROTOCOL_MAJOR", "protocolMajor"),
  freewayPin("FREEWAY", "MISSED_PINGS", "missedPings"),
  freewayPin("FREEWAY", "ACK_EVERY_BYTES", "ackEveryBytes"),
  freewayPin("FREEWAY", "APPROVAL_TTL_MS", "approvalTtlMs"),
  freewayPin("FREEWAY", "APPROVAL_RENEW_MS", "approvalRenewMs"),
  freewayPin("FREEWAY", "MAX_TICKETS_PER_ASK", "maxTicketsPerAsk"),
  ...[
    ["LINK", "link"],
    ["OPEN", "open"],
    ["OPENED", "opened"],
    ["TEXT", "text"],
    ["BINARY", "binary"],
    ["CLOSE", "close"],
    ["WINDOW", "window"],
    ["OPEN_REFUSED", "openRefused"],
  ].map(([key, swift]) =>
    freewayPin("FREEWAY_FRAME", key, swift, { indent: 4, value: HEX, type: ": UInt8" }),
  ),
  {
    name: "FREEWAY_FRAGMENT_BIT",
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^export const FREEWAY_FRAGMENT_BIT = (${HEX});$`, "m"),
      label: "FREEWAY_FRAGMENT_BIT",
    },
    copy: {
      file: FREEWAY_CONTRACT,
      pattern: new RegExp(`^ {2}public static let fragmentBit: UInt8 = (${HEX})$`, "m"),
      label: "FreewayContract.fragmentBit",
    },
  },
  ...[
    ["PROTOCOL", "protocolError"],
    ["APPROVAL", "approval"],
    ["NOT_ADMITTED", "notAdmitted"],
    ["KIND_NOT_SERVED", "kindNotServed"],
    ["SUPERSEDED", "superseded"],
    ["PEER_GONE", "peerGone"],
    ["TWIN", "twin"],
    ["PROTOCOL_VERSION", "protocolVersion"],
    ["RESTARTING", "restarting"],
    ["DOOR_DOWN", "doorDown"],
  ].map(([key, swift]) => freewayPin("FREEWAY_CODES", key, swift, { indent: 4 })),
);

const pinProblems = [];
const notices = [];

/** The one captured group, or `null` when the pin lost its witness. */
function pinned({ file, pattern }) {
  try {
    return pattern.exec(readFileSync(join(root, file), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

// The self-arming pin, armed or announced. See `productServePin` above.
if (pinned(productServePin.origin) !== null) {
  pins.push(productServePin);
} else {
  notices.push(
    `${productServePin.origin.label} is unreadable, so ` +
      `${productServePin.copy.label} is UNPINNED (UA-P-1a)\n` +
      "  the row landed at UA-P-0e, so this means it was renamed or removed — the phone\n" +
      "  is dialing a number nothing agrees with. Fix the row, or move this pattern to it.",
  );
}

// The tick's pin, armed or announced. See `doorTickPin` above.
if (pinned(doorTickPin.origin) !== null) {
  pins.push(doorTickPin);
} else {
  notices.push(
    `${doorTickPin.origin.label} is unreadable, so ${doorTickPin.copy.label} is UNPINNED ` +
      "(SP-2)\n" +
      "  the row is SP-1's and lands with that lane; until then the phone's default tick\n" +
      "  interval is a literal nothing agrees with. When it lands, this pin arms itself.",
  );
}

for (const pin of pins) {
  const origin = pinned(pin.origin);
  const copy = pinned(pin.copy);
  // A pattern that stopped matching fails too. A pin nobody can read is not a
  // pin that agrees — it is a gate that quietly stopped being one.
  if (origin === null) {
    pinProblems.push(
      `${pin.origin.label} is unreadable in ${pin.origin.file}\n` +
        `  fix: restore the declaration, or move this script's pattern with it`,
    );
  } else if (copy === null) {
    pinProblems.push(
      `${pin.copy.label} is unreadable in ${pin.copy.file}\n` +
        `  fix: restore the declaration, or move this script's pattern with it`,
    );
  } else if (origin !== copy) {
    pinProblems.push(
      `${pin.copy.label} is "${copy}" but ${pin.origin.label} is "${origin}"\n` +
        `  fix: set ${pin.copy.label} to "${origin}" in ${pin.copy.file} — or move BOTH,` +
        ` deliberately, because it is the namespace every plane must share`,
    );
  }
}

if (problems.length > 0 || pinProblems.length > 0) {
  if (problems.length > 0) {
    console.error(`ios fixtures: ${problems.length} of ${checked} copies are stale\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
  }
  if (pinProblems.length > 0) {
    console.error(`ios pins: ${pinProblems.length} of ${pins.length} registry values drifted\n`);
    for (const problem of pinProblems) console.error(`  ${problem}\n`);
  }
  process.exit(1);
}

const values = pins.length === 1 ? "registry value" : "registry values";
console.log(`ios fixtures: ${checked} copies identical to packages/contracts/fixtures`);
console.log(`ios pins: ${pins.length} ${values} identical to packages/contracts/src/registries.ts`);
for (const notice of notices) console.log(`ios pins: NOTICE — ${notice}`);
