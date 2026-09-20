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
  | "login_already_linked";

const LINK_STATES: readonly string[] = [
  "offline",
  "capturing",
  "linked",
  "link_corrupt",
  "login_unavailable",
  "login_already_linked",
];

function isLinkState(value: unknown): value is UserLinkState {
  return typeof value === "string" && LINK_STATES.includes(value);
}

/** `link.json`, as `user.link.subscribe` reports it. Local rather than
 * imported: the method is fieldd's to define and lands with the daemon half of
 * UA-3. Kept a tolerant shape so an early daemon that omits a field renders
 * honestly instead of throwing. */
export type UserLinkStatus = {
  link: { login: string | null; tailnet?: string; linkedAt: string } | null;
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
};

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
   * one, and null in the window before it does. */
  | { kind: "capturing"; authUrl: string | null; nodeState: string | null }
  | { kind: "linked"; link: UserLink; nodeState: string | null }
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

/** One phrase for the act, on both surfaces and in every face that offers it —
 * including the browser hand-off, so the name survives its flow (DESIGN.md
 * §9). */
export const LINK_ACT_LABEL = "Link Tailscale account";
/** ...and the same name in progress. */
export const LINK_ACT_PENDING_LABEL = "Linking…";

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
    case "linked":
      // A `linked` word over a missing record is a daemon disagreeing with
      // itself. The RECORD is the account (UA-4 compares the stored login), so
      // the record wins and the desktop reads as what it can prove: unlinked.
      return data.link === null
        ? { kind: "offline", nodeState: data.nodeState }
        : { kind: "linked", link: data.link, nodeState: data.nodeState };
    case "capturing":
      return { kind: "capturing", authUrl: data.authUrl, nodeState: data.nodeState };
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
  return face.kind === "linked" || (face.kind === "refused" && face.link !== null);
}

/** A timestamp reads as a time or as itself — never as "Invalid Date". */
export function readableTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
