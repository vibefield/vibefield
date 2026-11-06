import {
  FIELDD_LINK,
  type FielddLinkUnavailable,
  type RendererReplaceReason,
} from "@vibefield/contracts";
import { getRendererLogger } from "../logging";
import { type StatusNotice, sayStatus, withdrawStatus } from "./status-line";

// THE FIELD SERVICE, IN THE WINDOW (item 212, RV #29; DESIGN.md §8 "The status line", amended 2026-11-06, the words at
// the lean James ruled (rv-service-recovery, 11-06)). Main holds the field service for the attached person
// (`desktopState.fieldd`, electron-shell main/fieldd-link.ts, the ONE detector); this window says it on its status line
// and detects nothing itself. One held notice at a time: "Reconnecting to the field service…" while main starts it
// again; once main stopped trying, "VibeField's field service stopped after 3 tries. Your terminal sessions keep
// running." with Try again, which asks main to replace this window through the existing door (`field-service`): the
// reloaded window's bootstrap is the person's ask. Withdrawn the moment the field service is back. The status line
// stands over every view's cover, Godview's included, so no view says it twice. RV #67: while it is up and its
// replies are silent, "VibeField's field service isn't responding. …" is held, with no act, until it answers.

const log = () => getRendererLogger().child({ component: "frame.field-service" });

/** The shell's replace door (`FieldHost.replaceRenderer`); a host without one has no Try again. */
export interface FieldServiceDoor {
  readonly replaceRenderer?: (reason: RendererReplaceReason) => Promise<unknown>;
}

/** The status line's notice for the field service as main said it, or null where the line says nothing of it. */
export function fieldServiceNotice(
  fieldd: FielddLinkUnavailable | null | undefined,
  retry: (() => void) | undefined,
): StatusNotice | null {
  if (fieldd === null || fieldd === undefined) return null;
  switch (fieldd.state) {
    case FIELDD_LINK.STATE_RECOVERING:
      return {
        id: "field-service:recovering",
        text: "Reconnecting to the field service…",
        hold: true,
      };
    case FIELDD_LINK.STATE_CRASH_LOOP: {
      const stopped =
        fieldd.failures === undefined
          ? "VibeField's field service stopped."
          : `VibeField's field service stopped after ${triesWords(fieldd.failures)}.`;
      const text = `${stopped} Your terminal sessions keep running.`;
      const id = "field-service:crash-loop";
      return retry === undefined
        ? { id, text, hold: true }
        : { id, text, act: { label: "Try again", run: retry } };
    }
    case FIELDD_LINK.STATE_UNRESPONSIVE:
      // RV #67 (DESIGN.md §8, amended 2026-11-06, at the lean, ruled: rv-service-recovery): up, and silent.
      // Held with no act: there is nothing a person's ask would start while it is up
      return {
        id: "field-service:unresponsive",
        text: "VibeField's field service isn't responding. Your terminal sessions keep running. If it lasts, quit VibeField and open it again.",
        hold: true,
      };
  }
}

/** "1 try", "3 tries". */
function triesWords(tries: number): string {
  return tries === 1 ? "1 try" : `${tries} tries`;
}

/** The window's teller: each state main publishes, said once; the notice before it withdrawn. */
export function fieldServiceTeller(door: FieldServiceDoor): {
  tell(fieldd: FielddLinkUnavailable | null | undefined): void;
  stop(): void;
} {
  const replace = door.replaceRenderer;
  // The reload is the answer. A refused door (no reload) leaves the notice and its act standing, to be taken again.
  const retry =
    replace === undefined
      ? undefined
      : () => {
          void replace("field-service").catch((error: unknown) => {
            log().error(
              "renderer.field_service.replace_refused",
              "The shell did not replace this window for Try again; the notice stands",
              error,
            );
          });
        };
  let said: StatusNotice | null = null;
  return {
    tell(fieldd) {
      const next = fieldServiceNotice(fieldd, retry);
      if (next?.id === said?.id && next?.text === said?.text) return;
      if (said !== null) withdrawStatus(said.id);
      said = next;
      if (next !== null) sayStatus(next);
    },
    stop() {
      if (said !== null) withdrawStatus(said.id);
      said = null;
    },
  };
}
