import { type FrameView, NeedsNotice } from "@vibefield/contracts";
import type { FielddHandleCoordinator } from "./fieldd-handle-coordinator";

// CP-3 (track CO, CP3-D5 A) — an agent's notify, said outside the app. Every
// window's status line says a notify; while no VibeField window is in front,
// main says it as an OS notice. Main decides, as for the link's notices
// (TS-5): a notice must reach someone with no window in front. DESIGN.md §9
// ("An agent's notify"): its title is the teller, as Chat or Godview names it,
// and its body the agent's words, which fieldd has already put on one line of
// at most 140 characters; a click opens Chat, whoever told it, and chooses
// nothing there. A notify is an event and is never kept, so there is no ledger
// and no first-minute quiet (that is the link's rule, LINK_NOTICE_QUIET_MS),
// and a new item in the needs-you queue raises no notice here. The carrier is
// fieldd's `needs.notices.subscribe` on the attached user's shell-main client:
// no IPC channel, preload door or shell.* method is added.

/** What main shows for one notify. */
export interface NeedsOsNotice {
  readonly title: string;
  readonly body: string;
  /** the view a click opens */
  readonly opens: FrameView;
}

export interface NeedsNoticePorts {
  /** a VibeField window is in front: its status line says it there */
  focused(): boolean;
  /** show it; a click opens `notice.opens` */
  notify(notice: NeedsOsNotice): void;
}

/** DESIGN.md §9 "An agent's notify": the teller, then its words. */
export function needsOsNotice(notice: NeedsNotice): NeedsOsNotice {
  return { title: notice.from.name, body: notice.words, opens: "assistant" };
}

/** Binds notify's notices to the attached user's fieldd, re-subscribing on
 * every new handle (supervisor recovery); a late answer from an old handle is
 * unsubscribed at once and says nothing. */
export class NeedsNoticeObserver {
  private generation = 0;
  private stop: (() => void) | null = null;
  private readonly stopHandles: () => void;

  constructor(
    coordinator: Pick<FielddHandleCoordinator, "onHandle">,
    private readonly ports: NeedsNoticePorts,
    onError: (error: unknown) => void,
  ) {
    this.stopHandles = coordinator.onHandle((handle) => {
      this.generation += 1;
      const generation = this.generation;
      this.clear();
      void handle.client
        .subscribe("needs.notices.subscribe", {}, (payload, kind) => {
          // the snapshot (and a reconnect's fresh one) is empty by design: a
          // notice told before this client heard is never said late
          if (kind === "delta" && generation === this.generation) this.apply(payload);
        })
        .then(
          (subscription) => {
            if (generation !== this.generation) {
              subscription.unsubscribe();
              return;
            }
            this.stop = subscription.unsubscribe;
          },
          (error: unknown) => {
            if (generation === this.generation) onError(error);
          },
        );
    });
  }

  dispose(): void {
    this.generation += 1;
    this.stopHandles();
    this.clear();
  }

  /** The tolerant reader: each notice is read alone, and one this build cannot
   * read is passed over without holding back the others. */
  private apply(payload: unknown): void {
    const notices =
      typeof payload === "object" && payload !== null
        ? (payload as { notices?: unknown }).notices
        : undefined;
    if (!Array.isArray(notices)) return;
    for (const value of notices) {
      const notice = NeedsNotice.safeParse(value);
      if (!notice.success || this.ports.focused()) continue;
      this.ports.notify(needsOsNotice(notice.data));
    }
  }

  private clear(): void {
    const stop = this.stop;
    this.stop = null;
    try {
      stop?.();
    } catch {
      // teardown is best-effort
    }
  }
}
