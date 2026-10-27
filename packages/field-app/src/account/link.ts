// The §7.1 link snapshot, and the one derivation of what it means (UA-3/UA-3w,
// rebuilt on the posture in UA-P-0g).
//
// Two surfaces ask the same question — the Account page's "Connect your
// devices" section and the Setup Assistant's pane 4 — and they must never
// disagree about which face applies. The reading lives here; the chrome stays
// with each surface, because a settings row and a full-window wizard pane are
// not the same object wearing different paint.

/** The posture word (contracts `UserLinkState`, UA-P-0a). Local rather than
 * imported for the same reason the snapshot below is: this module is the
 * renderer's tolerant read of a daemon that may be older than the field it is
 * being asked about. */
export type UserLinkState =
  | "offline"
  | "capturing"
  | "linked"
  | "link_corrupt"
  | "login_unavailable"
  | "login_already_linked"
  // TS-1 (track TS) — a capture held by device approval, and a link that
  // stands while its node is signed out (lapsed, or removed in the console).
  | "awaiting_approval"
  | "expired"
  | "removed";

const LINK_STATES: readonly string[] = [
  "offline",
  "capturing",
  "linked",
  "link_corrupt",
  "login_unavailable",
  "login_already_linked",
  "awaiting_approval",
  "expired",
  "removed",
];

function isLinkState(value: unknown): value is UserLinkState {
  return typeof value === "string" && LINK_STATES.includes(value);
}

/** `link.json`, as `user.link.subscribe` reports it. Local rather than
 * imported: the method is fieldd's to define and lands with the daemon half of
 * UA-3. Kept a tolerant shape so an early daemon that omits a field renders
 * honestly instead of throwing. */
export type UserLinkStatus = {
  link: {
    login: string | null;
    tailnet?: string;
    linkedAt: string;
    /** TS-1 — display only: when the node's sign-in lapses (ms; null = never). */
    keyExpiresAt?: number | null;
  } | null;
  meshEnabled: boolean;
  nodeState: string | null;
  authUrl: string | null;
  /** UA-P-0a's posture, and since UA-P-0g the thing every face is derived
   * from. OPTIONAL here and nowhere else: the contract requires it, but a
   * daemon that predates the posture still answers this subscription, and the
   * tolerant reader renders from what it did send rather than throwing. */
  linkState?: UserLinkState | null;
  /** The sentence that makes a refusal actionable — the corrupt file's path,
   * the other local user's name. Null whenever the word needs no elaboration. */
  linkDetail?: string | null;
  /** TS-1 — the name Tailscale shows for this Mac's node, so a person can match
   * it on Tailscale's own page; null until the floor has named one. */
  machineName?: string | null;
  /** TS-1 — the admin console's Machines page; null for a custom server. */
  adminUrl?: string | null;
  /** TS-1 — when the node's sign-in lapses (ms); null = never; absent = unknown. */
  keyExpiresAt?: number | null;
  /** TS-1 — why the floor's last bring-up ended without a node, when one did. */
  failure?: LinkFailure | null;
};

/** TS-1 — the floor's typed reason a bring-up ended without a node. */
export type LinkFailure = "sidecar_missing" | "bring_up_failed" | "sidecar_exited";

export type UserLink = NonNullable<UserLinkStatus["link"]>;

/** The three postures that are REFUSALS: the daemon ended an attempt and says
 * why. Each one is offline, and each one names something a human can act on. */
export type LinkRefusal = "link_corrupt" | "login_unavailable" | "login_already_linked";

/** How the link reads right now. One case per honest state.
 *
 * UA-P-0g deleted `mesh-off`, which was the one face with no state behind it:
 * `meshEnabled` derives FROM the link (link-service.ts), so "mesh is off" only
 * ever meant "nothing is linked" — and it said so under a sentence about an
 * env flag that has been a development override since UA-P-0a. An unlinked
 * desktop now lands on `offline`, where the link act is offered. */
