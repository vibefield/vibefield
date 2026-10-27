import { AGENT_CATALOG } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import type { DoorDevice } from "../account/door/door-parts";
import { faceKey } from "../account/faces";
import { type LinkBeginStep, type LinkFace, linkFace, type UserLinkStatus } from "../account/link";
import type { SyncPosture, SyncPostureControl } from "../account/posture";
import { historySetupPhase } from "../boot/onboarding/history-line";
import { type ConnectAside, OnboardingConnectPaneView } from "../boot/onboarding/views/connect";
import { OnboardingFieldPaneView } from "../boot/onboarding/views/field";
import { OnboardingPosturePaneView } from "../boot/onboarding/views/posture";
import {
  OnboardingSettingUpPaneView,
  type OnboardingSetupPhase,
} from "../boot/onboarding/views/setting-up";
import {
  type OnboardingChooserUser,
  OnboardingUsersPaneView,
} from "../boot/onboarding/views/users";
import {
  OnboardingDerivingPaneView,
  OnboardingWelcomeBackPaneView,
  OnboardingWelcomePaneView,
} from "../boot/onboarding/views/welcome";
import { WizardShellView } from "../boot/onboarding/wizard-ui";
import type { FieldUserFace } from "../host";
import { signInNote } from "../panels/agents/profiles-model";
import { signInEndNotice } from "../panels/agents/use-profile-sign-in";
import { type AgentsInventory, AgentsWizardPaneView } from "../setup/AgentsPaneView";
import { agentsPaneModel } from "../setup/agents-pane";
import { HistoryConsentBody } from "../setup/HistoryConsentView";
import { HistoryWizardPaneView } from "../setup/HistoryWizardPane";
import { HISTORY_WORDS } from "../setup/history-words";
import {
  type AddProfileStep,
  type PaneSignIn,
  ProfilesPaneBody,
  ProfilesWizardPaneView,
} from "../setup/ProfilesPaneView";
import { type ProfilesPaneModel, profilesPaneModel } from "../setup/profiles-pane";
import {
  FIXTURE_FIRST_READING_FINDING,
  FIXTURE_FIRST_READING_FOUND,
  FIXTURE_HISTORY_CENSUS,
  FIXTURE_ME,
  FIXTURE_OTHERS,
} from "./account-fixtures";
import { fixtureAgentInstalls } from "./agents-fixtures";
import {
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_SIGN_IN_OUTPUT,
  FIXTURE_WORK,
} from "./profiles-fixtures";

const noop = (): void => undefined;

/** TS-2 — every face the Connect pane shows, each from a wire snapshot through
 * the production `linkFace` (the daemon's words). The second control is what a
 * state can show besides its first face: a panel the person chose, or a variant
 * of the daemon's word. */
const CONNECT_STATES = [
  "ask",
  "opening",
  "sign in",
  "approval",
  "connected",
  "signed out",
  "refused",
  "quiet",
] as const;
type ConnectState = (typeof CONNECT_STATES)[number];

const CONNECT_VARIANTS: Record<ConnectState, readonly string[]> = {
  ask: ["devices", "what it sees", "other ways", "auth key"],
  opening: ["now", "slow"],
  "sign in": ["browser", "phone"],
  approval: [],
  connected: ["your devices", "alone"],
  "signed out": ["expired", "removed"],
  refused: ["taken", "tagged", "damaged"],
  quiet: ["loading", "unavailable", "no network part"],
};

/** The account's devices at arrival: this Mac, and two more of the person's. */
const CONNECT_DEVICES: readonly DoorDevice[] = [
  { id: "self", name: "Studio", os: "macos", self: true },
  { id: "laptop", name: "James's MacBook Air", os: "macos" },
  { id: "pc", name: "Workshop PC", os: "windows" },
];

function connectAside(state: ConnectState, variant: string): ConnectAside {
  if (state === "ask" && variant === "what it sees") return "why";
  if (state === "ask" && variant === "other ways") return "other";
  if (state === "ask" && variant === "auth key") return "key";
  if (state === "sign in" && variant === "phone") return "phone";
  return "constellation";
}

