import type { CanvasEngine } from "@vibecook/ice";
import { attachDevtools } from "@vibecook/ice/devtools";
import { useFrameFreeze } from "@vibecook/ice/react";
import type { DesktopShellState, ShellCommand } from "@vibefield/contracts";
import {
  type Dispatch,
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MeMenu } from "../account/MeMenu";
import { useSyncQuestion } from "../account/sync-question";
import { isSwitchCovering, useSwitchState } from "../boot/switch";
import type { DocManager, DocManagerState } from "../doc-manager";
import type { LineActs } from "../frame/Composer";
import { Cards } from "../frame/cards/Cards";
import { type FrameSurface, foldSurface } from "../frame/frame-surface";
import { Head } from "../frame/Head";
import { canvasHead } from "../frame/head-canvas";
import { runChosenSession } from "../frame/line-door";
import { FramePeek } from "../frame/Peek";
import type { FrameActRun } from "../frame/palette-acts";
import { StatusLine } from "../frame/StatusLine";
import { runSystemControl } from "../frame/system-control-door";
import { ViewFrame } from "../frame/ViewFrame";
import { requestView, subscribeMenuZoom, useActiveView } from "../frame/view-state";
import { viewKeysOf } from "../frame/views";
import { runZoom } from "../frame/zoom";
import { GodviewOverlay } from "../godview";
import { openHistoryLiveFeed } from "../godview/monitor/live-feed";
import { HistoryView } from "../history/HistoryView";
import { prefetchHistoryRoomWhenIdle } from "../history/room-chunk";
import { getHost } from "../host";
import { CommandPalette } from "../hud/CommandPalette";
import { LoadingVeil } from "../hud/LoadingVeil";
import { PluginSurfaceHost } from "../hud/PluginSurfaceSlot";
import { SettingsPanel } from "../panels";
import { SelectionBar } from "./desk/bar/SelectionBar";
import { useBoardFacts } from "./desk/pegboard/board-door";
import { Pegboard } from "./desk/pegboard/Pegboard";
import { useSettingsChord } from "./me-menu-wiring";
import { isCommandPaletteChord, listenForProductChord } from "./product-chords";
import {
  INITIAL_SHELL_PRESENTATION,
  onShellPresentationRequest,
  reduceShellPresentation,
  type ShellPresentationState,
  settingsOpening,
} from "./shell-presentation";

// ChromeLayer (§5.4.3): the head, the pegboard's chrome (Objects, behind the
// line — the board itself is the desk's), the hand, the corner, settings, and
// overlays — WITHOUT owning document or engine lifetime. All the chrome-scoped
// effects live here too: the two keyboard additions, the hud-flight dock
// choreography, the devtools attach, and the switch's freeze. Sheet
// open/close STATE stays in FieldView (the canvas recede transform derives
// from it in the same render — a callback-up would land the recede one frame
// late; Objects never recedes it since DK-13). The theme is not here: it has
// one owner, main's, and `theme.ts` is its mirror (One Frame FC-D5).

// §13.1 windowId: the renderer has no per-window identity yet (v1 is one field
// window). A stable constant names it honestly; the id becomes real when
// multi-window lands (recorded delta).
export const FIELD_WINDOW_ID = "field";

/** Chrome-only state shared with FieldView's sheet/recede choreography. */
export interface ChromeState {
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  showEcs: boolean;
  setShowEcs: Dispatch<SetStateAction<boolean>>;
}

export function useChromeState(): ChromeState {
  const [showSettings, setShowSettings] = useState(false);
  const [showEcs, setShowEcs] = useState(false);
  return { showSettings, setShowSettings, showEcs, setShowEcs };
}

