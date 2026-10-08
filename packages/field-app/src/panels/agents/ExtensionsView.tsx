import { AgentIcon } from "@vibecook/puppeteer-view-sdk/react";
import type {
  AgentExtensionOffer,
  AgentExtensionRun,
  AgentExtensionServerDefinition,
  AgentProfileSet,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanSkillResult,
} from "@vibefield/contracts";
import { FieldGlyph, type GlyphName as KitGlyphName } from "@vibefield/design-kit/glyphs";
import {
  InlineNotice,
  SegmentedControl,
  UiButton,
  UiSwitch,
} from "@vibefield/design-kit/primitives";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { SettingsSubpage } from "../SettingsDialog";
import { borderCls, fieldCls, labelCls, SettingsRow, SettingsSection } from "../settings-ui";
import {
  type BrowseGroup,
  type BrowseRow,
  browsePage,
  checkConfirm,
  listedPluginPage,
  pluginsHead,
} from "./browse-model";
import {
  type AddServerDraft,
  type AgentListItem,
  type AgentListKey,
  type AgentListOpen,
  actConfirm,
  addServerChips,
  addSkillChips,
  agentExtensions,
  agentList,
  agentListTitle,
  asksFirst,
  builtFromWords,
  changeLines,
  draftDefinition,
  draftProblem,
  type ExtensionCell,
  type ExtensionCellAct,
  type ExtensionConfirmContext,
  type ExtensionGridModel,
  type ExtensionKindKey,
  extensionGrid,
  extensionItem,
  extensionKindTitle,
  pluginPage,
  readWords,
  runWords,
  sharedFolderReaders,
  signInNote,
  skillSourceProblem,
} from "./extensions-model";
import { ProfileMark } from "./ProfilesView";

// Extensions' views (AR-S4b), controller-free, so the catalog mounts the
// shipping composition on fixtures. On a profile's page, pass 24's L2 grid:
// MCP servers and skills, a row per name some agent holds as its own, a
// column per agent, a cell saying what that agent holds — a row's name opens
// that server's or skill's own page. On an agent's page in a profile, pass
// 23's three rows — Plugins, MCP servers, Skills — each opening the agent's
// own list. AR-S4c: a cell whose agent offers an act is a button — on turns
// off (or, where the agent has no switch, removes), off turns on — and a click
// that reaches further than its cell asks first (P7); the act's own output
// and outcome sit in the run card under the lists. A remote server's sign-in
// is the agent's own login in a terminal on the page: while it runs, the run
// card is its sign-in card — the live pane where this window opened it (the
// controller hands it in), a line elsewhere — with Cancel. AR-S4d: an empty
// cell turns the server on for its agent, by the agent's own add; a value the
// server reads is asked for first, in the confirm, and kept once in the
// keychain. Add server… is a page of its own (pass 23's A1 form, with Turn on
// for). AR-S4d2: a skill's cell turns too — a link to its one copy in the
// profile's skills folder, taken away again — and Codex's asks first, since
// its copy moves to the folder every profile shares; Add skill… is a page of
// its own. A change made outside VibeField greys its cell's corner and says
// who changed what above the list (O1). AR-S4e: a row of an agent's own list
// opens its page — a plugin's (pass 23's D1: what it brings, its version, the
// agent's own switch, Update, Remove and Remove with its data, each removal a
// two-step confirm), or a server's or skill's.

const KINDS: ExtensionKindKey[] = ["servers", "skills"];

/** The design kit's glyphs these marks are (DESIGN.md §13; pass 23 and 24 draw the
 * kit's plugin, globe and snippets): every icon here is drawn by this one component. */
type GlyphName = Extract<
  KitGlyphName,
  "check" | "chevron" | "plugin" | "folder" | "globe" | "prompt" | "snippets" | "search" | "plus"
>;

/** The host's sheet says each mark's box and ink (`.vf-ext-glyph` and its places). */
function Glyph({ name, className = "vf-ext-glyph" }: { name: GlyphName; className?: string }) {
  return <FieldGlyph name={name} size={14} className={className} />;
}

/** The door's chevron, inked by this file's sheet so no other sheet's glyph rules reach it. */
function Chevron(): ReactElement {
  return <Glyph name="chevron" className="vf-ext-chevron" />;
}

function CellMark({ cell, changed = false }: { cell: ExtensionCell; changed?: boolean }) {
  // O1: a change made outside VibeField marks the cell with a grey dot
  return changed ? (
    <span className="vf-ext-was" data-ext-changed="">
      <CellShape cell={cell} />
    </span>
  ) : (
    <CellShape cell={cell} />
  );
}

function CellShape({ cell }: { cell: ExtensionCell }): ReactElement {
  switch (cell.s) {
    case "on":
      return (
        <span className={`vf-ext-cell vf-ext-cell--on${cell.attn ? " vf-ext-cell--attn" : ""}`}>
          <Glyph name="check" />
        </span>
      );
    case "fixed":
      return (
        <span className="vf-ext-cell vf-ext-cell--fixed">
          <Glyph name="check" />
        </span>
      );
    case "app":
      return (
        <span className={`vf-ext-cell vf-ext-cell--app${cell.on ? " vf-ext-cell--lit" : ""}`}>
          {cell.on ? <Glyph name="check" /> : null}
        </span>
      );
    case "plugin":
      return (
        <span className="vf-ext-cell vf-ext-cell--na">
          <Glyph name={cell.glyph} />
        </span>
      );
    case "lent":
      return (
        <span className="vf-ext-cell vf-ext-cell--na vf-ext-cell--lent">
          <AgentIcon providerId={cell.from} />
        </span>
      );
    case "none":
      return <span className="vf-ext-cell vf-ext-cell--na vf-ext-cell--none">–</span>;
    case "unread":
      return <span className="vf-ext-cell vf-ext-cell--na vf-ext-cell--unread">?</span>;
    default:
      return <span className="vf-ext-cell vf-ext-cell--off" />;
  }
}

/** A sentence from an agent's read: puppeteer marks a command or a key in
 * backticks, and those are set as code. */
