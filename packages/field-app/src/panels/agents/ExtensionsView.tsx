import { AgentIcon } from "@vibecook/puppeteer-views";
import type { AgentProfileSet, AgentsExtensionsListResult } from "@vibefield/contracts";
import { InlineNotice, UiButton } from "@vibefield/design-kit/primitives";
import { Fragment, type ReactElement, type ReactNode } from "react";
import type { SettingsSubpage } from "../SettingsDialog";
import { borderCls, SettingsSection } from "../settings-ui";
import {
  type AgentListItem,
  type AgentListKey,
  agentExtensions,
  agentList,
  agentListTitle,
  builtFromWords,
  type ExtensionCell,
  type ExtensionGridModel,
  type ExtensionKindKey,
  extensionGrid,
  extensionItem,
  extensionKindTitle,
  readWords,
} from "./extensions-model";
import { ProfileMark } from "./ProfilesView";

// Extensions' views (AR-S4b), controller-free, so the catalog mounts the
// shipping composition on fixtures. On a profile's page, pass 24's L2 grid:
// MCP servers and skills, a row per name some agent holds as its own, a
// column per agent, a cell saying what that agent holds — a row's name opens
// that server's or skill's own page. On an agent's page in a profile, pass
// 23's three rows — Plugins, MCP servers, Skills — each opening the agent's
// own list. Read-only in this slice: every cell and row says what the agent
// holds, and the acts arrive with S4c.

const KINDS: ExtensionKindKey[] = ["servers", "skills"];

/** The design kit's names for these marks (pass 23 and 24 draw the kit's
 * plugin, globe and snippets): every icon here is drawn by this one component. */
type GlyphName = "check" | "chevron" | "plugin" | "folder" | "globe" | "prompt" | "snippets";

function Glyph({ name, className = "vf-ext-glyph" }: { name: GlyphName; className?: string }) {
  const paths: Record<GlyphName, ReactElement> = {
    check: <path d="M4.5 10.5l3.2 3.2 7.8-7.8" />,
    chevron: <path d="m7.5 5 5 5-5 5" />,
    plugin: (
      <path d="M7 4.5h2.5a1.5 1.5 0 013 0H15v3a1.5 1.5 0 010 3v3.5h-3.5a1.5 1.5 0 00-3 0H5v-3.5a1.5 1.5 0 010-3V4.5h2z" />
    ),
    folder: <path d="M3.5 6.5v8h13v-7h-6.5l-1.5-1.5h-5z" />,
    globe: (
      <>
        <circle cx="10" cy="10" r="6.5" />
        <path d="M3.5 10h13M10 3.5c-2 2-2 11 0 13M10 3.5c2 2 2 11 0 13" />
      </>
    ),
    prompt: <path d="M4.5 6.5l3.5 3.5-3.5 3.5M10 14h5.5" />,
    snippets: <path d="M6 3.5h6l3 3v10H6zM12 3.5v3h3M8.5 10h4M8.5 13h4" />,
  };
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** The door's chevron, stroked by this file's sheet so no other sheet's glyph rules reach it. */
function Chevron(): ReactElement {
  return <Glyph name="chevron" className="vf-ext-chevron" />;
}

function CellMark({ cell }: { cell: ExtensionCell }): ReactElement {
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

function ExtensionGridView({
  model,
  onOpenItem,
}: {
  model: ExtensionGridModel;
  onOpenItem?: ((key: ExtensionKindKey, name: string) => void) | undefined;
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
                {row.cells.map(({ provider, cell }) => {
                  const label =
                    model.heads.find((head) => head.provider === provider)?.label ?? provider;
                  return (
                    <td
                      key={provider}
                      title={cell.why}
                      aria-label={`${row.name} for ${label}: ${cell.why}`}
                    >
                      <CellMark cell={cell} />
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

/** Before the first read has answered there is nothing to draw but that. */
const firstRead = (lens: AgentsExtensionsListResult | null): boolean =>
  lens === null || (lens.reading && lens.readAt === undefined);

export interface ProfileExtensionsViewProps {
  /** The lens; null while the first frame is on its way. */
  lens: AgentsExtensionsListResult | null;
  /** The profile's name, for the words. */
  profile: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** A row's name opens that server's or skill's page. */
  onOpenItem?: (key: ExtensionKindKey, name: string) => void;
  now?: Date;
}

/** The two lists on a profile's page: its agents' MCP servers and skills. */
export function ProfileExtensionsView({
  lens,
  profile,
  error = null,
  refreshing = false,
  onRefresh,
  onOpenItem,
  now,
}: ProfileExtensionsViewProps): ReactElement {
  const reading = refreshing || lens === null || lens.reading;
  const refresh = <ReadAgain reading={reading} onRefresh={onRefresh} />;
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
        return (
          <SettingsSection
            key={key}
            title={extensionKindTitle(key)}
            description={
              key === "servers"
                ? `What each of ${profile}’s agents connects to, as the agent itself holds it`
                : `What each of ${profile}’s agents loads, from where the agent itself looks`
            }
            action={index === 0 ? refresh : undefined}
            className={`vf-ext-section vf-ext-section--${key}`}
          >
            {model.empty !== null ? (
              <p className="vf-ext-quiet">{model.empty}</p>
            ) : (
              <ExtensionGridView model={model} onOpenItem={onOpenItem} />
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
    </div>
  );
}

/* ── one agent in a profile: its Extensions rows (pass 23) ─────────────────── */

export interface AgentExtensionsViewProps {
  lens: AgentsExtensionsListResult | null;
  provider: string;
  error?: string | null;
  /** A row opens the agent's own list of that kind. */
  onOpen?: (key: AgentListKey) => void;
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
                    onClick={() => onOpen(row.key)}
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

function ItemRow({ item }: { item: AgentListItem }): ReactElement {
  return (
    <div className="vf-ext-item" data-ext-item={item.key}>
      <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
        {item.initial !== undefined ? (
          <span className="vf-ext-initial">{item.initial}</span>
        ) : (
          <Glyph name={item.glyph} />
        )}
      </span>
      <span className="vf-ext-item-text">
        <b>{item.name}</b>
        {(item.code !== "" || item.text !== "") && (
          <small>
            <FactLine code={item.code} text={item.text} />
          </small>
        )}
      </span>
      <span className={`vf-ext-item-state${item.attention ? " vf-ext-attn" : ""}`}>
        {item.state}
      </span>
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
  now,
}: AgentExtensionListViewProps): ReactElement {
  const model = lens === null || firstRead(lens) ? null : agentList(lens, provider, list, where);
  const title = agentListTitle(list);
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
                  {section.items.map((item) => (
                    <ItemRow key={item.key} item={item} />
                  ))}
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
  now,
}: ExtensionItemViewProps): ReactElement {
  const model = lens === null || firstRead(lens) ? null : extensionItem(lens, list, name);
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
                  <CellMark cell={agent.cell} />
                  {agent.state}
                </span>
              </div>
            ))}
          </div>
        </SettingsSection>
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

/* ── the Settings header for these pages ───────────────────────────────────── */

/** An agent's own list names itself by the kind, under the agent and its profile. */
export function agentListSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  list: AgentListKey,
  onBack: () => void,
): SettingsSubpage {
  return {
    title: agentListTitle(list),
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