const POSTURE_STATES = ["automatic", "opt-in", "loading", "unavailable", "write error"] as const;
type PostureState = (typeof POSTURE_STATES)[number];

const FIELD_STATES = ["fresh", "second user", "saving", "error"] as const;
type FieldState = (typeof FIELD_STATES)[number];

const CHOOSER_STATES = ["ready", "opening", "refused", "reading"] as const;

/** AO-5 — the Agents pane: agents on this Mac with a supported one missing,
 * More agents open, nothing installed, and the inventory's two quiet states. */
const AGENTS_STATES = ["ready", "more", "first", "looking", "unavailable"] as const;
type AgentsState = (typeof AGENTS_STATES)[number];

/** The catalog's Mac: the fixture inventory without the second supported agent,
 * so the pane shows a ready row and a missing one (derived from the catalog,
 * never an agent named here). */
function agentsInventory(state: AgentsState): AgentsInventory {
  if (state === "looking" || state === "unavailable") return { kind: state };
  const second = AGENT_CATALOG.filter((row) => row.status === "supported")[1]?.id;
  const installs =
    state === "first"
      ? []
      : fixtureAgentInstalls().filter((install) => install.provider !== second);
  return { kind: "found", model: agentsPaneModel(AGENT_CATALOG, installs) };
}

/** AO-5 — the Profiles pane: This Mac alone, each step of Add a profile…, a
 * login that ended before its agent said who, the profile kept, and the feed
 * still being read. */
const PROFILES_STATES = [
  "this mac",
  "name",
  "agent",
  "signing in",
  "again",
  "ready",
  "reading",
] as const;
type ProfilesState = (typeof PROFILES_STATES)[number];

/** The pane's parts for one state, through the shipping model and words. */
function profilesFixture(state: ProfilesState): {
  model: ProfilesPaneModel | null;
  step: AddProfileStep;
  signIn: PaneSignIn | null;
} {
  if (state === "reading") return { model: null, step: { kind: "offer" }, signIn: null };
  const model = profilesPaneModel({
    ...FIXTURE_PROFILES_CONTEXT,
    sets: state === "ready" ? [FIXTURE_NATIVE, FIXTURE_WORK] : [FIXTURE_NATIVE],
  });
  const name = "Work";
  // the still's login is This Mac's agent not signed in (the fixture's own),
  // read from the model rather than named here
  const waiting = model.thisMac?.rows.find((row) => row.canSignIn);
  const provider = waiting?.provider ?? "";
  const label = waiting?.label ?? "";
  const step: AddProfileStep =
    state === "name"
      ? { kind: "name", name }
      : state === "agent"
        ? { kind: "agent", name }
        : state === "signing in"
          ? { kind: "signing-in", name, provider }
          : state === "again"
            ? {
                kind: "again",
                name,
                provider,
                said: signInEndNotice("unread", label)?.text ?? "",
              }
            : state === "ready"
              ? { kind: "ready", name }
              : { kind: "offer" };
  const signIn: PaneSignIn | null =
    state === "signing in"
      ? {
          at: "add",
          provider,
          agentLabel: label,
          where: name,
          note: signInNote({ kind: "managed", label: name }, label),
          cancelling: false,
          onCancel: noop,
          terminal: <pre className="vf-agents-output-text">{FIXTURE_SIGN_IN_OUTPUT}</pre>,
        }
      : null;
  return { model, step, signIn };
}

/** AO-3 — the History pane's census states, and every switch off (a no). */
const HISTORY_STATES = ["found", "all off", "looking", "unavailable"] as const;
type HistoryState = (typeof HISTORY_STATES)[number];
type ChooserState = (typeof CHOOSER_STATES)[number];

