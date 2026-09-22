import { useSubscription } from "@vibefield/fieldd-client/react";
import { useCallback, useEffect, useState } from "react";
import { type FieldUserFace, type FieldUserProfile, getHost } from "../host";
import { shownFaces } from "./faces";
import { type LinkFace, linkFace, type UserLinkStatus } from "./link";

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
  /** The login is monospace; a sentence ("offline · not linked") is not. */
  readonly detailIsLogin: boolean;
  /** Offer "Link Tailscale account…" — true only when linking is a real act. */
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

function linkDetail(face: LinkFace): { detail: string; isLogin: boolean; canLink: boolean } {
  switch (face.kind) {
    case "linked":
      return face.link.login === null
        ? { detail: "linked · learning the login…", isLogin: false, canLink: false }
        : { detail: face.link.login, isLogin: true, canLink: false };
    case "offline":
      // The ordinary first-run state, in words — never red (UA-P-D1).
      return { detail: "offline · not linked", isLogin: false, canLink: true };
    case "capturing":
      return { detail: "linking…", isLogin: false, canLink: false };
    case "refused":
      return { detail: face.title, isLogin: false, canLink: face.canBegin };
    case "unavailable":
      return { detail: "on this machine", isLogin: false, canLink: false };
    case "loading":
      return { detail: "", isLogin: false, canLink: false };
  }
}

type Roster = { attachedUserId: string | null; users: FieldUserProfile[] };

export function useAccountSnapshot(): AccountSnapshot {
  const host = getHost();
  const usersList = host.usersList;
  const usersUpdate = host.usersUpdate;
  const [roster, setRoster] = useState<
    { kind: "loading" } | { kind: "ready"; roster: Roster } | { kind: "none" } | { kind: "failed" }
  >(usersList === undefined && usersUpdate === undefined ? { kind: "none" } : { kind: "loading" });
  const [generation, setGeneration] = useState(0);
  const link = useSubscription<UserLinkStatus>("user.link.subscribe");

  const reread = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    listeners.add(reread);
    return () => {
      listeners.delete(reread);
    };
  }, [reread]);

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
  }, [usersList, usersUpdate, generation]);

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
  const words = linkDetail(
    linkFace(link.status, link.status === "live" ? (link.data ?? null) : null),
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
