import type { ProductSessionRosterItem } from "@vibefield/contracts";
// The deep kit entry, not the barrel: this view is re-exported from the
// registration door, which the registry build reaches, and the barrel pulls the
// GL surface (design-kit → @vibecook/ice/r3f → three → loro) in behind one
// class name (docs/UI_SYSTEM.md's 2026-08-10 finding).
import {
  EmptyState,
  StatusDot,
  UiButton,
  UnavailableState,
} from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import type { TerminalRosterState } from "../pool";
// Its own skin, so the view is complete wherever it is mounted — the widget,
// or the catalog reaching for it directly.
import "./mirror-widget.css";

// THE SESSION PICKER — controller-free (docs/UI_SYSTEM.md: "for runtime-bound
// UI, export a controller-free View/Frame/Stage; keep subscriptions, services
// and engine operations in the controller"). It takes a roster and a state and
// renders; it reads nothing and writes nothing. `TerminalMirrorWidget` owns the
// read (`refreshTerminalRoster`) and the write (the durable prop); the catalog
// mounts THIS with fixture rows, which is how the bench shows five states it
// could never reach with no daemon under it.
//
// WHAT IT MAY SHOW. `ProductSessionRosterItem`s (TPv3 §5.3, TP-D4): id, class,
// health, provenance — and NO placement, which the contract refuses at parse.
// So the picker cannot accidentally become a placement UI: there is no cell to
// print. The one thing it must not do is present an empty list as an empty
// FLOOR — `rosterState` carries fieldd's own honesty (`unobserved` = it has not
// looked yet) and this window's (`unavailable` = it could not ask), and each
// gets its own face. An empty list is only trustworthy under `observed`.

/** A roster row's health as the shared status-dot vocabulary. `unknown` is
 * muted rather than an error tone: not knowing is not a fault. */
function healthTone(health: ProductSessionRosterItem["health"]): "healthy" | "attention" | "muted" {
  switch (health) {
    case "live":
      return "healthy";
    case "recovering":
      return "attention";
    default:
      return "muted";
  }
}

/** The line under the id: who made it and what class it is. Provenance is
 * optional on the wire, so its absence is simply not printed — never "unknown
 * agent", which invents a fact. */
function rowDetail(item: ProductSessionRosterItem): string {
  const parts: string[] = [item.workloadClass, item.health];
  const kind = item.provenance?.kind;
  if (kind !== undefined && kind !== "unknown") {
    parts.push(
      item.provenance?.agentId === undefined ? kind : `${kind} · ${item.provenance.agentId}`,
    );
  }
  return parts.join(" · ");
}

export interface SessionPickerViewProps {
  items: readonly ProductSessionRosterItem[];
  state: TerminalRosterState;
  /** The user chose a session. The controller writes it durably. */
  onPick: (item: ProductSessionRosterItem) => void;
  /** Ask the floor again. Absent = no refresh affordance (the catalog). */
  onRefresh?: () => void;
  /** A read is in flight — the button says so rather than looking inert. */
  busy?: boolean;
}

export function SessionPickerView({
  items,
  state,
  onPick,
  onRefresh,
  busy = false,
}: SessionPickerViewProps): ReactElement {
  const refresh =
    onRefresh === undefined ? undefined : (
      // `data-canvas-interactive` is the C-2 opt-in: this is a CONTROL, so its
      // pointerdown belongs to the button and not to card drag. The mirror
      // itself carries no such attribute anywhere — a watcher consumes no
      // gesture — and the difference between the two is the whole point of the
      // attribute being explicit.
      <span data-canvas-interactive="">
        <UiButton onClick={onRefresh} disabled={busy}>
          {busy ? "looking…" : "look again"}
        </UiButton>
      </span>
    );

  if (state === "unread" && items.length === 0) {
    return (
      <div className="vf-terminal-picker" data-roster-state={state}>
        <UnavailableState
          compact
          title="reading the roster"
          description="asking this device which sessions it is holding"
        />
      </div>
    );
  }

  if (state === "unobserved") {
    return (
      <div className="vf-terminal-picker" data-roster-state={state}>
        <UnavailableState
          compact
          title="the floor has not been observed"
          description="fieldd has not looked at the terminal floor yet — this is not an empty machine"
        />
        {refresh}
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="vf-terminal-picker" data-roster-state={state}>
        <UnavailableState
          compact
          title="roster unavailable"
          description="this window could not ask for the session list"
        />
        {refresh}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="vf-terminal-picker" data-roster-state={state}>
        <EmptyState
          title="no sessions to watch"
          description="start a terminal session and this card can mirror it"
          {...(refresh === undefined ? {} : { actions: refresh })}
        />
      </div>
    );
  }

  return (
    <div className="vf-terminal-picker" data-roster-state={state}>
      <div className="vf-terminal-picker-head">
        <span className="vf-terminal-picker-title">watch a session</span>
        {refresh}
      </div>
      <ul className="vf-terminal-picker-list">
        {items.map((item) => (
          <li key={item.sessionId} data-canvas-interactive="">
            <button
              type="button"
              className="vf-terminal-picker-row"
              onClick={() => onPick(item)}
              data-health={item.health}
            >
              <StatusDot tone={healthTone(item.health)} />
              <span className="vf-terminal-picker-row-name">{item.title ?? item.sessionId}</span>
              <span className="vf-terminal-picker-row-detail">{rowDetail(item)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