/** The chooser's users: this machine's, plus the new one being set up. */
const CHOOSER_USERS: readonly OnboardingChooserUser[] = [
  { userId: FIXTURE_ME.userId, name: FIXTURE_ME.name, face: FIXTURE_ME.face, current: false },
  ...FIXTURE_OTHERS.map((person) => ({
    userId: person.userId,
    name: person.name,
    face: person.face,
    current: false,
  })),
  {
    userId: "01JB0000000000000000000NEW",
    name: "jamesyong3",
    face: { emoji: "🦉" },
    current: true,
    detail: "Setting up",
  },
];

const COMPLETION_FAILURE = {
  kind: "failed" as const,
  reason: "The profile store is read-only — your field is ready either way.",
};

/** AO-D2 — Setting up as the boot machine moves under it: the answers being
 * written, the desk's own stages (the DocManager's words), then Ready. AO-4b:
 * History's line beside it, in the room's words (the shipping
 * `historySetupPhase` over a fixture status) — still finding with the desk
 * ready, Start now 8s past it, and found at Ready. */
const SETTING_UP_STATES = [
  "saving",
  "opening",
  "drawing",
  "settling",
  "finding",
  "slow",
  "ready",
] as const;
type SettingUpState = (typeof SETTING_UP_STATES)[number];

const DESK_WAITING: OnboardingSetupPhase = { key: "desk", label: "Your desk", state: "waiting" };
const DESK_READY: OnboardingSetupPhase = { key: "desk", label: "Your desk", state: "done" };

function deskPhase(state: SettingUpState): OnboardingSetupPhase {
  switch (state) {
    case "saving":
      return DESK_WAITING;
    case "opening":
      return { key: "desk", label: "Your desk", state: "live", detail: "opening doc" };
    case "drawing":
      return { key: "desk", label: "Your desk", state: "live", detail: "drawing the board" };
    case "settling":
      return { key: "desk", label: "Your desk", state: "live", detail: "settling" };
    case "finding":
    case "slow":
    case "ready":
      return DESK_READY;
  }
}

/** History's line in each state: still finding until Ready. */
function historyPhase(state: SettingUpState): OnboardingSetupPhase {
  return historySetupPhase(
    state === "ready" ? FIXTURE_FIRST_READING_FOUND : FIXTURE_FIRST_READING_FINDING,
  );
}

const OnboardingPreviewTheme = createContext<{
  dark: boolean;
  onToggleTheme: () => void;
} | null>(null);

export function OnboardingPreview({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}): ReactElement {
  return (
    <OnboardingPreviewTheme.Provider value={{ dark, onToggleTheme }}>
      <div className="vf-ds-onboarding-catalog">
        <OnboardingGroup
          eyebrow="Fresh user path"
          title="Every pane in the shipping sequence"
          description="These are the exact production views in flow order. The catalog only supplies deterministic data and keeps timed panes from advancing."
        >
          <OnboardingFrame
            index="01"
            label="Welcome"
            note="Fresh user · first launch"
            state="welcome"
          >
            <OnboardingWelcomePaneView onContinue={noop} />
          </OnboardingFrame>

          <FieldPreview />
          <AgentsPreview />
          <ProfilesPreview />
          <HistoryPreview />
          <ConnectPreview />
          <PosturePreview />
          <SettingUpPreview />
        </OnboardingGroup>

        <OnboardingGroup
          eyebrow="Derived and recovery states"
          title="Every alternate face"
          description="Resume, migration, a second user's end, and the refusals of the answers and the desk are preserved here so none can silently drift."
        >
          <OnboardingFrame
            index="A1"
            label="Deriving resume position"
            note="Bounded link-state read"
            state="deriving"
          >
            <OnboardingDerivingPaneView />
          </OnboardingFrame>

          <OnboardingFrame
            index="A2"
            label="Migration welcome"
            note="Existing flat-v1 field"
            state="welcome-back"
          >
            <OnboardingWelcomeBackPaneView onContinue={noop} />
          </OnboardingFrame>

          <OnboardingFrame
            index="A3"
            label="A second user's end"
            note="No welcome beat · the glass hands over once the desk is ready"
            state="setting-up-second-user"
          >
            <OnboardingSettingUpPaneView
              phases={[DESK_READY]}
              name={null}
              ready
              flag={{ kind: "idle" }}
              onRetryWrite={noop}
              onContinueAnyway={noop}
              onRetryPhase={noop}
            />
          </OnboardingFrame>

          <OnboardingFrame
            index="A4"
            label="Answers not saved"
            note="The completion write refused · the desk waits for it"
            state="setting-up-write-failed"
          >
            <OnboardingSettingUpPaneView
              phases={[DESK_WAITING]}
              name="James"
              ready={false}
              flag={COMPLETION_FAILURE}
              onRetryWrite={noop}
              onContinueAnyway={noop}
              onRetryPhase={noop}
            />
          </OnboardingFrame>

          <OnboardingFrame
            index="A5"
            label="The desk could not open"
            note="The boot's own reason and Retry, as the splash says them"
            state="setting-up-desk-failed"
          >
            <OnboardingSettingUpPaneView
              phases={[
                {
                  key: "desk",
                  label: "Your desk",
                  state: "failed",
                  detail: "document open failed: the daemon refused doc.open (UNAVAILABLE)",
                },
              ]}
              name="James"
              ready={false}
              flag={{ kind: "idle" }}
              onRetryWrite={noop}
              onContinueAnyway={noop}
              onRetryPhase={noop}
            />
          </OnboardingFrame>

          <ChooserPreview />
        </OnboardingGroup>
      </div>
    </OnboardingPreviewTheme.Provider>
  );
}

