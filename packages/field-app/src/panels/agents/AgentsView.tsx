import type { AgentInstall, AgentOperation, AgentProfileSet } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  EmptyState,
  InlineNotice,
  UiButton,
  UnavailableState,
} from "@vibefield/design-kit/primitives";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import type { ReactElement, ReactNode } from "react";
import type { SettingsSubpage } from "../SettingsDialog";
import { labelCls, SettingsRow, SettingsSection } from "../settings-ui";
import {
  type AgentShelfItem,
  autoUpdateWords,
  checkedWords,
  elapsedWords,
  methodWords,
  planCommandWords,
  receiptWords,
  shelfCheckedLine,
  updaterWords,
} from "./agents-model";
import { ProfileMark } from "./ProfilesView";
import type { ProfileAgentRow } from "./profiles-model";

// The Agents settings section's views — controller-free, so the catalog mounts
// the shipping composition with a fixture adapter (UI_SYSTEM.md). The design
// record is R1 (pass 16): Agents is the shelf — the apps, installed once and
// shared — every act a design-kit button, the time of a check always said.

export interface AgentsNotice {
  tone: "neutral" | "attention" | "error";
  text: string;
}

/** How an agent's page names itself in the Settings header (pass 16): the
 * agent, what it is to every profile, and the way back to the shelf. */
export function agentSubpage(label: string, onBack: () => void): SettingsSubpage {
  return {
    title: label,
    description: "Shared by every agent profile",
    backLabel: "Back to Agents",
    onBack,
  };
}

/* ── shared parts ─────────────────────────────────────────────────────────── */

function AgentMark({ provider, size = "row" }: { provider: string; size?: "row" | "hero" }) {
  return (
    <span className={`vf-agents-mark vf-agents-mark--${size}`} aria-hidden="true">
      <AgentIcon providerId={provider} />
    </span>
  );
}

function Chevron(): ReactElement {
  return <FieldGlyph name="chevron" size={14} className="vf-agents-chevron" />;
}

function OutwardArrow(): ReactElement {
  return <FieldGlyph name="outward" size={13} className="vf-agents-outward" />;
}

function CheckMark(): ReactElement {
  return <FieldGlyph name="check" size={13} className="vf-agents-check" />;
}

/** Whether Update can run for this install from here: something newer is on
 * offer, the install's own updater can take it (not a manual recipe), and
 * this daemon holds the machine scope the receipt is kept in. */
function canUpdate(item: AgentShelfItem, machineScope: boolean): boolean {
  return (
    machineScope &&
    item.available !== undefined &&
    item.install.update !== undefined &&
    item.install.update.kind !== "manual"
  );
}

function versionLine(install: AgentInstall): string {
  return [install.version ?? "version unknown", methodWords(install.method)].join(" · ");
}

/* ── the shelf ────────────────────────────────────────────────────────────── */

export interface AgentsShelfViewProps {
  state: "loading" | "ready" | "unavailable";
  items: readonly AgentShelfItem[];
  /** why the section cannot answer, in its own words; `retry` when asking
   * again could help (a refused scope cannot) */
  unavailable?: { title: string; description: string; retry?: boolean } | null | undefined;
  /** false = no machine scope: the shelf reads, but nothing updates from here */
  machineScope: boolean;
  checking: boolean;
  /** Look again / Try again is reading the Mac again */
  rescanning?: boolean | undefined;
  notice?: AgentsNotice | null | undefined;
  /** "now" for the checked-at words (the catalog pins it) */
  now?: Date | undefined;
  onCheck: () => void;
  onRescan: () => void;
  onUpdate: (provider: string) => void;
  onOpen: (provider: string) => void;
}

