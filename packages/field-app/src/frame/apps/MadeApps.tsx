import type { IndexApp, IndexAppsSource } from "@vibefield/contracts";
import {
  EmptyState,
  InlineNotice,
  UiButton,
  uiButtonClass,
  uiFieldClass,
} from "@vibefield/design-kit";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { thisDeviceWord } from "../../account/link";
import { MadeAppTile } from "./MadeAppTile";
import {
  FROM_YOUR_AGENTS,
  MADE_APP_OPEN_RETRY_DELAYS_MS,
  MADE_APP_SERVING_HELD_MS,
  MADE_APPS_QUERY_MAX,
  MADE_APPS_SEARCH_DEBOUNCE_MS,
  type MadeAppAct,
  type MadeAppsClient,
  type MadeAppVersionsRead,
  madeAppActBasis,
  madeAppAt,
  madeAppAway,
  madeAppDays,
  madeAppDayWords,
  madeAppDesktop,
  madeAppErrorKind,
  madeAppErrorWords,
  madeAppFacts,
  madeAppHost,
  madeAppImageUrl,
  madeAppReadingLine,
  madeAppRefusalOf,
  madeAppSourceOf,
  madeAppStateOf,
  madeAppsClippedLine,
  madeAppsFeedReadingLines,
  madeAppVersions,
  markMadeApp,
  openMadeApp,
  SEARCH_APPS,
  useMadeAppsFeed,
} from "./made-apps";
import "./made-apps.css";

// FROM YOUR AGENTS — the group (DESIGN.md §8 "Artifacts — the Artifacts shelf's contents", as amended
// 2026-11-05; §9 "Apps"): its head (the heading and the "Search apps" field that searches it), its
// days newest first, each a row of made tiles three across at the shelf's width, its honest states
// (reading, empty, unreadable, a desktop asleep or on another build, an app not written out yet with
// "Open in ‹host›"), and the in-place Versions step. A controller-free view over a client: the
// shelf's host (4c) hands it the window's FielddClient, the catalog its fixture adapter
// (`design-system.tsx`), the tests theirs.
// - A press opens through `artifact.open {…, reveal: true}`, single-flight per app; the answering
//   home opens the URL (RULINGS L4, C2). An app answered `starting` is asked again on
//   `MADE_APP_OPEN_RETRY_DELAYS_MS`, still revealing, and then left starting.
// - This window's answer to an open stands only over the row it was about (`madeAppActBasis`): once
//   a newer reading moves that row, or its desktop goes away, the row's truth wins. A version's open
//   is held under its own presentation, never the tile's. A serving answer stands no longer than a
//   serve nobody opens lives (`MADE_APP_SERVING_HELD_MS`, the origin's idle close).
// - A press on a tile that cannot open asks nothing and says why in the group's notice, with
//   "Open in ‹host›" when the app is hosted: an https link the window's own policy hands the system
//   browser (main's `decideWindowOpen`), so it needs no `shell.open` either.
// - Keep and Hide ask `artifact.mark` once by the fold key. The home's answer stands until the next
//   reading lands; until slice 3h the door refuses, and the group says so.

export interface MadeAppsProps {
  readonly client: MadeAppsClient;
  /** the clock the days are read by (the catalog's is fixed) */
  readonly now?: number;
  /** this desktop's own word when the roster names it none ("This Mac", `thisDeviceWord`) */
  readonly here?: string;
  /** the dates' locale (the window's when absent) */
  readonly locale?: string;
  /** the image transport: the product derives `madeAppImageUrl`; the catalog, which has no tailnet,
   * hands its own stills */
  readonly previewSrc?: (app: IndexApp, sources: readonly IndexAppsSource[]) => string | undefined;
}

/** This window's last open of an app, or of one of its versions, and the row it was about
 * (`madeAppActBasis`); `basis` is null while the ask is in flight, which holds whatever lands. */
interface Held {
  readonly appKey: string;
  readonly act: MadeAppAct;
  readonly basis: string | null;
}

/** What the group's notice is about: a tile, or one of its versions. */
interface Noticed {
  readonly appKey: string;
  readonly presentationId: string | undefined;
}

/** The home's answer to this window's last mark of an app, by fold key, and the reading it was
 * answered over: it stands until a newer reading lands. */
interface Mark {
  readonly kept: boolean;
  readonly hidden: boolean;
  readonly over: number;
}

/** The Versions step, in place of the days (the Hub's Publish step's shape): null while it is read,
 * "failed" when it could not be (the alert says so). */
interface VersionsStep {
  readonly app: IndexApp;
  readonly read: MadeAppVersionsRead | "failed" | null;
}

const NO_ACTS: ReadonlyMap<string, Held> = new Map();
const NO_MARKS: ReadonlyMap<string, Mark> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

