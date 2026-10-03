import type { CanvasEngine } from "@vibecook/ice";
import type { DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import { Desk, type KeymapEntry, type LayerFactory } from "@vibecook/ice/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitDeskReadyMarker, emitDeskUnavailableMarker } from "../development-console";
import { sayStatus, withdrawStatus } from "../frame/status-line";
import { getRendererLogger } from "../logging";
import { useAppTheme } from "../theme";
import { DeskUnavailableView } from "./desk/DeskUnavailableView";
import { installDeskDoor, type MountedDesk, publishDesk } from "./desk/desk-door";
import { feedDesk } from "./desk/desk-feed";
import { deskLook, fieldDeskLayer } from "./desk/desk-layer";
import { type DeskUnavailableWords, degradedNotice, unavailableWords } from "./desk/desk-words";

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
//   DESK_READY (ready AND the first frame presented, after CANVAS_READY) and `window.__vfDesk`.
// The old composition — `<InfiniteCanvas>`, the GL bridge and router, the R3F portal, the GL lanes,
// the cursor halo — left with ICE 0.14.0; `InfiniteCanvasGround` (DK-2's stub) folded in here: the
// catalog's specimen mounts the same layer (`fieldDeskLayer`) on an engine of its own, and nothing
// else distinguished the two.

export interface CanvasStageProps {
  ce: CanvasEngine;
  /** FieldView's stable override entries (I1, ice 0.4.0 — field-keymap.ts). */
  keymapOverrides: readonly KeymapEntry[];
  /** The document generation this stage was keyed on (DESK_READY and the door say it). */
  generation: number;
  /** A board refused at open (ruling 7 — from before the desk): the card, and no desk at all. */
  refused?: DeskUnavailableWords | null;
}

export function CanvasStage({
  ce,
  keymapOverrides,
  generation,
  refused = null,
}: CanvasStageProps): ReactElement {
  const theme = useAppTheme().resolved;
  const themeRef = useRef(theme);
  /** The theme the mounted layer wears — made in it, or last re-dressed to it. */
  const wornRef = useRef(theme);
  const handleRef = useRef<DeskLayerHandle | null>(null);
  const deskRef = useRef<MountedDesk | null>(null);
  // The desk's own generation within the engine's: Reload remounts the layer (a new factory —
  // `<Desk>` disposes the mount and makes the next), the engine and its document untouched.
  const [mount, setMount] = useState(0);
  const [status, setStatus] = useState<DeskLayerStatus>({ state: "pending" });
  const remount = useCallback(() => setMount((n) => n + 1), []);

  // A new factory per engine and per remount: `<Desk>` re-boots on a new identity, never on a render.
  const layer = useMemo<LayerFactory>(() => {
    const dressed = themeRef.current;
    const factory = fieldDeskLayer({
      engine: ce,
      theme: dressed,
      mount,
      gpuLedger: import.meta.env.DEV,
    });
    return (ctx) => {
      const handle = factory(ctx);
      handleRef.current = handle;
      wornRef.current = dressed;
      return handle;
    };
  }, [ce, mount]);

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
    const desk: MountedDesk = { engine: ce, handle, generation, mount, theme: themeRef.current };
    deskRef.current = desk;
    const unpublish = publishDesk(desk);
    // the plates and the rulers' atlas, the moment the mat is here
    const feed = feedDesk(handle, ce);
    const undoDoor = installDeskDoor(desk, feed.platesSet);

    // DESK_READY: the status `ready` AND the first frame presented (its GPU work done).
    const awaitFirstFrame = (): void => {
      if (ended || readySaid) return;
      const perf = handle.perf();
      if (perf.frames >= 1 && perf.boot.presented !== undefined) {
        readySaid = true;
        emitDeskReadyMarker({ generation, mount, boot: perf.boot, frames: perf.frames });
        return;
      }
      frame = requestAnimationFrame(awaitFirstFrame);
    };

    const heard = (next: DeskLayerStatus): void => {
      if (ended) return;
      setStatus(next);
      if (next.state === "ready") awaitFirstFrame();
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
  const words = unavailableWords(status);
  return (
    <div className="field-canvas" data-desk={status.state}>
      <Desk engine={ce} layer={layer} keymapOverrides={keymapOverrides} onReady={onReady} />
      {words === null ? null : <DeskUnavailableView words={words} onReload={remount} />}
    </div>
  );
}
