import {
  AgentAccountUsageBatch,
  type AgentInstall,
  type AgentProviderSummary,
  AgentProvidersResult,
  AgentsInstallsResult,
  AgentsProfileSetsListResult,
  AgentsProfileSetsSetResult,
  AgentsProfilesCreateResult,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { suggestProfileGlyph } from "@vibefield/puppeteer-views";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { refusalSentence } from "../account/use-account";
import { getHost } from "../host";
import type { AgentsNotice } from "../panels/agents/AgentsView";
import { type ProfilesContext, signInNote } from "../panels/agents/profiles-model";
import { SignInTerminal } from "../panels/agents/SignInTerminal";
import {
  type SignInAct,
  signInEndNotice,
  useProfileSignIn,
} from "../panels/agents/use-profile-sign-in";
import { answerSetupStep } from "./ledger";
import {
  type AddProfileStep,
  type PaneSignIn,
  ProfilesPaneBody,
  ProfilesWizardPaneView,
} from "./ProfilesPaneView";
import { profilesPaneModel, profilesPaneShows } from "./profiles-pane";

// The Profiles pane on the Setup Assistant's glass (track AO, AO-5; AO-D6, AO-D7;
// DESIGN.md §8 "The Setup Assistant's agent chapter" — Profiles). It teaches a
// profile with the person's own sign-ins: This Mac from the profiles feed, each
// agent's plan from its usage. Add a profile… grows in place — a name, the agent,
// then that agent's own login in the pane, on the one sign-in controller Agent
// Profiles uses. The profile is made as a draft when its sign-in starts (its
// folder is where the login writes; AO-D14: `agents.profileSets.create
// {draft}`), and fieldd keeps it once its agent says who signed in; Cancel is
// `agents.profileSets.discard`, which deletes it only while it is still a draft,
// so a sign-in that landed first wins. A login that ends before the agent says
// who leaves it a draft, with Sign in again and Cancel — never discarded unasked,
// since the login may have worked; a draft nothing kept is deleted at fieldd's
// next start.
//
// Continue records the step answered; a Mac with nothing to explain (no agent
// in This Mac's folders, or no profiles feed) moves on by itself (AO-L2).

/** How the pane ended. */
export type ProfilesPaneEnd = "answered" | "skipped";

/** The profile Add a profile… made, until it is kept or deleted. */
interface Pending {
  readonly set: string;
  readonly profileId: string;
  readonly provider: string;
  readonly name: string;
}

export function ProfilesWizardPane({
  onDone,
  onBack,
  shared = false,
}: {
  onDone: (end: ProfilesPaneEnd) => void;
  onBack?: (() => void) | undefined;
  /** a second person on this Mac (UA §6.2): This Mac's sign-ins are shared */
  shared?: boolean;
}): ReactElement {
  const client = useFielddClient();
  const platform = getHost().platform;
  const feedState = useSubscription<unknown>("agents.profileSets.subscribe", {});
  const usageState = useSubscription<unknown>("agents.usage.subscribe", {});
  const feed = useMemo(() => {
    const parsed = AgentsProfileSetsListResult.safeParse(feedState.data);
    return parsed.success ? parsed.data : null;
  }, [feedState.data]);
  const [inventory, setInventory] = useState<{
    providers: AgentProviderSummary[];
    installs: AgentInstall[];
  } | null>(null);
  const [inventoryFailed, setInventoryFailed] = useState(false);
  const [step, setStep] = useState<AddProfileStep>({ kind: "offer" });
  const [notice, setNotice] = useState<AgentsNotice | null>(null);
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(new Set<string>());
  const ended = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Labels and installs, read once (fieldd holds the inventory it read at boot).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.request("agent.providers", {}).then((r) => AgentProvidersResult.parse(r).providers),
      client.request("agents.installs", {}).then((r) => AgentsInstallsResult.parse(r).installs),
    ]).then(
      ([providers, installs]) => {
        if (!cancelled) setInventory({ providers, installs });
      },
      () => {
        if (!cancelled) setInventoryFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const context = useMemo<ProfilesContext | null>(() => {
    if (feed === null || inventory === null) return null;
    const usage = AgentAccountUsageBatch.safeParse(usageState.data);
    return {
      providers: inventory.providers,
      installs: inventory.installs,
      usage: usage.success ? usage.data.entries : [],
      signIn: feed.signIn,
      identity: feed.identity,
      signOut: feed.signOut,
      reading: feed.reading,
      sets: feed.sets,
      routes: feed.routes ?? {},
    };
  }, [feed, inventory, usageState.data]);
  const model = context === null ? null : profilesPaneModel(context);
  const labelOf = (provider: string): string =>
    inventory?.providers.find((summary) => summary.id === provider)?.label ?? provider;

  // AO-L2 — nothing to explain: the pane moves on by itself, recording nothing.
  // A feed that never answered says so; one that drops later keeps its last frame.
  const nothingToExplain =
    (feedState.status === "error" && feed === null) ||
    inventoryFailed ||
    (model !== null && !profilesPaneShows(model));
  useEffect(() => {
    if (nothingToExplain && !ended.current && pending.current === null) {
      ended.current = true;
      onDone("skipped");
    }
  }, [nothingToExplain, onDone]);

  /** One act at a time per key; a refusal is said in the act's own words. */
  const act: SignInAct = async (key, failure, run) => {
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    setNotice(null);
    try {
      return await run();
    } catch (cause) {
      if (mounted.current) setNotice({ tone: "error", text: refusalSentence(failure, cause) });
      return null;
    } finally {
      inFlight.current.delete(key);
    }
  };

  /** Cancel: the draft Add a profile… made goes, sign-in and folder — fieldd
   * deletes it only while it is still a draft (AO-D14). */
  const discardMade = (made: Pending): void => {
    pending.current = null;
    void client.request("agents.profileSets.discard", { set: made.set }).catch((cause: unknown) => {
      if (mounted.current) {
        setNotice({ tone: "error", text: refusalSentence(`Couldn't remove ${made.name}`, cause) });
      }
    });
  };

  const signIn = useProfileSignIn<"this-mac" | "add">({
    client,
    feed,
    act,
    labelOf,
    mounted,
    onNotice: setNotice,
    onEnd: (done, end) => {
      if (done.at === "this-mac") {
        const said = signInEndNotice(end, labelOf(done.provider));
        if (said !== null) setNotice(said);
        return;
      }
      const made = pending.current;
      if (made === null) return;
      if (end === "cancelled") {
        discardMade(made);
        setStep({ kind: "offer" });
      } else if (end === "signed-in" || end === "unsaid") {
        // kept: its first agent signed in (AO-D7)
        pending.current = null;
        setStep({ kind: "ready", name: made.name });
      } else {
        const said = signInEndNotice(end, labelOf(done.provider));
        setStep({
          kind: "again",
          name: made.name,
          provider: made.provider,
          said: said?.text ?? "",
        });
      }
    },
  });
  const holding = signIn.signIn !== null;

  const signInThisMac = (provider: string): void => {
    const set = model?.thisMac;
    const row = set?.rows.find((candidate) => candidate.provider === provider);
    if (set === undefined || set === null || row === undefined) return;
    void signIn.start(row.profileId, provider, set.id, "this-mac", false);
  };

  const pick = async (provider: string): Promise<void> => {
    if (step.kind !== "agent" || signIn.signInRef.current !== null) return;
    const name = step.name.trim();
    setStep({ kind: "making", name, provider });
    const made = await act("make", `Couldn't make ${name}`, async () =>
      AgentsProfileSetsSetResult.parse(
        await client.request("agents.profileSets.create", {
          label: name,
          glyph: suggestProfileGlyph(name),
          draft: true,
        }),
      ),
    );
    if (made === null) {
      if (mounted.current) setStep({ kind: "agent", name });
      return;
    }
    const added = await act(`add:${provider}`, `Couldn't add ${labelOf(provider)}`, async () =>
      AgentsProfilesCreateResult.parse(
        await client.request("agents.profiles.create", { set: made.set.id, provider }),
      ),
    );
    const kept: Pending = {
      set: made.set.id,
      profileId: added?.persona.profileId ?? "",
      provider,
      name,
    };
    if (added === null) {
      discardMade(kept);
      if (mounted.current) setStep({ kind: "agent", name });
      return;
    }
    pending.current = kept;
    await signIn.start(kept.profileId, provider, kept.set, "add", false);
    if (!mounted.current) return;
    if (signIn.signInRef.current === null) {
      // the login could not start; the act said why
      discardMade(kept);
      setStep({ kind: "agent", name });
      return;
    }
    setStep({ kind: "signing-in", name, provider });
  };

  const again = (): void => {
    const made = pending.current;
    if (step.kind !== "again" || made === null) return;
    const said = step.said;
    setStep({ kind: "making", name: made.name, provider: made.provider });
    void signIn.start(made.profileId, made.provider, made.set, "add", false).then(() => {
      if (!mounted.current) return;
      setStep(
        signIn.signInRef.current === null
          ? { kind: "again", name: made.name, provider: made.provider, said }
          : { kind: "signing-in", name: made.name, provider: made.provider },
      );
    });
  };

  const cancelAdd = (): void => {
    const made = pending.current;
    if (step.kind === "signing-in") {
      void signIn.cancel();
      return;
    }
    if (made !== null) discardMade(made);
    setStep({ kind: "offer" });
  };

  const open = signIn.signIn;
  const paneSignIn: PaneSignIn | null =
    open === null
      ? null
      : {
          at: open.at,
          provider: open.provider,
          agentLabel: labelOf(open.provider),
          where: open.at === "this-mac" ? "This Mac" : (pending.current?.name ?? ""),
          note: signInNote(
            open.at === "this-mac"
              ? { kind: "native", label: "This Mac" }
              : { kind: "managed", label: pending.current?.name ?? "" },
            labelOf(open.provider),
          ),
          cancelling: signIn.cancelling,
          onCancel: () => void signIn.cancel(),
          terminal: <SignInTerminal terminal={open.terminal} platform={platform} />,
        };

  const onContinue = (): void => {
    if (ended.current || holding) return;
    ended.current = true;
    // a refused write is the ledger's loss, never the person's: Settings →
    // Agent Profiles is where profiles live
    void answerSetupStep(client, "profiles", "answered").catch(() => undefined);
    onDone("answered");
  };

  return (
    <ProfilesWizardPaneView
      holding={holding}
      onContinue={onContinue}
      onBack={onBack}
      body={
        <ProfilesPaneBody
          model={model}
          step={step}
          signIn={paneSignIn}
          notice={notice}
          onSignIn={signInThisMac}
          onAdd={() => {
            if (signIn.signInRef.current !== null) return;
            setNotice(null);
            setStep({ kind: "name", name: "" });
          }}
          onName={(name) => setStep({ kind: "name", name })}
          onNext={() => {
            if (step.kind === "name" && step.name.trim().length > 0) {
              setStep({ kind: "agent", name: step.name.trim() });
            }
          }}
          onPick={(provider) => void pick(provider)}
          onCancelAdd={cancelAdd}
          onAgain={again}
          shared={shared}
        />
      }
    />
  );
}
