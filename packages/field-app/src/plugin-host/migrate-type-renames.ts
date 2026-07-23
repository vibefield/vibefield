import { decodeEnvelope, encodeEnvelope } from "@vibecook/ice";
import { LoroDoc, LoroMap } from "loro-crdt";
import { TYPE_RENAMES } from "./type-renames";

// C2 — the durable-ID migration (plugin spec §21.2; thinking-p1 close-out).
// Boards written before the 2026-07-23 ratification carry dev-era type strings
// in exactly four places (encoding probe, empirically proven): the
// `comp:PrefabId` cell VALUE, the `comp:<type>:<group>` cell NAME, the
// `engine.pack.<type>.<version>` meta marker, and the ICE1 envelope header's
// `prefabVersions` keys. Relations address entities by key — never by type —
// so they need nothing.
//
// THE ORDER LAW (the probe's zombie hazard): fold the ENTIRE journal into the
// doc FIRST, rename ONCE, emit one snapshot. A pre-rename journal entry
// replayed after the rewrite would `set` the old cell name straight back.
// Fold-first also makes re-migration harmless: a server-side journal that
// outlives the first migrated checkpoint just folds and renames again to the
// same result (idempotent by construction).
//
// Single-replica surgery, stated honestly: this rewrites bytes OFFLINE before
// attach, which is sound while a doc has one holder (P0 truth). When
// replica-everywhere ships, renames move to an in-band M9-style migration
// under the single-writer law — the ICE petition for a first-class
// rename-migration API is filed in the C2 close-out.

const COMP_PREFIX = "comp:";
const PACK_PREFIX = "engine.pack.";
const PREFAB_ID_CELL = "comp:PrefabId";

export interface TypeRenameResult {
  bytes: Uint8Array;
  migrated: boolean;
  /** cells + markers rewritten (0 ⇒ bytes returned untouched, by reference) */
  renamedCells: number;
}

export function migrateTypeRenames(
  initialBytes: Uint8Array,
  initialUpdates: readonly Uint8Array[],
  renames: Readonly<Record<string, string>> = TYPE_RENAMES,
): TypeRenameResult {
  const { header, payload } = decodeEnvelope(initialBytes);
  const doc = new LoroDoc();
  doc.import(payload);
  for (const update of initialUpdates) doc.import(update);

  let renamed = 0;
  const entities = doc.getMap("entities");
  for (const entityKey of entities.keys()) {
    const child = entities.get(entityKey);
    if (!(child instanceof LoroMap)) continue; // poisoned-entry guard (strata's own childMap idiom)
    for (const rawKey of [...child.keys()]) {
      const cellKey = String(rawKey);
      if (cellKey === PREFAB_ID_CELL) {
        const value = child.get(cellKey);
        const id =
          value !== null && typeof value === "object" ? (value as { id?: unknown }).id : undefined;
        const next = typeof id === "string" ? renames[id] : undefined;
        if (next !== undefined) {
          child.set(cellKey, { ...(value as Record<string, unknown>), id: next });
          renamed++;
        }
      } else if (cellKey.startsWith(COMP_PREFIX)) {
        // `comp:<type>:<group>` — the group suffix survives verbatim; only the
        // type segment renames. A component name with no group colon is not a
        // widget-generated cell and stays untouched.
        const name = cellKey.slice(COMP_PREFIX.length);
        const colon = name.indexOf(":");
        const type = colon > 0 ? name.slice(0, colon) : undefined;
        const next = type !== undefined ? renames[type] : undefined;
        if (next !== undefined) {
          const value = child.get(cellKey);
          child.delete(cellKey);
          child.set(`${COMP_PREFIX}${next}${name.slice(colon)}`, value as never);
          renamed++;
        }
      }
    }
  }

  const meta = doc.getMap("meta");
  for (const rawKey of [...meta.keys()]) {
    const markerKey = String(rawKey);
    if (!markerKey.startsWith(PACK_PREFIX)) continue;
    // `engine.pack.<prefabId>.<version>` — prefabId itself contains dots; the
    // version is the LAST segment (version-gate's own lastIndexOf parse).
    const rest = markerKey.slice(PACK_PREFIX.length);
    const dot = rest.lastIndexOf(".");
    if (dot <= 0) continue;
    const next = renames[rest.slice(0, dot)];
    if (next !== undefined) {
      const newKey = `${PACK_PREFIX}${next}${rest.slice(dot)}`;
      if (meta.get(newKey) === undefined) meta.set(newKey, true);
      meta.delete(markerKey);
      renamed++;
    }
  }

  if (renamed === 0) return { bytes: initialBytes, migrated: false, renamedCells: 0 };

  doc.commit();
  const prefabVersions = Object.fromEntries(
    Object.entries(header.prefabVersions ?? {}).map(([id, v]) => [renames[id] ?? id, v]),
  );
  return {
    bytes: encodeEnvelope({ ...header, prefabVersions }, doc.export({ mode: "snapshot" })),
    migrated: true,
    renamedCells: renamed,
  };
}
