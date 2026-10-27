import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useState } from "react";
import { type FieldUserFace, type FieldUserProfile, getHost } from "../host";
import { shownFaces } from "./faces";
import {
  type LinkFace,
  linkFace,
  RENEWAL_WARN_DAYS,
  renewalDays,
  type UserLinkStatus,
  unlinkedWord,
} from "./link";

// Who is at this window, and who else is on this machine — the one reading the
// Me menu and the head of Settings share (UA-D19), so the corner and the
// dialog can never disagree about the face or the words beside it.
//
// Two owners, as on the Account page: the roster and the profile are
// SUPERVISOR facts (users.json over the host bridge), the link is fieldd's
// (`user.link.subscribe`). Either half may be missing — an older shell, a
// browser harness — and the snapshot says which, rather than inventing it.

export interface AccountPerson {
  readonly userId: string;
  readonly name: string;
  readonly face: FieldUserFace;
  /** Another user's agents waiting on a person. No feed carries this yet —
   * main does not watch other users' pairs (spec v0.3 §12) — so it is always
   * 0 in the product today; the views draw it when a feed arrives. */
  readonly waiting: number;
}

export interface AccountMe extends AccountPerson {
  /** The line under the name: the login, or the link state in words. */
  readonly detail: string;
  /** The login is monospace; a sentence ("This Mac only") is not. */
  readonly detailIsLogin: boolean;
  /** TS-2 — a state that needs the person (a renewal due, a sign-in lapsed)
   * takes the attention ink (DESIGN.md §8, the Me menu's amendment). */
  readonly detailTone: "plain" | "attention";
  /** Offer "Connect your devices…" — true only when linking is a real act. */
  readonly canLink: boolean;
}

export interface AccountSnapshot {
  readonly status: "loading" | "ready" | "unavailable" | "failed";
  readonly me: AccountMe | null;
  readonly others: readonly AccountPerson[];
  readonly canSwitch: boolean;
  readonly canCreate: boolean;
}

/** Anyone who writes the profile (the Account page, pane 2) says so here, and
 * every mounted snapshot re-reads — the corner changes face the moment the
 * picker does. */
const listeners = new Set<() => void>();
export function accountChanged(): void {
  for (const listener of listeners) listener();
}

/** A count that moves each time `accountChanged()` is said — the re-read
 * trigger for any surface that keeps its own reading of the roster (the
 * Account page's user list), not only the snapshot below. */