function Words({ text }: { text: string }): ReactElement {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(/`([^`]+)`/gu)) {
    const start = match.index;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <code key={start} className="vf-ext-code">
        {match[1]}
      </code>,
    );
    at = start + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** What is typed set as code, then the words, a middle dot between. */
function FactLine({ code, text }: { code: string; text: string }): ReactElement {
  return (
    <>
      {code !== "" && <code className="vf-ext-code">{code}</code>}
      {code !== "" && text !== "" && " · "}
      {text}
    </>
  );
}

/** What a person asked a cell or a switch for: an act, maybe waiting on its confirm. */
export interface ExtensionActRequest {
  provider: string;
  kind: "mcp-server" | "skill" | "plugin" | "marketplace";
  id: string;
  act: ExtensionCellAct["act"];
  /** AR-S4d — an add's values for the names its server reads, kept once in the keychain first. */
  values?: Record<string, string>;
  /** AR-S4e2 — an install from a source, or a marketplace added from one: the source (and `id`). */
  source?: string;
  /** AR-S4e2 — it runs in a terminal the person answers (an install that asks first), in a pane. */
  terminal?: boolean;
}

export const requestOf = (
  act: ExtensionCellAct,
  values?: Record<string, string>,
): ExtensionActRequest => ({
  provider: act.provider,
  kind: act.kind,
  id: act.id,
  act: act.act,
  ...(values !== undefined && Object.keys(values).length > 0 ? { values } : {}),
  // AR-S4e2 — a marketplace is added from its source, which is its id until the agent names it
  ...(act.kind === "marketplace" && act.act === "add" ? { source: act.id } : {}),
  // a sign-in has its own door; any other act the person answers opens a pane of its own
  ...(act.terminal && act.act !== "sign-in" ? { terminal: true } : {}),
});

/**
 * P7: the confirm a click that reaches further than its cell opens beneath
 * its list. AR-S4d: an add whose server reads a value VibeField keeps none of
 * asks for it here, one field per name, before the agent's own add runs.
 */
function ActConfirm({
  act,
  where,
  context,
  busy,
  onConfirm,
  onCancel,
}: {
  act: ExtensionCellAct;
  where: string;
  /** AR-S4d2 — who else a skill's move reaches, for its words and chips. */
  context?: ExtensionConfirmContext | undefined;
  busy: boolean;
  onConfirm: (values?: Record<string, string>) => void;
  onCancel: () => void;
}): ReactElement | null {
  const confirm = actConfirm(act, where, context);
  const asks = act.act === "add" && act.needs.length > 0;
  const [values, setValues] = useState<Record<string, string>>({});
  const button = useRef<HTMLButtonElement>(null);
  const firstValue = useRef<HTMLInputElement>(null);
  const questionId = useId();
  useEffect(() => {
    (asks ? firstValue.current : button.current)?.focus();
  }, [asks]);
  if (confirm === null && !asks) return null;
  const filled = act.needs.every((name) => (values[name] ?? "") !== "");
  const profile = where.replace(/^(in|on) /u, "");
  const question = asks
    ? `Turn ${act.name} on for ${act.label}${act.reaches.includes("every-profile") ? " in every profile" : ""}?`
    : confirm!.question;
  const what = asks
    ? [
        `${act.name} reads ${act.needs.join(", ")}. VibeField keeps ${act.needs.length === 1 ? "its value" : "each value"} once, in its keychain entry for ${profile}: ${act.label}’s settings name the variable, and VibeField gives the value when it starts ${act.label}.`,
        // This Mac is each agent's own folder, which a plain terminal starts too
        where.startsWith("on ") ? "An agent started outside VibeField gets none." : "",
        confirm?.what ?? "",
      ]
        .filter(Boolean)
        .join(" ")
    : confirm!.what;
  const submit = (): void => {
    if (asks && !filled) return;
    onConfirm(asks ? values : undefined);
  };
  return (
    <fieldset
      className={`vf-profiles-confirm-box vf-ext-confirm${asks ? " vf-ext-values" : ""}`}
      aria-labelledby={questionId}
      data-ext-confirm={`${act.provider}:${act.id}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={questionId} className="vf-profiles-confirm-question">
        {question}
      </p>
      <p className={`vf-profiles-confirm-what ${labelCls}`}>{what}</p>
      {confirm?.chips !== undefined && confirm.chips.length > 0 && (
        // pass 24: chips name who gets it
        <ul className="vf-ext-confirm-chips" aria-label="Loads it">
          {confirm.chips.map((chip) => (
            <li key={chip.provider} className="vf-ext-chip vf-ext-chip--on">
              <span className="vf-ext-chip-mark" aria-hidden="true">
                <AgentIcon providerId={chip.provider} />
              </span>
              {chip.label}
            </li>
          ))}
        </ul>
      )}
      {asks &&
        act.needs.map((name, index) => (
          <label key={name} className="vf-ext-value">
            <code className="vf-ext-code">{name}</code>
            <input
              ref={index === 0 ? firstValue : undefined}
              type="password"
              className={`${fieldCls} vf-ext-value-field`}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Value of ${name}`}
              value={values[name] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setValues((previous) => ({ ...previous, [name]: value }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </label>
        ))}
      <p className="vf-ext-confirm-runs">
        Runs <code className="vf-ext-code">{act.runs}</code>
      </p>
      <div className="vf-profiles-confirm-acts">
        <UiButton
          ref={button}
          variant={asks ? "primary" : confirm!.danger ? "danger" : "quiet"}
          disabled={busy || (asks && !filled)}
          onClick={submit}
        >
          {asks ? "Keep and turn on" : confirm!.action}
        </UiButton>
        <UiButton disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
      </div>
    </fieldset>
  );
}

function ExtensionGridView({
  model,
  onOpenItem,
  busy = false,
  onCellAct,
}: {
  model: ExtensionGridModel;
  onOpenItem?: ((key: ExtensionKindKey, name: string) => void) | undefined;
  /** An act is running or asked for: no cell starts another. */
  busy?: boolean;
  /** A cell with an act was clicked. */
  onCellAct?: ((act: ExtensionCellAct) => void) | undefined;
}): ReactElement {
  const many = model.heads.length > 5;
  return (
    <div className="vf-ext-wrap">
      <table className={`vf-ext-grid${many ? " vf-ext-grid--many" : ""}`} data-ext-grid={model.key}>
        <colgroup>
          <col />
          {model.heads.map((head) => (
            <col key={head.provider} className="vf-ext-col" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="vf-ext-namehead">
              {model.columnTitle}
            </th>
            {model.heads.map((head) => (
              <th key={head.provider} scope="col" title={head.why || head.label}>
                <span className="vf-ext-head">
                  <span className="vf-ext-head-mark" aria-hidden="true">
                    <AgentIcon providerId={head.provider} />
                  </span>
                  <b>{head.label}</b>
                  <small>{head.caveat}</small>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => {
            const name = (
              <>
                <span className="vf-ext-name-glyph">
                  <Glyph name={row.glyph} />
                </span>
                <span className="vf-ext-name-text">
                  <b>{row.name}</b>
                  <small>
                    {row.twoVersions && <span className="vf-ext-attn">Two versions</span>}
                    {row.twoVersions && (row.factCode !== "" || row.factText !== "") && " · "}
                    <FactLine code={row.factCode} text={row.factText} />
                  </small>
                </span>
              </>
            );
            return (
              <tr key={row.name} data-ext-row={row.name}>
                <th scope="row">
                  {/* pass 24: the name opens the server's or skill's own page */}
                  {onOpenItem === undefined ? (
                    <span className="vf-ext-name">{name}</span>
                  ) : (
                    <button
                      type="button"
                      className="vf-ext-name vf-ext-name--open"
                      onClick={() => onOpenItem(model.key, row.name)}
                    >
                      {name}
                    </button>
                  )}
                </th>
                {row.cells.map(({ provider, cell, act, changed }) => {
                  const label =
                    model.heads.find((head) => head.provider === provider)?.label ?? provider;
                  const why = changed === null ? cell.why : `${cell.why} · ${changed}`;
                  if (act !== null && onCellAct !== undefined) {
                    return (
                      <td key={provider} title={`${why} — ${act.title}`}>
                        <button
                          type="button"
                          className="vf-ext-cell-button"
                          aria-label={`${act.title}: ${why}`}
                          disabled={busy}
                          onClick={() => onCellAct(act)}
                        >
                          <CellMark cell={cell} changed={changed !== null} />
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={provider} title={why} aria-label={`${row.name} for ${label}: ${why}`}>
                      <CellMark cell={cell} changed={changed !== null} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ErrorNotice({ error }: { error: string | null }): ReactElement | null {
  return error === null ? null : (
    <InlineNotice tone="error" role="alert">
      {error}
    </InlineNotice>
  );
}

function ReadAgain({
  reading,
  onRefresh,
}: {
  reading: boolean;
  onRefresh?: (() => void) | undefined;
}): ReactElement | null {
  return onRefresh === undefined ? null : (
    <UiButton disabled={reading} aria-busy={reading} onClick={onRefresh}>
      {reading ? "Reading…" : "Read again"}
    </UiButton>
  );
}

/** The act running for the profile, or the last one: what ran, its own output, and what the agent holds now. */
function RunCard({ run, now }: { run: AgentExtensionRun; now?: Date | undefined }): ReactElement {
  const words = runWords(run, now ?? new Date());
  const running = run.state === "running";
  const text = run.output.length > 0 ? run.output : running ? "Waiting for output…" : "No output.";
  const pre = (
    <pre className="vf-agents-output-text" aria-live="off">
      {text}
    </pre>
  );
  return (
    <section
      className="vf-agents-output vf-ext-run"
      aria-label={`${run.label}: ${run.name}`}
      data-ext-run={run.state}
    >
      <header className="vf-agents-output-head">
        <span className="vf-agents-output-command">{run.runs}</span>
        <span className="vf-agents-output-state" role="status">
          {words.state}
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
      {run.truncated && (
        <p className={`vf-agents-output-note ${labelCls}`}>Earlier output was trimmed here.</p>
      )}
      {words.outcome !== null && (
        <InlineNotice tone={words.outcome.tone} className="vf-agents-output-receipt">
          {words.outcome.text}
        </InlineNotice>
      )}
    </section>
  );
}

/** What a pane's head says it runs: a sign-in, an install, an update, a switch. */
const paneVerb = (run: AgentExtensionRun): string =>
  run.act === "sign-in"
    ? `sign in to ${run.name}`
    : run.act === "install"
      ? `install ${run.name}`
      : run.act === "update"
        ? `update ${run.name}`
        : run.act === "enable"
          ? `turn ${run.name} on`
          : `${run.act} ${run.name}`;

/** A server's sign-in — or AR-S4e2, any act the person answers — while its pane is open: the agent's own terminal, live, and Cancel. */
function ServerSignInCard({
  run,
  where,
  note,
  pane,
  cancelling = false,
  onCancel,
}: {
  run: AgentExtensionRun;
  where: string;
  note: string;
  /** The live pane, where this window opened the sign-in; absent elsewhere. */
  pane?: ReactNode | undefined;
  cancelling?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  return (
    <section
      className="vf-profiles-signin vf-ext-signin"
      aria-label={
        run.act === "sign-in"
          ? `${run.label} sign-in to ${run.name}`
          : `${run.label}: ${paneVerb(run)}`
      }
      data-ext-run="running"
    >
      <div className="vf-agents-output vf-profiles-signin-card">
        <header className="vf-agents-output-head">
          <span className="vf-profiles-signin-title">
            {run.label} · {paneVerb(run)} · {where.replace(/^(in|on) /u, "")}
          </span>
          <span className="vf-agents-output-state" role="status">
            closes when {run.label} has been read again
          </span>
        </header>
        {pane === undefined ? (
          <p className={`vf-ext-signin-elsewhere ${labelCls}`}>
            <code className="vf-ext-code">{run.runs}</code> is running in a terminal another window
            opened. Finish it there, or cancel it here.
          </p>
        ) : (
          // The terminal takes every key, Tab and Escape included, so a login
          // can use them; Shift-Tab is the way back out, as on a profile's sign-in.
          <div
            className="vf-profiles-signin-body"
            aria-describedby={hintId}
            onKeyDownCapture={(event) => {
              if (
                event.key === "Tab" &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              ) {
                event.preventDefault();
                event.stopPropagation();
                cancel.current?.focus();
              }
            }}
          >
            {pane}
          </div>
        )}
        <span id={hintId} className="sr-only">
          Shift-Tab leaves the terminal.
        </span>
      </div>
      <div className="vf-profiles-signin-row">
        <span className={labelCls}>{note}</span>
        {onCancel !== undefined && (
          <UiButton ref={cancel} onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </UiButton>
        )}
      </div>
    </section>
  );
}

/** How a page shows the profile's run: a running sign-in's card, or the run card. */
export interface ExtensionSignInSlot {
  /** The live pane of the running sign-in, where this window opened it. */
  pane?: ReactNode;
  /** Ends the running sign-in's pane. */
  onCancel?: () => void;
  cancelling?: boolean;
}

function RunView({
  lens,
  run,
  where,
  signIn,
  now,
}: {
  lens: AgentsExtensionsListResult;
  run: AgentExtensionRun;
  where: string;
  signIn?: ExtensionSignInSlot | undefined;
  now?: Date | undefined;
}): ReactElement {
  if (run.terminal !== undefined && run.state === "running") {
    return (
      <ServerSignInCard
        run={run}
        where={where}
        note={
          run.act === "sign-in"
            ? signInNote(lens, run, where)
            : `Answer ${run.label} in the terminal. VibeField reads ${run.label} again when it closes.`
        }
        pane={signIn?.pane}
        cancelling={signIn?.cancelling}
        onCancel={signIn?.onCancel}
      />
    );
  }
  return <RunCard run={run} now={now} />;
}

/** Before the first read has answered there is nothing to draw but that. */
const firstRead = (lens: AgentsExtensionsListResult | null): boolean =>
  lens === null || (lens.reading && lens.readAt === undefined);

export interface ProfileExtensionsViewProps {
  /** The lens; null while the first frame is on its way. */
  lens: AgentsExtensionsListResult | null;
  /** The profile's name, for the words. */
  profile: string;
  /** "in Work" · "on This Mac"; `in <profile>` when absent. */
  where?: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** A row's name opens that server's or skill's page. */
  onOpenItem?: (key: ExtensionKindKey, name: string) => void;
  /** AR-S4c: run an act a cell offers; absent, the lists are read-only. */
  onAct?: (request: ExtensionActRequest) => void;
  /** An act was asked for and has not answered yet. */
  acting?: boolean;
  /** The catalog's still of a confirm: the act whose confirm is open. */
  armed?: ExtensionActRequest;
  /** A server's sign-in running for the profile: its pane and Cancel. */
  signIn?: ExtensionSignInSlot;
  /** AR-S4d — Add server…: a server kept once for the profile, turned on for its agents. */
  onAddServer?: () => void;
  /** AR-S4d2 — Add skill…: a skill kept once for the profile, linked where its agents look. */
  onAddSkill?: () => void;
  /** AR-S4d2 — the other profiles and their agents, for what a move to the shared folder reaches. */
  otherProfiles?: Array<{ profile: string; providers: string[] }>;
  now?: Date;
}

/**
 * What a skill's move to the shared folder reaches: this profile's agents
 * that read that folder too, and the other profiles' — an agent's support is
 * its own wherever it is, so this profile's columns say which read it.
 */
function confirmContext(
  lens: AgentsExtensionsListResult,
  act: ExtensionCellAct,
  otherProfiles: ReadonlyArray<{ profile: string; providers: string[] }>,
): ExtensionConfirmContext {
  const readers = sharedFolderReaders(lens, act.provider);
  const reads = new Map(
    lens.agents
      .filter(
        (column) =>
          column.provider !== act.provider &&
          (column.support.skills?.store === "mixed" || column.support.skills?.store === "shared"),
      )
      .map((column) => [column.provider, column.label]),
  );
  return {
    readers,
    elsewhere: otherProfiles.map((other) => ({
      profile: other.profile,
      agents: other.providers.flatMap((provider) => {
        const label = reads.get(provider);
        return label === undefined ? [] : [label];
      }),
    })),
  };
}

/** The two lists on a profile's page: its agents' MCP servers and skills. */
export function ProfileExtensionsView({
  lens,
  profile,
  where = `in ${profile}`,
  error = null,
  refreshing = false,
  onRefresh,
  onOpenItem,
  onAct,
  acting = false,
  armed: armedInitially,
  signIn,
  onAddServer,
  onAddSkill,
  otherProfiles = [],
  now,
}: ProfileExtensionsViewProps): ReactElement {
  const [armed, setArmed] = useState<ExtensionCellAct | null>(null);
  const reading = refreshing || lens === null || lens.reading;
  const busy = acting || lens?.run?.state === "running";
  // the catalog opens a confirm by naming its act
  const initial =
    armedInitially === undefined || lens === null
      ? null
      : ([...extensionGrid(lens, "servers").rows, ...extensionGrid(lens, "skills").rows]
          .flatMap((row) => row.cells.map((cell) => cell.act))
          .find(
            (act) =>
              act !== null &&
              act.provider === armedInitially.provider &&
              act.id === armedInitially.id &&
              act.act === armedInitially.act,
          ) ?? null);
  const open = armed ?? initial;
  const cellAct =
    onAct === undefined
      ? undefined
      : (act: ExtensionCellAct) => {
          if (asksFirst(act)) setArmed(act);
          else onAct(requestOf(act));
        };
  const refresh = <ReadAgain reading={reading} onRefresh={onRefresh} />;
  const addServer =
    onAddServer === undefined ? null : (
      <UiButton disabled={busy} onClick={onAddServer}>
        Add server…
      </UiButton>
    );
  const addSkill =
    onAddSkill === undefined ? null : (
      <UiButton disabled={busy} onClick={onAddSkill}>
        Add skill…
      </UiButton>
    );
  if (lens === null && error !== null) {
    return (
      <div className="vf-ext" data-profile-extensions="">
        <ErrorNotice error={error} />
      </div>
    );
  }
  if (lens === null || firstRead(lens)) {
    return (
      <div className="vf-ext" data-profile-extensions="" aria-busy="true">
        <ErrorNotice error={error} />
        <SettingsSection title="MCP servers and skills" action={refresh}>
          <p className="vf-ext-quiet">Reading what {profile}’s agents hold…</p>
        </SettingsSection>
      </div>
    );
  }
  const built = builtFromWords(lens, profile);
  const when = readWords(lens, now ?? new Date());
  return (
    <div className="vf-ext" data-profile-extensions="">
      <ErrorNotice error={error} />
      {built !== null && (
        <p className="vf-ext-built" data-ext-built="">
          {built.text}
          {built.twoVersions.length > 0 &&
            ` ${built.twoVersions.join(", ")} ${built.twoVersions.length === 1 ? "is" : "are"} two different servers under one name.`}
        </p>
      )}
      {KINDS.map((key, index) => {
        const model = extensionGrid(lens, key);
        const changes = changeLines(lens, key, now ?? new Date());
        return (
          <SettingsSection
            key={key}
            title={extensionKindTitle(key)}
            description={
              key === "servers"
                ? `What each of ${profile}’s agents connects to, as the agent itself holds it`
                : `What each of ${profile}’s agents loads, from where the agent itself looks`
            }
            action={
              index === 0 ? (
                <span className="vf-ext-actions">
                  {addServer}
                  {refresh}
                </span>
              ) : (
                (addSkill ?? undefined)
              )
            }
            className={`vf-ext-section vf-ext-section--${key}`}
          >
            {changes.map((change) => (
              // O1: who changed what outside VibeField, and when a read noticed it
              <p key={change.text} className="vf-ext-change" data-ext-change="">
                <span className="vf-ext-change-dot" aria-hidden="true" />
                <span>
                  {change.text}, {change.when}. {change.now}
                </span>
              </p>
            ))}
            {model.empty !== null ? (
              <p className="vf-ext-quiet">{model.empty}</p>
            ) : (
              <ExtensionGridView
                model={model}
                onOpenItem={onOpenItem}
                busy={busy}
                onCellAct={cellAct}
              />
            )}
            {open !== null &&
              onAct !== undefined &&
              (open.kind === "mcp-server") === (key === "servers") && (
                <ActConfirm
                  key={`${open.provider}:${open.id}:${open.act}`}
                  act={open}
                  where={where}
                  context={confirmContext(lens, open, otherProfiles)}
                  busy={busy}
                  onConfirm={(values) => {
                    setArmed(null);
                    onAct(requestOf(open, values));
                  }}
                  onCancel={() => setArmed(null)}
                />
              )}
            {(model.more !== null || (index === 1 && when !== "")) && (
              <div className="vf-ext-foot">
                {model.more !== null && <span>{model.more}</span>}
                {index === 1 && when !== "" && <span className="vf-ext-when">{when}</span>}
              </div>
            )}
          </SettingsSection>
        );
      })}
      {lens.run !== undefined && (
        <RunView lens={lens} run={lens.run} where={where} signIn={signIn} now={now} />
      )}
    </div>
  );
}

/* ── one agent in a profile: its Extensions rows (pass 23) ─────────────────── */

export interface AgentExtensionsViewProps {
  lens: AgentsExtensionsListResult | null;
  provider: string;
  error?: string | null;
  /** A row opens the agent's own list of that kind, titled as the row is. */
  onOpen?: (key: AgentListKey, title: string) => void;
}

/** The Extensions section on one agent's page in a profile. */
export function AgentExtensionsView({
  lens,
  provider,
  error = null,
  onOpen,
}: AgentExtensionsViewProps): ReactElement {
  const model = lens === null || firstRead(lens) ? null : agentExtensions(lens, provider);
  return (
    <SettingsSection
      title="Extensions"
      description={model?.sub ?? undefined}
      className="vf-ext-agent"
    >
      <ErrorNotice error={error} />
      {model === null ? (
        <p className="vf-ext-quiet" aria-busy={lens === null || lens.reading}>
          {lens === null || lens.reading ? "Reading…" : "Not in this profile’s read."}
        </p>
      ) : model.failure !== null ? (
        <p className="vf-ext-quiet">
          <Words text={model.failure} />
        </p>
      ) : (
        <div className="vf-agents-list vf-ext-kinds">
          {model.rows.map((row) => (
            <div
              key={row.key}
              className={`vf-agents-row vf-ext-kind${row.unread ? " vf-ext-kind--unread" : ""}`}
              data-ext-kind={row.key}
            >
              <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                <Glyph name={row.glyph} />
              </span>
              <div className="vf-agents-row-text">
                {row.unread || onOpen === undefined ? (
                  <span className="vf-ext-kind-title">{row.title}</span>
                ) : (
                  <button
                    type="button"
                    className="vf-agents-row-open"
                    onClick={() => onOpen(row.key, row.title)}
                  >
                    {row.title}
                  </button>
                )}
                {(row.attention !== "" || row.fact !== "") && (
                  <span className="vf-agents-row-fact">
                    {row.attention !== "" && <span className="vf-ext-attn">{row.attention}</span>}
                    {row.attention !== "" && row.fact !== "" && " · "}
                    {row.fact}
                  </span>
                )}
              </div>
              <span className="vf-agents-value tabular-nums">{row.value}</span>
              {row.unread ? <span /> : <Chevron />}
            </div>
          ))}
        </div>
      )}
      {model?.lacks != null && <p className="vf-ext-quiet vf-ext-lacks">{model.lacks}</p>}
    </SettingsSection>
  );
}

/* ── one agent's own list (pass 23), read-only ────────────────────────────── */

function ItemRow({
  item,
  onOpen,
}: {
  item: AgentListItem;
  /** AR-S4e — the row opens its page: a plugin's, or a server's or skill's. */
  onOpen?: ((open: AgentListOpen) => void) | undefined;
}): ReactElement {
  const open = item.open !== undefined && onOpen !== undefined ? item.open : undefined;
  return (
    <div
      className={`vf-ext-item${open !== undefined ? " vf-ext-item--open" : ""}`}
      data-ext-item={item.key}
    >
      <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
        {item.initial !== undefined ? (
          <span className="vf-ext-initial">{item.initial}</span>
        ) : (
          <Glyph name={item.glyph} />
        )}
      </span>
      <span className="vf-ext-item-text">
        {open !== undefined ? (
          <button type="button" className="vf-agents-row-open" onClick={() => onOpen!(open)}>
            {item.name}
          </button>
        ) : (
          <b>{item.name}</b>
        )}
        {(item.code !== "" || item.text !== "") && (
          <small>
            <FactLine code={item.code} text={item.text} />
          </small>
        )}
      </span>
      <span className={`vf-ext-item-state${item.attention ? " vf-ext-attn" : ""}`}>
        {item.state}
      </span>
      {open !== undefined && <Chevron />}
    </div>
  );
}

/** When the lens was read, and the way to read again, beneath a page. */
function ReadFoot({
  lens,
  refreshing,
  onRefresh,
  now,
}: {
  lens: AgentsExtensionsListResult | null;
  refreshing: boolean;
  onRefresh?: (() => void) | undefined;
  now?: Date | undefined;
}): ReactElement {
  const reading = refreshing || lens === null || lens.reading;
  return (
    <div className="vf-ext-readfoot">
      <span>{lens === null ? "" : readWords(lens, now ?? new Date())}</span>
      <ReadAgain reading={reading} onRefresh={onRefresh} />
    </div>
  );
}

export interface AgentExtensionListViewProps {
  lens: AgentsExtensionsListResult | null;
  provider: string;
  /** The agent's name, for the page's title before the lens answers. */
  agent: string;
  list: AgentListKey;
  /** The profile's name, and "in Work" · "on This Mac". */
  profile: string;
  where: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** pass 24: servers and skills are also on the profile's page, a column per agent. */
  onOpenProfile?: () => void;
  /** AR-S4e — a row opens its page: a plugin's, or a server's or skill's. */
  onOpen?: (open: AgentListOpen) => void;
  /** AR-S4e2 — Check for updates (or Update catalogs…), where the agent has catalogs. */
  onCheck?: () => void;
  /** AR-S4e2 — Browse…, where the agent has catalogs; a marketplace's row opens its part of it. */
  onBrowse?: (market?: string) => void;
  /** AR-S4e2 — an install from a source a person gives. */
  onAct?: (request: ExtensionActRequest) => void;
  acting?: boolean;
  /** A running act's pane (an install that asks first), and its Cancel. */
  signIn?: ExtensionSignInSlot;
  /** AR-S4e2 — what the agent would run for a source being typed: the form's Runs. */
  onPlanSource?: (source: string) => Promise<AgentExtensionOffer | null>;
  /** The catalog's stills: the add form open with this source; the check's confirm open. */
  adding?: string;
  checkArmed?: boolean;
  now?: Date;
}

/** One agent's own plugins, servers or skills in a profile, grouped by where each comes from. */
export function AgentExtensionListView({
  lens,
  provider,
  agent,
  list,
  profile,
  where,
  error = null,
  refreshing = false,
  onRefresh,
  onOpenProfile,
  onOpen,
  onCheck,
  onBrowse,
  onAct,
  acting = false,
  signIn,
  onPlanSource,
  adding,
  checkArmed = false,
  now,
}: AgentExtensionListViewProps): ReactElement {
  const model = lens === null || firstRead(lens) ? null : agentList(lens, provider, list, where);
  const title = model?.title ?? agentListTitle(list);
  // AR-S4e2 — the plugins list's head: Check for updates, Browse…, Add from a source
  const head =
    model !== null && list === "plugins" && lens !== null ? pluginsHead(lens, provider) : null;
  const [armedCheck, setArmedCheck] = useState(checkArmed);
  const [addOpen, setAddOpen] = useState(adding !== undefined);
  const busy = acting || lens?.run?.state === "running";
  const run =
    lens?.run !== undefined &&
    lens.run.provider === provider &&
    list === "plugins" &&
    (lens.run.kind === "marketplace" || (lens.run.kind === "plugin" && lens.run.act === "install"))
      ? lens.run
      : undefined;
  const confirm = armedCheck && lens !== null ? checkConfirm(lens, provider, where) : null;
  return (
    <div className="vf-agents vf-agents-page vf-ext-page" data-ext-list={list}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {agent}’s {title} {where}
      </h2>
      <ErrorNotice error={error} />
      {model === null ? (
        <p className="vf-ext-quiet" aria-busy="true">
          {lens === null || lens.reading ? `Reading what ${agent} holds…` : ""}
        </p>
      ) : (
        <>
          {model.intro !== null && (
            <p className="vf-ext-intro">
              <Words text={model.intro} />
            </p>
          )}
          {list !== "plugins" && onOpenProfile !== undefined && (
            <div className="vf-ext-pointer">
              <span>Also on {profile}’s page, with a column for each agent.</span>
              <UiButton onClick={onOpenProfile}>Open {profile}</UiButton>
            </div>
          )}
          {model.unread !== null && (
            <p className="vf-ext-quiet">
              <Words text={model.unread} />
            </p>
          )}
          {head !== null && (head.check !== null || head.browse !== null || head.add !== null) && (
            <div className="vf-ext-list-head" data-ext-list-head="">
              <span className={`vf-ext-list-head-words ${labelCls}`}>{head.checked}</span>
              <span className="vf-ext-list-head-acts">
                {head.check !== null && onCheck !== undefined && (
                  <UiButton
                    disabled={busy}
                    onClick={() => (head.check!.asks ? setArmedCheck(true) : onCheck())}
                  >
                    {head.check.label}
                  </UiButton>
                )}
                {head.add !== null && onAct !== undefined && (
                  <UiButton disabled={busy || addOpen} onClick={() => setAddOpen(true)}>
                    {head.add.label}
                  </UiButton>
                )}
                {head.browse !== null && onBrowse !== undefined && (
                  <UiButton onClick={() => onBrowse()}>{head.browse}</UiButton>
                )}
              </span>
            </div>
          )}
          {confirm !== null && onCheck !== undefined && (
            <PlainConfirm
              question={confirm.question}
              what={confirm.what}
              action={confirm.action}
              busy={busy}
              onConfirm={() => {
                setArmedCheck(false);
                onCheck();
              }}
              onCancel={() => setArmedCheck(false)}
            />
          )}
          {addOpen && head?.add != null && onAct !== undefined && (
            <SourceForm
              kind="plugin"
              title={head.add.label.replace(/…$/u, "")}
              words={head.add.words}
              agent={model.label}
              where={where}
              initial={adding ?? ""}
              busy={busy}
              onPlan={onPlanSource}
              onAdd={(source, offer) => {
                setAddOpen(false);
                onAct({
                  provider,
                  kind: "plugin",
                  id: source,
                  act: "install",
                  source,
                  ...(offer.terminal === true ? { terminal: true } : {}),
                });
              }}
              onCancel={() => setAddOpen(false)}
            />
          )}
          {run !== undefined && lens !== null && (
            <RunView lens={lens} run={run} where={where} signIn={signIn} now={now} />
          )}
          {model.empty !== null && <p className="vf-ext-empty">{model.empty}</p>}
          {model.sections.map((section) =>
            section.summary !== undefined ? (
              <section key={section.key} className={`${borderCls} vf-ext-summary`}>
                <div className="vf-ext-item">
                  <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                    <Glyph name={list === "plugins" ? "plugin" : "snippets"} />
                  </span>
                  <span className="vf-ext-item-text">
                    <b>{section.summary.title}</b>
                    <small>{section.summary.text}</small>
                  </span>
                  <span className="vf-ext-item-state tabular-nums">{section.summary.value}</span>
                </div>
              </section>
            ) : (
              <SettingsSection
                key={section.key}
                title={section.title}
                description={section.sub === "" ? undefined : section.sub}
              >
                <div className="vf-ext-items" data-ext-section={section.key}>
                  {section.items.map((item) =>
                    // AR-S4e2 — a marketplace's row opens its part of the agent's catalogs
                    section.key === "marketplaces" && onBrowse !== undefined ? (
                      <ItemRow
                        key={item.key}
                        item={{ ...item, open: { kind: "plugin", id: item.key, name: item.name } }}
                        onOpen={() => onBrowse(item.key)}
                      />
                    ) : (
                      <ItemRow key={item.key} item={item} onOpen={onOpen} />
                    ),
                  )}
                </div>
              </SettingsSection>
            ),
          )}
        </>
      )}
      <ReadFoot lens={lens} refreshing={refreshing} onRefresh={onRefresh} now={now} />
    </div>
  );
}

/* ── one server or skill of the profile (pass 24's item page), read-only ──── */

export interface ExtensionItemViewProps {
  lens: AgentsExtensionsListResult | null;
  list: ExtensionKindKey;
  name: string;
  /** "in Work" · "on This Mac" */
  where: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** AR-S4c: an agent's switch, its Remove…, its Sign in; absent, the page is read-only. */
  onAct?: (request: ExtensionActRequest) => void;
  acting?: boolean;
  /** The catalog's still of a confirm: the act whose confirm is open. */
  armed?: ExtensionActRequest;
  /** A server's sign-in running for the profile: its pane and Cancel. */
  signIn?: ExtensionSignInSlot;
  /** AR-S4d2 — the other profiles and their agents, for what a move to the shared folder reaches. */
  otherProfiles?: Array<{ profile: string; providers: string[] }>;
  now?: Date;
}

/** What one server or skill is, the versions held under its name, and how each agent holds it. */
export function ExtensionItemView({
  lens,
  list,
  name,
  where,
  error = null,
  refreshing = false,
  onRefresh,
  onAct,
  acting = false,
  armed: armedInitially,
  signIn,
  otherProfiles = [],
  now,
}: ExtensionItemViewProps): ReactElement {
  const [armedByClick, setArmed] = useState<ExtensionCellAct | null>(null);
  const model =
    lens === null || firstRead(lens)
      ? null
      : extensionItem(lens, list, name, where.replace(/^(in|on) /u, ""));
  // the catalog opens a confirm by naming its act
  const armed =
    armedByClick ??
    (armedInitially === undefined || model === null
      ? null
      : (model.agents
          .flatMap((agent) => [agent.act, agent.signIn?.act ?? null, agent.signOut])
          .find(
            (act) =>
              act !== null &&
              act.provider === armedInitially.provider &&
              act.id === armedInitially.id &&
              act.act === armedInitially.act,
          ) ?? null));
  const busy = acting || lens?.run?.state === "running";
  const ask = (act: ExtensionCellAct): void => {
    if (onAct === undefined) return;
    if (asksFirst(act)) setArmed(act);
    else onAct(requestOf(act));
  };
  const kindWord = list === "servers" ? "MCP server" : "Skill";
  let body: ReactNode;
  if (model === null) {
    body = (
      <p className="vf-ext-quiet" aria-busy="true">
        {lens === null || lens.reading ? "Reading the agents…" : ""}
      </p>
    );
  } else if (model.gone) {
    body = (
      <p className="vf-ext-empty">
        No agent {where} holds {name} now.
      </p>
    );
  } else {
    body = (
      <>
        {model.versions !== null && (
          <SettingsSection title={model.versions.title} description={model.versions.sub}>
            <div className="vf-ext-versions">
              {model.versions.entries.map((version) => (
                <div
                  key={`${version.code}|${version.names}`}
                  className="vf-ext-version"
                  data-ext-version=""
                >
                  <code className="vf-ext-code">{version.code}</code>
                  {version.names !== "" && <span>{version.names}</span>}
                  <small>{version.agents}</small>
                </div>
              ))}
            </div>
          </SettingsSection>
        )}
        <section className={`${borderCls} vf-ext-def-section`}>
          <dl className="vf-ext-def">
            {model.facts.map((fact) => (
              <Fragment key={fact.term}>
                <dt>{fact.termCode === true ? <code>{fact.term}</code> : fact.term}</dt>
                <dd>
                  {fact.code !== undefined ? (
                    <code className="vf-ext-code">{fact.code}</code>
                  ) : (
                    <span className={fact.attention === true ? "vf-ext-attn" : undefined}>
                      {fact.text}
                    </span>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
        <SettingsSection
          title={`Agents ${where}`}
          description={model.agentsSub === "" ? undefined : model.agentsSub}
        >
          <div className="vf-ext-items">
            {model.agents.map((agent) => (
              <div key={agent.provider} className="vf-ext-item" data-ext-agent={agent.provider}>
                <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                  <AgentIcon providerId={agent.provider} />
                </span>
                <span className="vf-ext-item-text">
                  <b>{agent.label}</b>
                  <small>
                    <Words text={agent.fact} />
                  </small>
                  {agent.place !== undefined && (
                    <small className="vf-ext-place">{agent.place}</small>
                  )}
                </span>
                <span
                  className={`vf-ext-item-state vf-ext-item-state--cell${agent.attention ? " vf-ext-attn" : ""}`}
                  title={agent.cell.why}
                >
                  {agent.act !== null && agent.switchable && onAct !== undefined ? (
                    // the agent's own switch for this profile; a skill's link is its switch
                    <UiSwitch
                      checked={agent.act.act === "disable" || agent.act.act === "remove"}
                      disabled={busy}
                      label={agent.act.title}
                      onChange={() => ask(agent.act!)}
                    />
                  ) : (
                    <CellMark cell={agent.cell} />
                  )}
                  {agent.state}
                  {agent.signIn !== null && onAct !== undefined && (
                    // the agent's own login, in a terminal below
                    <UiButton
                      disabled={busy}
                      aria-label={agent.signIn.act.title}
                      onClick={() => ask(agent.signIn!.act)}
                    >
                      {agent.signIn.label}
                    </UiButton>
                  )}
                  {agent.signOut !== null && onAct !== undefined && (
                    <UiButton
                      variant="quiet"
                      disabled={busy}
                      aria-label={agent.signOut.title}
                      onClick={() => ask(agent.signOut!)}
                    >
                      Sign out
                    </UiButton>
                  )}
                  {agent.act !== null &&
                    agent.act.act === "add" &&
                    !agent.switchable &&
                    onAct !== undefined && (
                      // AR-S4d — the agent's own add, from the profile's definition
                      <UiButton
                        disabled={busy}
                        aria-label={agent.act.title}
                        onClick={() => ask(agent.act!)}
                      >
                        Turn on
                      </UiButton>
                    )}
                  {agent.act !== null &&
                    agent.act.act !== "add" &&
                    !agent.switchable &&
                    onAct !== undefined && (
                      <UiButton
                        variant="danger"
                        disabled={busy}
                        aria-label={agent.act.title}
                        onClick={() => ask(agent.act!)}
                      >
                        Remove…
                      </UiButton>
                    )}
                </span>
              </div>
            ))}
          </div>
          {armed !== null && onAct !== undefined && (
            <ActConfirm
              key={`${armed.provider}:${armed.id}:${armed.act}`}
              act={armed}
              where={where}
              {...(lens !== null ? { context: confirmContext(lens, armed, otherProfiles) } : {})}
              busy={busy}
              onConfirm={(values) => {
                setArmed(null);
                onAct(requestOf(armed, values));
              }}
              onCancel={() => setArmed(null)}
            />
          )}
        </SettingsSection>
        {lens !== null &&
          lens.run !== undefined &&
          lens.run.name === name &&
          // a plugin by the same name runs on its own page
          lens.run.kind === (list === "servers" ? "mcp-server" : "skill") && (
            <RunView lens={lens} run={lens.run} where={where} signIn={signIn} now={now} />
          )}
        {model.sharedFolder !== null && (
          <section className={`${borderCls} vf-ext-shared`}>
            <b>In the shared folder</b>
            <p>{model.sharedFolder}</p>
          </section>
        )}
      </>
    );
  }
  return (
    <div className="vf-agents vf-agents-page vf-ext-page" data-ext-item-page={list}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {name}, {kindWord.toLowerCase()} {where}
      </h2>
      <ErrorNotice error={error} />
      {body}
      <ReadFoot lens={lens} refreshing={refreshing} onRefresh={onRefresh} now={now} />
    </div>
  );
}

/* ── one plugin an agent holds (AR-S4e; pass 23's D1) ─────────────────────── */

export interface PluginViewProps {
  lens: AgentsExtensionsListResult | null;
  provider: string;
  /** The plugin's key in its agent's read. */
  id: string;
  /** Its name as its row gave it: the title before the lens answers, and after it goes. */
  name: string;
  /** "in Work" · "on This Mac" */
  where: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The agent's own acts on it; absent, the page is read-only. */
  onAct?: (request: ExtensionActRequest) => void;
  acting?: boolean;
  /** The catalog's still of a confirm: the act whose confirm is open. */
  armed?: ExtensionActRequest;
  now?: Date;
}

/** A plugin's page: who made it, what it brings, its version, and its agent's own acts on it. */
export function PluginView({
  lens,
  provider,
  id,
  name,
  where,
  error = null,
  refreshing = false,
  onRefresh,
  onAct,
  acting = false,
  armed: armedInitially,
  now,
}: PluginViewProps): ReactElement {
  const [armedByClick, setArmed] = useState<ExtensionCellAct | null>(null);
  const model = lens === null || firstRead(lens) ? null : pluginPage(lens, provider, id, name);
  const acts =
    model === null
      ? []
      : [model.toggle, model.update, model.remove, model.purge].filter(
          (act): act is ExtensionCellAct => act !== null,
        );
  // the catalog opens a confirm by naming its act
  const armed =
    armedByClick ??
    (armedInitially === undefined
      ? null
      : (acts.find((act) => act.act === armedInitially.act && act.id === armedInitially.id) ??
        null));
  const busy = acting || lens?.run?.state === "running";
  const ask = (act: ExtensionCellAct): void => {
    if (onAct === undefined) return;
    if (asksFirst(act)) setArmed(act);
    else onAct(requestOf(act));
  };
  const confirmFor = (act: ExtensionCellAct): ReactElement | null =>
    armed === null || onAct === undefined || armed.act !== act.act ? null : (
      <ActConfirm
        key={`${armed.provider}:${armed.id}:${armed.act}`}
        act={armed}
        where={where}
        context={{ goes: model?.goes ?? "", keepsData: model?.purge != null }}
        busy={busy}
        onConfirm={() => {
          setArmed(null);
          onAct(requestOf(armed));
        }}
        onCancel={() => setArmed(null)}
      />
    );
  let body: ReactNode;
  if (model === null) {
    body = (
      <p className="vf-ext-quiet" aria-busy="true">
        {lens === null || lens.reading ? "Reading the agent…" : ""}
      </p>
    );
  } else if (model.gone) {
    body = (
      <p className="vf-ext-empty">
        {model.label} doesn’t hold {model.name} {where} now.
      </p>
    );
  } else {
    const run =
      lens?.run !== undefined &&
      lens.run.kind === "plugin" &&
      lens.run.provider === provider &&
      lens.run.item === id
        ? lens.run
        : undefined;
    body = (
      <>
        <section className={`${borderCls} vf-ext-hero`} data-ext-plugin={model.id}>
          <span className="vf-agents-mark vf-ext-tile" aria-hidden="true">
            <span className="vf-ext-initial">{model.initial}</span>
          </span>
          <span className="vf-ext-item-text">
            <b className="vf-ext-hero-name">{model.name}</b>
            {model.sub !== "" && <small>{model.sub}</small>}
          </span>
          <span className="vf-ext-item-state vf-ext-item-state--cell">
            {model.toggle !== null && onAct !== undefined && (
              // the agent's own switch for it, in this profile
              <UiSwitch
                checked={model.state === "On"}
                disabled={busy}
                label={model.toggle.title}
                onChange={() => ask(model.toggle!)}
              />
            )}
            {model.state}
          </span>
        </section>
        {model.toggle !== null && confirmFor(model.toggle)}
        {model.description !== null && <p className="vf-ext-intro">{model.description}</p>}
        {model.noSwitch !== null && (
          <p className="vf-ext-quiet">
            <Words text={model.noSwitch} />
          </p>
        )}
        {model.hosted !== null && <p className="vf-ext-quiet">{model.hosted}</p>}
        {model.parts.length > 0 && (
          <SettingsSection title="What it adds">
            <div className="vf-ext-items">
              {model.parts.map((part) => (
                <div key={part.key} className="vf-ext-item" data-ext-part={part.key}>
                  <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                    <Glyph name={part.glyph} />
                  </span>
                  <span className="vf-ext-item-text">
                    <b>{part.title}</b>
                    <small>{part.text}</small>
                    <span className="vf-ext-names">
                      {part.names.map((partName) => (
                        <code key={partName} className="vf-ext-code">
                          {partName}
                        </code>
                      ))}
                    </span>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </SettingsSection>
        )}
        {model.facts.length > 0 && (
          <section className={`${borderCls} vf-ext-def-section`}>
            <dl className="vf-ext-def">
              {model.facts.map((fact) => (
                <Fragment key={fact.term}>
                  <dt>{fact.term}</dt>
                  <dd className={fact.term === "Version" ? "vf-ext-def-act" : undefined}>
                    {fact.code !== undefined ? (
                      <code className="vf-ext-code">{fact.code}</code>
                    ) : (
                      <span>{fact.text}</span>
                    )}
                    {fact.term === "Version" && model.update !== null && onAct !== undefined && (
                      <UiButton
                        disabled={busy}
                        aria-label={model.update.title}
                        onClick={() => ask(model.update!)}
                      >
                        Update
                      </UiButton>
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
            {model.noUpdate !== null && (
              <p className="vf-ext-quiet vf-ext-def-note">
                <Words text={model.noUpdate} />
              </p>
            )}
          </section>
        )}
        {model.update !== null && confirmFor(model.update)}
        {run !== undefined && lens !== null && (
          <RunView lens={lens} run={run} where={where} now={now} />
        )}
        {(model.remove !== null || model.purge !== null || model.noRemove !== null) && (
          <section className={`${borderCls} vf-ext-way-out`}>
            {model.remove !== null || model.purge !== null ? (
              <div className="vf-ext-way-out-row">
                <span className="vf-ext-item-text">
                  <b>
                    Remove from {model.label} {where}
                  </b>
                  <small>{model.goes}</small>
                </span>
                {onAct !== undefined && (
                  <span className="vf-ext-way-out-acts">
                    {model.remove !== null && (
                      <UiButton
                        disabled={busy}
                        aria-label={model.remove.title}
                        onClick={() => ask(model.remove!)}
                      >
                        Remove…
                      </UiButton>
                    )}
                    {model.purge !== null && (
                      <UiButton
                        variant="danger"
                        disabled={busy}
                        aria-label={model.purge.title}
                        onClick={() => ask(model.purge!)}
                      >
                        Remove with its data…
                      </UiButton>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="vf-ext-quiet">
                <Words text={model.noRemove!} />
              </p>
            )}
            {model.remove !== null && confirmFor(model.remove)}
            {model.purge !== null && confirmFor(model.purge)}
          </section>
        )}
      </>
    );
  }
  return (
    <div className="vf-agents vf-agents-page vf-ext-page" data-ext-plugin-page={id}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {model?.name ?? name}, a plugin of {model?.label ?? "the agent"} {where}
      </h2>
      <ErrorNotice error={error} />
      {body}
      <ReadFoot lens={lens} refreshing={refreshing} onRefresh={onRefresh} now={now} />
    </div>
  );
}

/* ── AR-S4e2: browse and install (pass 23's B1 and D1) ────────────────────── */

/** A confirm with its words given: the plugins list's "Update catalogs…" (P7). */
function PlainConfirm({
  question,
  what,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  question: string;
  what: string;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => button.current?.focus(), []);
  return (
    <fieldset
      className="vf-profiles-confirm-box vf-ext-confirm"
      aria-labelledby={questionId}
      data-ext-confirm="check"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={questionId} className="vf-profiles-confirm-question">
        {question}
      </p>
      <p className={`vf-profiles-confirm-what ${labelCls}`}>{what}</p>
      <div className="vf-profiles-confirm-acts">
        <UiButton ref={button} disabled={busy} onClick={onConfirm}>
          {action}
        </UiButton>
        <UiButton disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
      </div>
    </fieldset>
  );
}

/**
 * A source a person types for the agent's own install, or for its add of a
 * marketplace: what the agent would run, planned as it is typed, then Add.
 */
function SourceForm({
  kind,
  title,
  words,
  agent,
  where,
  initial,
  busy,
  onPlan,
  onAdd,
  onCancel,
}: {
  kind: "plugin" | "marketplace";
  title: string;
  /** The agent's own words for what it takes. */
  words: string;
  agent: string;
  where: string;
  initial: string;
  busy: boolean;
  onPlan?: ((source: string) => Promise<AgentExtensionOffer | null>) | undefined;
  onAdd: (source: string, act: NonNullable<AgentExtensionOffer["act"]>) => void;
  onCancel: () => void;
}): ReactElement {
  const [source, setSource] = useState(initial);
  const [offer, setOffer] = useState<AgentExtensionOffer | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  useEffect(() => field.current?.focus(), []);
  // what the agent would run, planned when the typing rests
  useEffect(() => {
    const typed = source.trim();
    if (onPlan === undefined || typed === "") {
      setOffer(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      onPlan(typed)
        .then((answer) => {
          if (live) setOffer(answer);
        })
        .catch(() => {
          if (live) setOffer(null);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, onPlan]);
  const act = offer?.act;
  const everyProfile = act?.reaches.includes("every-profile") === true;
  return (
    <form
      className={`${borderCls} vf-ext-source`}
      data-ext-source={kind}
      onSubmit={(event) => {
        event.preventDefault();
        if (act !== undefined && !busy) onAdd(source.trim(), act);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <label className="vf-ext-source-label" htmlFor={fieldId}>
        <b>{title}</b>
        <small>{words}</small>
      </label>
      <div className="vf-ext-source-row">
        <input
          id={fieldId}
          ref={field}
          className={`${fieldCls} vf-ext-add-field vf-ext-mono`}
          value={source}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setSource(event.target.value)}
        />
        <UiButton type="submit" variant="primary" disabled={busy || act === undefined}>
          {everyProfile ? "Add to every profile" : "Add"}
        </UiButton>
        <UiButton disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
      </div>
      {act !== undefined ? (
        <p className="vf-ext-confirm-runs">
          Runs <code className="vf-ext-code">{act.runs}</code>
        </p>
      ) : offer?.unavailable !== undefined ? (
        <p className={`vf-ext-quiet ${labelCls}`}>
          <Words text={offer.unavailable.message} />
        </p>
      ) : null}
      <p className={`vf-ext-quiet ${labelCls}`}>
        {kind === "marketplace"
          ? `${agent} fetches its catalog now and keeps it ${where}. Only add a marketplace you trust: its plugins can run code on this Mac.`
          : `${agent} fetches it now and keeps it ${everyProfile ? "for every profile" : where}. It runs as code on this Mac, so add only what you trust.`}
      </p>
    </form>
  );
}

/** A listed plugin's row: its name opens its page; Install is one click where the agent asks nothing first. */
function BrowseRowView({
  row,
  busy,
  onOpen,
  onInstall,
}: {
  row: BrowseRow;
  busy: boolean;
  onOpen?: ((row: BrowseRow) => void) | undefined;
  onInstall?: ((act: ExtensionCellAct) => void) | undefined;
}): ReactElement {
  let right: ReactNode = null;
  if (row.state === "installed") {
    // installed: a check; installed with a newer one listed: the words alone, its page has Update
    right = row.newer ? (
      <span className="vf-ext-installed vf-ext-installed--newer">Update available</span>
    ) : (
      <span className="vf-ext-installed">
        <Glyph name="check" className="vf-ext-installed-mark" />
        Installed
      </span>
    );
  } else if (row.state === "blocked") {
    right = <span>{row.words}</span>;
  } else if (row.state === "install" && row.install !== null && onInstall !== undefined) {
    const install = row.install;
    right = (
      <UiButton disabled={busy} aria-label={install.title} onClick={() => onInstall(install)}>
        Install
      </UiButton>
    );
  } else if (row.state === "look" && onOpen !== undefined) {
    right = (
      <UiButton
        disabled={busy}
        aria-label={`Look at ${row.name} first`}
        onClick={() => onOpen(row)}
      >
        Install…
      </UiButton>
    );
  }
  return (
    <div
      className={`vf-ext-item${onOpen !== undefined ? " vf-ext-item--open" : ""}`}
      data-ext-listed={row.id}
    >
      <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
        <span className="vf-ext-initial">{row.initial}</span>
      </span>
      <span className="vf-ext-item-text">
        {onOpen !== undefined ? (
          <button type="button" className="vf-agents-row-open" onClick={() => onOpen(row)}>
            {row.name}
          </button>
        ) : (
          <b>{row.name}</b>
        )}
        {row.text !== "" && <small>{row.text}</small>}
      </span>
      <span className="vf-ext-item-state vf-ext-item-state--cell">{right}</span>
      {onOpen !== undefined && <Chevron />}
    </div>
  );
}

/** When the catalog was read, and the way to read it again (it reads files; nothing is fetched). */
function CatalogFoot({
  catalog,
  loading,
  onRefresh,
}: {
  catalog: AgentsExtensionsCatalogResult | null;
  loading: boolean;
  onRefresh?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="vf-ext-readfoot">
      <span>
        {catalog?.readAt === undefined
          ? ""
          : `Read from what ${catalog.label} last fetched. VibeField fetches nothing itself.`}
      </span>
      <ReadAgain reading={loading} onRefresh={onRefresh} />
    </div>
  );
}

export interface BrowseViewProps {
  lens: AgentsExtensionsListResult | null;
  /** The agent's catalog; null while the first read is on its way. */
  catalog: AgentsExtensionsCatalogResult | null;
  provider: string;
  /** "in Work" · "on This Mac" */
  where: string;
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  onAct?: (request: ExtensionActRequest) => void;
  acting?: boolean;
  signIn?: ExtensionSignInSlot;
  /** A row opens its page: the installed plugin's (`held`), or the listed one's. */
  onOpen?: (plugin: { id: string; name: string; held: string | null }) => void;
  /** What the agent would run for a marketplace's source being typed. */
  onPlanSource?: (source: string) => Promise<AgentExtensionOffer | null>;
  /** The catalog's stills: a filter, a marketplace's removal confirm open, the add form open. */
  query?: string;
  market?: string;
  armed?: string;
  adding?: string;
  now?: Date;
}

/** pass 23's B1: one list of what the agent's marketplaces list, grouped by marketplace. */
export function BrowseView({
  lens,
  catalog,
  provider,
  where,
  error = null,
  loading = false,
  onRefresh,
  onAct,
  acting = false,
  signIn,
  onOpen,
  onPlanSource,
  query: queryInitially = "",
  market: marketInitially = "all",
  armed: armedInitially,
  adding,
  now,
}: BrowseViewProps): ReactElement {
  const [query, setQuery] = useState(queryInitially);
  const [market, setMarket] = useState(marketInitially);
  const [armed, setArmed] = useState<ExtensionCellAct | null>(null);
  const [addOpen, setAddOpen] = useState(adding !== undefined);
  const model =
    catalog === null
      ? null
      : browsePage(catalog, lens, where, now ?? new Date(), { query, market });
  const label = model?.label ?? catalog?.label ?? "The agent";
  const busy = acting || lens?.run?.state === "running";
  const run =
    lens?.run !== undefined &&
    lens.run.provider === provider &&
    (lens.run.kind === "marketplace" || lens.run.act === "install")
      ? lens.run
      : undefined;
  const ask = (act: ExtensionCellAct): void => {
    if (onAct === undefined) return;
    if (asksFirst(act)) setArmed(act);
    else onAct(requestOf(act));
  };
  // the catalog's still of a marketplace's removal confirm
  const armedGroup =
    armed ??
    (armedInitially === undefined
      ? null
      : (model?.groups.find((group) => group.key === armedInitially)?.remove ?? null));
  const confirmFor = (group: BrowseGroup): ReactElement | null =>
    armedGroup === null || onAct === undefined || armedGroup.id !== group.key ? null : (
      <ActConfirm
        key={`${armedGroup.id}:${armedGroup.act}`}
        act={armedGroup}
        where={where}
        context={{
          installedFrom: (lens?.plugins[provider] ?? []).filter(
            (plugin) => plugin.marketplace === group.key,
          ).length,
          ...(group.source !== null ? { source: group.source } : {}),
        }}
        busy={busy}
        onConfirm={() => {
          setArmed(null);
          onAct(requestOf(armedGroup));
        }}
        onCancel={() => setArmed(null)}
      />
    );
  const rows = (list: readonly BrowseRow[]) =>
    list.map((row) => (
      <BrowseRowView
        key={row.id}
        row={row}
        busy={busy}
        onOpen={
          onOpen === undefined
            ? undefined
            : (open) => onOpen({ id: open.id, name: open.name, held: open.held })
        }
        onInstall={onAct === undefined ? undefined : (act) => onAct(requestOf(act))}
      />
    ));
  const addForm =
    addOpen && model?.addMarketplace != null && onAct !== undefined ? (
      <SourceForm
        kind="marketplace"
        title="Add a marketplace"
        words={model.addMarketplace}
        agent={label}
        where={where}
        initial={adding ?? ""}
        busy={busy}
        onPlan={onPlanSource}
        onAdd={(source, act) => {
          setAddOpen(false);
          onAct({
            provider,
            kind: "marketplace",
            id: source,
            act: "add",
            source,
            ...(act.terminal === true ? { terminal: true } : {}),
          });
        }}
        onCancel={() => setAddOpen(false)}
      />
    ) : null;
  let body: ReactNode;
  if (model === null) {
    body = (
      <p className="vf-ext-quiet" aria-busy="true">
        {loading ? `Reading ${label}’s catalogs…` : ""}
      </p>
    );
  } else if (model.failure !== null) {
    body = <p className="vf-ext-quiet">{model.failure}</p>;
  } else if (model.empty !== null) {
    const suggest = model.empty.suggest;
    body = (
      <>
        <section className={`${borderCls} vf-ext-browse-empty`} data-ext-browse-empty="">
          <span className="vf-ext-browse-empty-mark" aria-hidden="true">
            <Glyph name="plugin" />
          </span>
          <b>{model.empty.title}</b>
          <p className={labelCls}>{model.empty.text}</p>
          {onAct !== undefined && (
            <span className="vf-ext-browse-empty-acts">
              {suggest !== null && (
                <UiButton variant="primary" disabled={busy} onClick={() => ask(suggest)}>
                  Add {suggest.name}
                </UiButton>
              )}
              {model.addMarketplace !== null && (
                <UiButton disabled={busy || addOpen} onClick={() => setAddOpen(true)}>
                  Add marketplace…
                </UiButton>
              )}
            </span>
          )}
        </section>
        {addForm}
        {run !== undefined && lens !== null && (
          <RunView lens={lens} run={run} where={where} signIn={signIn} now={now} />
        )}
      </>
    );
  } else {
    body = (
      <>
        <div className="vf-ext-browse-tools">
          <label className="vf-ext-search">
            <Glyph name="search" className="vf-ext-search-glyph" />
            <input
              type="search"
              className={`${fieldCls} vf-ext-search-field`}
              value={query}
              placeholder={model.placeholder}
              aria-label={model.placeholder}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {model.chips.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs
            <div className="vf-ext-chips" role="group" aria-label="Marketplaces">
              {model.chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={`vf-ext-chip${market === chip.key ? " vf-ext-chip--on" : ""}`}
                  aria-pressed={market === chip.key}
                  onClick={() => setMarket(chip.key)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {model.notice !== null && (
          <p className="vf-ext-quiet">
            <Words text={model.notice} />
          </p>
        )}
        {run !== undefined && lens !== null && (
          <RunView lens={lens} run={run} where={where} signIn={signIn} now={now} />
        )}
        {model.featured.length > 0 && (
          <SettingsSection title="Featured" description={`As ${label} features them`}>
            <div className="vf-ext-items" data-ext-section="featured">
              {rows(model.featured)}
            </div>
          </SettingsSection>
        )}
        {model.groups.map((group) => (
          <SettingsSection
            key={group.key}
            title={group.title}
            description={group.sub === "" ? undefined : group.sub}
            action={
              onAct === undefined ||
              (group.update === null && group.remove === null) ? undefined : (
                <>
                  {group.update !== null && (
                    <UiButton
                      disabled={busy}
                      aria-label={group.update.title}
                      onClick={() => ask(group.update!)}
                    >
                      Update catalog
                    </UiButton>
                  )}
                  {group.remove !== null && (
                    <UiButton
                      disabled={busy}
                      aria-label={group.remove.title}
                      onClick={() => ask(group.remove!)}
                    >
                      Remove…
                    </UiButton>
                  )}
                </>
              )
            }
          >
            {confirmFor(group)}
            {group.unread !== null && <p className="vf-ext-quiet">{group.unread}</p>}
            {group.rows.length > 0 ? (
              <div className="vf-ext-items" data-ext-section={group.key}>
                {rows(group.rows)}
              </div>
            ) : (
              group.unread === null && <p className="vf-ext-quiet">Nothing here yet.</p>
            )}
          </SettingsSection>
        ))}
        {model.noMatch !== null && <p className="vf-ext-empty">{model.noMatch}</p>}
        {model.addMarketplace !== null &&
          onAct !== undefined &&
          (addForm ?? (
            <section className={`${borderCls} vf-ext-browse-add`}>
              <button
                type="button"
                className="vf-ext-item vf-ext-item--open vf-ext-browse-add-row"
                disabled={busy}
                onClick={() => setAddOpen(true)}
              >
                <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                  <Glyph name="plus" />
                </span>
                <span className="vf-ext-item-text">
                  <b>Add marketplace…</b>
                  <small>{model.addMarketplace}</small>
                </span>
              </button>
            </section>
          ))}
      </>
    );
  }
  return (
    <div className="vf-agents vf-agents-page vf-ext-page vf-ext-browse" data-ext-browse={provider}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {model?.title ?? "Browse"}, {label} {where}
      </h2>
      <ErrorNotice error={error} />
      {body}
      <CatalogFoot catalog={catalog} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}

export interface ListedPluginViewProps {
  lens: AgentsExtensionsListResult | null;
  catalog: AgentsExtensionsCatalogResult | null;
  provider: string;
  /** The catalog's key for it. */
  id: string;
  /** Its name as its row gave it. */
  name: string;
  where: string;
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  onAct?: (request: ExtensionActRequest) => void;
  acting?: boolean;
  signIn?: ExtensionSignInSlot;
  /** The catalog's still: the install's confirm open. */
  armed?: boolean;
  now?: Date;
}

/** pass 23's D1 before it is installed: what it is, what the agent asks first, what it would add, and Install. */
export function ListedPluginView({
  lens,
  catalog,
  provider,
  id,
  name,
  where,
  error = null,
  loading = false,
  onRefresh,
  onAct,
  acting = false,
  signIn,
  armed: armedInitially = false,
  now,
}: ListedPluginViewProps): ReactElement {
  const model = catalog === null ? null : listedPluginPage(catalog, lens, id, name);
  const [armedByClick, setArmed] = useState(false);
  const armed = armedByClick || armedInitially;
  const busy = acting || lens?.run?.state === "running";
  const run =
    lens?.run !== undefined &&
    lens.run.provider === provider &&
    lens.run.act === "install" &&
    lens.run.item === id
      ? lens.run
      : undefined;
  const install = model?.install ?? null;
  const confirm =
    install !== null && armed && onAct !== undefined ? (
      <ActConfirm
        act={install}
        where={where}
        busy={busy}
        onConfirm={() => {
          setArmed(false);
          onAct(requestOf(install));
        }}
        onCancel={() => setArmed(false)}
      />
    ) : null;
  let body: ReactNode;
  if (model === null) {
    body = (
      <p className="vf-ext-quiet" aria-busy="true">
        {loading ? "Reading the agent’s catalogs…" : ""}
      </p>
    );
  } else if (model.gone) {
    body = (
      <p className="vf-ext-empty">
        No marketplace {model.label} knows lists {model.name} {where} now.
      </p>
    );
  } else {
    const running = run?.state === "running";
    const control =
      model.held !== null ? (
        <span className="vf-ext-installed">
          <Glyph name="check" className="vf-ext-installed-mark" />
          Installed
        </span>
      ) : model.blocked !== null ? (
        <span>{model.blocked}</span>
      ) : running ? (
        <span>Installing…</span>
      ) : install !== null && onAct !== undefined ? (
        <UiButton
          variant="primary"
          disabled={busy}
          aria-label={install.title}
          onClick={() => {
            if (actConfirm(install, where) !== null) setArmed(true);
            else onAct(requestOf(install));
          }}
        >
          {install.terminal ? "Install in a terminal…" : `Install ${where}`}
        </UiButton>
      ) : null;
    body = (
      <>
        <section className={`${borderCls} vf-ext-hero`} data-ext-listed-plugin={model.id}>
          <span className="vf-agents-mark vf-ext-tile" aria-hidden="true">
            <span className="vf-ext-initial">{model.initial}</span>
          </span>
          <span className="vf-ext-item-text">
            <b className="vf-ext-hero-name">{model.name}</b>
            {model.sub !== "" && <small>{model.sub}</small>}
          </span>
          <span className="vf-ext-item-state vf-ext-item-state--cell">{control}</span>
        </section>
        {confirm}
        {model.description !== null && <p className="vf-ext-intro">{model.description}</p>}
        {model.why !== null && (
          <p className="vf-ext-quiet">
            <Words text={model.why} />
          </p>
        )}
        {run !== undefined && lens !== null && (
          <RunView lens={lens} run={run} where={where} signIn={signIn} now={now} />
        )}
        {model.before.length > 0 && model.held === null && (
          <SettingsSection title="Before it runs">
            <div className="vf-ext-items" data-ext-section="before">
              {model.before.map((row) => (
                <div key={row.key} className="vf-ext-item" data-ext-before={row.key}>
                  <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                    <Glyph name={row.glyph} />
                  </span>
                  <span className="vf-ext-item-text">
                    <b>{row.title}</b>
                    <small>
                      {row.code !== undefined && <code className="vf-ext-code">{row.code}</code>}
                      {row.code !== undefined && " · "}
                      {row.text}
                    </small>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </SettingsSection>
        )}
        {model.parts.length > 0 && (
          <SettingsSection
            title={model.held === null ? "What it would add" : "What it adds"}
            description="As its listing names it"
          >
            <div className="vf-ext-items">
              {model.parts.map((part) => (
                <div key={part.key} className="vf-ext-item" data-ext-part={part.key}>
                  <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                    <Glyph name={part.glyph} />
                  </span>
                  <span className="vf-ext-item-text">
                    <b>{part.title}</b>
                    <small>{part.text}</small>
                    <span className="vf-ext-names">
                      {part.names.map((partName) => (
                        <code key={partName} className="vf-ext-code">
                          {partName}
                        </code>
                      ))}
                    </span>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </SettingsSection>
        )}
        {model.facts.length > 0 && (
          <section className={`${borderCls} vf-ext-def-section`}>
            <dl className="vf-ext-def">
              {model.facts.map((fact) => (
                <Fragment key={fact.term}>
                  <dt>{fact.term}</dt>
                  <dd>
                    {fact.code !== undefined ? (
                      <code className="vf-ext-code">{fact.code}</code>
                    ) : (
                      <span>{fact.text}</span>
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        )}
      </>
    );
  }
  return (
    <div className="vf-agents vf-agents-page vf-ext-page" data-ext-listed-page={id}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {model?.name ?? name}, listed for {model?.label ?? "the agent"} {where}
      </h2>
      <ErrorNotice error={error} />
      {body}
      <CatalogFoot catalog={catalog} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}

/** The Browse page names itself, under its agent and its profile; back is the agent's list. */
export function browseSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  title: string,
  /** The agent's list it opened from: "Plugins", or the agent's own word ("Packages"). */
  listTitle: string,
  onBack: () => void,
): SettingsSubpage {
  return {
    title,
    description: (
      <span className="vf-profiles-subhead">
        {agentLabel} ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${listTitle}`,
    onBack,
  };
}

/* ── the Settings header for these pages ───────────────────────────────────── */

/** An agent's own list names itself by the kind, under the agent and its profile. */
export function agentListSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  list: AgentListKey,
  onBack: () => void,
  /** AR-S4e — the agent's own word for the kind, as its row said it (Pi's "Packages"). */
  title?: string,
): SettingsSubpage {
  return {
    title: title ?? agentListTitle(list),
    description: (
      <span className="vf-profiles-subhead">
        {agentLabel} ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${agentLabel}`,
    onBack,
  };
}

/** A server's or skill's page names itself, what it is, and the profile it is in. */
export function extensionItemSubpage(
  set: AgentProfileSet,
  list: ExtensionKindKey,
  name: string,
  onBack: () => void,
): SettingsSubpage {
  return {
    title: name,
    description: (
      <span className="vf-profiles-subhead">
        {list === "servers" ? "MCP server" : "Skill"} ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${set.label}`,
    onBack,
  };
}

/** A plugin's page names itself, under its agent and its profile; back is the agent's list. */
export function pluginSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  name: string,
  /** The agent's list it opened from: "Plugins", or the agent's own word ("Packages"). */
  listTitle: string,
  onBack: () => void,
): SettingsSubpage {
  return {
    title: name,
    description: (
      <span className="vf-profiles-subhead">
        {agentLabel} ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${listTitle}`,
    onBack,
  };
}

/** Add server's page names itself, what it makes, and the profile it is for. */
export function addServerSubpage(set: AgentProfileSet, onBack: () => void): SettingsSubpage {
  return {
    title: "Add MCP server",
    description: (
      <span className="vf-profiles-subhead">
        Kept once ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${set.label}`,
    onBack,
  };
}

/** Add skill's page names itself, what it makes, and the profile it is for. */
export function addSkillSubpage(set: AgentProfileSet, onBack: () => void): SettingsSubpage {
  return {
    title: "Add skill",
    description: (
      <span className="vf-profiles-subhead">
        Kept once ·
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${set.label}`,
    onBack,
  };
}

/* ── Add server (AR-S4d; pass 24's "Adding one", pass 23's A1 form) ─────────── */

export interface AddServerRequest {
  name: string;
  definition: AgentExtensionServerDefinition;
  values: Record<string, string>;
  agents: string[];
}

export interface AddServerViewProps {
  lens: AgentsExtensionsListResult | null;
  profile: string;
  /** "in Work" · "on This Mac" */
  where: string;
  /** What each agent's own add would run for the draft, or why it cannot; null until asked. */
  offers?: Record<string, AgentExtensionOffer> | null;
  /** Why the draft cannot be kept as it stands (a key in its command line), from fieldd. */
  planError?: string | null;
  error?: string | null;
  /** The Add is running: each agent's add rides the profile's frames. */
  adding?: boolean;
  /** The draft changed: the controller asks what each agent would run. */
  onDraft?: (name: string, definition: AgentExtensionServerDefinition | null) => void;
  onAdd?: (request: AddServerRequest) => void;
  onCancel?: () => void;
  /** The catalog's still: a draft already typed, and the agents chosen. */
  initial?: { draft?: Partial<AddServerDraft>; agents?: string[] };
  now?: Date;
}

const HOW = ["A program on this Mac", "A URL"] as const;

/** The form: a name, what it connects to, the values it reads, and Turn on for. */
export function AddServerView({
  lens,
  profile,
  where,
  offers = null,
  planError = null,
  error = null,
  adding = false,
  onDraft,
  onAdd,
  onCancel,
  initial,
  now,
}: AddServerViewProps): ReactElement {
  const [draft, setDraft] = useState<AddServerDraft>(() => ({
    name: "",
    how: "command",
    command: "",
    url: "",
    env: [{ name: "", value: "" }],
    ...initial?.draft,
  }));
  const [picked, setPicked] = useState<Set<string> | null>(
    initial?.agents === undefined ? null : new Set(initial.agents),
  );
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const definition = draftDefinition(draft);
  const name = draft.name.trim();
  const definitionKey = JSON.stringify(definition);
  // the controller plans each change of what would be kept
  useEffect(() => {
    onDraft?.(name, definition);
  }, [name, definitionKey]);

  const taken = lens === null ? [] : lens.servers.map((row) => row.name);
  const problem = draftProblem(draft, taken);
  const chips = lens === null ? [] : addServerChips(lens, offers);
  const chosen = chips.filter(
    (chip) => chip.act !== null && (picked === null ? chip.preselected : picked.has(chip.provider)),
  );
  // pass 24's hint: who cannot take it, and who would take it further than this profile
  const notes = chips
    .filter((chip) => chip.act === null || chip.act.reaches.includes("every-profile"))
    .map((chip) => chip.why);
  const native = where.startsWith("on ");
  const ready = problem === null && planError === null && !adding && onAdd !== undefined;
  const set = (patch: Partial<AddServerDraft>): void =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const running =
    lens?.run !== undefined && lens.run.name === name && (adding || lens.run.state === "running");
  return (
    <form
      className="vf-agents vf-agents-page vf-ext-page vf-ext-add"
      data-ext-add=""
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || definition === null) return;
        const values: Record<string, string> = {};
        for (const entry of draft.env) {
          if (entry.name.trim() !== "") values[entry.name.trim()] = entry.value;
        }
        onAdd?.({
          name,
          definition,
          values: definition.transport === "stdio" ? values : {},
          agents: chosen.map((chip) => chip.provider),
        });
      }}
    >
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        Add an MCP server {where}
      </h2>
      <ErrorNotice error={error} />
      <section className={borderCls}>
        <SettingsRow title="Name" description="How the agents and you will call it">
          <input
            ref={nameRef}
            className={`${fieldCls} vf-ext-add-name`}
            value={draft.name}
            maxLength={64}
            spellCheck={false}
            placeholder="context7"
            aria-label="Name"
            disabled={adding}
            onChange={(event) => set({ name: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow title="Connects to">
          <SegmentedControl
            options={HOW}
            value={draft.how === "command" ? HOW[0] : HOW[1]}
            label="Connects to"
            size="small"
            onChange={(value) => set({ how: value === HOW[0] ? "command" : "url" })}
          />
        </SettingsRow>
        {draft.how === "command" ? (
          <>
            <SettingsRow title="Command" description="What each agent runs to start it">
              <input
                className={`${fieldCls} vf-ext-add-field vf-ext-mono`}
                value={draft.command}
                spellCheck={false}
                placeholder="npx -y @upstash/context7-mcp"
                aria-label="Command"
                disabled={adding}
                onChange={(event) => set({ command: event.target.value })}
              />
            </SettingsRow>
            <SettingsRow
              title="Environment"
              description={`Each value is kept once, in VibeField’s keychain entry for ${profile}. Each agent’s settings name the variable; VibeField gives the value when it starts the agent.${native ? " An agent started outside VibeField gets none." : ""}`}
              align="start"
              divider={false}
            >
              <div className="vf-ext-env">
                {draft.env.map((entry, index) => (
                  <div key={index} className="vf-ext-env-row">
                    <input
                      className={`${fieldCls} vf-ext-mono`}
                      value={entry.name}
                      spellCheck={false}
                      placeholder="API_KEY"
                      aria-label={`Variable ${index + 1}`}
                      disabled={adding}
                      onChange={(event) => {
                        const value = event.target.value;
                        set({
                          env: draft.env.map((candidate, at) =>
                            at === index ? { ...candidate, name: value } : candidate,
                          ),
                        });
                      }}
                    />
                    <input
                      type="password"
                      className={fieldCls}
                      value={entry.value}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="value"
                      aria-label={`Value of variable ${index + 1}`}
                      disabled={adding}
                      onChange={(event) => {
                        const value = event.target.value;
                        set({
                          env: draft.env.map((candidate, at) =>
                            at === index ? { ...candidate, value } : candidate,
                          ),
                        });
                      }}
                    />
                  </div>
                ))}
                <UiButton
                  disabled={adding}
                  onClick={() => set({ env: [...draft.env, { name: "", value: "" }] })}
                >
                  Add a variable
                </UiButton>
              </div>
            </SettingsRow>
          </>
        ) : (
          <SettingsRow
            title="URL"
            description="If the server asks you to sign in, each agent asks on its own"
            divider={false}
          >
            <input
              className={`${fieldCls} vf-ext-add-field vf-ext-mono`}
              value={draft.url}
              spellCheck={false}
              placeholder="https://mcp.example.com/mcp"
              aria-label="URL"
              disabled={adding}
              onChange={(event) => set({ url: event.target.value })}
            />
          </SettingsRow>
        )}
      </section>
      <SettingsSection
        title="Turn on for"
        description={`${notes.length === 0 ? "" : `${notes.join("; ")}. `}You can change any of them later, one agent at a time.`}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs */}
        <div className="vf-ext-chips" role="group" aria-label="Turn on for">
          {chips.map((chip) => {
            const on = chosen.includes(chip);
            return (
              <button
                key={chip.provider}
                type="button"
                className={`vf-ext-chip${on ? " vf-ext-chip--on" : ""}`}
                aria-pressed={on}
                disabled={chip.act === null || adding}
                title={chip.why}
                onClick={() => {
                  const next = new Set(chosen.map((candidate) => candidate.provider));
                  if (on) next.delete(chip.provider);
                  else next.add(chip.provider);
                  setPicked(next);
                }}
              >
                <span className="vf-ext-chip-mark" aria-hidden="true">
                  <AgentIcon providerId={chip.provider} />
                </span>
                {chip.label}
              </button>
            );
          })}
        </div>
        <div className="vf-ext-runs" data-ext-runs="">
          <span className={labelCls}>Runs</span>
          {chosen.length === 0 ? (
            <code className="vf-ext-code">nothing yet: choose an agent</code>
          ) : (
            chosen.map((chip) => (
              <code key={chip.provider} className="vf-ext-code">
                <i>{chip.label}</i> {chip.act?.runs}
              </code>
            ))
          )}
        </div>
      </SettingsSection>
      <ErrorNotice error={planError} />
      {running && lens?.run !== undefined && <RunCard run={lens.run} now={now} />}
      <div className="vf-profiles-foot">
        {problem !== null && !adding && <span className={labelCls}>{problem}</span>}
        <UiButton onClick={onCancel} disabled={adding}>
          Cancel
        </UiButton>
        <UiButton type="submit" variant="primary" disabled={!ready}>
          {adding ? "Adding…" : "Add server"}
        </UiButton>
      </div>
    </form>
  );
}

/* ── Add skill (AR-S4d2; pass 24's "A skill, added once") ───────────────────── */

export interface AddSkillRequest {
  /** The folder a person named: a full path, or one from `~/`. */
  from: string;
  agents: string[];
}

/** What fieldd read of the folder, and what each agent would run to take it. */
export type AddSkillPlan = AgentsExtensionsPlanSkillResult;

export interface AddSkillViewProps {
  lens: AgentsExtensionsListResult | null;
  profile: string;
  /** "in Work" · "on This Mac" */
  where: string;
  /** The folder's read and each agent's line; null until asked, or while the folder is wrong. */
  plan?: AddSkillPlan | null;
  /** Why the folder can't be kept (none there, no SKILL.md, the name taken), from fieldd. */
  planError?: string | null;
  error?: string | null;
  adding?: boolean;
  /** The folder changed: the controller asks fieldd what it is. */
  onSource?: (from: string) => void;
  onAdd?: (request: AddSkillRequest) => void;
  onCancel?: () => void;
  /** The catalog's still: a folder already named, and the agents chosen. */
  initial?: { from?: string; agents?: string[] };
  now?: Date;
}

/** The form: a folder with a SKILL.md, then Turn on for, and what each agent would run. */
export function AddSkillView({
  lens,
  profile,
  where,
  plan = null,
  planError = null,
  error = null,
  adding = false,
  onSource,
  onAdd,
  onCancel,
  initial,
  now,
}: AddSkillViewProps): ReactElement {
  const [from, setFrom] = useState(initial?.from ?? "");
  const [picked, setPicked] = useState<Set<string> | null>(
    initial?.agents === undefined ? null : new Set(initial.agents),
  );
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => fieldRef.current?.focus(), []);
  const source = from.trim();
  // the controller reads each change of the folder
  useEffect(() => {
    onSource?.(source);
  }, [source]);
  const problem = skillSourceProblem(from);
  const chips = lens === null ? [] : addSkillChips(lens, plan?.offers ?? null);
  const chosen = chips.filter(
    (chip) => chip.act !== null && (picked === null ? chip.preselected : picked.has(chip.provider)),
  );
  // pass 24's hint: who cannot take it, and whose taking reaches further than this profile
  const notes = chips
    .filter((chip) => chip.act === null || chip.act.reaches.length > 0)
    .map((chip) => chip.why);
  const ready =
    problem === null && plan !== null && planError === null && !adding && onAdd !== undefined;
  const running =
    lens?.run !== undefined &&
    plan !== null &&
    lens.run.name === plan.name &&
    (adding || lens.run.state === "running");
  const keptIn = plan?.folder.replace(/\/[^/]+$/u, "") ?? lens?.library;
  return (
    <form
      className="vf-agents vf-agents-page vf-ext-page vf-ext-add"
      data-ext-add-skill=""
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onAdd?.({ from: source, agents: chosen.map((chip) => chip.provider) });
      }}
    >
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        Add a skill {where}
      </h2>
      <ErrorNotice error={error} />
      <section className={borderCls}>
        <SettingsRow
          title="Folder"
          description="A folder on this Mac with a SKILL.md inside"
          divider={plan !== null}
        >
          <input
            ref={fieldRef}
            className={`${fieldCls} vf-ext-add-field vf-ext-mono`}
            value={from}
            spellCheck={false}
            placeholder="~/Downloads/changelog-writer"
            aria-label="Folder"
            disabled={adding}
            onChange={(event) => setFrom(event.target.value)}
          />
        </SettingsRow>
        {plan !== null && (
          <SettingsRow
            title={plan.name}
            description={plan.description ?? "Its SKILL.md says nothing of what it does"}
            divider={false}
          >
            <span className="vf-ext-add-found" data-ext-found="">
              A skill
            </span>
          </SettingsRow>
        )}
      </section>
      <p className="vf-ext-quiet vf-ext-add-hint">
        VibeField copies it into {profile}’s skills folder
        {keptIn !== undefined && (
          <>
            , <code className="vf-ext-code">{keptIn}</code>
          </>
        )}
        , so the agents share one copy and an edit is made once.
      </p>
      <SettingsSection
        title="Turn on for"
        description={`${notes.length === 0 ? "" : `${notes.join("; ")}. `}You can change any of them later, one agent at a time.`}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs */}
        <div className="vf-ext-chips" role="group" aria-label="Turn on for">
          {chips.map((chip) => {
            const on = chosen.includes(chip);
            return (
              <button
                key={chip.provider}
                type="button"
                className={`vf-ext-chip${on ? " vf-ext-chip--on" : ""}`}
                aria-pressed={on}
                disabled={chip.act === null || adding}
                title={chip.why}
                onClick={() => {
                  const next = new Set(chosen.map((candidate) => candidate.provider));
                  if (on) next.delete(chip.provider);
                  else next.add(chip.provider);
                  setPicked(next);
                }}
              >
                <span className="vf-ext-chip-mark" aria-hidden="true">
                  <AgentIcon providerId={chip.provider} />
                </span>
                {chip.label}
              </button>
            );
          })}
        </div>
        <div className="vf-ext-runs" data-ext-runs="">
          <span className={labelCls}>Runs</span>
          {plan === null ? (
            <code className="vf-ext-code">nothing yet: name a folder</code>
          ) : (
            <>
              <code className="vf-ext-code">
                <i>VibeField</i> copy {source} → {plan.folder}
              </code>
              {chosen.flatMap((chip) =>
                (chip.act?.runs ?? "").split("\n").map((line, index) => (
                  <code key={`${chip.provider}:${index}`} className="vf-ext-code">
                    <i>{index === 0 ? chip.label : ""}</i> {line}
                  </code>
                )),
              )}
            </>
          )}
        </div>
      </SettingsSection>
      <ErrorNotice error={planError} />
      {running && lens?.run !== undefined && <RunCard run={lens.run} now={now} />}
      <div className="vf-profiles-foot">
        {problem !== null && !adding && <span className={labelCls}>{problem}</span>}
        <UiButton onClick={onCancel} disabled={adding}>
          Cancel
        </UiButton>
        <UiButton type="submit" variant="primary" disabled={!ready}>
          {adding ? "Adding…" : "Add skill"}
        </UiButton>
      </div>
    </form>
  );
}
