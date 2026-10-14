import type { ReaderAddress, RoomPorts } from "@vibefield/rosetta-room";
import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useState,
} from "react";
import { getRendererLogger } from "../logging";
import { HistoryOpenFailedState, HistoryOpeningState } from "./HistoryOpening";
import type { HistoryRoomViewProps } from "./HistoryRoomView";

// THE HISTORY ROOM'S CHUNK (AR-8c's follow-up, 2026-10-04; DESIGN.md §8
// "History" — "Its first open says 'Opening History'"). The room —
// `HistoryRoomView`, everything under `@vibefield/rosetta-room`, and the package's sheet
// — is its own chunk, reached by the ONE dynamic import below and by nothing
// static: `ui-system-boundaries` holds the source to that, and
// `pnpm bundle:assert` holds the build. Until then the room's sheet rode the
// first paint (the app's manifest, render-blocking) and its code the canvas's
// chunk, for a view a window may never show.
//
// When it loads: when the window is first IDLE after the chrome has mounted —
// after the canvas has drawn, never on its path — or at the first ⌘3 if that
// comes sooner. GT-D14's rule for the terminal pool's prewarm, the same idle
// and the same ceiling: worth doing early, and worth doing LAST. Prefetching
// is a code fetch only; the room still MOUNTS on History's first open
// (`ViewFrame`), so a window that never shows History opens no feed and holds
// no stream. An environment with no idle moment to observe (a test's DOM)
// gets no prefetch, and its first ⌘3 loads the chunk.
//
// While the chunk arrives the view says so in VibeField's words, on the
// room's own glass (`HistoryOpening.tsx`); a chunk that will not load, or a
// room that fails as it draws, is held in the view's place in its own words,
// with Retry — it never takes the window down with it.

type RoomModule = typeof import("./HistoryRoomView");
type LazyRoom = LazyExoticComponent<ComponentType<HistoryRoomViewProps>>;

/** The idle prefetch's ceiling: the browser runs it at its next idle moment,
 * or after this long if it never has one (GT-D14's prewarm). */
export const HISTORY_ROOM_PREFETCH_TIMEOUT_MS = 2_000;

export interface HistoryRoomLoader {
  /** The room's module: one import shared by every caller. A refusal is not
   * kept, so the next call asks again (the boot machine's rule — a failed
   * fetch must not poison a retry). */
  load(): Promise<RoomModule>;
  /** Fetch the room when the window is next idle; answers the cancel. */
  prefetchWhenIdle(timeoutMs?: number): () => void;
}

interface IdleScope {
  requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** A loader over `importRoom` — the product's is the room's one dynamic
 * import; a test hands its own. */
export function historyRoomLoader(importRoom: () => Promise<RoomModule>): HistoryRoomLoader {
  let pending: Promise<RoomModule> | null = null;
  const load = (): Promise<RoomModule> => {
    pending ??= importRoom().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  return {
    load,
    prefetchWhenIdle(timeoutMs = HISTORY_ROOM_PREFETCH_TIMEOUT_MS) {
      const scope = globalThis as IdleScope;
      if (typeof scope.requestIdleCallback !== "function") return () => undefined;
      const handle = scope.requestIdleCallback(
        () => {
          // A refusal here is said by the first open, in the view's place.
          load().catch(() => undefined);
        },
        { timeout: timeoutMs },
      );
      return () => scope.cancelIdleCallback?.(handle);
    },
  };
}

/** The product's loader: the room's one dynamic import. */
const HISTORY_ROOM = historyRoomLoader(() => import("./HistoryRoomView"));

/** Fetch the room's chunk when the window is next idle (ChromeLayer's, once
 * the chrome has mounted); answers the cancel. */
export function prefetchHistoryRoomWhenIdle(timeoutMs?: number): () => void {
  return HISTORY_ROOM.prefetchWhenIdle(timeoutMs);
}

/** A fresh lazy room over `loader` — one per attempt, since a lazy component
 * keeps its refusal for life. */
function lazyRoom(loader: HistoryRoomLoader): LazyRoom {
  return lazy(async () => ({ default: (await loader.load()).HistoryRoomView }));
}

/** Holds what failed — the chunk refused, or the room as it drew — in the
 * view's place, instead of letting it take the window down with it. */
class HistoryRoomBoundary extends Component<
  { onRetry: () => void; children: ReactNode },
  { reason: string | null }
> {
  override state: { reason: string | null } = { reason: null };
  static getDerivedStateFromError(error: unknown): { reason: string } {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    getRendererLogger()
      .child({ component: "history" })
      .error("renderer.history.room_failed", "History's room could not open", error);
  }
  private readonly retry = (): void => {
    this.setState({ reason: null });
    this.props.onRetry();
  };
  override render(): ReactNode {
    if (this.state.reason === null) return this.props.children;
    return <HistoryOpenFailedState reason={this.state.reason} onRetry={this.retry} />;
  }
}

/** History's room through its chunk: "Opening History" while it arrives,
 * the room in its place once it is here, and what failed with Retry if it
 * cannot open. `loader` is the product's unless a test hands its own. */
export function HistoryRoomMount({
  loader = HISTORY_ROOM,
  ...room
}: HistoryRoomViewProps & { loader?: HistoryRoomLoader }): ReactElement {
  // A lazy component is an object (React calls neither it nor its update as a
  // function), so the initializer and the retry's updater each make one.
  const [Room, setRoom] = useState<LazyRoom>(() => lazyRoom(loader));
  const retry = useCallback(() => setRoom(() => lazyRoom(loader)), [loader]);
  return (
    <HistoryRoomBoundary onRetry={retry}>
      <Suspense fallback={<HistoryOpeningState />}>
        <Room {...room} />
      </Suspense>
    </HistoryRoomBoundary>
  );
}

/** PK3 — the room's reader through the room's own chunk (one dynamic import:
 * the reader is the room's code), for the Peek's past picture. One lazy
 * component for the window. */
const PEEK_READER = lazy(async () => ({ default: (await HISTORY_ROOM.load()).PeekReaderView }));

/** Holds a reader that cannot load or draw in `fallback`'s place: the Peek
 * keeps the matched lines rather than a hole. */
class PeekReaderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    getRendererLogger()
      .child({ component: "history" })
      .error("renderer.history.reader_failed", "the Peek's reader could not draw", error);
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The Peek's past picture (PK3): the room's reader at `at`, `fallback` (the
 * session's matched lines) while the chunk arrives or if it cannot. */
export function PeekReaderMount({
  ports,
  at,
  fallback,
}: {
  ports: RoomPorts;
  at: ReaderAddress;
  fallback: ReactNode;
}): ReactElement {
  return (
    <PeekReaderBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <PEEK_READER ports={ports} at={at} />
      </Suspense>
    </PeekReaderBoundary>
  );
}
