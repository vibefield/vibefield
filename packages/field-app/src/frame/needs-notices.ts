import { type NeedsNotice, needsNoticesOf } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { type StatusNotice, sayStatus } from "./status-line";

// AN AGENT'S NOTIFY, IN THE WINDOW (track CO, CP-3; CP3-D5 A; DESIGN.md §8 "The status line", amended 2026-10-31, and
// §9 "An agent's notify"). Every window says each notify on its status line as fieldd tells it
// (`needs.notices.subscribe`): its snapshot is empty by design, and so is a reconnect's, so a notice told before this
// window listened is never said late. It is said as its teller — fieldd's name for it, never the agent's own words, so
// a notice cannot pass as another teller's — a dash, then its words, which fieldd has already put on one line of at
// most 140 characters (`noticeWords`); the line cuts the whole at its width with an ellipsis. One teller's notices shed
// among themselves (two wait at most, the third sheds that teller's oldest waiting one), so one agent never holds back
// another's. Main says the same notice outside the app while no VibeField window is in front (main/needs-notices.ts);
// nothing here depends on it. A fieldd without notify's carrier (one before CP-3) refuses the subscribe, and the
// window says nothing: no notice, never a guess.

/** What the window hears notify through: its fieldd client in the product (`needsNoticesPortOver`), a fake in a test. */
export interface NeedsNoticesPort {
  /** Each notice fieldd tells after this subscribe, one at a time, in order. Resolves to the way to stop; rejects where
   * fieldd has no carrier. */
  watch(onNotice: (notice: NeedsNotice) => void): Promise<() => void>;
}

export function needsNoticesPortOver(client: FielddClient): NeedsNoticesPort {
  return {
    watch: async (onNotice) => {
      const subscription = await client.subscribe(
        "needs.notices.subscribe",
        {},
        (payload, kind) => {
          // the snapshot, and a reconnect's fresh one, tell nothing: only what is told while the
          // window listens is news
          if (kind === "delta") for (const notice of needsNoticesOf(payload)) onNotice(notice);
        },
      );
      return () => subscription.unsubscribe();
    },
  };
}

/** One notify as the status line says it (DESIGN.md §8): the teller, a dash, its words, on one line, shed per teller.
 * A teller is its session, else its name — as fieldd counts a teller's notices. */
export function needsNoticeStatus(notice: NeedsNotice): StatusNotice {
  return {
    id: `notify:${notice.id}`,
    text: `${notice.from.name} — ${notice.words}`,
    oneLine: true,
    shed: `notify:${notice.from.session ?? notice.from.name}`,
  };
}

/** Say every notify on the status line, for the window's life (its host starts it once); the answer stops it. */
export function startNeedsNotices(port: NeedsNoticesPort): () => void {
  let open = true;
  let stop: (() => void) | null = null;
  port
    .watch((notice) => {
      if (open) sayStatus(needsNoticeStatus(notice));
    })
    .then(
      (unsubscribe) => {
        if (open) stop = unsubscribe;
        else unsubscribe();
      },
      // no carrier (a fieldd before CP-3), or no fieldd: the line says nothing of notify
      () => undefined,
    );
  return () => {
    open = false;
    stop?.();
    stop = null;
  };
}
