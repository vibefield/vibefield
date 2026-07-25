// THE fuse matrix (electron-security-packaging.md §9.1). One checked-in
// expectation per fuse in the pinned @electron/fuses schema, each with the
// reason it holds that value — a fuse table without reasons is a table nobody
// can safely change.
//
// §9.1's law: every supported fuse MUST appear here, and an added or removed
// fuse makes the audit fail until reviewed. That is enforced two ways — this
// file is compared against the enum at flip time, and `strictlyRequireAllFuses`
// makes @electron/fuses itself refuse a partial config.
//
// TRANSITIONAL entries are the ones that are NOT yet where they are going. They
// carry `status: "transitional-required"` so the audit reports them as a
// deliberate debt with a named owner slice, never as a passing state (ESP §3.1:
// "the expected fuse report MUST label this state `transitional-required`, not
// merely `on`").
//
// WHY @electron/fuses IS PINNED EXPLICITLY (WP5, 2026-07-25): electron-builder
// pulls in 1.8.0 transitively, whose V1 enum stops at index 7 — it has no name
// for `WasmTrapHandlers`. Electron 43's actual fuse wire carries NINE fuses, so
// building against the transitive version failed immediately and correctly:
// "the fuse wire has 9 fuses but you only provided a config for 8". That error
// is `strictlyRequireAllFuses` doing precisely the job §9.1 describes — a fuse
// the tool cannot name is a fuse that would otherwise ship at its default,
// unexpressed and unaudited. The fix is the explicit ^2.1.3 dependency, not a
// narrower config; a stale fuse library silently under-configures the wire.

/** Fuse name → wire index, mirrored from @electron/fuses' FuseV1Options. Kept
 * as data so the flip hook can prove the enum still matches this file. */
export const FUSE_WIRE_INDEX = Object.freeze({
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3,
  EnableEmbeddedAsarIntegrityValidation: 4,
  OnlyLoadAppFromAsar: 5,
  LoadBrowserProcessSpecificV8Snapshot: 6,
  GrantFileProtocolExtraPrivileges: 7,
  WasmTrapHandlers: 8,
});

/** @typedef {"final" | "transitional-required" | "measurement-gated"} FuseStatus */

export const FUSE_MATRIX = Object.freeze({
  RunAsNode: {
    enabled: true,
    status: "transitional-required",
    owner: "WP9 / ESP §9.3",
    reason:
      "Production fieldd still launches as Electron-as-node (ESP-2). Electron IGNORES " +
      "ELECTRON_RUN_AS_NODE when this fuse is off, so disabling it now would not harden the " +
      "app — it would stop the daemon starting. Closes when the standalone launcher lands.",
  },
  EnableCookieEncryption: {
    enabled: true,
    status: "final",
    reason:
      "OS-backed encryption of Chromium cookie values at rest. Enabled BEFORE any persistent " +
      "profile ships because the transition is one-way (ESP-11); doing it later would strand " +
      "already-written cookies.",
  },
  EnableNodeOptionsEnvironmentVariable: {
    enabled: false,
    status: "final",
    reason:
      "Refuses ambient NODE_OPTIONS injection by a same-uid process (§4.1's threat model). " +
      "Also removes ambient NODE_EXTRA_CA_CERTS from the Electron runtime — a deliberate cost " +
      "(§9.4), not an oversight: enterprise CAs get an explicit trust design if they become a " +
      "requirement.",
  },
  EnableNodeCliInspectArguments: {
    enabled: false,
    status: "final",
    reason:
      "Refuses --inspect / SIGUSR1 debugger activation in production. A local attacker who can " +
      "attach a debugger to main owns every capability the shell brokers.",
  },
  EnableEmbeddedAsarIntegrityValidation: {
    enabled: true,
    status: "final",
    reason:
      "Validates app.asar against the hashes embedded in the app bundle, so tampered app code " +
      "fails closed on macOS/Windows. Paired with OnlyLoadAppFromAsar — either alone leaves a " +
      "path open (ESP-10). Protects APP CODE ONLY: sidecars and staged plugins carry their own " +
      "verification.",
  },
  OnlyLoadAppFromAsar: {
    enabled: true,
    status: "final",
    reason:
      "Removes the unpacked `app/` and default_app.asar fallback search paths, so integrity " +
      "validation cannot be sidestepped by dropping a directory beside the archive.",
  },
  LoadBrowserProcessSpecificV8Snapshot: {
    enabled: false,
    status: "measurement-gated",
    owner: "ESP §9.1",
    reason:
      "No browser-process-specific V8 snapshot is designed or built, so enabling it would point " +
      "Electron at an artifact that does not exist. Left at Electron's default.",
  },
  GrantFileProtocolExtraPrivileges: {
    enabled: true,
    status: "transitional-required",
    owner: "WP7 / ESP §8.3 stage F2",
    reason:
      "The packaged renderer still loads through loadFile() (stage F0). Disabling it before the " +
      "vibefield-app:// custom origin ships would break the renderer rather than harden it — " +
      "§8.3 stages this deliberately.",
  },
  WasmTrapHandlers: {
    enabled: true,
    status: "final",
    reason:
      "VibeField is WASM-heavy — loro drives every canvas document, and the renderer inlines its " +
      "wasm. Trap-handler-based bounds checking is what keeps that cheap; disabling it moves " +
      "bounds checks into emitted code, costing size and speed for no security gain here.",
  },
});