function ChooserPreview(): ReactElement {
  const [state, setState] = useState<ChooserState>("ready");
  const workId = FIXTURE_OTHERS[0]?.userId ?? null;
  return (
    <OnboardingFrame
      index="A6"
      label="Choose a user"
      note="Back from a new user's first pane"
      state="users"
      controls={
        <SegmentedControl
          options={CHOOSER_STATES}
          value={state}
          onChange={setState}
          label="Users chooser state"
        />
      }
    >
      <OnboardingUsersPaneView
        users={state === "reading" ? null : CHOOSER_USERS}
        opening={state === "opening" ? workId : null}
        error={
          state === "refused"
            ? "Couldn't open Work's field — a user switch is already in flight."
            : null
        }
        onChoose={noop}
        onContinue={noop}
      />
    </OnboardingFrame>
  );
}

/** The agent chapter's Agents pane (AO-5): the shipping face on the fixture
 * inventory, joined with the agent catalog by the shipping model. */
function AgentsPreview(): ReactElement {
  const [state, setState] = useState<AgentsState>("ready");
  return (
    <OnboardingFrame
      index="03"
      label="Agents"
      note="The agents on this Mac · Get joins with AO-7"
      state="agents"
      controls={
        <SegmentedControl
          options={AGENTS_STATES}
          value={state}
          onChange={setState}
          label="Agents pane state"
        />
      }
    >
      <AgentsWizardPaneView
        inventory={agentsInventory(state)}
        moreOpen={state === "more"}
        onToggleMore={noop}
        onLookAgain={noop}
        onContinue={noop}
        onBack={noop}
      />
    </OnboardingFrame>
  );
}

/** The agent chapter's Profiles pane (AO-5): the shipping face on the catalog's
 * profiles fixtures, each step of Add a profile… held still. */
function ProfilesPreview(): ReactElement {
  const [state, setState] = useState<ProfilesState>("this mac");
  const { model, step, signIn } = profilesFixture(state);
  return (
    <OnboardingFrame
      index="04"
      label="Profiles"
      note="This Mac in its own sign-ins · Add a profile… in place"
      state="profiles"
      controls={
        <SegmentedControl
          options={PROFILES_STATES}
          value={state}
          onChange={setState}
          label="Profiles pane state"
        />
      }
    >
      <ProfilesWizardPaneView
        holding={signIn !== null}
        onContinue={noop}
        onBack={noop}
        body={
          <ProfilesPaneBody
            model={model}
            step={step}
            signIn={signIn}
            notice={null}
            onSignIn={noop}
            onAdd={noop}
            onName={noop}
            onNext={noop}
            onPick={noop}
            onCancelAdd={noop}
            onAgain={noop}
          />
        }
      />
    </OnboardingFrame>
  );
}

