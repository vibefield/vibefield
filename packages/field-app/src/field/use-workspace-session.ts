import { type CanvasEngine, decodeEnvelope, type WidgetType } from "@vibecook/ice";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { setBoardStatus } from "../board-status";
import type { DocManager, DocManagerState } from "../doc-manager";
import { buildRegistry, createFieldEngine, fieldPackScope, seedField } from "../field-engine";
import { getActiveView, subscribeActiveView } from "../frame/view-state";
import type { FieldUserProfile } from "../host";
import { getRendererLogger } from "../logging";
import {
  type BehaviorGenerationEvent,
  BehaviorGenerationHost,
  connectBehaviorGenerationHost,
} from "../plugin-host/behavior-generation-host";
import { setActiveCanvasEngine } from "../plugin-host/canvas-engine-ref";
import { buildGhostWidgetTypes } from "../plugin-host/ghost-stubs";
import type { PreparedRendererPlugins } from "../plugin-host/staged-loader";
import type { WindowKinds } from "../plugin-host/window-kinds";
import { deskBlobs } from "./desk/desk-blobs";
import { bindCapabilityUpgrades } from "./desk/desk-capabilities";
import { currentDesk, deskCensus } from "./desk/desk-door";
import { watchPacksLearned } from "./desk/desk-packs";
import { seedsExamples, seedTryTypes } from "./desk/desk-seed";
import { createDeskStills } from "./desk/desk-stills";
import { isBeforeTheDesk, rootIsBeforeTheDesk } from "./desk/pre-desk";
import { attachDocumentPresence } from "./document-presence";
import { bindPersistence } from "./persistence-controller";

let nextBehaviorRuntimeGeneration = 0;

function logBehaviorGenerationEvent(event: BehaviorGenerationEvent): void {
  const attrs = {
    behaviorId: event.declarationId,
    runtimeGeneration: event.target.runtimeGeneration,
    ...(event.orderKey === undefined ? {} : { orderKey: event.orderKey }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.record === undefined ? {} : { ledger: event.record }),
  };
  const log = getRendererLogger().child({
    component: "plugin.behavior.host",
    docId: event.target.documentId,
    ...(event.pluginId === undefined ? {} : { pluginId: event.pluginId }),
  });
  switch (event.type) {
    case "register":
      log.debug("renderer.plugin.behavior_registered", "A plugin behavior was registered", attrs);
      break;
    case "unregister":
      log.debug(
        "renderer.plugin.behavior_unregistered",
        "A plugin behavior was unregistered",
        attrs,
      );
      break;
    case "rollback":
      log.warn(
        "renderer.plugin.behavior_registration_rolled_back",
        "A failed behavior batch addition was rolled back",
        attrs,
      );
      break;
    case "ledger":
      if (event.record?.suspended) {
        log.warn(
          "renderer.plugin.behavior_breaker_changed",
          "A plugin behavior breaker changed",
          attrs,
        );
      } else {
        log.debug(
          "renderer.plugin.behavior_breaker_changed",
          "A plugin behavior breaker changed",
          attrs,
        );
      }
      break;
    case "error":
      log.error(
        "renderer.plugin.behavior_host_error",
        "A plugin behavior host operation failed",
        event.error,
        attrs,
      );
      break;
    case "close":
      log.debug(
        "renderer.plugin.behavior_generation_closed",
        "The document behavior generation closed",
        attrs,
      );
      break;
  }
}

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
// composition stacked stateful layers on the engine and the retained frames
// survived a world reset — field report: stale 3D cards + wires after "new
// field". Remounting lands every switch on the exact path boot/restart
// already prove, behind the veil. The extra virgin engine at first boot
// (generation 0 → 1) is the accepted cost of uniformity. On the desk (DK-3,
// ruling 1) the stage's layer is per generation too: a switch is a new desk.
//
// A BOARD FROM BEFORE THE DESK (ruling 7) is refused here, at open: its
// envelope says so before anything is imported, so it is never opened —
// no ghost stubs, no `docs.open`, no presence, no persistence — and the stage
// shows the card in its place while the library marks it.
//
// THE PACK MARKERS (DK-4, DK-D17): every writable board this session opens or
// makes gains the packs of what is on — the desk's kinds and the enabled
// plugins' object kinds — at the open, and again when a plugin is enabled
// mid-session; ICE refuses to place a kind whose pack the board lacks. DK-9: a
// pack the board LACKS waits while another desktop holds it open (fieldd's
// `doc.holders`), and a pack a live update brings that this engine does not
// compile is LEARNED — the board reopens on a ghost stub for it, writable.
//
// THE RUNTIME WITH KINDS (DK-9, plugin-host/window-kinds.ts): each generation's
// registry is built from the window's plugin set AS IT STANDS at that
// generation — the boot's, grown by a plugin enabled mid-session — and every
// opened board registers its REOPEN, what `DocManager.remount` asks of it to
// carry the same board onto a new engine.