/** The config shape @electron/fuses wants: {[FuseV1Options]: boolean}. */
export function fuseConfigFromMatrix(matrix = FUSE_MATRIX) {
  const config = {};
  for (const [name, entry] of Object.entries(matrix)) {
    const index = FUSE_WIRE_INDEX[name];
    if (index === undefined) throw new Error(`fuse-matrix: ${name} has no wire index`);
    config[index] = entry.enabled;
  }
  return config;
}

/** Prove this file still describes the tool's schema. Catches the case §9.1
 * cares about most: an Electron upgrade ADDS a fuse and every existing
 * expectation still passes, so the new one ships at whatever default it has. */
export function reconcileWithEnum(fuseV1Options) {
  const enumNames = Object.keys(fuseV1Options).filter((k) => Number.isNaN(Number(k)));
  const ours = Object.keys(FUSE_WIRE_INDEX);
  const missing = enumNames.filter((n) => !ours.includes(n));
  const extra = ours.filter((n) => !enumNames.includes(n));
  const misindexed = enumNames
    .filter((n) => ours.includes(n) && fuseV1Options[n] !== FUSE_WIRE_INDEX[n])
    .map((n) => `${n}: tool=${fuseV1Options[n]} matrix=${FUSE_WIRE_INDEX[n]}`);
  const unexpressed = ours.filter((n) => !(n in FUSE_MATRIX));
  return { missing, extra, misindexed, unexpressed };
}

/** @electron/fuses' FuseState is a NUMERIC enum of ASCII char codes, not the
 * strings its names suggest: '0'=48 DISABLE, '1'=49 ENABLE, 'r'=114 REMOVED,
 * 144 INHERIT. Readback returns those numbers, so a comparator written against
 * the names silently reports every fuse as disabled. Defaulted here so this
 * module stays testable without the dependency; the hook passes the real enum
 * so the tool remains the authority. */
export const FUSE_STATE = Object.freeze({ DISABLE: 48, ENABLE: 49, REMOVED: 114, INHERIT: 144 });

/** Compare a readback wire against the matrix. */
export function compareWire(wire, { matrix = FUSE_MATRIX, state = FUSE_STATE } = {}) {
  const mismatches = [];
  const transitional = [];
  for (const [name, entry] of Object.entries(matrix)) {
    const index = FUSE_WIRE_INDEX[name];
    const actual = wire[index] ?? wire[String(index)];
    const want = entry.enabled;

    if (actual === undefined) {
      mismatches.push(`${name}: absent from the readback wire`);
      continue;
    }
    // REMOVED means the fuse left this Electron's wire entirely — a schema
    // change §9.1 wants reviewed, never silently tolerated.
    if (actual === state.REMOVED) {
      mismatches.push(`${name}: removed from this Electron's fuse wire — review the matrix`);
      continue;
    }
    // INHERIT means the flip did not take: the fuse still holds whatever the
    // upstream Electron build shipped, which is exactly the unexpressed state
    // this matrix exists to eliminate.
    if (actual === state.INHERIT) {
      mismatches.push(`${name}: still INHERIT — the flip did not take`);
      continue;
    }
    const got = actual === state.ENABLE;
    if (got !== want) {
      mismatches.push(`${name}: expected ${want ? "ENABLE" : "DISABLE"}, read ${String(actual)}`);
    }
    if (entry.status === "transitional-required") {
      transitional.push(`${name} (${entry.owner ?? "unowned"}) — ${want ? "on" : "off"} for now`);
    }
  }
  return { ok: mismatches.length === 0, mismatches, transitional };
}
