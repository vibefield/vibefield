import { UiButton } from "@vibefield/design-kit";
import type { ReactElement } from "react";
import { formatBytes } from "../../format/bytes";
import { labelCls, SettingsRow, SettingsSwitch } from "../settings-ui";
import { GHOSTTY_DEFAULT_SCROLLBACK } from "./config-text";
import { KEY_BY_NAME } from "./ghostty-key-groups";
import { DeviceUnavailable } from "./LookTab";
import type { TerminalPageModel } from "./page-model";
import { Fact, PageSection } from "./parts";

// Settings → Terminal → Behavior (GT-7): what terminals DO — how much history
// they keep, what a session's life is, and the Ghostty behaviours ghosttea does
// not have yet, named rather than offered as switches that change nothing.

/** Scrollback steps, bytes: the stepper walks these. */
export const SCROLLBACK_STEPS: readonly number[] = [
  1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9,
];

function nearestStep(bytes: number): number {
  let best = 0;
  SCROLLBACK_STEPS.forEach((step, index) => {
    if (Math.abs(step - bytes) < Math.abs((SCROLLBACK_STEPS[best] ?? 0) - bytes)) best = index;
  });
  return best;
}

/** Ghostty behaviours people reach for that ghosttea recognizes and ignores —
 * each shown with the key that would set it, so the reference can find it. */
const NOT_YET: readonly { key: string; what: string }[] = [
  { key: "cursor-style", what: "Cursor shape and blink" },
  { key: "copy-on-select", what: "Copy on select" },
  { key: "mouse-hide-while-typing", what: "Hide the pointer while typing" },
  { key: "shell-integration", what: "Shell integration (prompt marks, cwd)" },
  { key: "confirm-close-surface", what: "Confirm before closing a running program" },
  { key: "font-thicken", what: "Thicker text" },
  { key: "working-directory", what: "The folder new terminals open in" },
  { key: "command", what: "A shell other than your login shell" },
  { key: "bell-features", what: "What the bell does" },
];

export function BehaviorTab({ model }: { model: TerminalPageModel }): ReactElement {
  const { device, managed } = model;
  const ready = device.kind === "ready" ? device : null;
  const effective = ready?.snapshot?.scrollbackBytes ?? GHOSTTY_DEFAULT_SCROLLBACK;
  const here = managed.scrollbackLimit;
  const shown = here ?? effective;
  const step = nearestStep(shown);
  const origin =
    here !== null
      ? "Set in config.ghostty."
      : effective !== GHOSTTY_DEFAULT_SCROLLBACK
        ? "From your Ghostty file."
        : `Ghostty's default.`;
  const setStep = (index: number): void => {
    const bytes = SCROLLBACK_STEPS[Math.min(SCROLLBACK_STEPS.length - 1, Math.max(0, index))];
    if (bytes !== undefined) model.setManaged({ ...managed, scrollbackLimit: bytes });
  };
  // What this Mac's terminals will do: the draft's own block first, then what
  // the loader made of every layer, then Ghostty's default — on.
  const findLinks = managed.linkUrl ?? ready?.snapshot?.linkUrl ?? true;

  return (
    <div className="vf-ts-tab" data-tab="behavior">
      <PageSection
        id="behavior-history"
        title="History"
        scope="mac"
        when="new-terminals"
        description="How much output each terminal keeps to scroll back through. The terminal service reads it when a terminal opens, so open terminals keep what they started with."
      >
        {ready !== null ? (
          <SettingsRow
            title="Scrollback"
            divider={false}
            description={
              <>
                {origin} Measured in bytes of output, not lines — 10 MB is roughly 100,000 lines of
                typical logs.
              </>
            }
          >
            <fieldset className="vf-ts-stepper" aria-label="Scrollback">
              <button
                type="button"
                aria-label="Less scrollback"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                −
              </button>
              <output aria-live="polite">{formatBytes(shown)}</output>
              <button
                type="button"
                aria-label="More scrollback"
                disabled={step === SCROLLBACK_STEPS.length - 1}
                onClick={() => setStep(step + 1)}
              >
                +
              </button>
            </fieldset>
            {here !== null && (
              <UiButton onClick={() => model.setManaged({ ...managed, scrollbackLimit: null })}>
                Default
              </UiButton>
            )}
          </SettingsRow>
        ) : (
          <DeviceUnavailable model={model} compact />
        )}
      </PageSection>

      {/* GT-8b: ghosttea 0.12.0 applies `link-url` (the generated catalog
          says so, and a catalog row pins it). A file path is found and
          underlined like any link, but the deck asks fieldd to open web links
          only — ghosttea's hook names no session, so a path cannot be told
          from a peer's — and the line says so rather than promising Finder. */}
      <PageSection
        id="behavior-links"
        title="Links"
        scope="mac"
        when="after-save"
        description="⌘-click opens a web link in your browser. A file path is underlined too, but opens nothing yet: the terminal can't say which Mac it's on."
      >
        {ready !== null ? (
          <SettingsRow
            title="Find links in output"
            divider={false}
            description={
              findLinks
                ? "On: web addresses and file paths in a terminal's output become links."
                : "Off: only the links a program marks itself (OSC 8) stay clickable."
            }
          >
            <SettingsSwitch
              checked={findLinks}
              onChange={(on) => model.setManaged({ ...managed, linkUrl: on })}
              label="Find links in output"
            />
          </SettingsRow>
        ) : (
          <DeviceUnavailable model={model} compact />
        )}
      </PageSection>

      <PageSection
        id="behavior-sessions"
        title="Sessions"
        scope="fact"
        description="What a terminal's life is, so nothing about it is a surprise."
      >
        <SettingsRow
          title="How long a terminal lives"
          description="As long as its program runs, on this Mac's terminal service. It outlives this window and quitting VibeField; it ends when its program exits, when you end it, or when the service stops — when the Mac restarts, for instance."
        >
          <Fact>Until it exits</Fact>
        </SettingsRow>
        <SettingsRow
          title="Closing a pane"
          divider={false}
          description="Closing a pane or Godview detaches you from the terminal; the session keeps running, and the next Godview can open it again."
        >
          <Fact>Detaches</Fact>
        </SettingsRow>
      </PageSection>

      <PageSection
        id="behavior-not-yet"
        title="Not in ghosttea yet"
        scope="fact"
        description="Ghostty settings people look for that ghosttea recognizes in a config file but doesn't apply yet. They stay in the file, and start working when ghosttea does."
      >
        <ul className="vf-ts-not-yet">
          {NOT_YET.filter((entry) => KEY_BY_NAME.get(entry.key)?.support === "unsupported").map(
            (entry) => (
              <li key={entry.key}>
                <span>{entry.what}</span>
                <code className={labelCls}>{entry.key}</code>
              </li>
            ),
          )}
        </ul>
      </PageSection>
    </div>
  );
}