export function AgentsShelfView({
  state,
  items,
  unavailable,
  machineScope,
  checking,
  rescanning = false,
  notice = null,
  now,
  onCheck,
  onRescan,
  onUpdate,
  onOpen,
}: AgentsShelfViewProps): ReactElement {
  if (state === "unavailable") {
    return (
      <div className="vf-agents">
        <UnavailableState
          title={unavailable?.title ?? "Agents aren't available"}
          description={unavailable?.description ?? "The daemon did not answer."}
        />
        {unavailable?.retry !== false && (
          <div className="vf-agents-retry">
            <UiButton onClick={onRescan} disabled={rescanning}>
              {rescanning ? "Trying…" : "Try again"}
            </UiButton>
          </div>
        )}
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="vf-agents" aria-busy="true">
        <SettingsSection title="Installed" description="Looking for agents on this Mac…">
          <div className="vf-agents-list">
            {[0, 1, 2].map((index) => (
              <div key={index} className="vf-agents-row vf-agents-row--placeholder">
                <span className="vf-agents-mark vf-agents-mark--row" />
                <span className="vf-agents-placeholder" />
              </div>
            ))}
          </div>
        </SettingsSection>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="vf-agents">
        <EmptyState
          className="vf-agents-empty"
          visual={<AgentsGlyph />}
          title="No coding agents on this Mac yet"
          description="VibeField looks on your PATH and in each agent's usual install folder. Install one, and it appears here."
          actions={
            <UiButton onClick={onRescan} disabled={rescanning}>
              {rescanning ? "Looking…" : "Look again"}
            </UiButton>
          }
        />
      </div>
    );
  }

  return (
    <div className="vf-agents">
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
      {!machineScope && (
        <InlineNotice>
          This VibeField reads the agents on this Mac but can't update them: it has no machine
          scope.
        </InlineNotice>
      )}
      <SettingsSection
        title="Installed"
        description={checking ? "Checking for updates…" : shelfCheckedLine(items, now)}
        action={
          <UiButton onClick={onCheck} disabled={checking}>
            {checking ? "Checking…" : "Check for updates"}
          </UiButton>
        }
      >
        <div className="vf-agents-list">
          {items.map((item) => (
            <AgentShelfRow
              key={item.provider}
              item={item}
              machineScope={machineScope}
              onUpdate={onUpdate}
              onOpen={onOpen}
            />
          ))}
        </div>
      </SettingsSection>
      <p className={`vf-agents-foot ${labelCls}`}>
        Each agent is installed once and every profile uses it. Removing one stays with its
        installer.
      </p>
    </div>
  );
}

function AgentShelfRow({
  item,
  machineScope,
  onUpdate,
  onOpen,
}: {
  item: AgentShelfItem;
  machineScope: boolean;
  onUpdate: (provider: string) => void;
  onOpen: (provider: string) => void;
}): ReactElement {
  const factId = `vf-agents-fact-${item.provider}`;
  let action: ReactNode = null;
  if (item.updating) {
    action = <UiButton disabled>Updating…</UiButton>;
  } else if (canUpdate(item, machineScope)) {
    action = (
      <UiButton onClick={() => onUpdate(item.provider)} aria-label={`Update ${item.label}`}>
        Update
      </UiButton>
    );
  }
  return (
    <div className="vf-agents-row" data-provider={item.provider}>
      <AgentMark provider={item.provider} />
      <div className="vf-agents-row-text">
        <button
          type="button"
          className="vf-agents-row-open"
          aria-describedby={factId}
          onClick={() => onOpen(item.provider)}
        >
          {item.label}
        </button>
        <span id={factId} className="vf-agents-row-fact">
          {item.available !== undefined && item.install.version !== undefined ? (
            <span className="tabular-nums">
              {item.install.version} → {item.available.version}
            </span>
          ) : (
            <span className="tabular-nums">{versionLine(item.install)}</span>
          )}
        </span>
      </div>
      <div className="vf-agents-row-actions">{action}</div>
      <Chevron />
    </div>
  );
}

function AgentsGlyph(): ReactElement {
  return <FieldGlyph name="agents" size={28} className="vf-agents-glyph" />;
}

/* ── one agent's page ─────────────────────────────────────────────────────── */

export interface AgentPageViewProps {
  item: AgentShelfItem;
  machineScope: boolean;
  /** the executable a Show in Finder is running for */
  busy?: string | null | undefined;
  notice?: AgentsNotice | null | undefined;
  now?: Date | undefined;
  /** the file manager's name on this platform ("Show in Finder" on macOS) */
  revealLabel?: string | undefined;
  /** a Stop was asked for and the updater has not ended yet */
  stopping?: boolean | undefined;
  /** AR-S2 — the profiles this agent is signed in under (the profiles feed's
   * sign-ins for it), each a door to that sign-in's page */
  signedIn?: ReadonlyArray<{ set: AgentProfileSet; row: ProfileAgentRow }> | undefined;
  /** the profiles feed has not answered yet: nothing can be said either way */
  signedInReading?: boolean | undefined;
  onUpdate: () => void;
  onStop: () => void;
  onReveal: (executable: string) => void;
  onOpenSignIn?: ((set: string, provider: string) => void) | undefined;
}

