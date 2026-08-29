import type {
  PluginAttachmentPool,
  PluginLiveSurfaceOptions,
  PluginSurfaceHandle,
} from "@vibefield/plugin-sdk";
import { useOps, useWidgetProps, type WidgetComponentProps } from "@vibefield/plugin-sdk/canvas";
import { CardShell } from "@vibefield/plugin-sdk/ui";
import { type ComponentType, type ReactElement, useEffect, useRef, useState } from "react";
import { type BrowserPageCommit, BrowserPageView } from "./BrowserPageView";
import { BLANK_PAGE, BROWSER_PAGE_TYPE } from "./manifest";

// DT-3d — the browser card's CONTROLLER. It owns the three things a view
// cannot: the durable props (read per conflict group, written through the
// engine's own op), the attachment's lifetime, and the identity that ties the
// two together. Everything visible is `BrowserPageView`'s.

/** Per DT-D7's group split, each durable prop is read from its own conflict
 * group — `useWidgetProps` reads ONE group per call, and the group names are
 * the manifest's (`address`/`title`/`chrome`). */
interface AddressProps extends Record<string, unknown> {
  url: string;
}
interface TitleProps extends Record<string, unknown> {
  title: string;
}
interface ChromeProps extends Record<string, unknown> {
  showChrome: boolean;
}

/**
 * The card's name for its surface.
 *
 * ONE CARD, ONE ATTACHMENT: the pool shares an attachment across every holder
 * of a key, so two cards must never agree on one. The entity is what makes
 * this card this card, and the host namespaces the whole thing by plugin id
 * before it reaches the pool, so nothing outside this plugin can name it.
 *
 * THE CEILING, STATED. This key is only as durable as the entity id, which is
 * a RUNTIME number (`Entity` is a branded number; the ECS runtime is
 * key-ignorant and the SDK's canvas door exposes no durable entity key). So
 * `reuseKey` re-binds the same running page across everything inside one
 * renderer generation — a remount, a cull, the pool's grace window — which is
 * what it is for. It does NOT promise re-binding across a renderer reload,
 * because a plugin cannot currently name a card the same way twice across one.
 * Saying so here rather than implying otherwise: the surface a reload orphans
 * is swept by main's stale-incarnation sweep, and the card re-attaches to its
 * durable `url`, which is the honest half of the promise and the half DT-D7
 * actually makes.
 */
export function surfaceKeyFor(entity: WidgetComponentProps["entity"]): string {
  return `page:${String(entity)}`;
}

/**
 * Everything the card asks the pool for, in one place a test can read.
 *
 * `key` and `reuseKey` are deliberately the SAME string: the key says which
 * attachment in this window, the reuse key says which running runtime to
 * re-bind to, and for a card those are one question — this card's page.
 */
export function browserSurfaceOptions(
  entity: WidgetComponentProps["entity"],
  initialUrl: string,
): PluginLiveSurfaceOptions {
  const key = surfaceKeyFor(entity);
  return {
    key,
    source: {
      kind: "browser",
      initialUrl,
      // A memory profile per card: cookies and storage are runtime policy,
      // never durable (DT-D7's never-persisted column), and `ref` scopes the
      // partition to this card so two browser cards are two sessions.
      profile: { mode: "memory", ref: key },
      logicalViewport: { width: 1024, height: 768 },
    },
    reuseKey: key,
    // A seed the view immediately corrects: `SurfaceView` measures its own
    // element and re-declares this holder's demand on mount (DT-D5).
    initialDemand: { mode: "live", targetFps: 30, priority: 50, interactive: false },
  };
}

export function createBrowserPageWidget(
  pool: PluginAttachmentPool,
): ComponentType<WidgetComponentProps> {
  const { SurfaceView } = pool;

  function BrowserPageWidget({ entity, world }: WidgetComponentProps): ReactElement {
    const address = useWidgetProps<AddressProps>(world, entity, BROWSER_PAGE_TYPE, "address");
    const heading = useWidgetProps<TitleProps>(world, entity, BROWSER_PAGE_TYPE, "title");
    const chrome = useWidgetProps<ChromeProps>(world, entity, BROWSER_PAGE_TYPE, "chrome");
    const ops = useOps();

    const url = address?.url ?? BLANK_PAGE;
    const title = heading?.title ?? "";
    const showChrome = chrome?.showChrome ?? true;

    const [handle, setHandle] = useState<PluginSurfaceHandle | null>(null);

    // The address the surface OPENS at, read through a ref so that navigating
    // never re-acquires. A url in the effect's dependencies would tear down a
    // live page and mint a new surface on every commit — steering is
    // `navigate()`'s job, and re-minting would also spend a fresh ticket for a
    // page the user only scrolled.
    const initialUrl = useRef(url);

    useEffect(() => {
      const claim = pool.liveSurface(browserSurfaceOptions(entity, initialUrl.current));
      setHandle(claim);
      return () => {
        setHandle(null);
        // The ACQUIRER releases (03·A C-3); the view never does. The
        // activation's own scope releases it too if this card is still mounted
        // when the plugin deactivates, which is the backstop, not the plan.
        claim.release();
      };
    }, [entity]);

    const commit = (next: BrowserPageCommit): void => {
      // The engine's own op, the same door the note card writes through — one
      // durable write, routed to the conflict group each prop belongs to.
      ops.setWidgetProps(entity, {
        url: next.url,
        ...(next.title === undefined ? {} : { title: next.title }),
      });
    };

    return (
      <CardShell world={world} entity={entity}>
        {handle === null ? null : (
          <BrowserPageView
            handle={handle}
            SurfaceView={SurfaceView}
            url={url}
            title={title}
            showChrome={showChrome}
            onCommit={commit}
          />
        )}
      </CardShell>
    );
  }

  BrowserPageWidget.displayName = "BrowserPageWidget";
  return BrowserPageWidget;
}
