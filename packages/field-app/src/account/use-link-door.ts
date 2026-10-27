import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHost } from "../host";
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
export function openSignIn(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** The host's clipboard door when there is one, the web's otherwise — the
 * History room's way (window-ports.ts). */
export async function copyText(text: string): Promise<void> {
  const diagnostics = getHost().diagnostics;
  if (diagnostics) await diagnostics.copyText(text);
  else await navigator.clipboard.writeText(text);
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
  /** The live address on the clipboard; false when there is none to copy. */
  copyLink(): Promise<boolean>;
}

export function useLinkDoor(open: (url: string) => void = openSignIn): LinkDoor {
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
    copyLink: async () => {
      if (authUrl === null) return false;
      try {
        await copyText(authUrl);
        return true;
      } catch {
        return false;
      }
    },
  };
}