/** The end of every path (AO-D2): the shipping pane, fed the boot machine's
 * states by hand so none of them advances on its own here. */
/** The agent chapter's History pane (AO-3): the shipping face on a fixture
 * census — two agents with history on this Mac and one no longer installed. */
function HistoryPreview(): ReactElement {
  const [state, setState] = useState<HistoryState>("found");
  const census =
    state === "looking"
      ? { kind: "looking" as const }
      : state === "unavailable"
        ? { kind: "unavailable" as const }
        : FIXTURE_HISTORY_CENSUS;
  const chosen = new Set(
    state === "found" ? FIXTURE_HISTORY_CENSUS.rows.map((row) => row.kind) : [],
  );
  const choosing = census.kind === "found";
  return (
    <OnboardingFrame
      index="05"
      label="History"
      note="Every switch on · nothing read before the button"
      state="history"
      controls={
        <SegmentedControl
          options={HISTORY_STATES}
          value={state}
          onChange={setState}
          label="History pane state"
        />
      }
    >
      <HistoryWizardPaneView
        parts={{
          body: (
            <HistoryConsentBody
              census={census}
              chosen={chosen}
              now={Date.parse("2026-10-27T12:00:00Z")}
              onToggle={noop}
            />
          ),
          primaryLabel: !choosing
            ? "Continue"
            : chosen.size === 0
              ? HISTORY_WORDS.without
              : HISTORY_WORDS.bringIn,
          primaryBusy: false,
          choosing,
          error: null,
          onPrimary: noop,
          onLater: noop,
        }}
        onBack={noop}
      />
    </OnboardingFrame>
  );
}

function SettingUpPreview(): ReactElement {
  const [state, setState] = useState<SettingUpState>("drawing");
  return (
    <OnboardingFrame
      index="08"
      label="Setting up, then Ready"
      note="The desk opens beneath the glass · the title becomes the welcome in place"
      state="setting-up"
      controls={
        <SegmentedControl
          options={SETTING_UP_STATES}
          value={state}
          onChange={setState}
          label="Setting up state"
        />
      }
    >
      <OnboardingSettingUpPaneView
        phases={[deskPhase(state), historyPhase(state)]}
        name="James"
        ready={state === "ready"}
        flag={state === "saving" ? { kind: "writing" } : { kind: "idle" }}
        onRetryWrite={noop}
        onContinueAnyway={noop}
        onRetryPhase={noop}
        onStartNow={state === "slow" ? noop : undefined}
      />
    </OnboardingFrame>
  );
}

function FieldPreview(): ReactElement {
  const [state, setState] = useState<FieldState>("fresh");
  const [name, setName] = useState("James");
  const [face, setFace] = useState<FieldUserFace>(FIXTURE_ME.face);
  return (
    <OnboardingFrame
      index="02"
      label="Name and face"
      note="The one mandatory decision"
      state="field"
      controls={
        <SegmentedControl
          options={FIELD_STATES}
          value={state}
          onChange={setState}
          label="Identity pane state"
        />
      }
    >
      <OnboardingFieldPaneView
        name={name}
        face={face}
        seed={FIXTURE_ME.userId}
        held={new Map(FIXTURE_OTHERS.map((person) => [faceKey(person.face.emoji), person.name]))}
        writing={state === "saving"}
        error={state === "error" ? "The profile service refused this write." : null}
        onNameChange={setName}
        onFaceChange={setFace}
        onSubmit={noop}
        eyebrow={state === "second user" ? "New user" : "Your field"}
        onBack={noop}
        autoFocus={false}
        pickerName="vf-design-onboarding-face"
      />
    </OnboardingFrame>
  );
}

