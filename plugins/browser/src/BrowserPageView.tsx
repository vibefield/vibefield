import type {
  PluginSurfaceBrowserState,
  PluginSurfaceHandle,
  PluginSurfaceState,
  PluginSurfaceViewProps,
} from "@vibefield/plugin-sdk";
import { FieldGlyph, UiIconButton, uiFieldClass } from "@vibefield/plugin-sdk/ui";
import {
  type ComponentType,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./browser-page.css";

// DT-3d — the browser card's FACE, controller-free (UI_SYSTEM §"Rules for new
// UI": runtime-bound UI exports a view the fixture adapters can mount, and the
// controller keeps the engine ops). Everything here runs off two things it is
// handed — a `PluginSurfaceHandle` and the pool's own `SurfaceView` — so the
// same component renders on the canvas, in a test, and in the catalog.
//
// WHAT THIS VIEW OWNS: the chrome (nav row + address), the draft the user is
// typing, engagement, and WHEN a navigation is durable. What it never owns: the
// document write itself (`onCommit` is the controller's) and the demand — the
// pool's `SurfaceView` folds demand from its own element facts and calls
// `setDemand` itself, so a second driver here would fight the view for the same
// holder's intent.

/** Longest address the wire carries (`LiveSurfaceUrlV1`). Enforced here so a
 * paste can never reach `navigate()`, which throws on a malformed command
 * rather than soft-failing — a coherence bug in the caller's frame is the right
 * contract for the pool and the wrong thing to hand a text field. */
const URL_MAX = 8_192;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Escaped, never literal: a raw control byte in a source file passes tsc,
// vitest and biome and still makes git call the whole file binary.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the wire forbids these bytes, so matching them is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

/**
 * The address bar's reading of what the user typed, or null when there is no
 * navigation in it.
 *
 * Schemeless text becomes `https://` — the modern default, and the one a user
 * who types `example.com` means. Anything that already names a scheme passes
 * through UNTOUCHED, including schemes main's browser policy will refuse: the
 * refusal is the producer's to state in its own words (EL5 honest states), not
 * this field's to pre-empt with a guess about what is allowed.
 */
export function normalizeAddress(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > URL_MAX) return null;
  if (CONTROL_CHARACTERS.test(text)) return null;
  return SCHEME.test(text) ? text : `https://${text}`;
}

/** What the controller persists when a gesture in this widget settles (DT-D7).
 * `title` is absent, never `undefined`, when there is nothing new to remember. */
export interface BrowserPageCommit {
  readonly url: string;
  readonly title?: string;
}

export interface BrowserPageViewProps {
  readonly handle: PluginSurfaceHandle;
  /** The pool's SHIPPING view (`ctx.pool.SurfaceView`). Injected rather than
   * imported: a plugin has no other way to reach the real presentation path,
   * and a test has no way to reach it at all. */
  readonly SurfaceView: ComponentType<PluginSurfaceViewProps>;
  /** The durable navigation intent. This is what the address bar shows whenever
   * the producer has no committed truth to show instead. */
  readonly url: string;
  readonly title: string;
  readonly showChrome: boolean;
  /** The gesture-edged durable write. The view decides WHEN; the controller
   * decides what a write means. */
  readonly onCommit: (commit: BrowserPageCommit) => void;
}

function readState(handle: PluginSurfaceHandle): PluginSurfaceState {
  return { status: handle.status, browser: handle.browser, error: handle.error };
}

function BackIcon(): ReactElement {
  return <FieldGlyph name="chevron" size={16} turn={180} />;
}

function ForwardIcon(): ReactElement {
  return <FieldGlyph name="chevron" size={16} />;
}

function ReloadIcon(): ReactElement {
  return <FieldGlyph name="reset" size={16} />;
}

function StopIcon(): ReactElement {
  return <FieldGlyph name="close" size={16} />;
}

