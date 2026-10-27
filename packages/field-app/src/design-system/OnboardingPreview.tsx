import { SegmentedControl } from "@vibefield/design-kit";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import { faceKey } from "../account/faces";
import { type LinkBeginStep, type LinkFace, linkFace } from "../account/link";
import type { SyncPosture, SyncPostureControl } from "../account/posture";
import { OnboardingConnectPaneView } from "../boot/onboarding/views/connect";
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
import { FIXTURE_ME, FIXTURE_OTHERS } from "./account-fixtures";

const noop = (): void => undefined;

/** UA-P-0g — every posture `user.link.subscribe` can report, including the
 * three refusals the daemon writes a sentence for. `mesh off` is gone with the
 * face it named. */
const CONNECT_STATES = [
  "offline",
  "capturing",
  "sign in",
  "linked",
  "corrupt link",
  "tagged node",
  "already linked",
  "loading",
  "unavailable",
] as const;
type ConnectState = (typeof CONNECT_STATES)[number];

const POSTURE_STATES = ["automatic", "opt-in", "loading", "unavailable", "write error"] as const;
type PostureState = (typeof POSTURE_STATES)[number];

const FIELD_STATES = ["fresh", "second user", "saving", "error"] as const;
type FieldState = (typeof FIELD_STATES)[number];

const CHOOSER_STATES = ["ready", "opening", "refused", "reading"] as const;
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
 * written, the desk's own stages (the DocManager's words), then Ready. */
const SETTING_UP_STATES = ["saving", "opening", "drawing", "settling", "ready"] as const;
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
    case "ready":
      return DESK_READY;
  }
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

/** The end of every path (AO-D2): the shipping pane, fed the boot machine's
 * states by hand so none of them advances on its own here. */
function SettingUpPreview(): ReactElement {
  const [state, setState] = useState<SettingUpState>("drawing");
  return (
    <OnboardingFrame
      index="05"
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
        phases={[deskPhase(state)]}
        name="James"
        ready={state === "ready"}
        flag={state === "saving" ? { kind: "writing" } : { kind: "idle" }}
        onRetryWrite={noop}
        onContinueAnyway={noop}
        onRetryPhase={noop}
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
  const [state, setState] = useState<ConnectState>("offline");
  // The act's in-flight beat is the one thing the snapshot cannot carry, so the
  // adapter answers the click the way the wizard's own wrapper does — and no
  // further: there is no daemon here to finish or refuse it.
  const [beginStep, setBeginStep] = useState<LinkBeginStep>({ kind: "idle" });
  return (
    <OnboardingFrame
      index="03"
      label="Connect devices"
      note="Every posture the daemon reports"
      state="connect"
      controls={
        <SegmentedControl
          options={CONNECT_STATES}
          value={state}
          onChange={(next) => {
            setBeginStep({ kind: "idle" });
            setState(next);
          }}
          label="Connect pane state"
        />
      }
    >
      <OnboardingConnectPaneView
        face={connectFace(state)}
        beginStep={beginStep}
        onBeginLink={() => setBeginStep({ kind: "pending" })}
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
      index="04"
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
function connectFace(state: ConnectState): LinkFace {
  const linkRecord = {
    login: "james@example.com",
    tailnet: "studio.ts.net",
    linkedAt: "2026-08-05T19:24:00.000Z",
  };
  switch (state) {
    case "offline":
      return linkFace("live", {
        link: null,
        meshEnabled: false,
        nodeState: null,
        authUrl: null,
        linkState: "offline",
        linkDetail: null,
      });
    case "capturing":
      return linkFace("live", {
        link: null,
        meshEnabled: true,
        nodeState: "Starting",
        authUrl: null,
        linkState: "capturing",
        linkDetail: null,
      });
    case "sign in":
      return linkFace("live", {
        link: null,
        meshEnabled: true,
        nodeState: "NeedsLogin",
        authUrl: "https://login.tailscale.com/a/vibefield-preview",
        linkState: "capturing",
        linkDetail: null,
      });
    case "linked":
      return linkFace("live", {
        link: linkRecord,
        meshEnabled: true,
        nodeState: "Running",
        authUrl: null,
        linkState: "linked",
        linkDetail: null,
      });
    case "corrupt link":
      return linkFace("live", {
        link: null,
        meshEnabled: false,
        nodeState: null,
        authUrl: null,
        linkState: "link_corrupt",
        linkDetail:
          "link.json is present but unusable: ~/Library/Application Support/VibeField/users/1/fieldd/link.json",
      });
    case "tagged node":
      return linkFace("live", {
        link: null,
        meshEnabled: false,
        nodeState: null,
        authUrl: null,
        linkState: "login_unavailable",
        linkDetail: "the tailnet has no user for this node (a tagged node cannot link)",
      });
    case "already linked":
      return linkFace("live", {
        link: null,
        meshEnabled: false,
        nodeState: null,
        authUrl: null,
        linkState: "login_already_linked",
        linkDetail:
          'the local user "Work" is already linked to this tailscale account; unlink it first',
      });
    case "loading":
      return linkFace("loading", null);
    case "unavailable":
      return linkFace("error", null);
  }
}