export interface WorkspaceSession {
  ce: CanvasEngine;
  registry: PluginRegistry<WidgetType>;
  generation: number;
  docState: DocManagerState;
  /** The pending board is from before the desk: refused at open, never opened. */
  beforeTheDesk: boolean;
}

export function useWorkspaceSession(
  manager: DocManager,
  /** P8b-3 — the plugins the boot phase staged and activated. Passed in rather
   * than fetched here: the registry is built synchronously in the memo below,
   * so every import had to finish before this hook ever ran. */
  plugins?: PreparedRendererPlugins,
  /** Supervisor-owned identity. No profile means the optional room coeffect
   * stays off; persistence and every non-ephemeral behavior remain unchanged. */
  profile?: FieldUserProfile,
  /** DK-9 — the window's kinds: its plugin set per generation (`current()`), which a mid-session
   * enable grows. Absent (harnesses): the boot's `plugins`, fixed. */
  kinds?: WindowKinds,
): WorkspaceSession {
  const docState = useSyncExternalStore(manager.subscribe, manager.getState);
  const pending = docState.pending;
  const generation = pending?.generation ?? 0;
  const beforeTheDesk = useMemo(
    () => pending?.initialBytes != null && isBeforeTheDesk(pending.initialBytes),
    [pending],
  );
  // P3c: every PRESENT plugin registers unconditionally (ICE's catalog is
  // process-permanent — the only way enable/disable round-trips in-session);
  // disabling a plugin never changes registrations (what a disabled plugin's
  // kinds draw is DK-9's; the widget-face swapper, faces.tsx, retired with
  // `contributes.widgets` at DK-8). The registry is therefore stable for the
  // whole mount again.
  // DK-9: re-read per generation — the same object until a plugin enabled mid-session was staged, so a
  // doc switch rebuilds nothing; the generation that remount opens compiles the grown set's kinds
  // (`generation` in the deps is the re-read's clock)
  const prepared = useMemo(() => kinds?.current() ?? plugins, [kinds, plugins, generation]);
  const registry = useMemo(() => buildRegistry(prepared), [prepared]);
  // Ghost stubs (§12.4 absent case): the pending doc's envelope header names
  // every widget type + pack version pre-open; types NO pack of this engine
  // covers register as FACELESS preserving stubs AT THE DOC'S VERSION, so the
  // engine's pack-marker gate stays satisfied and the board opens writable.
  // Sampled per generation — ghosts are doc-shaped. Unreadable envelopes yield
  // no stubs; docs.open's own quarantine stays the honest catch. DK-2: the
  // filter is the engine's full pack scope (the desk's kinds and data prefabs
  // included), never only the plugin registry's types (r2 R4).
  const ghosts = useMemo(() => {
    const bytes = pending?.initialBytes ?? null;
    // a refused board stubs nothing: it is never opened
    if (bytes === null || beforeTheDesk) return [];
    try {
      const { header } = decodeEnvelope(bytes);
      return buildGhostWidgetTypes(header.prefabVersions, fieldPackScope(registry));
    } catch {
      return [];
    }
  }, [pending, registry, beforeTheDesk]);
  const engineGeneration = useMemo(
    () => ({
      ce: createFieldEngine(registry, ghosts),
      runtimeGeneration: `field-engine-${++nextBehaviorRuntimeGeneration}`,
    }),
    [registry, ghosts, generation],
  );
  const { ce, runtimeGeneration } = engineGeneration;

  // B3 law carried into B4 — the doc attaches to the COMMITTED engine only,
  // never in the memo factory. Keyed on the manager's pending session: a doc
  // switch tears the old session down only after the manager has durably
  // flushed it, then lands the new one before paint.
  useLayoutEffect(() => {
    if (pending === null) return;
    if (beforeTheDesk) {
      // Ruling 7: refused with words, never opened, never converted — the
      // at-rest bytes untouched, nothing bound that could write them.
      getRendererLogger()
        .child({ component: "board.session", docId: pending.docId })
        .warn("renderer.board.before_the_desk", "A board from before the desk was refused at open");
      manager.refuseBeforeTheDesk(pending.docId);
      manager.contentApplied(pending.generation);
      return;
    }
    const behaviorRuntime = plugins?.runtime;
    let behaviorEpisode = 0;
    const connectBehaviorEpisode = () => {
      if (behaviorRuntime === undefined) return undefined;
      // DK-5: a DEGRADED session (the manager's in-memory board — no document, `docId` "")
      // binds no behaviors: they are attributed to a document, and the host refuses an empty
      // one with a throw that unmounted the whole window (white) where B3 says the field
      // still opens. The soak with the desk found it: a window that lost the board's writer
      // lock after a daemon restart degrades.
      if (pending.docId.length === 0) return undefined;
      behaviorEpisode += 1;
      return connectBehaviorGenerationHost(
        new BehaviorGenerationHost({
          engine: ce,
          target: {
            windowId: behaviorRuntime.windowId,
            documentId: pending.docId,
            runtimeGeneration:
              behaviorEpisode === 1
                ? runtimeGeneration
                : `${runtimeGeneration}:session-${behaviorEpisode}`,
          },
          ledger: behaviorRuntime.behaviorLedger,
          presenceAvailable: () => ce.docs.presence() !== undefined,
          onEvent: logBehaviorGenerationEvent,
          onDiagnosticsChanged: (diagnostics) =>
            behaviorRuntime.publishBehaviorDiagnostics(diagnostics),
        }),
        behaviorRuntime.behaviorCatalog,
      );
    };
    let behaviorConnection = connectBehaviorEpisode();
    const lane = pending.lane;
    let closePresence = (): void => {};
    let unbindCapabilities = (): void => {};
    let unregisterReopen = (): void => {};
    let stopLearning = (): void => {};
    // DK-9: what a remount on a new engine asks of THIS generation — the typing ended (its session
    // commits as the editor's lease ends) and the board's envelope as it stands
    const registerReopen = (): void => {
      unregisterReopen = manager.registerReopen(pending.generation, {
        endInput: () => {
          const desk = currentDesk();
          if (desk !== null && desk.engine === ce) desk.handle.editor().blur();
        },
        export: () => ce.docs.current()?.exportEnvelope(Date.now()) ?? null,
      });
    };
    // DK-9 (DK-5 input (2)): a pack the board lacks waits while another desktop holds it open
    const capabilityOptions =
      lane === null || pending.docId.length === 0
        ? {}
        : { heldElsewhere: () => manager.heldLiveElsewhere(pending.docId) };
    const connectPresence = (): void => {
      if (lane === null || profile === undefined) return;
      try {
        closePresence = attachDocumentPresence({
          ce,
          lane,
          profile,
          docId: pending.docId,
          cover: {
            covered: () => getActiveView() !== "canvas",
            subscribe: subscribeActiveView,
          },
        });
      } catch (error) {
        getRendererLogger()
          .child({ component: "presence", docId: pending.docId })
          .warn("renderer.presence.attach_failed", "The document opened without presence", {
            error: String(error),
          });
      }
    };
    const closeDocument = (reason: string): void => {
      // Registration is execution authority: withdraw it before persistence and document close.
      behaviorConnection?.close(reason);
      closePresence();
      unbindCapabilities();
      unregisterReopen();
      stopLearning();
      ce.docs.close();
    };
    if (pending.initialBytes !== null) {
      const res = ce.docs.open(pending.initialBytes);
      if (!res.ok) {
        // Honest quarantine (the M5 law): the at-rest bytes stay untouched on
        // disk; a blank board + surfaced state beats autosaving over them.
        getRendererLogger()
          .child({ component: "board.session", docId: pending.docId })
          .error(
            "renderer.board.quarantined",
            "Document bytes were quarantined instead of overwritten",
            undefined,
            { reason: res.reason },
          );
        setBoardStatus({ state: "quarantined", detail: res.reason });
        ce.docs.create();
        connectPresence();
        behaviorConnection?.refresh();
        ce.world.sync();
        manager.contentApplied(pending.generation);
        return () => closeDocument("quarantined-document-close");
      }
      if (rootIsBeforeTheDesk(res.session.report?.rootCanvas)) {
        // The belt under the header's mirror: the document's OWN root is the
        // authority, and it says `ice.default`. Closed before anything binds —
        // no journal applied, no presence, no persistence — and refused as above.
        behaviorConnection?.close("before-the-desk-close");
        ce.docs.close();
        getRendererLogger()
          .child({ component: "board.session", docId: pending.docId })
          .warn(
            "renderer.board.before_the_desk",
            "A board from before the desk was refused at open",
          );
        manager.refuseBeforeTheDesk(pending.docId);
        manager.contentApplied(pending.generation);
        return;
      }
      // DK-D17: the packs of what is on, upgraded at the open — before the journal, while the
      // facade's gate is clean (each applied record leaves it to be judged at the next publish).
      if (!res.session.readOnly)
        unbindCapabilities = bindCapabilityUpgrades(ce, registry, capabilityOptions);
      try {
        for (const update of pending.initialUpdates) res.session.applyRemote(update);
      } catch (error) {
        // The failed session is a real close edge. Reverse its exact behavior generation before
        // closing, then create a fresh generation before the quarantined blank document.
        behaviorConnection?.close("quarantined-journal-reset");
        unbindCapabilities();
        ce.docs.close();
        const detail = error instanceof Error ? error.message : String(error);
        getRendererLogger()
          .child({ component: "board.session", docId: pending.docId })
          .error(
            "renderer.board.journal_quarantined",
            "A document journal was quarantined instead of applied",
            error,
            { detail },
          );
        setBoardStatus({ state: "quarantined", detail });
        behaviorConnection = connectBehaviorEpisode();
        ce.docs.create();
        connectPresence();
        behaviorConnection?.refresh();
        ce.world.sync();
        manager.contentApplied(pending.generation);
        return () => closeDocument("quarantined-journal-close");
      }
      connectPresence();
      behaviorConnection?.refresh();
      ce.world.sync();
      registerReopen();
      // DK-9: a pack a live update brings that this engine does not compile is LEARNED — the board
      // reopens on a ghost stub for it, writable — never held read-only until a reopen
      const session = res.session;
      stopLearning = watchPacksLearned(session, {
        learn: (types) => {
          getRendererLogger()
            .child({ component: "board.session", docId: pending.docId })
            .info("renderer.board.pack_learned", "A live update brought a pack this board learns", {
              types: [...types],
            });
          void manager.remount("pack-learned");
        },
        stuck: (types) => {
          setBoardStatus({ state: "readonly", detail: `needs ${types.join(", ")}` });
        },
      });
      if (res.session.readOnly) {
        // P2 — the engine's pack-marker gate (ghost probe 2026-07-23): a board
        // carrying widgets of an UNREGISTERED plugin (or a newer schema) opens
        // READ-ONLY — never quarantined, never lossy; re-enabling the plugin
        // restores write, and P3's missing faces (spec §12.4) are the planned
        // lift. No persistence bind: nothing can commit, and autosave's
        // dirty-start PUT would stomp this honest status row.
        const missing = res.session.report?.newerInDoc ?? [];
        const detail = missing.length > 0 ? `needs ${missing.join(", ")}` : "newer doc schema";
        getRendererLogger()
          .child({ component: "board.session", docId: pending.docId })
          .warn("renderer.board.read_only", "Document opened read-only", { detail });
        setBoardStatus({ state: "readonly", detail });
        manager.contentApplied(pending.generation);
        return () => closeDocument("readonly-document-close");
      }
    } else {
      const session = ce.docs.create();
      // ICE stamps the whole catalog on a new board; the binding keeps a plugin enabled later
      unbindCapabilities = bindCapabilityUpgrades(ce, registry, capabilityOptions);
      registerReopen();
      connectPresence();
      behaviorConnection?.refresh();
      // The first-run board belongs to the bootstrap default doc alone (seed
      // flag); user-created docs open as an empty field. On the desk it is the
      // PRODUCT's composition (DK-8: ICE's six and the comment pad — the print
      // once its picture is in the byte store); the example clock joins it only
      // where the run asks for the examples (a dev build, `?deskSeedExamples=1`).
      // DK-10: a load that asks for a TRY BOARD (`?deskTry=<type>,…` — the
      // author's smoke, `vibefield-plugin try`) gets those types alone.
      if (pending.seed) {
        const search = globalThis.location?.search ?? "";
        const examples = seedsExamples(import.meta.env.DEV, search);
        const tryTypes = seedTryTypes(search);
        void seedField(ce, session, deskBlobs(), undefined, {
          examples,
          ...(tryTypes.length > 0 ? { try: tryTypes } : {}),
        }).catch((error: unknown) =>
          getRendererLogger()
            .child({ component: "board.session", docId: pending.docId })
            .error("renderer.board.seed_failed", "The first-run board's print was not laid", error),
        );
      } else ce.world.sync();
    }
    if (lane === null) {
      // degraded (in-memory) session — the manager already set the board row
      manager.contentApplied(pending.generation);
      return () => closeDocument("degraded-document-close");
    }
    const unbindPersistence = bindPersistence({ ce, manager, pending, lane });
    // THE BOARD'S STILLS (DK-4, DK-D27): the explorer's picture of this board, taken from
    // the desk the stage mounted for THIS generation — once on the desk's idle after an
    // edit settles (the persistence path owes it), and at the board's close (the manager
    // asks before a switch takes the desk away). Bound HERE, with the persistence: only a
    // board whose saves reach fieldd is pictured — a quarantined board shows a blank in
    // place of bytes it never opened, and a read-only, refused or degraded one saves
    // nothing, so none of them ever replaces a board's picture.
    const stills = createDeskStills({
      engine: ce,
      desk: () => {
        const desk = currentDesk();
        return desk !== null && desk.engine === ce && desk.generation === pending.generation
          ? desk.handle
          : null;
      },
      keep: (png) => manager.keepStill(pending.docId, png),
    });
    const unregisterStills = manager.registerStills(pending.generation, pending.docId, stills);
    manager.contentApplied(pending.generation);
    return () => {
      behaviorConnection?.close("document-close");
      closePresence();
      unbindCapabilities();
      unregisterReopen();
      stopLearning();
      unregisterStills();
      stills.dispose();
      unbindPersistence();
      ce.docs.close();
    };
  }, [ce, manager, pending, plugins, profile, registry, runtimeGeneration, beforeTheDesk]);

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
    if (Object.keys(deskCensus(ce)).length === 0 || ce.ops.frameContent()) {
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
  // runs in the commit phase, BEFORE this passive cleanup disposes the engine,
  // and the keyed stage's `<Desk>` — a deleted subtree's passive cleanup —
  // disposes its host (the layer, its device) before this one runs. (The GL
  // disposal-order ref the stage published into retired with the GL, DK-3.)
  useEffect(() => {
    setActiveCanvasEngine(ce); // P6 §12.7 — publish the live engine for ctx.canvas
    return () => {
      setActiveCanvasEngine(null); // cleared first — never hand out a disposed engine
      ce.dispose();
    };
  }, [ce]);

  return { ce, registry, generation, docState, beforeTheDesk };
}
