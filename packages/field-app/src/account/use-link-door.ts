import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DealFrom } from "../frame/cards/cards-store";
import { COPY_PLACES } from "../frame/cards/cards-words";
import { copyWords, sheetOrigin } from "../frame/cards/copy-door";
import { type LinkBeginStep, type LinkFace, linkFace, type UserLinkStatus } from "./link";

// TS-2 (track TS) — the link's one machinery, for every surface that starts it
// (DESIGN.md §8 "The Connect pane"): the Setup Assistant's pane, the face menu,
// Settings → Devices. Each draws its own chrome around it; none of them can
// invent a different act.
//
// THE HAND-OFF (TS-D5; the face menu's F16, lifted out of it): the browser opens
// the sign-in address the moment it is ready, ONCE, because this person asked —
// never on a subscription change nobody asked for, and never again when tsnet
// rotates the address while it waits (the surface offers "Open again" for
// that). The face moves on the subscription alone; a call's answer only opens
// the browser sooner when it already carries the address.

/** Open a sign-in address in the person's own browser: the shell denies the
 * window and hands the URL to the OS (design-03 §5.1); a browser harness opens
 * a tab. Never an embedded view (RFC 8252). */
/** TS-4 (TS-D7; DESIGN.md §8 "Asking again") — this Mac is in the ordinary
 * unconnected state, where the rows that offer the link again show: the device
 * filters' ghost rows (main's status item reads the same face, `offersConnectFor`).
 * A capture, a refusal or a lapsed sign-in says its own words where the link
 * is decided. Surfaces far from the account mount this, so a snapshot that is
 * not the link's own shape offers nothing rather than throwing. */
export function useOffersConnect(): boolean {
  const sub = useSubscription<UserLinkStatus>("user.link.subscribe");
  const data: unknown = sub.status === "live" ? sub.data : undefined;
  if (typeof data !== "object" || data === null || !("link" in data) || !("authUrl" in data))
    return false;
  return linkFace("live", data as UserLinkStatus).kind === "offline";
}

export function openSignIn(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** HN-5 — words copied here go on the system clipboard through the one copy door and deal a
 * text card (DESIGN.md §8 "The hand": Settings' copies deal text cards from the button pressed),
 * leaving from `from` — the button's box, under the sheet — or rising into place without one;
 * its provenance names the view under the sheet and `place`. False when the clipboard did not
 * take them: no card is dealt, and the button says so in its own words. */
export async function copyText(
  text: string,
  place: string,
  from: DealFrom | null = null,
): Promise<boolean> {
  const copied = await copyWords(text, sheetOrigin(place), from);
  return copied.ok;
}

export interface LinkDoor {
  readonly face: LinkFace;
  /** the subscription's snapshot, or null before it is live */
  readonly status: UserLinkStatus | null;
  /** the act in flight, or the daemon's refusal of it */
  readonly step: LinkBeginStep;
  /** Continue with Tailscale. With `authKey`, a machine with no browser signs in
   * by the key and nothing opens; with `browser: false` the address is kept for
   * the phone's code instead of opening here. Resolves the refusal's words, or
   * null. */
  begin(options?: { authKey?: string; browser?: boolean }): Promise<string | null>;
  /** TS-D16 — "Send logs on this network", on or off. A standing link keeps it in
   * link.json and its node is built again with it (`user.link.logs`); a capture
   * the network refused for its logs begins again sending them, and its new
   * address opens when ready. */
  sendLogs(send: boolean): Promise<string | null>;
  /** End a capture: the node stops, and the desktop is offline again. */
  cancel(): Promise<string | null>;
  /** Sign a signed-out link in again; the new address opens when ready. */
  renew(): Promise<string | null>;
  /** "Use another account" / "Not this account? Sign in again": unlink first —
   * it archives this sign-in's identity, so the next one can choose any
   * account (a capture held by approval would come back to the same network)
   * — then begin; the new address opens when ready. */
  startOver(): Promise<string | null>;
  /** The live address, opened again (the browser did not open, or was closed). */
  openAgain(): void;
  /** The live address on the clipboard, dealt as a card from the button's box (HN-5); false
   * when there is none to copy, or the clipboard did not take it. */
  copyLink(from?: DealFrom | null): Promise<boolean>;
}

/** `place` names the surface its copies are made in, on their cards (Settings, or the Setup
 * Assistant's Connect pane). */
export function useLinkDoor(
  open: (url: string) => void = openSignIn,
  place: string = COPY_PLACES.settings,
): LinkDoor {
  const client = useFielddClient();
  const sub = useSubscription<UserLinkStatus>("user.link.subscribe");
  const status = sub.status === "live" ? (sub.data ?? null) : null;
  const face = linkFace(sub.status, status);
  const [step, setStep] = useState<LinkBeginStep>({ kind: "idle" });
  /** This person asked for an address and has not been handed one yet. */
  const wants = useRef(false);
  const authUrl = status?.authUrl ?? null;

  const handOff = useCallback(
    (url: string | null) => {
      if (!wants.current || url === null) return;
      wants.current = false;
      open(url);
    },
    [open],
  );

  useEffect(() => handOff(authUrl), [authUrl, handOff]);

  const act = useCallback(
    async (method: string, params: Record<string, unknown>): Promise<string | null> => {
      setStep({ kind: "pending" });
      try {
        const answer = (await client.request(method, params)) as Partial<UserLinkStatus> | null;
        setStep({ kind: "idle" });
        handOff(answer?.authUrl ?? null);
        return null;
      } catch (cause) {
        wants.current = false;
        const reason = cause instanceof Error ? cause.message : String(cause);
        setStep({ kind: "failed", reason });
        return reason;
      }
    },
    [client, handOff],
  );

  return {
    face,
    status,
    step,
    begin: (options = {}) => {
      wants.current = options.authKey === undefined && options.browser !== false;
      return act(
        "user.link.begin",
        options.authKey !== undefined ? { authKey: options.authKey } : {},
      );
    },
    sendLogs: (send) => {
      if (send && face.kind === "logsRequired" && face.link === null) {
        wants.current = true;
        return act("user.link.begin", { sendLogs: true });
      }
      wants.current = false;
      return act("user.link.logs", { send });
    },
    cancel: () => {
      wants.current = false;
      return act("user.link.cancel", {});
    },
    renew: () => {
      wants.current = true;
      return act("user.link.renew", {});
    },
    startOver: async () => {
      wants.current = false;
      const refused = await act("user.link.unlink", {});
      if (refused !== null) return refused;
      wants.current = true;
      return act("user.link.begin", {});
    },
    openAgain: () => {
      if (authUrl !== null) open(authUrl);
    },
    copyLink: async (from = null) => {
      if (authUrl === null) return false;
      return copyText(authUrl, place, from);
    },
  };
}