function ConnectPreview(): ReactElement {
  const [state, setState] = useState<ConnectState>("ask");
  const [variant, setVariant] = useState<string>("devices");
  // The act's in-flight beat is the one thing the snapshot cannot carry, so the
  // adapter answers the click the way the door does — and no further: there is
  // no daemon here to finish or refuse it.
  const [step, setStep] = useState<LinkBeginStep>({ kind: "idle" });
  const variants = CONNECT_VARIANTS[state];
  const pending = (): void => setStep({ kind: "pending" });
  return (
    <OnboardingFrame
      index="06"
      label="Connect devices"
      note="Every face the link shows, in the daemon's own words"
      state="connect"
      controls={
        <>
          <SegmentedControl
            options={CONNECT_STATES}
            value={state}
            onChange={(next) => {
              setStep({ kind: "idle" });
              setState(next);
              setVariant(CONNECT_VARIANTS[next][0] ?? "");
            }}
            label="Connect pane state"
          />
          {variants.length > 0 && (
            <SegmentedControl
              options={variants}
              value={variant}
              onChange={(next) => {
                setStep({ kind: "idle" });
                setVariant(next);
              }}
              label="Connect pane variant"
            />
          )}
        </>
      }
    >
      <OnboardingConnectPaneView
        key={`${state}:${variant}`}
        face={connectFace(state, variant)}
        step={step}
        me={{ face: FIXTURE_ME.face, seed: FIXTURE_ME.userId }}
        devices={
          state === "connected" && variant === "alone"
            ? CONNECT_DEVICES.slice(0, 1)
            : CONNECT_DEVICES
        }
        platform="darwin"
        slow={state === "opening" && variant === "slow"}
        initialAside={connectAside(state, variant)}
        onBegin={pending}
        onRenew={pending}
        onCancel={noop}
        onOpenAgain={noop}
        onCopyLink={async () => true}
        onCopyText={async () => true}
        onSignInAgain={pending}
        onNewUser={noop}
        onContinue={noop}
        onSkip={noop}
        onBack={noop}
      />
    </OnboardingFrame>
  );
}

function PosturePreview(): ReactElement {
  const [state, setState] = useState<PostureState>("automatic");
  const [posture, setPosture] = useState<SyncPosture>("automatic");
  const visiblePosture =
    state === "opt-in" ? "opt-in" : state === "automatic" ? "automatic" : posture;
  const control: SyncPostureControl = {
    posture: visiblePosture,
    status: state === "loading" ? "loading" : state === "unavailable" ? "error" : "live",
    unavailable: state === "loading" || state === "unavailable",
    pending: false,
    writeError: state === "write error" ? "The preference write was refused. Try again." : null,
    set: async (next) => {
      setPosture(next);
      setState(next);
      return true;
    },
  };

  return (
    <OnboardingFrame
      index="07"
      label="Project default"
      note="Shared with Settings → Account"
      state="posture"
      controls={
        <SegmentedControl
          options={POSTURE_STATES}
          value={state}
          onChange={setState}
          label="Project-default pane state"
        />
      }
    >
      <OnboardingPosturePaneView
        posture={control}
        onDone={noop}
        onBack={noop}
        radioName="vf-design-onboarding-posture"
      />
    </OnboardingFrame>
  );
}

function OnboardingGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="vf-ds-onboarding-group">
      <header className="vf-ds-onboarding-group-head">
        <span className="vf-ds-onboarding-group-eyebrow">{eyebrow}</span>
        <h3 className="vf-ds-onboarding-group-title">{title}</h3>
        <p className="vf-ds-onboarding-group-description">{description}</p>
      </header>
      <div className="vf-ds-onboarding-flow">{children}</div>
    </section>
  );
}

