// PJ-6 — NEW AGENT'S ROWS TURN IN PLACE (DESIGN.md §8 "History", New agent).
// The room draws a host's rows and closes them on every choice (rosetta
// `HostMenu.tsx`, ROOM API v3): it pages nothing. A choice that turns New
// agent's rows to another page (Another model…, a model with controls, back)
// is said by the host as a new page, and the room's own trigger is pressed
// again once the room has closed its rows, so the next page opens where the
// last one was. The room's trigger is the one control this reaches:
// `button.ah-hostact[data-act="new-agent"]`, found while its rows are still
// open (`aria-expanded`), which names the one New agent whose rows were
// chosen in, wherever several rooms are drawn (the catalog). An interim until
// the room pages its own rows (a room ask); if the trigger is not found, the
// page waits for the next press, which shows it.
//
// Rows closed WITHOUT a turn (Escape, a press outside, a start) open on the
// first page again: the trigger's `aria-expanded` is watched from the reopen
// until it falls, and a fall no turn asked for is said to `closed`.

const OPEN_TRIGGER = 'button.ah-hostact[data-act="new-agent"][aria-expanded="true"]';

/** The watch on the reopened rows, held strongly (a collected observer would
 * never say the rows closed). One New agent's rows are open at a time. */
let watching: MutationObserver | null = null;

export function turnNewAgentPage(closed: () => void, scope: ParentNode = document): void {
  // a turn chosen in reopened rows: their closing is this turn's, not a close
  watching?.disconnect();
  watching = null;
  const trigger = scope.querySelector<HTMLButtonElement>(OPEN_TRIGGER);
  if (trigger === null) return;
  // the room closes its rows after this choice's own handler returns; the
  // next page opens once it has
  setTimeout(() => {
    if (!trigger.isConnected) return;
    // React commits the reopen after the click returns: the watch starts first
    let opened = trigger.getAttribute("aria-expanded") === "true";
    const observer = new MutationObserver(() => {
      if (trigger.getAttribute("aria-expanded") === "true") {
        opened = true;
        return;
      }
      if (!opened) return;
      observer.disconnect();
      if (watching === observer) watching = null;
      closed();
    });
    observer.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
    watching = observer;
    if (!opened) trigger.click();
  }, 0);
}