export function useAccountGeneration(): number {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const bump = (): void => setGeneration((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return generation;
}

/** "Couldn't switch to Work — a user switch is already in flight." The head
 * of a refusal plus main's own words (the preload hands them back unwrapped).
 * The Me menu and the head of Settings say a refused switch this way. */
export function refusalSentence(head: string, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const trimmed = reason.trim().replace(/\.$/u, "");
  return trimmed.length > 0 ? `${head} — ${trimmed}.` : `${head}.`;
}

type LinkLine = {
  detail: string;
  isLogin: boolean;
  tone: "plain" | "attention";
  canLink: boolean;
};

/** "This Mac only" → "this Mac only": the word after a separator, its noun kept. */
const lowerFirst = (words: string): string => words.charAt(0).toLowerCase() + words.slice(1);

/** TS-2 — the line under your name, in DESIGN.md §9's link words. Exported for
 * its rows: the face menu and the head of Settings both read it. */
export function linkLine(face: LinkFace, platform: string | undefined, now: number): LinkLine {
  const plain = (detail: string, canLink = false): LinkLine => ({
    detail,
    isLogin: false,
    tone: "plain",
    canLink,
  });
  switch (face.kind) {
    case "linked": {
      if (face.link.login === null) return plain("Connected · learning the login…");
      const days = renewalDays(face.keyExpiresAt, now);
      if (days !== null && days <= RENEWAL_WARN_DAYS) {
        // TS-D9 — 14 days out the line says it, in the attention ink
        const when = days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
        return {
          detail: `Sign-in renews ${when}`,
          isLogin: false,
          tone: "attention",
          canLink: false,
        };
      }
      return { detail: face.link.login, isLogin: true, tone: "plain", canLink: false };
    }
    case "offline":
      // The ordinary first-run state, in words — never red (UA-P-D1, TS-D2).
      return plain(unlinkedWord(platform), true);
    case "capturing":
      return plain("Connecting…");
    case "approval":
      return plain("Waiting for approval");
    case "signedOut":
      return {
        detail:
          face.reason === "removed"
            ? "Removed from Tailscale"
            : `Sign-in expired · ${lowerFirst(unlinkedWord(platform))}`,
        isLogin: false,
        tone: "attention",
        canLink: false,
      };
    case "refused":
      // the refusal is said where the act is (the pane, Settings); the line
      // keeps the ordinary state's words, except a record nobody can read
      return face.state === "link_corrupt"
        ? plain(face.title)
        : plain(unlinkedWord(platform), face.canBegin);
    case "unavailable":
      return plain("on this machine");
    case "loading":
      return plain("");
  }
}

type Roster = { attachedUserId: string | null; users: FieldUserProfile[] };

/** The last roster a snapshot read through this host — what a newly mounted
 * one (Settings, opening) starts from while it re-reads, so the head never
 * draws the no-account fallback and then swaps itself out. Keyed by the host
 * object, which lives as long as the window: a switch reloads it. */
let lastRead: { host: object; roster: Roster } | null = null;

export function useAccountSnapshot(): AccountSnapshot {
  const host = getHost();
  const usersList = host.usersList;
  const usersUpdate = host.usersUpdate;
  const [roster, setRoster] = useState<
    { kind: "loading" } | { kind: "ready"; roster: Roster } | { kind: "none" } | { kind: "failed" }
  >(() =>
    usersList === undefined && usersUpdate === undefined
      ? { kind: "none" }
      : lastRead !== null && lastRead.host === host
        ? { kind: "ready", roster: lastRead.roster }
        : { kind: "loading" },
  );
  const generation = useAccountGeneration();
  const link = useSubscription<UserLinkStatus>("user.link.subscribe");

  useEffect(() => {
    let cancelled = false;
    // The roster when the host has it; else just this user, through the
    // profile door's read (an EMPTY update reads — host.ts).
    const read: Promise<Roster> | null =
      usersList !== undefined
        ? usersList()
        : usersUpdate !== undefined
          ? usersUpdate({}).then((me) => ({ attachedUserId: me.userId, users: [me] }))
          : null;
    if (read === null) return;
    void read.then(
      (next) => {
        lastRead = { host, roster: next };
        if (!cancelled) setRoster({ kind: "ready", roster: next });
      },
      () => {
        if (!cancelled) setRoster({ kind: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
    // `generation` is the re-read trigger; the doors themselves are stable.
  }, [host, usersList, usersUpdate, generation]);

  if (roster.kind !== "ready") {
    return {
      status:
        roster.kind === "none" ? "unavailable" : roster.kind === "failed" ? "failed" : "loading",
      me: null,
      others: [],
      canSwitch: false,
      canCreate: false,
    };
  }
  const { attachedUserId, users } = roster.roster;
  const faces = shownFaces(users);
  const person = (user: FieldUserProfile): AccountPerson => ({
    userId: user.userId,
    name: user.name,
    face: faces.get(user.userId)?.face ?? { emoji: "🦊" },
    waiting: 0,
  });
  const meRecord = users.find((user) => user.userId === attachedUserId) ?? null;
  const words = linkLine(
    linkFace(link.status, link.status === "live" ? (link.data ?? null) : null),
    host.platform,
    Date.now(),
  );
  return {
    status: "ready",
    me:
      meRecord === null
        ? null
        : {
            ...person(meRecord),
            detail: words.detail,
            detailIsLogin: words.isLogin,
            detailTone: words.tone,
            canLink: words.canLink,
          },
    others: users
      .filter((user) => user.userId !== attachedUserId)
      .sort((a, b) => a.fuid - b.fuid)
      .map(person),
    canSwitch: host.usersSwitch !== undefined,
    canCreate: host.usersCreate !== undefined,
  };
}