function OnboardingFrame({
  index,
  label,
  note,
  state,
  controls,
  children,
}: {
  index: string;
  label: string;
  note: string;
  state: string;
  controls?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const theme = useContext(OnboardingPreviewTheme);
  if (theme === null) throw new Error("OnboardingFrame requires an OnboardingPreview theme");
  return (
    <article className="vf-ds-onboarding-frame" data-onboarding-preview={state}>
      <header className="vf-ds-onboarding-frame-head">
        <div className="vf-ds-onboarding-frame-label">
          <span className="vf-ds-onboarding-frame-index">{index}</span>
          <strong className="vf-ds-onboarding-frame-title">{label}</strong>
          <small className="vf-ds-onboarding-frame-note">{note}</small>
        </div>
        {controls !== undefined && <div className="vf-ds-onboarding-controls">{controls}</div>}
      </header>
      <div className="vf-ds-onboarding-production">
        <WizardShellView dark={theme.dark} onToggleTheme={theme.onToggleTheme}>
          {children}
        </WizardShellView>
      </div>
    </article>
  );
}

/** The adapter supplies what a HOST supplies — the wire snapshot — and the
 * production derivation turns it into a face. Building `LinkFace` values here
 * directly would have been a second reader of the same subscription, free to
 * drift from `linkFace` the moment a posture is added. */
function connectFace(state: ConnectState, variant: string): LinkFace {
  const linkRecord = {
    login: "james@example.com",
    tailnet: "studio.ts.net",
    linkedAt: "2026-08-05T19:24:00.000Z",
  };
  const quiet = {
    link: null,
    meshEnabled: false,
    nodeState: null,
    authUrl: null,
    linkDetail: null,
  };
  const facts = {
    machineName: "truffle-vibefield-studio",
    adminUrl: "https://login.tailscale.com/admin/machines",
  };
  switch (state) {
    case "ask":
      return linkFace("live", { ...quiet, linkState: "offline" });
    case "opening":
      return linkFace("live", {
        ...quiet,
        meshEnabled: true,
        nodeState: "Starting",
        linkState: "capturing",
        machineName: facts.machineName,
      });
    case "sign in":
      return linkFace("live", {
        ...quiet,
        meshEnabled: true,
        nodeState: "NeedsLogin",
        authUrl: "https://login.tailscale.com/a/vibefield-preview",
        linkState: "capturing",
        machineName: facts.machineName,
      });
    case "approval":
      return linkFace("live", {
        ...quiet,
        meshEnabled: true,
        nodeState: "NeedsMachineAuth",
        linkState: "awaiting_approval",
        ...facts,
      });
    case "connected":
      return linkFace("live", {
        ...quiet,
        link: linkRecord,
        meshEnabled: true,
        nodeState: "Running",
        linkState: "linked",
        ...facts,
      });
    case "signed out":
      return linkFace("live", {
        ...quiet,
        link: linkRecord,
        meshEnabled: true,
        nodeState: "NeedsLogin",
        authUrl: "https://login.tailscale.com/a/vibefield-renew",
        linkState: variant === "removed" ? "removed" : "expired",
        ...facts,
      });
    case "refused": {
      const refusal: Pick<UserLinkStatus, "linkState" | "linkDetail"> =
        variant === "damaged"
          ? {
              linkState: "link_corrupt",
              linkDetail:
                "link.json is present but unusable: ~/Library/Application Support/VibeField/users/1/fieldd/link.json",
            }
          : variant === "tagged"
            ? {
                linkState: "login_unavailable",
                linkDetail: "the tailnet has no user for this node (a tagged node cannot link)",
              }
            : {
                linkState: "login_already_linked",
                linkDetail:
                  'the local user "Work" is already linked to this tailscale account; unlink it first',
              };
      return linkFace("live", { ...quiet, ...refusal });
    }
    case "quiet":
      if (variant === "loading") return linkFace("loading", null);
      if (variant === "unavailable") return linkFace("error", null);
      return linkFace("live", {
        ...quiet,
        meshEnabled: true,
        linkState: "capturing",
        failure: "sidecar_missing",
      });
  }
}
