import { SegmentedControl } from "@vibefield/design-kit";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import { faceKey } from "../account/faces";
import { type LinkBeginStep, type LinkFace, linkFace } from "../account/link";
import type { SyncPosture, SyncPostureControl } from "../account/posture";
import {
  OnboardingConnectPaneView,
  OnboardingDerivingPaneView,
  OnboardingFieldPaneView,
  OnboardingFinishingPaneView,
  OnboardingPosturePaneView,
  OnboardingReadyPaneView,
  OnboardingSettingUpPaneView,
  OnboardingWelcomeBackPaneView,
  OnboardingWelcomePaneView,
} from "../boot/onboarding/onboarding-views";
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

const FIELD_STATES = ["ready", "saving", "error"] as const;
type FieldState = (typeof FIELD_STATES)[number];

const COMPLETION_FAILURE = {
  kind: "failed" as const,
  reason: "The profile store is read-only — your field is ready either way.",
};

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

          <OnboardingFrame
            index="03"
            label="Already running"
            note="Honest boot stages · normally advances after one beat"
            state="setting-up"
          >
            <OnboardingSettingUpPaneView
              stagesDone={["waking the daemon", "loading the field", "opening your last field"]}
              onContinue={noop}
            />
          </OnboardingFrame>

          <ConnectPreview />
          <PosturePreview />

          <OnboardingFrame
            index="06"
            label="Ready"
            note="Durable completion write in progress"
            state="ready"
          >
            <OnboardingReadyPaneView
              profileName="James"
              flag={{ kind: "writing" }}
              onRetry={noop}
              onContinueAnyway={noop}
            />
          </OnboardingFrame>
        </OnboardingGroup>

        <OnboardingGroup
          eyebrow="Derived and recovery states"
          title="Every alternate face"
          description="Resume, migration, second-user completion, and both refusal paths are preserved here so none can silently drift."
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
            label="Second-user completion"
            note="Successful writes disappear immediately"
            state="finishing"
          >
            <OnboardingFinishingPaneView
              flag={{ kind: "writing" }}
              onRetry={noop}
              onContinueAnyway={noop}
            />
          </OnboardingFrame>

          <OnboardingFrame
            index="A4"
            label="Ready write refused"
            note="Fresh-user recovery actions"
            state="ready-failed"
          >
            <OnboardingReadyPaneView
              profileName="James"
              flag={COMPLETION_FAILURE}
              onRetry={noop}
              onContinueAnyway={noop}
            />
          </OnboardingFrame>

          <OnboardingFrame
            index="A5"
            label="Second-user write refused"
            note="Immediate completion recovery"
            state="finishing-failed"
          >
            <OnboardingFinishingPaneView
              flag={COMPLETION_FAILURE}
              onRetry={noop}
              onContinueAnyway={noop}
            />
          </OnboardingFrame>
        </OnboardingGroup>
      </div>
    </OnboardingPreviewTheme.Provider>
  );
}

function FieldPreview(): ReactElement {
  const [state, setState] = useState<FieldState>("ready");
  const [name, setName] = useState("James");
  const [face, setFace] = useState<FieldUserFace>(FIXTURE_ME.face);
  const [pickerOpen, setPickerOpen] = useState(false);
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
        pickerOpen={pickerOpen}
        writing={state === "saving"}
        error={state === "error" ? "The profile service refused this write." : null}
        onNameChange={setName}
        onFaceChange={setFace}
        onPickerToggle={() => setPickerOpen((open) => !open)}
        onSubmit={noop}
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
      index="04"
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
      index="05"
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
