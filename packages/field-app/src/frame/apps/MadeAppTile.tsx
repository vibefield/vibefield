import type { IndexApp } from "@vibefield/contracts";
import { projectInk, StatusDot } from "@vibefield/design-kit";
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react";
import {
  MADE_APP_OPENING_LATE_MS,
  MADE_APP_PREVIEW_RETRY_DELAYS_MS,
  type MadeAppState,
  madeAppHost,
  madeAppInitial,
} from "./made-apps";

// A MADE TILE (DESIGN.md §8 "Artifacts — the Artifacts shelf's contents", as amended 2026-11-05): the
// Hub's tile form, kept — its 16:10 well (corners 10, the hairline ring) holding the app's preview,
// AH-4's still, or until it has one the fallback squircle (§2.9's one exception) centred in the
// well at 60; under the well its name, the fact line (`Claude Code · vibe-field`), and its desktop
// with its state: the status dot (§2.5) beside the desktop's name, and the state's word when it is
// not serving ("mini · asleep"); while this window's open is in flight, §9's "Opening on
// ‹desktop›…", late. Its menu (•••, on a chip over the well) holds Keep (or Stop
// keeping), Versions, Open in ‹host› (only with a hosted link) and Hide from Apps.
// The face is pressable in every state, so a tile that cannot open says why (the group's notice)
// rather than lying inert; it waits only while an act of its own is under way.

export interface MadeAppTileProps {
  readonly app: IndexApp;
  /** the fact line, `‹agent› · ‹project›` (`madeAppFacts`) */
  readonly facts: string;
  /** its desktop's name (`madeAppDesktop`) */
  readonly desktop: string;
  readonly state: MadeAppState;
  /** its desktop is not live (asleep, not answering, another build): the tile is greyed (DS-L8) */
  readonly muted: boolean;
  /** the preview image's address (`madeAppImageUrl`), absent before a preview */
  readonly imageUrl: string | undefined;
  /** kept, by the door's row or this window's last mark */
  readonly kept: boolean;
  /** an act of the group is under way: the tile's acts wait */
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onKeep: () => void;
  readonly onHide: () => void;
  readonly onVersions: () => void;
}

export function MadeAppTile({
  app,
  facts,
  desktop,
  state,
  muted,
  imageUrl,
  kept,
  busy,
  onOpen,
  onKeep,
  onHide,
  onVersions,
}: MadeAppTileProps): ReactElement {
  const menu = useRef<HTMLDetailsElement>(null);
  const host = madeAppHost(app.hostedUrl);
  const close = (): void => {
    if (menu.current !== null) menu.current.open = false;
  };
  const shut = (act: () => void) => () => {
    close();
    act();
  };
  return (
    <li className="vf-apps-tile" data-muted={muted ? "true" : "false"}>
      <button
        type="button"
        className="vf-apps-tile__open"
        disabled={busy}
        aria-disabled={state.opens ? undefined : "true"}
        onClick={onOpen}
        title={state.opens ? `Open ${app.title}` : (state.why?.title ?? app.title)}
      >
        <MadeAppWell app={app} imageUrl={imageUrl} />
        <span className="vf-apps-tile__facts">
          <strong>{app.title}</strong>
          <small>{facts}</small>
          <span className="vf-apps-status">
            <StatusDot tone={state.tone} />
            {state.opening === true ? (
              <MadeAppOpening desktop={desktop} />
            ) : state.word === null ? (
              desktop
            ) : (
              `${desktop} · ${state.word}`
            )}
          </span>
        </span>
      </button>
      <details className="vf-apps-menu" ref={menu}>
        <summary aria-label={`Actions for ${app.title}`} title="App actions">
          •••
        </summary>
        <div>
          <button type="button" onClick={shut(onKeep)} disabled={busy}>
            {kept ? "Stop keeping" : "Keep"}
          </button>
          <button type="button" onClick={shut(onVersions)} disabled={busy}>
            Versions
          </button>
          {host !== undefined && app.hostedUrl !== undefined && (
            <a href={app.hostedUrl} target="_blank" rel="noreferrer" onClick={close}>
              Open in {host}
            </a>
          )}
          <button type="button" onClick={shut(onHide)} disabled={busy}>
            Hide from Apps
          </button>
        </div>
      </details>
    </li>
  );
}

/** §9's "Opening on ‹desktop›…", LATE as History's opening words are: the tile keeps its desktop's
 * name for `MADE_APP_OPENING_LATE_MS`, so an open that answers sooner never flashes the line, and
 * then the line fades in (made-apps.css). Mounted afresh for each open. */
function MadeAppOpening({ desktop }: { readonly desktop: string }): ReactElement {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), MADE_APP_OPENING_LATE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!late) return <>{desktop}</>;
  return <span className="vf-apps-status__late">Opening on {desktop}…</span>;
}

/** A retry's address: the Hub's cache key (`vf-preview-attempt`) on an https image, so a listener
 * that lost the first race is asked again; any other address is asked as it is. */
function attemptUrl(url: string, attempt: number): string {
  if (attempt === 0 || !url.startsWith("https://")) return url;
  const retry = new URL(url);
  retry.searchParams.set("vf-preview-attempt", String(attempt));
  return retry.toString();
}

/** The tile's well: the preview with its two retries, then — or before a preview — the fallback. */
export function MadeAppWell({
  app,
  imageUrl,
}: {
  readonly app: IndexApp;
  readonly imageUrl: string | undefined;
}): ReactElement {
  return (
    <span className="vf-apps-well">
      {imageUrl === undefined ? (
        <MadeAppFallbackIcon initial={madeAppInitial(app)} ink={app.ink} />
      ) : (
        <MadeAppPreview key={imageUrl} app={app} url={imageUrl} />
      )}
    </span>
  );
}

/** The preview image (an `<img>`, no referrer). A failed load is asked again after each of
 * `MADE_APP_PREVIEW_RETRY_DELAYS_MS`; past them the fallback stands. */
function MadeAppPreview({ app, url }: { app: IndexApp; url: string }): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const delay = MADE_APP_PREVIEW_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setWaiting(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [attempt, waiting]);

  if (exhausted) return <MadeAppFallbackIcon initial={madeAppInitial(app)} ink={app.ink} />;
  if (waiting) return <span className="vf-apps-well__wait" aria-hidden="true" />;
  const src = attemptUrl(url, attempt);
  return (
    <img
      key={`${src}#${attempt}`}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (attempt >= MADE_APP_PREVIEW_RETRY_DELAYS_MS.length) setExhausted(true);
        else setWaiting(true);
      }}
    />
  );
}

/** The fallback squircle (§2.9's exception): by day the project's ink behind the initial in white,
 * by night the dark tile with the initial in the ink; with no project, the theme's fill and the
 * primary ink. The ink rides one custom property, `--vf-apps-ink` (`projectInk(ink)`). */
export function MadeAppFallbackIcon({
  initial,
  ink,
}: {
  readonly initial: string;
  readonly ink: number | undefined;
}): ReactElement {
  const style =
    ink === undefined ? undefined : ({ "--vf-apps-ink": projectInk(ink) } as CSSProperties);
  return (
    <span
      className="vf-apps-icon"
      aria-hidden="true"
      {...(ink !== undefined ? { "data-ink": "true" } : {})}
      style={style}
    >
      {initial}
    </span>
  );
}
