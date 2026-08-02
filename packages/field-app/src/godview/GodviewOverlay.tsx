import type { TerminalBridgeStatus } from "@vibefield/contracts";
import { type ReactElement, useEffect, useState } from "react";
import { getHost } from "../host";
import { GodviewDeck } from "./GodviewDeck";
import { useGodviewOpen } from "./overlay-state";

// The Godview overlay — the control room (DESIGN.md §1: "may commit to dark —
// it is a stage, not a document"). Spine UI in the canvas window (GT-D2),
// mounted above the field by ChromeLayer, toggled by ⌘G, the View menu, or the
// toolbar button, all of which are the same request to the same owner.
//
// It commits to dark in BOTH app themes and does not apologize for it: this is
// where terminals live, and a terminal on a white stage is a document pretending
// to be a machine. The palette is still §2's — the dark card surface at the §5
// sheet tier, hairlines at white/10, the text opacity ramp — so nothing here is
// a bespoke color.
//
// LIFETIME (PF6): closed by default and NOT mounted until the first open, so a
// user who never presses ⌘G forks no bridge and spawns no shell. After that the
// deck stays mounted for the life of the document and only its `active` prop
// moves — reopening is instant, the layout survives, and every hidden surface
// is silenced at ghosttea's own visibility seam rather than by unmounting the
// world and rebuilding it.

/** The honest word for a bridge that is not up. `bridge-up` says nothing —
 * a working transport is not news, and DESIGN.md's rule for standing states is
 * that no facts means no row (§8 doc sync). */
function bridgeNotice(status: TerminalBridgeStatus | null): string | null {
  if (status === null || status.state === "bridge-up") return null;
  if (status.state === "bridge-down") return "terminal bridge down · rebuilding";
  return "terminal bridge unavailable · reconnecting";
}

export function GodviewOverlay(): ReactElement | null {
  const open = useGodviewOpen();
  /** Once true, stays true. The deck is expensive to build and instant to
   * reveal, so it is built once — on the first open — and hidden thereafter. */
  const [everOpened, setEverOpened] = useState(false);
  const [bridge, setBridge] = useState<TerminalBridgeStatus | null>(null);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    const terminal = getHost().terminal;
    if (terminal === undefined) return;
    return terminal.onStatus(setBridge);
  }, []);

  // Esc closes, consistently (DESIGN.md §7). Capture phase, so a focused
  // terminal surface cannot swallow the one key that gets the user out.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void getHost().godview?.set(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!everOpened) return null;

  const notice = bridgeNotice(bridge);
  const terminalAvailable = getHost().terminal !== undefined;

  return (
    <div
      // aria-hidden while closed: it is still in the tree for PF6's sake, and a
      // screen reader should no more find it than an eye should.
      aria-hidden={!open}
      // The attribute IS the state: every material, easing and duration lives
      // in styles.css under `.vf-godview` (M3 — CSS transitions, not WAAPI, and
      // a media query can reach them for M6).
      data-godview-open={open ? "true" : "false"}
      className="vf-godview"
    >
      {/* The eyebrow row (§3): what this is on the left, what is wrong on the
          right. Nothing in the middle — the deck is the content. */}
      <header className="vf-godview-header flex items-center justify-between px-5 py-3">
        <span
          className="font-medium text-[10px] uppercase tracking-[0.08em]"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Godview
        </span>
        <span className="flex items-center gap-3">
          {notice !== null && (
            <span className="text-[11px]" style={{ color: "var(--vf-orange)" }}>
              {notice}
            </span>
          )}
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
            esc to close
          </span>
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        {terminalAvailable ? (
          <GodviewDeck active={open} />
        ) : (
          // The degraded face (§8 "a state is rendered, never blank space"):
          // a host with no terminal bridge cannot show terminals, and saying so
          // beats an empty stage that looks like a bug.
          <p
            className="absolute inset-0 flex items-center justify-center text-[13px]"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            This host has no terminal bridge — the deck is unavailable here.
          </p>
        )}
      </div>
    </div>
  );
}
