// The §7.1 link snapshot, and the one derivation of what it means (UA-3/UA-3w).
//
// Two surfaces ask the same question — the Account page's "Connect your
// devices" section and the Setup Assistant's pane 4 — and they must never
// disagree about which face applies. The reading lives here; the chrome stays
// with each surface, because a settings row and a full-window wizard pane are
// not the same object wearing different paint.

/** `link.json`, as `user.link.subscribe` reports it. Local rather than
 * imported: the method is fieldd's to define and lands with the daemon half of
 * UA-3. Kept a tolerant shape so an early daemon that omits a field renders
 * honestly instead of throwing. */
export type UserLinkStatus = {
  link: { login: string | null; tailnet?: string; linkedAt: string } | null;
  meshEnabled: boolean;
  nodeState: string | null;
  authUrl: string | null;
};

export type UserLink = NonNullable<UserLinkStatus["link"]>;

/** How the link reads right now. One case per honest state — including the two
 * that are not failures: the daemon that has no such method, and the device
 * whose mesh is simply switched off. */
export type LinkFace =
  | { kind: "loading" }
  /** No link service on this daemon. Everything local keeps working. */
  | { kind: "unavailable" }
  /** Mesh is off on this device (env-gated today), so there is nothing to link
   * from here. A link already on file still gets acknowledged. */
  | { kind: "mesh-off"; link: UserLink | null }
  | { kind: "linked"; link: UserLink; nodeState: string | null }
  /** The node offered a sign-in address and is waiting on the browser. */
  | { kind: "authenticating"; authUrl: string; nodeState: string | null }
  /** Mesh is on, nothing linked, no address offered yet. */
  | { kind: "idle"; nodeState: string | null };

/** Derive the face from a subscription state. `data` is whatever the
 * subscription holds — null before it is live, and never trusted to be
 * complete. */
export function linkFace(
  status: "loading" | "live" | "error",
  data: UserLinkStatus | null,
): LinkFace {
  if (status === "loading") return { kind: "loading" };
  if (status === "error" || data === null) return { kind: "unavailable" };
  if (!data.meshEnabled) return { kind: "mesh-off", link: data.link };
  if (data.link !== null) return { kind: "linked", link: data.link, nodeState: data.nodeState };
  if (data.authUrl !== null) {
    return { kind: "authenticating", authUrl: data.authUrl, nodeState: data.nodeState };
  }
  return { kind: "idle", nodeState: data.nodeState };
}

/** Is there a recorded link, whatever the mesh switch says? The Setup
 * Assistant's resume derivation asks this (W6): a root that already linked is
 * acknowledged, never asked again. */
export function hasLink(face: LinkFace): boolean {
  return face.kind === "linked" || (face.kind === "mesh-off" && face.link !== null);
}

/** A timestamp reads as a time or as itself — never as "Invalid Date". */
export function readableTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
