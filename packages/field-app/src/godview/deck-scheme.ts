import type { TerminalScheme } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { useEffect } from "react";
import { getRendererLogger } from "../logging";
import type { TerminalTheme } from "./deck-theme";

// TL-4a (2026-11-18) — THE DECK SAYS THE DEVICE'S TERMINAL SCHEME, AND NOTHING
// ELSE DOES. A pane's theme is a viewer's: it colours what this window draws. A
// program inside the pane does not see it; it asks its terminal what the ground
// is and picks its dark or its light design from the answer. That answer is the
// session's, so it is fieldd's to give, and the deck is what tells fieldd: the
// ground, ink and cursor of the look it draws its panes in.
//
// THE ONE CALLER. This module is the only place in the renderer that names
// `terminal.scheme.set`, and the real deck is its only user. A preview of a
// pane (the catalog, Settings' miniature, the live peek, a sign-in pane) draws
// with a theme and says nothing: a look tried on in a preview must not recolour
// what every running agent on the device is told.

/** How long the deck's look must stand still before it is said. A look being
 * dragged through values is said once, where it comes to rest. */
export const DECK_SCHEME_SETTLE_MS = 200;

function channel(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function hexOf(color: readonly [number, number, number, number]): string {
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

/** The scheme a pane theme stands for: its ground, ink and cursor as opaque
 * colours (a pane's alpha is the viewer's, never the session's). The palette
 * is empty until the terminal can be told one. */
export function deckTerminalScheme(
  theme: Pick<TerminalTheme, "foreground" | "background" | "cursor">,
): TerminalScheme {
  return {
    foreground: hexOf(theme.foreground),
    background: hexOf(theme.background),
    cursor: hexOf(theme.cursor),
    palette: [],
  };
}

/** The door the scheme is said through: fieldd's client, as the deck holds it. */
export interface DeckSchemeDoor {
  request(method: string, params?: unknown): Promise<unknown>;
}

/** Say the deck's scheme to fieldd: once the look has stood still for
 * `DECK_SCHEME_SETTLE_MS`, at mount and at every change of its ground, ink or
 * cursor. fieldd answers an unchanged scheme by telling nobody, so a re-mount
 * is silent. A refusal is fieldd's honest state and no sentence to a person,
 * but it is not invisible: it is logged (`sayScheme`). The deck says the
 * scheme again at its next change or mount, not when a lost connection
 * returns. */
export function useSayDeckScheme(door: DeckSchemeDoor, theme: TerminalTheme): void {
  const { foreground, background, cursor } = deckTerminalScheme(theme);
  useEffect(() => {
    const timer = setTimeout(() => {
      void sayScheme(door, { foreground, background, cursor, palette: [] });
    }, DECK_SCHEME_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [door, foreground, background, cursor]);
}

/** The code of the refusal last logged, until a say succeeds. One deck to a
 * window, so one to the module. */
let refusedAs: string | null = null;

/** A refused say is logged once under its code (fieldd's own kind, or
 * `unreachable` when nothing answered) and not again under the same code until
 * a say has succeeded: a deck re-saying into the same refusal does not fill
 * the log. The scheme itself is never logged. */
async function sayScheme(door: DeckSchemeDoor, scheme: TerminalScheme): Promise<void> {
  try {
    await door.request("terminal.scheme.set", { scheme });
    refusedAs = null;
  } catch (cause) {
    const code = cause instanceof FielddRpcError ? cause.kind : "unreachable";
    if (code === refusedAs) return;
    refusedAs = code;
    getRendererLogger()
      .child({ component: "godview" })
      .warn(
        "renderer.godview.scheme_refused",
        "fieldd did not take the deck's terminal scheme; the next change or mount says it again",
        { code },
      );
  }
}

/** Tests only: forget the refusal last logged. */
export function resetDeckSchemeForTests(): void {
  refusedAs = null;
}