export function AgentPageView({
  item,
  machineScope,
  busy = null,
  notice = null,
  now,
  revealLabel = "Show in Finder",
  stopping = false,
  signedIn = [],
  signedInReading = false,
  onUpdate,
  onStop,
  onReveal,
  onOpenSignIn,
}: AgentPageViewProps): ReactElement {
  const { install } = item;
  const plan = install.update;
  const latest = latestWords(item, now);
  return (
    <div className="vf-agents vf-agents-page">
      <header className="vf-agents-hero">
        <AgentMark provider={item.provider} size="hero" />
        <div className="vf-agents-hero-text">
          {/* The page's focus target when it opens (the dialog's h1 names it too). */}
          <h2 className="vf-agents-hero-name" tabIndex={-1} data-agents-page-title="">
            {item.label}
          </h2>
          <p className="vf-agents-hero-fact tabular-nums">{versionLine(install)}</p>
        </div>
        <div className="vf-agents-hero-action">
          <HeroAction
            item={item}
            machineScope={machineScope}
            stopping={stopping}
            onUpdate={onUpdate}
            onStop={onStop}
          />
        </div>
      </header>

      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}

      {item.operation !== undefined && (
        <UpdateOutput item={item} operation={item.operation} now={now} />
      )}

      <SettingsSection
        title="Version"
        action={
          item.releaseNotesUrl === undefined ? undefined : (
            <a
              className="vf-ui-button vf-agents-link-button"
              href={item.releaseNotesUrl}
              target="_blank"
              rel="noreferrer"
            >
              Release notes
              <OutwardArrow />
            </a>
          )
        }
      >
        <SettingsRow title="Installed">
          <span className="vf-agents-value tabular-nums">{install.version ?? "Unknown"}</span>
        </SettingsRow>
        <SettingsRow title="Latest" description={latest.description} divider={false}>
          <span className="vf-agents-value tabular-nums">{latest.value}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Install">
        <SettingsRow title="Installed by">
          <span className="vf-agents-value">{methodWords(install.method)}</span>
        </SettingsRow>
        <SettingsRow
          title="Location"
          description={<span className="vf-agents-path">{install.executable}</span>}
        >
          <UiButton
            onClick={() => onReveal(install.executable)}
            disabled={busy === install.executable}
            aria-label={`${revealLabel}: ${install.executable}`}
          >
            {revealLabel}
          </UiButton>
        </SettingsRow>
        <SettingsRow title="Automatic updates">
          <span className="vf-agents-value">{autoUpdateWords(install.autoUpdate)}</span>
        </SettingsRow>
        <SettingsRow
          title="Update runs"
          description={
            plan === undefined ? (
              "No update command is known for this install"
            ) : planCommandWords(plan) !== undefined ? (
              <span className="vf-agents-path">{planCommandWords(plan)}</span>
            ) : (
              (plan.instructions ?? "The vendor's own instructions")
            )
          }
          divider={item.others.length > 0}
        >
          <span className="vf-agents-value">
            {plan === undefined ? "—" : updaterWords(plan.kind)}
          </span>
        </SettingsRow>
        {/* Another install of the same agent: shown, never used (the record's
            every pass) — new sessions use the one above. */}
        {item.others.map((other, index) => (
          <SettingsRow
            key={other.executable}
            title="Other install"
            description={
              <>
                <span className="vf-agents-path">{other.executable}</span>
                <span className="vf-agents-line tabular-nums">
                  {versionLine(other)} · not used, new sessions use the one above
                </span>
              </>
            }
            divider={index < item.others.length - 1}
          >
            <UiButton
              onClick={() => onReveal(other.executable)}
              disabled={busy === other.executable}
              aria-label={`${revealLabel}: ${other.executable}`}
            >
              {revealLabel}
            </UiButton>
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection
        title="Signed in under"
        description="Each is its own sign-in, kept in its profile."
      >
        {signedInReading ? (
          <p className={`vf-agents-none ${labelCls}`} role="status">
            Reading…
          </p>
        ) : signedIn.length === 0 ? (
          <p className={`vf-agents-none ${labelCls}`}>Not signed in under any agent profile yet.</p>
        ) : (
          <div className="vf-agents-list">
            {signedIn.map(({ set, row }) => (
              <div key={set.id} className="vf-agents-row" data-profile={set.id}>
                <span className="vf-agents-mark vf-agents-mark--row vf-agents-mark--bare">
                  <ProfileMark set={set} size={20} />
                </span>
                <div className="vf-agents-row-text">
                  <button
                    type="button"
                    className="vf-agents-row-open"
                    onClick={() => onOpenSignIn?.(set.id, row.provider)}
                  >
                    {set.label}
                  </button>
                  <span className="vf-agents-row-fact">
                    {row.state === "expired" ? (
                      <>
                        <span className="vf-profiles-attention">Sign-in expired</span>
                        {row.fact.replace(/^Sign-in expired/u, "")}
                      </>
                    ) : (
                      row.fact
                    )}
                  </span>
                </div>
                <span />
                <Chevron />
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <p className={`vf-agents-foot ${labelCls}`}>
        {item.label} is installed once and shared by every profile. Removing it stays with its
        installer.
      </p>
    </div>
  );
}

/** The Version section's Latest row: the offered version, or what the last
 * check says instead — never a guess, and its time always said (§8). */
function latestWords(
  item: AgentShelfItem,
  now: Date | undefined,
): {
  value: string;
  description: string;
} {
  if (item.checkedAt === undefined) {
    return { value: "—", description: "Not checked yet — Check for updates on the Agents page" };
  }
  const checked = `Checked ${checkedWords(item.checkedAt, now)}`;
  if (item.available !== undefined) return { value: item.available.version, description: checked };
  if (item.checkProblem !== undefined) {
    return { value: "—", description: `${checked} — ${item.checkProblem}` };
  }
  if (item.noFeed) return { value: "No release feed", description: checked };
  return { value: "Same as installed", description: checked };
}

function HeroAction({
  item,
  machineScope,
  stopping,
  onUpdate,
  onStop,
}: {
  item: AgentShelfItem;
  machineScope: boolean;
  stopping: boolean;
  onUpdate: () => void;
  onStop: () => void;
}): ReactElement | null {
  // While the updater runs, the page's one act is Stop — an update can run
  // long (a large fetch, a service drained). Before its first frame and while
  // its version is read back, there is nothing to stop yet.
  if (item.operation?.state === "running") {
    return (
      <UiButton onClick={onStop} disabled={stopping} aria-label={`Stop updating ${item.label}`}>
        {stopping ? "Stopping…" : "Stop"}
      </UiButton>
    );
  }
  if (item.updating) return <UiButton disabled>Updating…</UiButton>;
  if (canUpdate(item, machineScope) && item.available !== undefined) {
    return (
      <UiButton variant="primary" onClick={onUpdate}>
        Update to {item.available.version}
      </UiButton>
    );
  }
  if (item.checkedAt === undefined || item.available !== undefined) return null;
  if (item.checkProblem !== undefined) return null;
  if (item.noFeed) return <span className="vf-agents-current">No release feed</span>;
  return (
    <span className="vf-agents-current">
      <CheckMark />
      Up to date
    </span>
  );
}

/** The vendor updater's own output — display text, never parsed (RFC 006) —
 * open while it runs with how long it has been running, folded under its
 * outcome once it has finished. */
function UpdateOutput({
  item,
  operation,
  now,
}: {
  item: AgentShelfItem;
  operation: AgentOperation;
  now?: Date | undefined;
}): ReactElement {
  const running = operation.state === "running";
  const plan = item.install.update;
  const heading = (plan === undefined ? undefined : planCommandWords(plan)) ?? "Update";
  const text =
    operation.output.length > 0 ? operation.output : running ? "Waiting for output…" : "No output.";
  const pre = (
    <pre className="vf-agents-output-text" aria-live="off">
      {text}
    </pre>
  );
  const receipt =
    operation.receipt === undefined ? undefined : receiptWords(operation.receipt, item);
  return (
    <section className="vf-agents-output" aria-label="Update output">
      <header className="vf-agents-output-head">
        <span className="vf-agents-output-command">{heading}</span>
        <span className="vf-agents-output-state" role="status">
          {running
            ? `Running · ${elapsedWords(operation.startedAt, now ?? new Date())}`
            : operation.finishedAt !== undefined
              ? `Finished ${checkedWords(operation.finishedAt, now)}`
              : "Finished"}
        </span>
      </header>
      {running ? (
        pre
      ) : (
        <details className="vf-agents-output-details">
          <summary>
            <span className="vf-agents-output-show">Show output</span>
            <span className="vf-agents-output-hide">Hide output</span>
          </summary>
          {pre}
        </details>
      )}
      {operation.truncated && (
        <p className={`vf-agents-output-note ${labelCls}`}>
          Earlier output was trimmed here; the full transcript is kept on this Mac.
        </p>
      )}
      {receipt !== undefined && (
        <InlineNotice tone={receipt.tone} className="vf-agents-output-receipt">
          {receipt.text}
        </InlineNotice>
      )}
    </section>
  );
}