export type LinkFace =
  | { kind: "loading" }
  /** No link service on this daemon. Everything local keeps working. */
  | { kind: "unavailable" }
  /** Nothing linked, nothing refused: the ordinary first-run state, and the
   * state Unlink returns to. The act belongs here. */
  | { kind: "offline"; nodeState: string | null }
  /** The act is running. `authUrl` is the sign-in address once the node offers
   * one, and null in the window before it does. TS-2 — `machineName` is the
   * name Tailscale's page will ask about ("Tailscale will ask to connect …"),
   * and `failure` says why a bring-up ended, when one did. */
  | {
      kind: "capturing";
      authUrl: string | null;
      nodeState: string | null;
      machineName: string | null;
      failure: LinkFailure | null;
    }
  /** TS-2 — the tailnet's device approval holds this node: the sign-in is done
   * and an admin acts now. `link` is the record a renewal holds; null for a
   * first capture. */
  | {
      kind: "approval";
      machineName: string | null;
      adminUrl: string | null;
      link: UserLink | null;
    }
  | {
      kind: "linked";
      link: UserLink;
      nodeState: string | null;
      /** ms; null = expiry disabled; undefined = not known */
      keyExpiresAt: number | null | undefined;
      machineName: string | null;
      adminUrl: string | null;
    }
  /** TS-2 — a link that stands while its node is signed out of the tailnet:
   * its key lapsed (`expired`), or it was removed in the console (`removed`).
   * `authUrl` is the renewal's address once the floor offers it. */
  | {
      kind: "signedOut";
      reason: "expired" | "removed";
      link: UserLink;
      authUrl: string | null;
      machineName: string | null;
      adminUrl: string | null;
    }
  /** A refusal, spoken. `detail` is the daemon's own sentence wherever it sent
   * one; `title` is this module's one-phrase reading of the word, held here
   * rather than in each surface's chrome so the two can never disagree about
   * what `login_unavailable` MEANS while agreeing on which face it is. */
  | {
      kind: "refused";
      state: LinkRefusal;
      title: string;
      detail: string;
      /** Is asking again a real act, or a button that can only fail? Corrupt is
       * the one that cannot: `begin()` refuses it by construction until the
       * file is moved aside (link-service.ts). The other two end capture
       * WITHOUT retiring the tailnet keys, precisely so the user can resolve
       * the reason and link again. */
      canBegin: boolean;
      link: UserLink | null;
    };

/** One phrase for the act, on every button that starts it (DESIGN.md §9 "The
 * link's words", TS-D1): it says where you are going, and works for a person
 * with an account and one without. */
export const LINK_ACT_LABEL = "Continue with Tailscale";
/** ...and the same act in progress: the button becomes its status (M1). */
export const LINK_ACT_PENDING_LABEL = "Opening Tailscale…";
/** The place that holds the act: the face menu's row, a section's title. */
export const CONNECT_ROW_LABEL = "Connect your devices…";

/** This desktop in its own platform's words (DESIGN.md §9: "This Mac", "This PC"
 * on Windows; never "This desktop"). */
export function thisDeviceWord(platform: string | undefined): string {
  if (platform === "win32") return "This PC";
  if (platform === "darwin" || platform === undefined) return "This Mac";
  return "This computer";
}

/** TS-D2 — a desktop that is not connected, in its own platform's words: the
 * ordinary first-run state, never "offline" (which reads as no internet). */
export function unlinkedWord(platform: string | undefined): string {
  return `${thisDeviceWord(platform)} only`;
}

/** TS-D9 — whole days until a sign-in lapses, rounded up (a key due in an hour
 * renews "today"), or null when it never lapses or is not known. */
export function renewalDays(keyExpiresAt: number | null | undefined, now: number): number | null {
  if (keyExpiresAt === null || keyExpiresAt === undefined) return null;
  return Math.max(0, Math.ceil((keyExpiresAt - now) / 86_400_000));
}

/** TS-D9 — the renewal speaks up 14 days out: the date turns to the attention
 * ink, and the line under your name says it. */
export const RENEWAL_WARN_DAYS = 14;

/** The link act's own two steps, shared so the two surfaces cannot invent
 * different shapes for the same call. `pending` covers the first probe, which
 * `user.link.begin` awaits inside the call; `failed` is a daemon refusal
 * (PRECONDITION_FAILED), which is rendered, never swallowed. The face itself
 * moves on the SUBSCRIPTION — never on this call's response. */
export type LinkBeginStep =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "failed"; reason: string };

