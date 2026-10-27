import {
  type AgentPersona,
  type AgentsProfileSetsListResult,
  AgentsProfilesListResult,
  AgentsProfilesLoginResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useEffect, useRef, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import type { AgentsNotice } from "./AgentsView";

// One sign-in at a time, run in a terminal on the page that asked for it (the
// design record's R1, pass 16) — Agent Profiles' pages and, since AO-5, the
// Setup Assistant's Profiles pane share this one controller.
//
// It closes when fieldd says its pane has ended — and, for an agent that says
// who signed in, once that has been read (fieldd reads it as the pane ends), or
// after a wait that says it could not. Cancel ends the pane; a sign-in made
// just now (`fresh`) and nobody finished is removed again, so a cancelled add
// adds nothing. Leaving the page does NOT end it: a browser-based login can
// still finish, and the row it belongs to offers Cancel wherever it is shown
// next.

/** How long a closed sign-in waits for the identity read before it says so. */
const IDENTITY_WAIT_MS = 15_000;
/** How long before a login the feed never showed open is asked after directly
 * (one that ends inside a single feed frame is never seen open). */
const UNSEEN_CHECK_MS = 3_000;

export interface SignIn<At extends string = string> {
  profileId: string;
  provider: string;
  set: string;
  /** the page the terminal shows on */
  at: At;
  terminal: TerminalCreateOpenResult;
  /** made by the Add menu just now: cancelled unfinished, it is removed again */
  fresh: boolean;
  cancelled: boolean;
  /** asked for at (before the request): an identity read after it is this login's */
  startedAt: number;
  /** the feed has shown this login open — until then a frame without it
   * says nothing (a sign-in just made, a frame read before the pane was) */
  seen: boolean;
  /** its pane has ended (the feed no longer names it) */
  ended: boolean;
}

/** How a sign-in ended. */
export type SignInEnd =
  /** the person cancelled it */
  | "cancelled"
  /** the agent said who is signed in */
  | "signed-in"
  /** an agent that never says which account it used */
  | "unsaid"
  /** it ended before the agent said who is signed in */
  | "unread";

export function signInEndOf(
  done: SignIn,
  current: AgentPersona | undefined,
  feed: AgentsProfileSetsListResult | null,
): SignInEnd {
  if (done.cancelled) return "cancelled";
  if (current?.identity?.loggedIn === true) return "signed-in";
  if (feed?.identity.includes(done.provider) === false) return "unsaid";
  return "unread";
}

/** What a page says when a sign-in ends; nothing for a cancelled one. */
export function signInEndNotice(end: SignInEnd, label: string): AgentsNotice | null {
  if (end === "signed-in") return { tone: "neutral", text: `Signed in to ${label}.` };
  if (end === "unsaid") {
    return {
      tone: "neutral",
      text: `${label}'s sign-in finished. ${label} doesn't say which account it used.`,
    };
  }
  if (end === "unread") {
    return {
      tone: "attention",
      text: `The sign-in ended before ${label} said who is signed in. Sign in again when you're ready.`,
    };
  }
  return null;
}

/** Run one act with the page's busy mark; a refusal is said in the act's own words. */
export type SignInAct = <T>(
  key: string,
  failure: string,
  run: () => Promise<T>,
) => Promise<T | null>;

export function useProfileSignIn<At extends string>({
  client,
  feed,
  act,
  labelOf,
  mounted,
  onNotice,
  onEnd,
}: {
  client: FielddClient;
  /** the profiles feed; null until it answers */
  feed: AgentsProfileSetsListResult | null;
  act: SignInAct;
  labelOf: (provider: string) => string;
  /** whether the page is still on screen */
  mounted: { readonly current: boolean };
  /** the page's notice: a sign-in already open holds the next one */
  onNotice: (notice: AgentsNotice) => void;
  /** how a sign-in ended, once a fresh cancelled one is gone again */
  onEnd: (done: SignIn<At>, end: SignInEnd, current: AgentPersona | undefined) => void;
}): {
  signIn: SignIn<At> | null;
  /** the sign-in, as acts see it between renders */
  signInRef: { readonly current: SignIn<At> | null };
  cancelling: boolean;
  start: (
    profileId: string,
    provider: string,
    setId: string,
    at: At,
    fresh: boolean,
    /** one of the agent's own routes (AR-S2c); absent, its default login */
    route?: string,
  ) => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [signIn, setSignIn] = useState<SignIn<At> | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // the sign-in, as the acts see it between renders (one at a time)
  const signInRef = useRef<SignIn<At> | null>(null);
  signInRef.current = signIn;

  const finish = (done: SignIn<At>, current: AgentPersona | undefined): void => {
    setSignIn(null);
    signInRef.current = null;
    setCancelling(false);
    if (done.fresh && done.cancelled) {
      // a cancelled add adds nothing: the empty sign-in goes again
      void client.request("agents.profiles.delete", { profileId: done.profileId }).catch(() => {
        // it stays, not signed in, and its row says so
      });
    }
    onEnd(done, signInEndOf(done, current, feed), current);
  };

  // The sign-in closes when its pane has ended: at once for an agent that
  // never says who, and — for one that does — once fieldd has read who (it
  // reads as the pane ends), or after a wait that says it could not.
  useEffect(() => {
    if (signIn === null || feed === null) return;
    const current = feed.sets
      .flatMap((candidate) => candidate.personas)
      .find((candidate) => candidate.profileId === signIn.profileId);
    const open = current?.signingIn?.sessionId === signIn.terminal.sessionId;
    if (open) {
      if (!signIn.seen) setSignIn({ ...signIn, seen: true });
      return;
    }
    if (!signIn.seen) return;
    const readsIdentity = feed.identity.includes(signIn.provider);
    const readSince =
      current?.identity !== undefined &&
      Date.parse(current.identity.verifiedAt) >= signIn.startedAt;
    // a cancelled one has nothing to wait for
    if (readsIdentity && !readSince && current !== undefined && !signIn.cancelled) {
      if (!signIn.ended) setSignIn({ ...signIn, ended: true });
      return;
    }
    finish(signIn, current);
  });
  // a login the feed never showed open is asked after directly: gone means ended
  const unseen = signIn !== null && !signIn.seen ? signIn : null;
  useEffect(() => {
    if (unseen === null) return;
    const timer = setTimeout(() => {
      void client
        .request("agents.profiles.list", { provider: unseen.provider })
        .then((answer) => {
          const open = AgentsProfilesListResult.safeParse(answer).data?.personas.some(
            (candidate) => candidate.signingIn?.sessionId === unseen.terminal.sessionId,
          );
          if (open !== false || signInRef.current !== unseen) return;
          const known = { ...unseen, seen: true };
          signInRef.current = known;
          setSignIn(known);
        })
        .catch(() => undefined);
    }, UNSEEN_CHECK_MS);
    return () => clearTimeout(timer);
  }, [unseen, client]);
  // an identity read that never comes still closes the card, and says so
  const waiting = signIn?.ended === true ? signIn : null;
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => {
      if (signInRef.current === waiting) finish(waiting, undefined);
    }, IDENTITY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  const start = async (
    profileId: string,
    provider: string,
    setId: string,
    at: At,
    fresh: boolean,
    route?: string,
  ): Promise<void> => {
    const open = signInRef.current;
    if (open !== null) {
      onNotice({
        tone: "attention",
        text: `Finish or cancel the sign-in to ${labelOf(open.provider)} first.`,
      });
      if (fresh)
        void client.request("agents.profiles.delete", { profileId }).catch(() => undefined);
      return;
    }
    const startedAt = Date.now();
    const answer = await act(
      `add:${provider}`,
      `Couldn't start ${labelOf(provider)}'s sign-in`,
      async () =>
        AgentsProfilesLoginResult.parse(
          await client.request("agents.profiles.login", {
            profileId,
            ...(route !== undefined ? { route } : {}),
          }),
        ),
    );
    if (answer === null) {
      if (fresh)
        void client.request("agents.profiles.delete", { profileId }).catch(() => undefined);
      return;
    }
    if (!mounted.current) {
      // the page was left before its terminal could show: nobody would see
      // this login, so it ends here, and an Add's empty sign-in goes with it
      void client
        .request("terminal.terminate", { sessionId: answer.terminal.sessionId })
        .catch(() => undefined)
        .then(() => (fresh ? client.request("agents.profiles.delete", { profileId }) : undefined))
        .catch(() => undefined);
      return;
    }
    const opened: SignIn<At> = {
      profileId,
      provider,
      set: setId,
      at,
      terminal: answer.terminal,
      fresh,
      cancelled: false,
      startedAt,
      seen: false,
      ended: false,
    };
    signInRef.current = opened;
    setSignIn(opened);
  };

  const cancel = async (): Promise<void> => {
    const open = signInRef.current;
    if (open === null) return;
    setCancelling(true);
    const cancelled = { ...open, cancelled: true };
    signInRef.current = cancelled;
    setSignIn(cancelled);
    try {
      await client.request("terminal.terminate", { sessionId: open.terminal.sessionId });
    } catch (cause) {
      if (mounted.current) {
        setCancelling(false);
        onNotice({ tone: "error", text: refusalSentence("Couldn't cancel the sign-in", cause) });
      }
    }
  };

  return { signIn, signInRef, cancelling, start, cancel };
}
