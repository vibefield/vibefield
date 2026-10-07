import type { CanvasEngine } from "@vibecook/ice";
import { type DeskLayerHandle, type DeskLayerStatus, objectKindOf } from "@vibecook/ice/desk";
import { Desk, type LayerFactory } from "@vibecook/ice/react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  emitDeskReadyMarker,
  emitDeskRetryMarker,
  emitDeskUnavailableMarker,
} from "../development-console";
import { sayStatus, withdrawStatus } from "../frame/status-line";
import { getRendererLogger } from "../logging";
import { getPluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import type { WindowKinds } from "../plugin-host/window-kinds";
import { useAppTheme } from "../theme";
import { DeskUnavailableView } from "./desk/DeskUnavailableView";
import { deskCensus, installDeskDoor, type MountedDesk, publishDesk } from "./desk/desk-door";
import { feedDesk } from "./desk/desk-feed";
import { deskGpu, HEAL_DELAYS_MS, type HealKind, healDelay, healKind } from "./desk/desk-gpu";
import { deskLook, fieldDeskLayer } from "./desk/desk-layer";
import { announceMissing } from "./desk/desk-notices";
import { objectWords } from "./desk/desk-object-words";
import { type DeskUnavailableWords, degradedNotice, unavailableWords } from "./desk/desk-words";
import { PeersOnTheMat } from "./desk/peers/PeersOnTheMat";

// THE CANVAS STAGE (§5.4.3; DK-3, the host swap): the DESK drawn — ICE's `<Desk engine layer>` over
// this generation's engine, mounted INSIDE the generation-keyed recede wrapper, so one stage lifetime
// is one engine generation and one layer (the orchestrator's ruling 1: the device is the layer's,
// nothing is shared across generations; StrictMode's development twin costs one more device, ~5 ms).
// Owns NO document or chrome state. What it wires per mount, in `onReady` — each undone by the
// cleanup it returns (StrictMode's discarded mount included):
//   the theme bridge — the app's ThemeOwner (main's, mirrored by `theme.ts`) → `handle.setTheme(
//     deskTheme(name), deskPalette(name))` on every change, and the layer MADE in the owner's state,
//     so the first frame is painted in it (no flash);
//   the plates (a lazy module — no `fetch`, ruling 8) and the rulers' glyph atlas, once the mat is here;
//   the status: `failed` → the unavailable card (Reload = a desk remount, a new layer on this engine);
//     `degraded` → the status line's banner with its Reload, the desk drawing on beneath it;
//   THE RELAUNCH HEAL (DK-5, desk-gpu.ts) by its RULE (DK-9): a mount of the heal's chain — the
//     boot's first and each retry it made — `failed` with no device yet is mounted again: a missing
//     adapter up to three times over ~2 s, a refused device once; then the card. A Reload the person
//     asked for is outside the chain and never retried;
//   DESK_READY (ready AND the first frame presented, after CANVAS_READY) and `window.__vfDesk`;
//   THE WORDS (DK-11, desk-object-words.ts) — the chrome's words for an object of a type on this mount, read
//     against the kinds the layer was MOUNTED without — and the status line's notices (desk-notices.ts): each
//     type on the board the desk draws as missing said once, at the first frame and whenever the faults move.
// And as the desk's child, PEERS ON THE MAT (DK-16, desk/peers/): the room's other people drawn by VibeField — the layer
// mounted with ICE's remote cursors off — while the desk draws.
// THE KINDS (DK-9, plugin-host/window-kinds.ts; ICE I25 — the kind set is fixed for a layer's life): the
// layer is mounted with the catalog's kinds LESS those of a plugin that is off (the structural `catalog`
// a host hands its layer, read at the mount alone), so a disabled plugin's objects wear ICE's missing
// face; and when the window's kinds change, the desk REMOUNTS (a new mount, a new layer on this engine).
// The old composition — the R3F ground and its portal, the GL bridge and router, the GL lanes, the
// cursor halo — left with ICE 0.14.0; DK-2's stub of the ground folded in here: the catalog's
// specimen (`design-system/DeskPreview.tsx`) mounts the same layer (`fieldDeskLayer`) on an engine
// of its own, and nothing else distinguished the two.

export interface CanvasStageProps {
  ce: CanvasEngine;
  /** The document generation this stage was keyed on (DESK_READY and the door say it). */
  generation: number;
  /** A board refused at open (ruling 7 — from before the desk): the card, and no desk at all. */
  refused?: DeskUnavailableWords | null;
  /** DK-9 — the window's kinds: the types the desk is mounted without, and when they change. */
  kinds?: WindowKinds;
}

const NO_KINDS_CHANGE = (): (() => void) => () => undefined;
const KINDS_UNCHANGED = (): number => 0;

export function CanvasStage({
  ce,
  generation,
  refused = null,
  kinds,
}: CanvasStageProps): ReactElement {
  const theme = useAppTheme().resolved;
  const themeRef = useRef(theme);
  /** The theme the mounted layer wears — made in it, or last re-dressed to it. */
  const wornRef = useRef(theme);
  const handleRef = useRef<DeskLayerHandle | null>(null);
  /** The types the mounted layer was made WITHOUT (DK-9's off set, as read at its mount — DK-11's words). */
  const mountedOffRef = useRef<ReadonlySet<string>>(new Set());
  const deskRef = useRef<MountedDesk | null>(null);
  /** The mounted layer's own device once it arrived (DK-16 — the smokes' GPU faults reach it through the door). */
  const deviceRef = useRef<GPUDevice | null>(null);
  // The desk's own generation within the engine's: Reload remounts the layer (a new factory —
  // `<Desk>` disposes the mount and makes the next), the engine and its document untouched.
  const [mount, setMount] = useState(0);
  const [status, setStatus] = useState<DeskLayerStatus>({ state: "pending" });
  const remount = useCallback(() => setMount((n) => n + 1), []);
  // DK-9: the window's kinds changed (a plugin turned off or on) — a new mount, mounted with them
  const kindsStore = useMemo(
    () =>
      kinds === undefined
        ? { subscribe: NO_KINDS_CHANGE, version: KINDS_UNCHANGED }
        : {
            subscribe: (fn: () => void) => kinds.subscribe(fn),
            version: () => kinds.version(),
          },
    [kinds],
  );
  const kindsVersion = useSyncExternalStore(
    kindsStore.subscribe,
    kindsStore.version,
    kindsStore.version,
  );
  const kindsSeen = useRef(kindsVersion);
  useEffect(() => {
    if (kindsSeen.current === kindsVersion) return;
    kindsSeen.current = kindsVersion;
    remount();
  }, [kindsVersion, remount]);
  // The relaunch heal, per stage — per engine generation: the mounts of its chain (the boot's first,
  // and each retry it made) and the retries each kind has spent (desk-gpu.ts `HEAL_DELAYS_MS`).
  const [retrying, setRetrying] = useState(false);
  const healRef = useRef<{ chain: Set<number>; tries: Record<HealKind, number> }>({
    chain: new Set([0]),
    tries: { "no-adapter": 0, refused: 0 },
  });

  // A new factory per engine and per remount: `<Desk>` re-boots on a new identity, never on a render.
  const layer = useMemo<LayerFactory>(() => {
    const dressed = themeRef.current;
    const gpu = deskGpu(mount, typeof location === "undefined" ? "" : location.search);
    const factory = fieldDeskLayer({
      engine: ce,
      theme: dressed,
      mount,
      gpuLedger: import.meta.env.DEV,
      ...(gpu === undefined ? {} : { gpu }),
      onDevice: (device) => {
        deviceRef.current = device;
      },
    });
    // the kinds of what is ON (DK-9): a plugin that is off has its types left out of the catalog the
    // layer is mounted with — read once, at the mount, as ICE reads it
    const off = kinds?.off() ?? new Set<string>();
    return (ctx) => {
      deviceRef.current = null; // the new layer's own device arrives with its boot
      const handle =
        off.size === 0
          ? factory(ctx)
          : factory({
              ...ctx,
              catalog: {
                widgetTypes: () => ctx.catalog.widgetTypes().filter((type) => !off.has(type.type)),
              },
            });
      handleRef.current = handle;
      mountedOffRef.current = off;
      wornRef.current = dressed;
      return handle;
    };
  }, [ce, mount, kinds]);

  // THE THEME BRIDGE (ruling 2; r4 §4): every change of the owner's answer re-dresses the live desk
  // — and only a change: the layer was MADE in the theme it wears (`wornRef`).
  useEffect(() => {
    themeRef.current = theme;
    const handle = handleRef.current;
    if (handle === null || wornRef.current === theme) return;
    const look = deskLook(theme);
    handle.setTheme(look.theme, look.palette);
    wornRef.current = theme;
    if (deskRef.current !== null) deskRef.current.theme = theme;
  }, [theme]);

  const onReady = useCallback(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    const log = getRendererLogger().child({ component: "canvas.desk" });
    let ended = false;
    let readySaid = false;
    let frame: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // the chrome's words for a type ON THIS MOUNT: against the kinds the layer was made without (I25 — a plugin
    // turned on again draws only at the next mount: "remount to draw it"), the registry and the desk's faults now
    const mountedOff = mountedOffRef.current;
    const builtIn = Object.fromEntries(
      ce.catalog
        .widgetTypes()
        .filter((widget) => widget.type.startsWith("desk."))
        .map((widget) => [widget.type, widget.tray?.label ?? widget.type] as const),
    );
    const words = (type: string) =>
      objectWords(type, {
        snapshot: getPluginRegistrySnapshot(),
        off: mountedOff,
        faults: (handle.status().faults ?? []).map((fault) => fault.kind),
        kinded: objectKindOf(ce.catalog.widget(type)) !== undefined,
        builtIn,
      });
    const desk: MountedDesk = {
      engine: ce,
      handle,
      generation,
      mount,
      theme: themeRef.current,
      words,
      off: mountedOff,
      device: () => deviceRef.current,
    };
    deskRef.current = desk;
    const unpublish = publishDesk(desk);
    // the plates and the rulers' atlas, the moment the mat is here
    const feed = feedDesk(handle, ce);
    const undoDoor = installDeskDoor(desk, feed.platesSet);
    // the status line says each type the desk draws as missing — once (desk-notices.ts)
    const announce = (): void => {
      announceMissing(Object.keys(deskCensus(ce)), words);
    };
    let faultsSeen = (handle.status().faults ?? []).length;

    // DESK_READY: the status `ready` AND the first frame presented (its GPU work done).
    const awaitFirstFrame = (): void => {
      if (ended || readySaid) return;
      const perf = handle.perf();
      if (perf.frames >= 1 && perf.boot.presented !== undefined) {
        readySaid = true;
        emitDeskReadyMarker({ generation, mount, boot: perf.boot, frames: perf.frames });
        announce();
        return;
      }
      frame = requestAnimationFrame(awaitFirstFrame);
    };

    const heard = (next: DeskLayerStatus): void => {
      if (ended) return;
      // THE RELAUNCH HEAL: a mount of the heal's chain whose device never arrived (a late GPU process
      // answers an adapter request with null; an adapter lost mid-request refuses its device) — no
      // card yet, no DESK_UNAVAILABLE: a new mount after the kind's next wait, while its budget lasts.
      const kind = healKind(next, handle.perf().boot);
      const heal = healRef.current;
      const afterMs =
        kind !== null && heal.chain.has(mount) ? healDelay(kind, heal.tries[kind]) : undefined;
      if (kind !== null && afterMs !== undefined) {
        heal.tries[kind] += 1;
        heal.chain.add(mount + 1);
        const failed = unavailableWords(next);
        const attempt = heal.tries[kind];
        const of = HEAL_DELAYS_MS[kind].length;
        setRetrying(true);
        log.warn("renderer.desk.retrying", "The desk found no device at boot; retrying", {
          kind,
          message: failed?.detail ?? "",
          generation,
          mount,
          attempt,
          of,
          afterMs,
        });
        emitDeskRetryMarker({
          generation,
          mount,
          kind,
          ...(failed?.detail === undefined ? {} : { message: failed.detail }),
          attempt,
          of,
          afterMs,
        });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          setStatus({ state: "pending" });
          setRetrying(false);
          remount();
        }, afterMs);
        return;
      }
      setStatus(next);
      if (next.state === "ready") awaitFirstFrame();
      // a kind gone missing after the first frame (quarantined at three strikes — ICE I24): said once
      const faults = (next.faults ?? []).length;
      if (faults !== faultsSeen) {
        faultsSeen = faults;
        if (readySaid) announce();
      }
      const notice = degradedNotice(next);
      if (notice === null) withdrawStatus("desk-degraded");
      else sayStatus({ id: "desk-degraded", text: notice, act: { label: "Reload", run: remount } });
      const words = unavailableWords(next);
      if (words !== null) {
        log.warn("renderer.desk.unavailable", "The desk cannot draw", {
          kind: words.kind,
          message: words.detail ?? "",
          generation,
          mount,
        });
        emitDeskUnavailableMarker({
          kind: words.kind,
          title: words.title,
          reload: words.reload,
          ...(words.detail === undefined ? {} : { message: words.detail }),
        });
      }
    };
    const offStatus = handle.onStatus(heard);
    heard(handle.status());

    return () => {
      ended = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (retryTimer !== null) clearTimeout(retryTimer);
      offStatus();
      feed.dispose();
      withdrawStatus("desk-degraded");
      undoDoor();
      unpublish();
      if (deskRef.current === desk) deskRef.current = null;
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [ce, generation, mount, remount]);

  if (refused !== null) {
    return (
      <div className="field-canvas" data-desk="refused">
        <DeskUnavailableView words={refused} />
      </div>
    );
  }
  const words = retrying ? null : unavailableWords(status);
  const drawing = !retrying && (status.state === "ready" || status.state === "degraded");
  return (
    <div className="field-canvas" data-desk={retrying ? "retrying" : status.state}>
      <Desk engine={ce} layer={layer} onReady={onReady}>
        <PeersOnTheMat drawing={drawing} />
      </Desk>
      {words === null ? null : <DeskUnavailableView words={words} onReload={remount} />}
    </div>
  );
}