/** What each refusal means, in one phrase. The daemon's `linkDetail` carries
 * the specifics; these never restate it. */
const REFUSAL_TITLE: Record<LinkRefusal, string> = {
  link_corrupt: "Link record unreadable",
  login_unavailable: "No tailnet user for this node",
  login_already_linked: "Already linked by another user here",
};

/** Used only when a daemon sends the word without a sentence. Deliberately the
 * SHAPE of the refusal and not a copy of the daemon's wording, which stays the
 * daemon's to write. */
const REFUSAL_FALLBACK: Record<LinkRefusal, string> = {
  link_corrupt: "This device's link record is present but unusable.",
  login_unavailable: "The tailnet never answered with a user for this node.",
  login_already_linked: "Another local user on this machine already holds this account.",
};

/** The posture word, or an honest derivation of one. A daemon from before
 * UA-P-0a sends no `linkState`, and a daemon from after this build could send a
 * word we do not know; both read from the facts that ARE on the wire rather
 * than from a face that claims more than we were told. */
function postureOf(data: UserLinkStatus): UserLinkState {
  if (isLinkState(data.linkState)) return data.linkState;
  if (data.link !== null && data.link.login !== null) return "linked";
  if (data.authUrl !== null) return "capturing";
  return "offline";
}

/** Derive the face from a subscription state. `data` is whatever the
 * subscription holds — null before it is live, and never trusted to be
 * complete. */
export function linkFace(
  status: "loading" | "live" | "error",
  data: UserLinkStatus | null,
): LinkFace {
  if (status === "loading") return { kind: "loading" };
  if (status === "error" || data === null) return { kind: "unavailable" };
  const state = postureOf(data);
  switch (state) {
    // TS-2 — the three words TS-1 taught the daemon, each with its own face.
    case "awaiting_approval":
      return {
        kind: "approval",
        machineName: data.machineName ?? null,
        adminUrl: data.adminUrl ?? null,
        link: data.link !== null && data.link.login !== null ? data.link : null,
      };
    case "expired":
    case "removed":
      // a signed-out word over a missing record reads as what it can prove
      return data.link === null
        ? { kind: "offline", nodeState: data.nodeState }
        : {
            kind: "signedOut",
            reason: state,
            link: data.link,
            authUrl: data.authUrl,
            machineName: data.machineName ?? null,
            adminUrl: data.adminUrl ?? null,
          };
    case "linked":
      // A `linked` word over a missing record is a daemon disagreeing with
      // itself. The RECORD is the account (UA-4 compares the stored login), so
      // the record wins and the desktop reads as what it can prove: unlinked.
      return data.link === null
        ? { kind: "offline", nodeState: data.nodeState }
        : {
            kind: "linked",
            link: data.link,
            nodeState: data.nodeState,
            keyExpiresAt:
              data.keyExpiresAt !== undefined ? data.keyExpiresAt : data.link.keyExpiresAt,
            machineName: data.machineName ?? null,
            adminUrl: data.adminUrl ?? null,
          };
    case "capturing":
      return {
        kind: "capturing",
        authUrl: data.authUrl,
        nodeState: data.nodeState,
        machineName: data.machineName ?? null,
        failure: data.failure ?? null,
      };
    case "offline":
      return { kind: "offline", nodeState: data.nodeState };
    default:
      return {
        kind: "refused",
        state,
        title: REFUSAL_TITLE[state],
        detail:
          data.linkDetail !== null && data.linkDetail !== undefined && data.linkDetail.length > 0
            ? data.linkDetail
            : REFUSAL_FALLBACK[state],
        canBegin: state !== "link_corrupt",
        link: data.link,
      };
  }
}

/** Is there a recorded link, whatever the posture says? The Setup Assistant's
 * resume derivation asks this (W6): a root that already linked is acknowledged,
 * never asked again — including from a refused posture, where the keys were
 * deliberately left in place. */
export function hasLink(face: LinkFace): boolean {
  return (
    face.kind === "linked" ||
    face.kind === "signedOut" ||
    (face.kind === "approval" && face.link !== null) ||
    (face.kind === "refused" && face.link !== null)
  );
}

/** A timestamp reads as a time or as itself — never as "Invalid Date". */
export function readableTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
