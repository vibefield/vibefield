import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { GhostteaProvider, TerminalSurface, type TerminalTheme } from "@vibecook/ghosttea-react";
import type { TerminalCreateOpenResult } from "@vibefield/contracts";
import { UnavailableState } from "@vibefield/design-kit/primitives";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { useDeckAppearance } from "../../godview/deck-appearance";
import { godviewTerminalTheme } from "../../godview/deck-theme";
import {
  adoptCreatedTerminal,
  prewarmTerminalPool,
  useTerminalPool,
  useTerminalSessionViews,
} from "../../terminal/pool";

// THE SIGN-IN TERMINAL (AR-S2) — the vendor's own login, interactive, on the
// Settings page that asked for it (pass 16: "sign-ins run the agent's own
// command in a terminal on the page, in that profile's folder").
//
// The window's terminal pool's third consumer, beside the deck (which owns
// panes) and the mirror (which only watches). `agents.profiles.login` answers
// the same create ticket an agent spawn does, so the pool ADOPTS it exactly as
// the deck adopts a spawn (placement recorded, the routed ticket primed for its
// first activation, the birth summary registered) and one surface is bound to
// it, live, for as long as this card is on screen. It never claims the pool:
// the deck stays the only consumer that opens and restores panes. A window
// that has not opened Godview yet has no runtime; warming the pool hands it
// this window's client, a no-op when it is already warm.
//
// Interactive on purpose — device codes, a browser hand-off, a pasted code —
// and nothing reads what it prints: fieldd learns the outcome from the
// provider's own status surface when the pane ends (RFC 006).

/** Whether the page is in dark mode: the class the theme stamps on the root. */
function useDocumentDark(): boolean {
  const read = (): boolean =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function SignInTerminal({
  terminal,
  platform,
}: {
  /** `agents.profiles.login`'s ticket for the pane the login runs in */
  terminal: TerminalCreateOpenResult;
  platform?: string | undefined;
}): ReactElement {
  const client = useFielddClient();
  const pool = useTerminalPool();
  const [born, setBorn] = useState<{ sessionId: string; session: SessionSummary } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    try {
      prewarmTerminalPool(client);
      setBorn(adoptCreatedTerminal(terminal));
      setProblem(null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, terminal]);

  useTerminalSessionViews(born === null ? [] : [born.sessionId], "live");

  // The deck's own palette for the viewer's mode, opaque: a login is read
  // against the Settings sheet, not over the stage.
  const appearance = useDeckAppearance();
  const dark = useDocumentDark();
  const theme = useMemo<TerminalTheme>(() => {
    const base = godviewTerminalTheme(appearance, dark ? "dark" : "light");
    return {
      ...base,
      background: [base.background[0], base.background[1], base.background[2], 1],
      backgroundOpacityCells: false,
    };
  }, [appearance, dark]);

  if (problem !== null) {
    return (
      <UnavailableState
        compact
        title="The sign-in terminal couldn't open here"
        description={problem}
      />
    );
  }
  if (born === null || pool.runtime === null) {
    return (
      <p className="vf-profiles-signin-wait" role="status">
        Opening a terminal…
      </p>
    );
  }
  return (
    <GhostteaProvider runtime={pool.runtime}>
      <TerminalSurface
        session={born.session}
        theme={theme}
        active
        controlsResize
        visible
        {...(platform !== undefined ? { platform } : {})}
        readClipboard={() => navigator.clipboard?.readText() ?? ""}
      />
    </GhostteaProvider>
  );
}