/** An act's key: the app's for its tile, the app's and the presentation's for one of its versions. */
function actKey(appKey: string, presentationId: string | undefined): string {
  return presentationId === undefined ? appKey : `${appKey}@${presentationId}`;
}

export function MadeApps({
  client,
  now,
  here = thisDeviceWord(undefined),
  locale,
  previewSrc = madeAppImageUrl,
}: MadeAppsProps): ReactElement {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const { feed, projects, retry, refresh } = useMadeAppsFeed(client, q);
  const [acts, setActs] = useState<ReadonlyMap<string, Held>>(NO_ACTS);
  const [marks, setMarks] = useState<ReadonlyMap<string, Mark>>(NO_MARKS);
  const [busy, setBusy] = useState<ReadonlySet<string>>(NO_KEYS);
  const [notice, setNotice] = useState<Noticed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionsStep | null>(null);
  const pending = useRef(new Set<string>());
  // each act's one timer, by its key: a starting app's re-ask, or the end of a serving answer
  const timers = useRef(new Map<string, number>());
  const mounted = useRef(true);

  // the search asks once the field settles, never past the door's bound; an empty field asks with no `q`
  useEffect(() => {
    const settled = query.trim().slice(0, MADE_APPS_QUERY_MAX);
    if (settled === q) return;
    const timer = window.setTimeout(() => setQ(settled), MADE_APPS_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, q]);

  // every reading that lands is counted, so a mark's answer knows when a newer one replaced it
  const readings = useRef(0);
  const [landed, setLanded] = useState(0);
  useEffect(() => {
    if (feed.phase === "loading") return;
    readings.current += 1;
    setLanded(readings.current);
  }, [feed]);

  // an answered open whose row a newer reading moved, or that left the reading, is let go, so the
  // row's truth stands from then on (an ask in flight holds)
  useEffect(() => {
    if (feed.phase !== "live") return;
    const rows = new Map(feed.apps.map((app) => [app.appKey, app]));
    setActs((current) => {
      let next: Map<string, Held> | null = null;
      for (const [key, held] of current) {
        if (held.basis === null) continue;
        const row = rows.get(held.appKey);
        const basis =
          row === undefined ? null : madeAppActBasis(row, madeAppSourceOf(row, feed.sources));
        if (basis === held.basis) continue;
        next ??= new Map(current);
        next.delete(key);
      }
      return next ?? current;
    });
  }, [feed]);

  useEffect(() => {
    mounted.current = true;
    const running = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of running.values()) window.clearTimeout(timer);
      running.clear();
    };
  }, []);

  const sources = feed.phase === "live" ? feed.sources : [];
  const sourceOf = (app: IndexApp): IndexAppsSource | undefined => madeAppSourceOf(app, sources);
  const desktopOf = (app: IndexApp): string => madeAppDesktop(sourceOf(app), app.device, here);
  const markOf = (app: IndexApp): Mark | undefined => {
    const mark = marks.get(app.foldKey);
    return mark !== undefined && mark.over === landed ? mark : undefined;
  };
  // this window's act on an app or a version, while it still stands over the app's row
  const actOf = (app: IndexApp, presentationId?: string): MadeAppAct | undefined => {
    const held = acts.get(actKey(app.appKey, presentationId));
    if (held === undefined) return undefined;
    return held.basis === null || held.basis === madeAppActBasis(app, sourceOf(app))
      ? held.act
      : undefined;
  };
  const stateOf = (app: IndexApp, presentationId?: string) => {
    const read = versions?.read;
    const entry =
      presentationId === undefined || read === null || read === "failed" || read === undefined
        ? undefined
        : read.entries.find((one) => one.presentationId === presentationId);
    return madeAppStateOf(app, sourceOf(app), actOf(app, presentationId), desktopOf(app), entry);
  };

  const begin = (key: string): boolean => {
    if (pending.current.has(key)) return false;
    pending.current.add(key);
    setBusy(new Set(pending.current));
    return true;
  };
  const finish = (key: string): void => {
    pending.current.delete(key);
    if (mounted.current) setBusy(new Set(pending.current));
  };
  const setAct = (key: string, held: Held | undefined): void => {
    if (!mounted.current) return;
    setActs((current) => {
      const next = new Map(current);
      if (held === undefined) next.delete(key);
      else next.set(key, held);
      return next;
    });
  };
  const cancelTimer = (key: string): void => {
    const timer = timers.current.get(key);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timers.current.delete(key);
  };
  const later = (key: string, delay: number, then: () => void): void => {
    cancelTimer(key);
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        then();
      }, delay),
    );
  };

  // one ask of `artifact.open`, and what its answer makes of the tile (or the version)
  const ask = async (
    app: IndexApp,
    presentationId: string | undefined,
    basis: string,
    again: number,
  ) => {
    const key = actKey(app.appKey, presentationId);
    const held = (act: MadeAppAct, over: string | null = basis): Held => ({
      appKey: app.appKey,
      act,
      basis: over,
    });
    if (!begin(app.appKey)) {
      // another open of this app is under way: a re-ask leaves its answer to that one
      if (again > 0) setAct(key, held({ kind: "starting" }));
      return;
    }
    try {
      const answer = await openMadeApp(client, app, presentationId);
      if (answer.state === "serving") {
        setAct(key, held({ kind: "serving" }));
        // green no longer than a serve nobody opens lives: past it the row's rest stands
        if (mounted.current) later(key, MADE_APP_SERVING_HELD_MS, () => setAct(key, undefined));
        return;
      }
      const delay = MADE_APP_OPEN_RETRY_DELAYS_MS[again];
      const reasking = delay !== undefined && mounted.current;
      setAct(key, held({ kind: "starting" }, reasking ? null : basis));
      if (reasking) later(key, delay, () => void ask(app, presentationId, basis, again + 1));
    } catch (failure) {
      if (!mounted.current) return;
      const refusal = madeAppRefusalOf(failure);
      if (refusal !== null) {
        setAct(key, held({ kind: "refused", state: refusal }));
        setNotice({ appKey: app.appKey, presentationId });
        return;
      }
      setAct(key, undefined);
      setError(madeAppErrorWords(failure, "open", app.title, desktopOf(app)));
      // an app no longer in Apps leaves the group at the next reading
      if (madeAppErrorKind(failure) === "NOT_FOUND") refresh();
    } finally {
      finish(app.appKey);
    }
  };

  const open = (app: IndexApp, presentationId?: string): void => {
    if (pending.current.has(app.appKey)) return;
    const key = actKey(app.appKey, presentationId);
    const state = stateOf(app, presentationId);
    setError(null);
    if (!state.opens) {
      setNotice(state.why === null ? null : { appKey: app.appKey, presentationId });
      return;
    }
    setNotice(null);
    cancelTimer(key);
    setAct(key, { appKey: app.appKey, act: { kind: "opening" }, basis: null });
    void ask(app, presentationId, madeAppActBasis(app, sourceOf(app)), 0);
  };

  const mark = async (app: IndexApp, flags: { kept?: boolean; hidden?: boolean }) => {
    const key = app.appKey;
    if (!begin(key)) return;
    setError(null);
    const act = flags.hidden === true ? "hide" : flags.kept === false ? "unkeep" : "keep";
    try {
      const answer = await markMadeApp(client, app, flags);
      if (!mounted.current) return;
      setMarks((current) =>
        new Map(current).set(app.foldKey, {
          kept: answer.kept,
          hidden: answer.hidden,
          over: readings.current,
        }),
      );
      refresh();
    } catch (failure) {
      if (mounted.current) setError(madeAppErrorWords(failure, act, app.title, desktopOf(app)));
    } finally {
      finish(key);
    }
  };

  const showVersions = async (app: IndexApp) => {
    setError(null);
    setNotice(null);
    setVersions({ app, read: null });
    try {
      const read = await madeAppVersions(client, app);
      if (mounted.current)
        setVersions((step) => (step?.app.appKey === app.appKey ? { app, read } : step));
    } catch (failure) {
      if (!mounted.current) return;
      setVersions((step) => (step?.app.appKey === app.appKey ? { app, read: "failed" } : step));
      setError(madeAppErrorWords(failure, "versions", app.title, desktopOf(app)));
    }
  };

  const closeVersions = (): void => {
    setVersions(null);
    setNotice(null);
  };

  const apps =
    feed.phase === "live"
      ? feed.apps.filter((app) => markOf(app)?.hidden !== true)
      : ([] as IndexApp[]);
  const clock = now ?? Date.now();
  // the notice's app: the Versions step's own while it shows, else a tile still in the group
  const noticedApp = (about: Noticed): IndexApp | undefined => {
    if (versions !== null) return versions.app.appKey === about.appKey ? versions.app : undefined;
    return apps.find((app) => app.appKey === about.appKey);
  };
  const noticed = notice === null ? undefined : noticedApp(notice);
  const why = noticed === undefined ? null : stateOf(noticed, notice?.presentationId).why;

  const alerts = (
    <>
      {noticed !== undefined && why !== null && (
        <MadeAppNotice
          title={why.title}
          detail={why.detail}
          hostedUrl={noticed.hostedUrl}
          onClose={() => setNotice(null)}
        />
      )}
      {error !== null && (
        <InlineNotice tone="error" role="alert" className="vf-apps-error">
          {error}
        </InlineNotice>
      )}
    </>
  );

  if (versions !== null) {
    const step = versions;
    const read = step.read === null || step.read === "failed" ? null : step.read;
    return (
      <section
        className="vf-apps vf-apps-versions"
        aria-label={`Versions of ${step.app.title}`}
        aria-busy={step.read === null ? "true" : undefined}
      >
        <div className="vf-apps-step-head">
          <UiButton onClick={closeVersions}>Back</UiButton>
          <span>
            <strong>Versions</strong>
            <small>{step.app.title}</small>
          </span>
        </div>
        {alerts}
        {read !== null && !read.canonicalReady && (
          <p className="vf-apps-reading" role="status">
            {madeAppReadingLine(desktopOf(step.app))}
          </p>
        )}
        {read !== null && read.canonicalReady && read.entries.length === 0 && (
          <EmptyState className="vf-apps-quiet" title="No versions found" />
        )}
        {read !== null && read.entries.length > 0 && (
          <ul className="vf-apps-version-list">
            {read.entries.map((entry) => {
              const at = madeAppAt(entry);
              return (
                <li key={entry.presentationId}>
                  <button
                    type="button"
                    className="vf-apps-version"
                    disabled={busy.has(step.app.appKey)}
                    onClick={() => open(step.app, entry.presentationId)}
                  >
                    <strong>{madeAppDayWords(at, clock, locale)}</strong>
                    {at > 0 && (
                      <small>
                        {new Date(at).toLocaleTimeString(locale, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </small>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  const reading = madeAppsFeedReadingLines(feed, here);

  return (
    <section
      className="vf-apps"
      aria-label={FROM_YOUR_AGENTS}
      aria-busy={feed.phase === "loading" ? "true" : undefined}
    >
      <div className="vf-apps-head">
        <h2>{FROM_YOUR_AGENTS}</h2>
        <input
          type="search"
          className={`${uiFieldClass} vf-apps-search`}
          placeholder={SEARCH_APPS}
          aria-label={SEARCH_APPS}
          maxLength={MADE_APPS_QUERY_MAX}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {alerts}
      {reading.map((line) => (
        <p key={line.key} className="vf-apps-reading" role="status">
          {line.words}
        </p>
      ))}
      {feed.phase === "live" && feed.clipped && (
        <p className="vf-apps-reading" role="status">
          {madeAppsClippedLine(feed.apps.length)}
        </p>
      )}
      {feed.phase === "error" && (
        <EmptyState
          className="vf-apps-quiet"
          title="Your agents' apps can't be read right now"
          actions={<UiButton onClick={retry}>Try again</UiButton>}
        />
      )}
      {feed.phase === "live" && apps.length === 0 && reading.length === 0 && (
        <EmptyState
          className="vf-apps-quiet"
          title={q === "" ? "No apps from your agents yet" : `No apps match “${q}”`}
        />
      )}
      {apps.length > 0 && (
        <div className="vf-apps-days">
          {madeAppDays(apps, clock, locale).map((day, index) => (
            <section key={`${index}:${day.label}`} className="vf-apps-day" aria-label={day.label}>
              <h3>{day.label}</h3>
              <ul className="vf-apps-tiles">
                {day.apps.map((app) => {
                  const source = sourceOf(app);
                  const kept = markOf(app)?.kept ?? app.kept === true;
                  return (
                    <MadeAppTile
                      key={app.appKey}
                      app={app}
                      facts={madeAppFacts(app, projects)}
                      desktop={desktopOf(app)}
                      state={stateOf(app)}
                      muted={madeAppAway(source)}
                      imageUrl={previewSrc(app, sources)}
                      kept={kept}
                      busy={busy.has(app.appKey)}
                      onOpen={() => open(app)}
                      onKeep={() => void mark(app, { kept: !kept })}
                      onHide={() => void mark(app, { hidden: true })}
                      onVersions={() => void showVersions(app)}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** Why a pressed tile did not open: its heading, its line, "Open in ‹host›" when the app has a
 * hosted link, and Close. */
function MadeAppNotice({
  title,
  detail,
  hostedUrl,
  onClose,
}: {
  title: string;
  detail: string | null;
  hostedUrl: string | undefined;
  onClose: () => void;
}): ReactElement {
  const host = madeAppHost(hostedUrl);
  return (
    <div className="vf-apps-notice" role="status">
      <span>
        <strong>{title}</strong>
        {detail !== null && <small>{detail}</small>}
      </span>
      <span className="vf-apps-notice__acts">
        {host !== undefined && hostedUrl !== undefined && (
          <a
            className={uiButtonClass}
            data-variant="primary"
            href={hostedUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in {host}
          </a>
        )}
        <UiButton onClick={onClose}>Close</UiButton>
      </span>
    </div>
  );
}
