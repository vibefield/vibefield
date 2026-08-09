import { SegmentedControl } from "@vibefield/design-kit";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import type { AccentSlot } from "../account/AccentPicker";
import type { LinkFace } from "../account/link";
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

const noop = (): void => undefined;

const CONNECT_STATES = ["sign in", "linked", "idle", "loading", "mesh off", "unavailable"] as const;
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
  const [accent, setAccent] = useState<AccentSlot>("accent-6");
  return (
    <OnboardingFrame
      index="02"
      label="Name and color"
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
        accent={accent}
        writing={state === "saving"}
        error={state === "error" ? "The profile service refused this write." : null}
        onNameChange={setName}
        onAccentChange={setAccent}
        onSubmit={noop}
        onBack={noop}
        autoFocus={false}
        accentName="vf-design-onboarding-accent"
      />
    </OnboardingFrame>
  );
}

function ConnectPreview(): ReactElement {
  const [state, setState] = useState<ConnectState>("sign in");
  return (
    <OnboardingFrame
      index="04"
      label="Connect devices"
      note="Every honest mesh/link face"
      state="connect"
      controls={
        <SegmentedControl
          options={CONNECT_STATES}
          value={state}
          onChange={setState}
          label="Connect pane state"
        />
      }
    >
      <OnboardingConnectPaneView
        face={connectFace(state)}
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

function connectFace(state: ConnectState): LinkFace {
  switch (state) {
    case "sign in":
      return {
        kind: "authenticating",
        authUrl: "https://login.tailscale.com/a/vibefield-preview",
        nodeState: "NeedsLogin",
      };
    case "linked":
      return {
        kind: "linked",
        link: {
          login: "james@example.com",
          tailnet: "studio.ts.net",
          linkedAt: "2026-08-05T19:24:00.000Z",
        },
        nodeState: "Running",
      };
    case "idle":
      return { kind: "idle", nodeState: "Starting" };
    case "loading":
      return { kind: "loading" };
    case "mesh off":
      return {
        kind: "mesh-off",
        link: {
          login: "james@example.com",
          tailnet: "studio.ts.net",
          linkedAt: "2026-08-05T19:24:00.000Z",
        },
      };
    case "unavailable":
      return { kind: "unavailable" };
  }
}