export function BrowserPageView({
  handle,
  SurfaceView,
  url,
  title,
  showChrome,
  onCommit,
}: BrowserPageViewProps): ReactElement {
  const [state, setState] = useState<PluginSurfaceState>(() => readState(handle));
  const [draft, setDraft] = useState<string | null>(null);
  const [engaged, setEngaged] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // `onState` fires immediately with the current state, so this is both the
  // subscription and the initial read for a handle that changed identity.
  useEffect(() => handle.onState(setState), [handle]);

  const browser: PluginSurfaceBrowserState | null = state.browser;
  const live = state.status === "live";

  /**
   * THE GESTURE EDGE (DT-D7).
   *
   * A ref, not state, and deliberately: it is armed inside an event handler and
   * read inside the state subscription, both outside render, and re-rendering
   * on it would say something visual changed when nothing did.
   *
   * What it encodes is the whole of the durability rule. `url` is the user's
   * NAVIGATION INTENT, so it moves when a gesture IN THIS WIDGET moves it —
   * a submitted address, a nav button — and stays put through everything else
   * a page does to its own history. Without this, an SPA that rewrites its URL
   * on scroll would rewrite the document, and a board would fill with addresses
   * nobody chose.
   */
  const gestureArmed = useRef(false);
  /** The address the last commit stored, so a late title fill knows which page
   * it belongs to and a re-render never re-commits. */
  const committed = useRef(url);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const storedTitle = useRef(title);
  storedTitle.current = title;

  useEffect(() => {
    committed.current = url;
  }, [url]);

  useEffect(() => {
    if (browser === null) return;
    const truth = browser.url;
    if (truth === committed.current) {
      // The page landed where the document already points; the gesture is
      // spent either way (see below for why that is the whole rule).
      gestureArmed.current = false;
      // It named itself only now. Worth ONE write — a card whose page is gone
      // can still say what it was — and only when nothing is stored, so a page
      // that animates its title cannot turn the undo stack into a ticker.
      if (browser.title !== undefined && storedTitle.current === "") {
        commitRef.current({ url: truth, title: browser.title });
      }
      return;
    }
    // Only a gesture makes a moved page a durable fact.
    if (!gestureArmed.current) return;
    // ONE gesture, ONE durable move. The first committed truth after a gesture
    // spends the arm, which is what lets an immediate redirect land (the
    // address the user actually reached is the one stored) while every later
    // hop — an SPA rewriting history, a page that pushes state on scroll —
    // finds the arm gone and leaves the document alone.
    gestureArmed.current = false;
    committed.current = truth;
    commitRef.current({
      url: truth,
      ...(browser.title === undefined ? {} : { title: browser.title }),
    });
  }, [browser]);

  const steer = useCallback(
    (command: Parameters<PluginSurfaceHandle["navigate"]>[0]): void => {
      // Arm BEFORE the command: the producer's committed truth can arrive
      // synchronously, and an edge that armed afterwards would miss it.
      gestureArmed.current = true;
      if (!handle.navigate(command)) gestureArmed.current = false;
    },
    [handle],
  );

  const submit = useCallback((): void => {
    const next = normalizeAddress(draft ?? "");
    setDraft(null);
    if (next === null) return;
    // The submit IS the intent — it is durable whether or not the page ever
    // loads, which is what makes a card that was pointed at an unreachable
    // address still say where it was pointed.
    committed.current = next;
    commitRef.current({ url: next });
    gestureArmed.current = true;
    if (!handle.navigate({ action: "go", url: next })) gestureArmed.current = false;
  }, [draft, handle]);

  const disengage = useCallback((): void => {
    setEngaged(false);
  }, []);

  /**
   * Engaging puts the focus where the input actually lands.
   *
   * Focus is not decoration here — it is what MAKES the engagement real. The
   * manifest's `keyboard: "exclusive"` claim is scoped to a focused node inside
   * this card, so without moving focus the ring would say "yours" while keys
   * still panned the canvas; and blur-to-leave can only fire from focus that
   * was inside to begin with.
   *
   * AFTER the commit, not during the handler: the element only becomes
   * focusable when `SurfaceView` re-renders with `interactive` (that is what
   * gives it a tabIndex), so focusing in the same tick as `setEngaged` would
   * silently do nothing. The target is the host view's own element, found by
   * the one attribute it publishes — it carries the tabIndex and the key
   * listeners, so focusing anything else would take the keyboard away from the
   * page. No surface painted yet means nothing to focus and nothing to claim,
   * which is a state rather than a failure.
   */
  useEffect(() => {
    if (!engaged) return;
    const root = rootRef.current;
    if (root === null) return;
    // Never take focus off a control the user is already using — engaging by
    // clicking into the address bar must leave the caret in the address bar.
    if (root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>("[data-live-surface-status]")?.focus();
  }, [engaged]);

  // The address bar shows the PRODUCER's truth when there is one and the
  // durable intent when there is not — never an invented state. A browser
  // surface that is live but has not committed a navigation yet (the
  // about:blank bootstrap is plumbing, not truth) is the second case, and the
  // field goes read-only to say so rather than inviting an edit that has
  // nowhere to land.
  const address = draft ?? browser?.url ?? url;
  const addressable = live && browser !== null;
  const loading = browser?.loading === true;
  const label = browser?.title ?? (title === "" ? undefined : title);

  return (
    <div
      ref={rootRef}
      className="vf-browser-page"
      data-engaged={engaged ? "true" : "false"}
      data-status={state.status}
      onBlur={(event) => {
        // Focus left the card entirely — the page has no claim on input it
        // cannot see. `relatedTarget` is null when focus left the document,
        // which is also a leave.
        const next = event.relatedTarget;
        if (next === null || !(rootRef.current?.contains(next as Node) ?? false)) disengage();
      }}
      onKeyDown={(event) => {
        // The manifest declares `keyboardEscape: "release"`, and this is that
        // promise kept: Escape always returns the canvas its keyboard, from
        // anywhere in the card.
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setDraft(null);
        disengage();
      }}
    >
      {showChrome ? (
        <div className="vf-browser-page__bar" data-canvas-interactive="">
          <UiIconButton
            onClick={() => steer({ action: "back" })}
            disabled={browser?.canGoBack !== true}
            title={browser?.canGoBack === true ? "Back" : "Nothing behind this page"}
          >
            <BackIcon />
          </UiIconButton>
          <UiIconButton
            onClick={() => steer({ action: "forward" })}
            disabled={browser?.canGoForward !== true}
            title={browser?.canGoForward === true ? "Forward" : "Nothing ahead of this page"}
          >
            <ForwardIcon />
          </UiIconButton>
          <UiIconButton
            onClick={() => steer({ action: loading ? "stop" : "reload" })}
            disabled={!addressable}
            title={loading ? "Stop" : "Reload"}
          >
            {loading ? <StopIcon /> : <ReloadIcon />}
          </UiIconButton>
          <input
            className={`${uiFieldClass} vf-browser-page__address`}
            value={address}
            disabled={!addressable}
            spellCheck={false}
            aria-label="Address"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setEngaged(true)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        </div>
      ) : null}
      {/* The page. `data-canvas-interactive` is present ONLY while engaged, and
          that one attribute is the whole input boundary: without it a pointer
          here belongs to the canvas (drag the card, wheel to zoom), with it the
          gesture is the page's. Engagement is a deliberate act — a double-click,
          the same "enter this widget" gesture the note card uses — so the first
          click on a browser card still moves it, and panning the canvas across a
          board of them never types into one. */}
      <div
        className="vf-browser-page__page"
        {...(engaged ? { "data-canvas-interactive": "" } : {})}
        onDoubleClick={(event) => {
          event.stopPropagation(); // an engage gesture, never a canvas fact
          setEngaged(true);
        }}
      >
        <SurfaceView handle={handle} interactive={engaged} className="vf-browser-page__surface" />
      </div>
      {showChrome ? (
        <div className="vf-browser-page__foot">
          <span className="vf-browser-page__label">{label ?? "untitled page"}</span>
          <span className="vf-browser-page__stage">
            {engaged ? "interacting · esc to leave" : loading ? "loading" : "double-click to use"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
