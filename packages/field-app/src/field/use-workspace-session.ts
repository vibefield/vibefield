import { type CanvasEngine, decodeEnvelope, type WidgetType } from "@vibecook/ice";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import {
  type MutableRefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { setBoardStatus } from "../board-status";
import type { DocManager, DocManagerState } from "../doc-manager";
import { captureDocThumbnailScene } from "../doc-thumbnail-scene";
import { buildRegistry, createFieldEngine, seedField } from "../field-engine";
import { buildGhostWidgetTypes } from "../plugin-host/ghost-stubs";
import { migrateTypeRenames } from "../plugin-host/migrate-type-renames";
import { bindPersistence } from "./persistence-controller";

// WorkspaceSession (§5.4.3): exactly ONE ICE engine generation and ONE
// document-attach lifetime. The two named invariants live here:
//
// THE STRICTMODE TWIN-ENGINE LAW — the document attaches only to the
// COMMITTED engine, in a layout effect, never in the memo factory that
// StrictMode double-invokes (the twin must never stream to the daemon).
//
// ONE ENGINE PER DOC (B4 fix, 2026-07-21): a doc switch REMOUNTS the engine
// and the whole canvas stack (FieldView keys the stage on generation). The
// store layer supports in-place close→open (doc-swap.test pins it), but the
// composition stacks six stateful layers on the engine (GL bridge/router/
// plane, halo, ground, devtools) and the retained GL + WebGPU frames survive
// a world reset — field report: stale 3D cards + wires after "new field".
// Remounting lands every switch on the exact path boot/restart already
// prove, behind the veil. The extra virgin engine at first boot (generation
// 0 → 1) is the accepted cost of uniformity.

export interface WorkspaceSession {
  ce: CanvasEngine;
  registry: PluginRegistry<WidgetType>;
  generation: number;
  docState: DocManagerState;
}

export function useWorkspaceSession(
  manager: DocManager,
  /** CanvasStage publishes its GL/halo teardown here; engine disposal runs it
   * FIRST — the GL disposal order invariant, structural. */
  stageDisposeRef: MutableRefObject<(() => void) | null>,
): WorkspaceSession {
  const docState = useSyncExternalStore(manager.subscribe, manager.getState);
  const pending = docState.pending;
  const generation = pending?.generation ?? 0;
  // P3c: every PRESENT plugin registers unconditionally (ICE's catalog is
  // process-permanent — the only way enable/disable round-trips in-session);
  // disabled plugins swap FACES live (faces.tsx), never registrations. The
  // registry is therefore stable for the whole mount again.
  const registry = useMemo(buildRegistry, []);
  // Ghost stubs (§12.4 absent case): the pending doc's envelope header names
  // every widget type + pack version pre-open; types NO present plugin owns
  // register as preserving placeholders AT THE DOC'S VERSION, so the engine's
  // pack-marker gate stays satisfied and the board opens writable. Sampled per
  // generation — ghosts are doc-shaped. Unreadable envelopes yield no stubs;
  // docs.open's own quarantine stays the honest catch.
  const ghosts = useMemo(() => {
    const bytes = pending?.initialBytes ?? null;
    if (bytes === null) return [];
    try {
      const { header } = decodeEnvelope(bytes);
      return buildGhostWidgetTypes(header.prefabVersions, new Set(registry.allWidgets().keys()));
    } catch {
      return [];
    }
  }, [pending, registry]);
  const ce = useMemo(() => createFieldEngine(registry, ghosts), [registry, ghosts, generation]);

  // B3 law carried into B4 — the doc attaches to the COMMITTED engine only,
  // never in the memo factory. Keyed on the manager's pending session: a doc
  // switch tears the old session down only after the manager has durably
  // flushed it, then lands the new one before paint.
  useLayoutEffect(() => {
    if (pending === null) return;
    const lane = pending.lane;
    if (pending.initialBytes !== null) {
      // C2 — the durable-ID migration: fold the journal and rename ONCE,
      // pre-attach (a pre-rename journal entry replayed post-rewrite would
      // resurrect old cells). Migration failure falls through to the untouched
      // bytes — the quarantine path below stays the honest catch.
      let bytes = pending.initialBytes;
      let updates: readonly Uint8Array[] = pending.initialUpdates;
      try {
        const migration = migrateTypeRenames(pending.initialBytes, pending.initialUpdates);
        if (migration.migrated) {
          console.log(`[board] C2 type-rename migration: ${migration.renamedCells} cell(s)`);
          bytes = migration.bytes;
          updates = []; // the journal is folded into the migrated snapshot
        }
      } catch (error) {
        console.warn(`[board] type-rename migration skipped: ${String(error)}`);
      }
      const res = ce.docs.open(bytes);
      if (!res.ok) {
        // Honest quarantine (the M5 law): the at-rest bytes stay untouched on
        // disk; a blank board + surfaced state beats autosaving over them.
        console.error(`[board] quarantined: ${res.reason}`);
        setBoardStatus({ state: "quarantined", detail: res.reason });
        ce.docs.create();
        ce.world.sync();
        manager.contentApplied(pending.generation);
        return () => ce.docs.close();
      }
      try {
        for (const update of updates) res.session.applyRemote(update);
      } catch (error) {
        ce.docs.close();
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[board] journal quarantined: ${detail}`);
        setBoardStatus({ state: "quarantined", detail });
        ce.docs.create();
        ce.world.sync();
        manager.contentApplied(pending.generation);
        return () => ce.docs.close();
      }
      ce.world.sync();
      if (res.session.readOnly) {
        // P2 — the engine's pack-marker gate (ghost probe 2026-07-23): a board
        // carrying widgets of an UNREGISTERED plugin (or a newer schema) opens
        // READ-ONLY — never quarantined, never lossy; re-enabling the plugin
        // restores write, and P3's missing faces (spec §12.4) are the planned
        // lift. No persistence bind: nothing can commit, and autosave's
        // dirty-start PUT would stomp this honest status row.
        const missing = res.session.report?.newerInDoc ?? [];
        const detail = missing.length > 0 ? `needs ${missing.join(", ")}` : "newer doc schema";
        console.warn(`[board] read-only: ${detail}`);
        setBoardStatus({ state: "readonly", detail });
        manager.contentApplied(pending.generation);
        return () => ce.docs.close();
      }
    } else {
      const session = ce.docs.create();
      // The demo scene belongs to the bootstrap default doc alone (seed flag);
      // user-created docs open as an empty field.
      if (pending.seed) seedField(ce, session, registry);
      else ce.world.sync();
    }
    if (lane === null) {
      // degraded (in-memory) session — the manager already set the board row
      manager.contentApplied(pending.generation);
      return () => ce.docs.close();
    }
    const unbindPersistence = bindPersistence({ ce, manager, pending, lane });
    manager.contentApplied(pending.generation);
    return () => {
      unbindPersistence();
      ce.docs.close();
    };
  }, [ce, manager, pending, registry]);

  // Natural boot framing (widgetlab, 2026-07-18: "zoom to fit, but with an
  // upper and bottom cap"): frame the content once the viewport is measured
  // and membership has stamped the first tick. Re-keyed per doc generation
  // (B4): a switched-in doc gets its own arrival framing.
  useEffect(() => {
    if (generation === 0) return; // no doc landed yet — the veil is up
    let presentFrame: number | null = null;
    const present = (): void => {
      presentFrame = requestAnimationFrame(() => manager.canvasPresented(generation));
    };
    // An empty field has nothing to frame, but still needs one painted frame
    // before the cover reveals it.
    if (captureDocThumbnailScene(ce).widgets.length === 0 || ce.ops.frameContent()) {
      present();
      return () => {
        if (presentFrame !== null) cancelAnimationFrame(presentFrame);
      };
    }
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (ce.ops.frameContent() || tries > 40) {
        clearInterval(id);
        present();
      }
    }, 50);
    return () => {
      clearInterval(id);
      if (presentFrame !== null) cancelAnimationFrame(presentFrame);
    };
  }, [ce, generation, manager]);

  // Engine lifecycle (one per doc): when the generation re-keys `ce`, tear the
  // PRIOR engine's wiring down and dispose it. Ordering is safe by React's
  // rules: the attach layout-effect's cleanup (final flush → stop → close)
  // runs in the commit phase, BEFORE this passive cleanup disposes the engine;
  // the stage's GL/halo teardown runs FIRST via the shared ref (idempotent —
  // the stage's own unmount cleanups may already have run it).
  useEffect(() => {
    return () => {
      stageDisposeRef.current?.();
      ce.dispose();
    };
  }, [ce, stageDisposeRef]);

  return { ce, registry, generation, docState };
}
