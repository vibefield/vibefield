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
const LANE_AUTHORED = new Set(["trf1-frames.lane.json"]);

const problems = [];
let checked = 0;

for (const searchRoot of searchRoots) {
  for (const copy of jsonFiles(searchRoot)) {
    const name = copy.slice(copy.lastIndexOf("/") + 1);
    const origin = join(contracts, name);
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
 * UA-P-1a — the product serve's tailnet port, pinned the day the registry
 * declares it.
 *
 * **It is not armed yet, and the NOTICE below is why.** `PORTS` carries no
 * product-serve row: the serve fieldd declares names no `listenPort`
 * (`packages/fieldd/src/daemon.ts`, `productServeSpec`), so the floor falls its
 * listener back to the TARGET port (`packages/field-native/src/mgmt/mesh.rs`,
 * `parse_listen_port`), which since UA-5 is fieldd's EPHEMERAL control port.
 * Discovery by the door needs a number a phone can dial, so the desktop lane is
 * declaring an explicit `listenPort` on a new registry row — and the phone's
 * `FieldMeshContract.productServePort` is a hand-picked constant until it does.
 *
 * This pin therefore ARMS ITSELF: it joins `pins` the moment the registry row
 * is readable, and from then on a drift reds the gate like every other value.
 * Until then the run prints a NOTICE rather than skipping in silence — a gate
 * that stops gating without saying so is the exact failure this script exists
 * to catch, and an unarmed pin nobody is told about is one.
 */
const productServePin = {
  name: "PRODUCT_SERVE",
  origin: {
    file: REGISTRIES,
    pattern: /^ {2}PRODUCT_SERVE: ([0-9_]+),$/m,
    label: "PORTS.PRODUCT_SERVE",
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
];

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
    `${productServePin.origin.label} does not exist yet, so ` +
      `${productServePin.copy.label} is UNPINNED (UA-P-1a)\n` +
      "  the phone dials a hand-picked number until the desktop lane declares the row;\n" +
      "  this pin arms itself the moment it does, and nothing else need change",
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