export function ChromeLayer({
  ce,
  manager,
  hudMotion,
  docState,
  surface,
  onSurfaceChange,
  chrome,
}: {
  ce: CanvasEngine;
  manager: DocManager;
  hudMotion: "out" | "in" | "idle";
  docState: DocManagerState;
  /** The frame's open surface (One Frame FR-2/FR-3/FR-4) and its one owner's
   * setter — FieldView's, where the explorer's recede is computed. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  chrome: ChromeState;
}): ReactElement {
  const { showSettings, setShowSettings, showEcs } = chrome;
  // Objects (DK-13): the desk's pegboard behind the line — out while the frame's
  // surface says so, or while the desk's tray says it is (its fact leads by a
  // frame either way).
  const board = useBoardFacts();
  // TS-6 (TS-D13) — the sync question New field asks while a link owes it.
  const syncQuestion = useSyncQuestion();
  const boardOut = surface === "objects" || board?.open === true;
  const docsOpen = surface === "fields";
  const paletteOpen = surface === "palette";
  // UA-D19 — the Me menu: one of the frame's open surfaces since FR-4, so the
  // one owner folds it when any other opens, and it folds them (DESIGN.md §10).
  const meOpen = surface === "me";
  const [shellPresentation, setShellPresentation] = useState(INITIAL_SHELL_PRESENTATION);
  const opening = settingsOpening(shellPresentation.target);
  const [desktopState, setDesktopState] = useState<DesktopShellState | null>(null);
  // Whether a view covers the field (One Frame FR-1): every view but the
  // canvas. The window's view is main's (one owner); this is its mirror.
  const view = useActiveView();
  const covered = view !== "canvas";
  const [keys] = useState(() => viewKeysOf(getHost().platform));
  // The head's door over this engine (its path and its zoom), and where the
  // line lends the palette its create (One Frame FR-3).
  const head = useMemo(() => canvasHead(ce), [ce]);
  const lineActs = useRef<LineActs | null>(null);
  // History's view in the frame's cover (AR-8c): rosetta's room over this
  // window's fieldd client, told whether it is the view showing. Its search is
  // the frame's Peek (below) since 2026-10-08, so the room is handed nothing of
  // the frame's open surface any more.
  const historyView = useCallback((active: boolean) => <HistoryView active={active} />, []);
  // The room is its own chunk (DESIGN.md §8 "History"): fetched when the window
  // is next idle after the chrome has mounted — after the canvas has drawn,
  // never on its path — so the first ⌘3 finds it here. Code only: the room
  // still mounts on History's first open.
  useEffect(() => prefetchHistoryRoomWhenIdle(), []);

  /** Settings, on the page asked for — the Me menu's Settings… and ⌘, open
   * General; its name row and its Link… open Account (UA-D19); the limit
   * moment's Add a profile… opens Agent Profiles' New profile… (AO-6b). */
  const openSettings = useCallback(
    (page: ShellPresentationState["target"]) => {
      setShellPresentation((state) => ({ ...state, target: page }));
      onSurfaceChange(null);
      setShowSettings(true);
    },
    [onSurfaceChange, setShowSettings],
  );
  // AO-6b — the limit moment's Add a profile…, handed to the cover while
  // Settings is closed (AO-6b3): an open panel takes no new page, so the
  // moment would retire without its form ever showing
  const openNewProfile = useCallback(() => openSettings("new-profile"), [openSettings]);

  // Opening it is asking the owner (which folds Settings and every other
  // surface); a fold of its own leaves the others alone.
  const onMeOpenChange = useCallback(
    (open: boolean) => onSurfaceChange(open ? "me" : foldSurface(surface, "me")),
    [onSurfaceChange, surface],
  );

  useEffect(() => {
    const present = (command: ShellCommand): void => {
      setShellPresentation((state) => reduceShellPresentation(state, command));
      onSurfaceChange(null);
      setShowSettings(true);
    };
    const stopNative = getHost().onShellCommand?.(present);
    // TS-4 — the same commands, asked for by the page's own surfaces
    const stopLocal = onShellPresentationRequest(present);
    return () => {
      stopNative?.();
      stopLocal();
    };
  }, [setShowSettings, onSurfaceChange]);

  useEffect(() => {
    const onDesktopState = getHost().onDesktopState;
    if (onDesktopState === undefined) return;
    return onDesktopState(setDesktopState);
  }, []);

  // A sheet (the fields explorer, Settings) and the loading veil take NO gate
  // (DK-17, the retire table's last row): their stage holds wrote ICE's
  // `StageMode`, which nothing on the desk reads — inert since the pin. Behind a
  // sheet the desk keeps its own idle, zero submits while nothing moves, its
  // wind the ambient's (DESIGN.md §6 M5). A covered view gets the gate that
  // parks the loop — taken since DK-15 by the still under the covers
  // (`desk/CoverStill.tsx`, mounted beside the scene in FieldView), in the ruled
  // order: the capture, the still blurred once and swapped in, the canvas
  // hidden, THEN `freeze("cover")` — zero frames and zero submits while the
  // cover stands (DESIGN.md §8 "The covers over the desk").
  // The switch covers the window too (DESIGN.md §8): the field it leaves is
  // frozen whole under the frost, and thaws if a refused switch hands it back.
  const switchCovering = isSwitchCovering(useSwitchState());
  useFrameFreeze(ce, switchCovering, "user-switch");
  useEffect(() => {
    if (docsOpen || showSettings) ce.ops.cancelActiveGestures();
  }, [docsOpen, showSettings, ce]);

  // Keyboard shortcuts: the DESK's keymap is the one (DK-D24; ruling 4) — `<Desk>`
  // attaches it (⌫, ⌘Z/⇧⌘Z, ⌘D, ⌘A, ⇧⌘L, ⏎ open/enter, arrows, and the Esc
  // ladder: close the drawer → put down → fly out of the frame), with no
  // override of the field's: its keymap drops a tool letter the desk's canvas
  // does not allow, so `c` connects nothing (DK-17 retired the field's `c`
  // override). The Escape → `exitContainer` handler this layer carried is GONE:
  // it fired a second exit beside the ladder's (r1 §3).

  // ⌘K / Ctrl+K toggles the command palette (§8.3; One Frame §7). ⌘K is free —
  // the ICE keymap, the line's B and the tray's Esc never claim it. The palette
  // is one of the frame's surfaces, so opening it folds whichever was open —
  // the drawers and the Me menu included — and the owner folds Settings.
  // GT-D21: caught in the window's capture phase, so a focused Godview pane
  // (whose Ghostty default for ⌘K is clear_screen) never sees it.
  useEffect(
    () =>
      listenForProductChord(isCommandPaletteChord, () => {
        if (surface === "palette") {
          onSurfaceChange(null);
          return;
        }
        onSurfaceChange("palette");
      }),
    [onSurfaceChange, surface],
  );

  // The palette's frame acts, run through the frame's own doors: the view's
  // one owner, the line's create, History's door for its chosen session (HN-7),
  // the head's zoom, Settings.
  const runFrameAct = useCallback(
    (run: FrameActRun) => {
      switch (run.kind) {
        case "view":
          void requestView(run.view);
          return;
        case "create":
          lineActs.current?.create();
          return;
        case "chosen-session":
          void runChosenSession();
          return;
        case "zoom":
          runZoom(head, run.act);
          return;
        case "system-control":
          runSystemControl();
          return;
        case "settings":
          openSettings("general");
      }
    },
    [head, openSettings],
  );
  const closePalette = useCallback(
    () => onSurfaceChange(foldSurface(surface, "palette")),
    [onSurfaceChange, surface],
  );

  // ⌘, / Ctrl+, — Settings from anywhere (DESIGN.md §8, the Me menu).
  const openGeneralSettings = useCallback(() => openSettings("general"), [openSettings]);
  const closeSettings = useCallback(() => setShowSettings(false), [setShowSettings]);
  useSettingsChord(showSettings, openGeneralSettings, closeSettings);

  // ECS devtools while the switch is on (Settings → Advanced → Developer).
  // The FACADE goes in (not ce.engine): the strata observer's durable tab
  // tracks docs.current() live only through it. (The handle no longer rides a
  // ref to the stage: the GL lanes it fed left with the islands, DK-3.)
  useEffect(() => {
    if (!showEcs) return;
    const d = attachDevtools(ce, { presence: () => ce.docs.presence() });
    return () => d.detach();
  }, [showEcs, ce]);

  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>(".ice-dock");
    if (!dock) return;

    dock.classList.add("hud-flight");
    if (hudMotion === "idle") {
      delete dock.dataset.docTransition;
      return;
    }

    if (hudMotion === "out") {
      const rect = dock.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
      const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
      const length = Math.hypot(dx, dy) || 1;
      const distance =
        Math.hypot(window.innerWidth, window.innerHeight) + Math.hypot(rect.width, rect.height);
      dock.style.setProperty("--hud-flight-x", `${(dx / length) * distance}px`);
      dock.style.setProperty("--hud-flight-y", `${(dy / length) * distance}px`);
    }

    dock.dataset.docTransition = hudMotion;
  }, [hudMotion, showEcs]);

  return (
    <>
      {/* Chrome overlays sit OUTSIDE the scene's recede (a sheet's) — they never
          scale with the desk. Under the Peek they recede with the cover and the
          still, in field.tsx's `.field-recede` (DESIGN.md §6). */}
      {/* THE HEAD (One Frame FR-3, DESIGN.md §8 "The head"): the field's name
          pill with the crumbs folded in, which grows the fields explorer, and
          the zoom readout — alone at the right since FR-4 took the theme into
          the Me menu and Artifacts behind the right notch. Still the canvas's
          chrome: under the cover. */}
      <Head
        manager={manager}
        canvas={head}
        view={view}
        keys={keys}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        menuZoom={subscribeMenuZoom}
        syncQuestion={syncQuestion}
      />

      {/* SEARCH — THE PEEK (GV-D8/D9/D10, 2026-10-08; DESIGN.md §8 "Search — the
          Peek"): the frame's button at the head's right end, above the cover
          in the views that search (History, and Godview since P2), ⌘F printed
          under it; its scrim and popup are drawn on the document's body,
          outside the field, so the view and the frame recede under them. One
          of the frame's open surfaces (`search`). History's Live now reads a
          feed of its own, opened only while it shows (docket PK5). */}
      <FramePeek
        view={view}
        keys={keys}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        openLiveFeed={openHistoryLiveFeed}
      />

      {/* THE HAND (track HN; DESIGN.md §8 "The hand", §10): every copy is a
          card at the window's foot, fanned like a hand you hold — the
          clipboard you can see, where the left edge's tray stood. The frame's,
          not the canvas's: it stands above the cover with the line in every
          view, and raised (⇧⌘V) or with a card picked up it is one of the
          frame's open surfaces. It steps down out of the pegboard's way, and
          at rest under Settings' backdrop it answers neither the pointer nor ⌫
          (Settings is not one of the frame's surfaces, so it is told). */}
      <Cards
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        tucked={boardOut}
        settingsOpen={showSettings}
      />

      {/* hud.attention (§8.4): the top-right attention stack, under the head.
          pointer-events-none wrapper so an empty slot never blocks the
          canvas; the host restores pointer-events on its own content. */}
      <div
        data-hud-flight="top-right"
        className="hud-flight pointer-events-none absolute top-16 right-4 z-40 flex w-72 max-w-[80vw] flex-col"
      >
        <PluginSurfaceHost slot="hud.attention" windowId={FIELD_WINDOW_ID} />
      </div>

      {/* THE CORNER (One Frame FR-4, DESIGN.md §8 "The Me menu", §10): the
          owner's face, the account's one door — the 44px button at 16 from
          the left and 24 from the foot, centred on the foot axis (y 734). Its
          menu opens ABOVE the line, never around the face (FC-D14), and it is
          the frame's, not the canvas's: it stands above the cover with the
          line (62) in every view. The corner keeps only the face — the
          devtools button left for Settings → Advanced (FC-D12). */}
      <div
        data-hud-flight="bottom-left"
        className="hud-flight no-drag absolute bottom-[24px] left-4 z-[62]"
      >
        <MeMenu
          open={meOpen}
          onOpenChange={onMeOpenChange}
          onOpenSettings={openSettings}
          shortcut={getHost().platform === "darwin" ? "⌘," : "Ctrl+,"}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          stressWidgetType="desk.note"
          platform={getHost().platform ?? "other"}
          desktopState={desktopState}
          diagnosticsRequest={shellPresentation.diagnosticsRequest}
          diagnosticsInitiallyOpen={shellPresentation.target === "diagnostics"}
          connectPending={shellPresentation.connect}
          onConnectTaken={() => setShellPresentation((state) => ({ ...state, connect: false }))}
          initialPage={opening.page}
          {...(opening.profiles !== undefined ? { initialProfiles: opening.profiles } : {})}
          devtools={{ open: showEcs, onToggle: () => chrome.setShowEcs((open) => !open) }}
          onClose={() => {
            setShellPresentation((state) => ({ ...state, target: "general", connect: false }));
            setShowSettings(false);
          }}
        />
      )}

      {/* hud.panel (§8.4): the bottom-anchored panel area, above the Me menu's
          face, clear of the line. Empty → invisible (host null). */}
      <div
        data-hud-flight="bottom-left"
        className="hud-flight pointer-events-none absolute bottom-20 left-4 z-40 flex w-72 max-w-[80vw] flex-col"
      >
        <PluginSurfaceHost slot="hud.panel" windowId={FIELD_WINDOW_ID} />
      </div>

      {/* The ⌘K command palette (§8.3; One Frame §7) — a solid panel under
          the head, above the frame, below the modal loading veil. */}
      <CommandPalette
        ce={ce}
        open={paletteOpen}
        onClose={closePalette}
        windowId={FIELD_WINDOW_ID}
        view={view}
        keys={keys}
        onAct={runFrameAct}
      />

      {/* THE FRAME (One Frame FR-1, DESIGN.md §10): the cover the covered views
          live in — Godview, History — over every piece of the canvas's own
          chrome, and the views track standing above the cover. Below Settings,
          the palette and the loading veil: a document that is still opening
          owns the window more than any view does. */}
      <ViewFrame
        godview={<GodviewOverlay openNewProfile={showSettings ? undefined : openNewProfile} />}
        history={historyView}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        lineActs={lineActs}
      />

      {/* THE SELECTION BAR (DK-11; DESIGN.md §8 "The selection bar", "The
          bar grown"): object chrome on the desk's selection — over the desk
          and under the frame (§10), placed imperatively from the desk's
          anchor; More or a right-click grows it into its menu, one of the
          frame's open surfaces. After the line in the document, so Tab from
          the line's create reaches it (R9). Not shown over a covered view, nor
          over the field receded under a sheet. */}
      <SelectionBar
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        hidden={covered || boardOut || docsOpen || showSettings}
        keys={keys}
      />

      {/* THE PEGBOARD'S CHROME (DK-13; DESIGN.md §8 "The pegboard — Objects,
          behind the line"): the board is the desk's own drawer, risen behind
          the line by its create or B; over it, the filters in its clear header
          band and the board's keyboard stop (⏎ lays a specimen at the view's
          centre). Over the desk, under the frame (§10) — after the bar in the
          document, so Tab reaches the filters, then the board. While the board
          is out the selection bar hides (the desk is inert under it, plan
          addendum 47); the selection persists, and the bar returns as the
          board folds. */}
      <Pegboard surface={surface} onSurfaceChange={onSurfaceChange} />

      {/* THE STATUS LINE (DESIGN.md §8, §10): the desk's notices under the
          head — a degraded desk's banner and its Reload (R18), a type the desk
          cannot draw, a type to remount (DK-11) — standing with the frame,
          above the cover, under the tools in hand while an object is held. */}
      <StatusLine />

      {/* The loading veil rides ABOVE all chrome — loading is modal (B4 §2). */}
      <LoadingVeil loading={docState.loading} />
    </>
  );
}
