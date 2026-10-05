import { type CanvasEngine, gateVerdict, type WidgetType } from "@vibecook/ice";
import { DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import type { PluginRegistrySnapshot } from "@vibefield/contracts";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { getRendererLogger } from "../../logging";
import {
  getPluginRegistrySnapshot,
  subscribePluginRegistry,
} from "../../plugin-host/plugin-registry-store";

// THE PACK MARKERS (DK-4; DK-D17 ruled 2 Oct; r2 R5): ICE gates PLACEMENT on a board's pack markers — a type
// whose pack the board does not carry is refused `pack-disabled` at every create, insert and drop, and the
// pegboard offers none of it — and only `docs.upgradeCapabilities` adds one. `docs.create` stamps the whole
// catalog, so a board made here already carries every kind this build compiles; a board OPENED here may not (one
// made on another desktop, or here before a plugin came). So at every open the board gains the packs of what is
// ON — the desk's own kinds and every registered plugin's object kinds, a disabled plugin's excepted — and a
// plugin enabled mid-session adds its own at the enable (the registry snapshot that says so). Idempotent: a board
// that carries them all is not written. A marker is forever (ICE's meta has no delete), which is why a disabled
// plugin's packs are never stamped on its behalf.
//
// THE ENABLE'S STAMP WAITS (DK-9; DK-5 input (2)): a pack stamped on a board ANOTHER desktop holds open
// would re-gate that desktop read-only until it reopened (its catalog lacks the type). So a pack the board
// LACKS is stamped only while no other desktop holds it live — fieldd's word (`doc.holders`: the peers
// whose presence lane reaches the board's room) — and otherwise waits, said once, for the board's next
// open or the next snapshot that asks again; THIS desktop draws the kind at once, and places it once the
// stamp lands (ICE refuses `pack-disabled` before). A pack the board already carries is never asked about.
// Its other half: a desktop handed a pack it lacks learns it live (the session reopens on a ghost stub).

/** How many times a held board is asked again after a publish before the host says so and lets it be. */
const RETRIES = 3;

/** The object types a board should carry the packs of: the desk's kinds, and every registered plugin's object
 * kinds unless its record says it is disabled — no snapshot yet (the daemon away) disables nothing. (DK-8: the
 * widget rows this once skipped — a widget placed nowhere on the desk — retired with `contributes.widgets`.) */
export function capabilityTypes(
  registry: PluginRegistry<WidgetType>,
  snapshot: PluginRegistrySnapshot | null,
): string[] {
  const types = DESK_OBJECTS.map((kind) => kind.type);
  for (const plugin of registry.all()) {
    if (snapshot?.plugins.find((record) => record.id === plugin.id)?.enabled === false) continue;
    for (const object of plugin.objectContributions) types.push(object.type);
  }
  return types;
}

/** Add the packs the open board lacks (`capabilityTypes`, those this engine compiles). False when nothing was
 * added or no WRITABLE board is open — a read-only board is never upgraded. It throws where the facade's own
 * writer gate holds the board for a moment (a peer's change not yet judged; its diagnostics refresh at the next
 * publish) — `bindCapabilityUpgrades` asks again after it. */
export function upgradeFieldCapabilities(
  ce: CanvasEngine,
  registry: PluginRegistry<WidgetType>,
  snapshot: PluginRegistrySnapshot | null = getPluginRegistrySnapshot(),
): boolean {
  const session = ce.docs.current();
  if (session === undefined || session.readOnly || gateVerdict(session.versionReport()) !== "ok")
    return false;
  const types = capabilityTypes(registry, snapshot).filter(
    (type) => ce.catalog.widget(type) !== undefined,
  );
  return ce.docs.upgradeCapabilities(types);
}

/** The packs the open board LACKS of what is on (`capabilityTypes`, those this engine compiles) — what an
 * upgrade would stamp. Empty when nothing is missing or no writable board is open. */
export function lackingCapabilities(
  ce: CanvasEngine,
  registry: PluginRegistry<WidgetType>,
  snapshot: PluginRegistrySnapshot | null = getPluginRegistrySnapshot(),
): string[] {
  const session = ce.docs.current();
  if (session === undefined || session.readOnly) return [];
  const docPacks = session.versionReport().docPacks;
  return capabilityTypes(registry, snapshot).filter(
    (type) => ce.catalog.widget(type) !== undefined && docPacks[type] === undefined,
  );
}

export interface CapabilityBindingOptions {
  /** DK-9 — whether another desktop holds the board open NOW (fieldd's `doc.holders`). Absent: no wait. */
  readonly heldElsewhere?: () => Promise<boolean>;
}

/**
 * The open board's packs, kept: upgraded NOW (the open — call it with the document live and writable, before its
 * journal is replayed, while the facade's gate is clean) and again at every registry snapshot (a plugin enabled
 * mid-session). A board the gate holds is asked once more after the next publish — at most `RETRIES` times, then
 * the host says why and leaves it for the next snapshot or open (never a retry per frame). DK-9: with
 * `heldElsewhere`, a pack the board LACKS waits while another desktop holds it open. Returns the unbind.
 */
export function bindCapabilityUpgrades(
  ce: CanvasEngine,
  registry: PluginRegistry<WidgetType>,
  opts: CapabilityBindingOptions = {},
): () => void {
  let ended = false;
  let tries = 0;
  let pendingRetry: (() => void) | null = null;
  let asking = false;
  let waitedFor = "";
  const attempt = (): void => {
    if (ended) return;
    const heldElsewhere = opts.heldElsewhere;
    if (heldElsewhere === undefined) {
      upgrade();
      return;
    }
    const lacking = lackingCapabilities(ce, registry);
    if (lacking.length === 0 || asking) return;
    asking = true;
    void heldElsewhere().then(
      (held) => {
        asking = false;
        if (ended) return;
        if (!held) {
          upgrade();
          return;
        }
        const key = lacking.join(" ");
        if (key === waitedFor) return; // said once per wait
        waitedFor = key;
        getRendererLogger()
          .child({ component: "board.session" })
          .info(
            "renderer.board.capabilities_waiting",
            "Another desktop holds this board open: its new packs wait for the board's next open",
            { types: lacking },
          );
      },
      () => {
        asking = false;
        if (!ended) upgrade();
      },
    );
  };
  const upgrade = (): void => {
    if (ended) return;
    try {
      upgradeFieldCapabilities(ce, registry);
    } catch (error) {
      if (pendingRetry !== null) return;
      if (tries >= RETRIES) {
        getRendererLogger()
          .child({ component: "board.session" })
          .warn(
            "renderer.board.capabilities_refused",
            "The board's packs were not added; its objects may refuse new kinds",
            { error: error instanceof Error ? error.message : String(error) },
          );
        return;
      }
      tries += 1;
      const off = ce.engine.onPublish(() => {
        off();
        pendingRetry = null;
        // after the step, once the facade's publish hook has judged the board again
        queueMicrotask(attempt);
      });
      pendingRetry = off;
      ce.frame.wake("vf:capabilities");
    }
  };
  const fresh = (): void => {
    tries = 0;
    attempt();
  };
  fresh();
  const offRegistry = subscribePluginRegistry(fresh);
  return () => {
    ended = true;
    offRegistry();
    pendingRetry?.();
    pendingRetry = null;
  };
}
