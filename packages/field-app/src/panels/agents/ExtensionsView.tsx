import { AgentIcon } from "@vibecook/puppeteer-views";
import type { AgentsExtensionsListResult } from "@vibefield/contracts";
import { InlineNotice, UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { SettingsSection } from "../settings-ui";
import {
  builtFromWords,
  type ExtensionCell,
  type ExtensionGridModel,
  type ExtensionKindKey,
  extensionGrid,
  extensionKindTitle,
  holdingWords,
  readWords,
} from "./extensions-model";

// Extensions on a profile's page (AR-S4b; the design record's pass 24, L2 —
// the grid). Controller-free, so the catalog mounts the shipping composition
// on fixtures. Two sections, MCP servers and skills, each a table: a row per
// name some agent holds as its own, a column per agent, a cell saying what
// that agent holds. Read-only in this slice — every cell's sentence is its
// title — and a row opens in place to show each agent's own holding.

const KINDS: ExtensionKindKey[] = ["servers", "skills"];

function Glyph({ name }: { name: "check" | "plugin" | "folder" | "globe" | "prompt" | "skill" }) {
  const paths: Record<typeof name, ReactElement> = {
    check: <path d="M4.5 10.5l3.2 3.2 7.8-7.8" />,
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
    skill: <path d="M6 3.5h6l3 3v10H6zM12 3.5v3h3M8.5 10h4M8.5 13h4" />,
  };
  return (
    <svg className="vf-ext-glyph" viewBox="0 0 20 20" aria-hidden="true">
      {paths[name]}
    </svg>
  );
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

function ExtensionGridView({
  lens,
  model,
}: {
  lens: AgentsExtensionsListResult;
  model: ExtensionGridModel;
}): ReactElement {
  const [open, setOpen] = useState<string | null>(null);
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
            const expanded = open === row.name;
            return [
              <tr key={row.name} data-ext-row={row.name}>
                <th scope="row">
                  <button
                    type="button"
                    className="vf-ext-name"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : row.name)}
                  >
                    <span className="vf-ext-name-glyph">
                      <Glyph name={row.glyph} />
                    </span>
                    <span className="vf-ext-name-text">
                      <b>{row.name}</b>
                      <small>
                        {[
                          row.twoVersions ? (
                            <span key="two" className="vf-ext-attn">
                              Two versions
                            </span>
                          ) : null,
                          row.factCode !== "" ? (
                            <code key="code" className="vf-ext-code">
                              {row.factCode}
                            </code>
                          ) : null,
                          row.factText !== "" ? <span key="text">{row.factText}</span> : null,
                        ]
                          .filter((part) => part !== null)
                          .flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}
                      </small>
                    </span>
                  </button>
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
              </tr>,
              expanded ? (
                <tr key={`${row.name}:detail`} className="vf-ext-detail">
                  <td colSpan={model.heads.length + 1}>
                    <ul>
                      {row.holdings.flatMap(({ provider, label, items }) =>
                        items.map((item) => {
                          const words = holdingWords(lens, item);
                          return (
                            <li key={`${provider}:${item.id}`}>
                              <span className="vf-ext-detail-mark" aria-hidden="true">
                                <AgentIcon providerId={provider} />
                              </span>
                              <span>
                                <b>{label}</b> · {words.origin}
                                {words.detail !== "" && (
                                  <span className="vf-ext-detail-fact">{words.detail}</span>
                                )}
                                {words.place !== undefined && (
                                  <span className="vf-ext-detail-fact">{words.place}</span>
                                )}
                              </span>
                            </li>
                          );
                        }),
                      )}
                    </ul>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface ProfileExtensionsViewProps {
  /** The lens; null while the first frame is on its way. */
  lens: AgentsExtensionsListResult | null;
  /** The profile's name, for the words. */
  profile: string;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  now?: Date;
}

/** The two lists on a profile's page: its agents' MCP servers and skills. */
export function ProfileExtensionsView({
  lens,
  profile,
  error = null,
  refreshing = false,
  onRefresh,
  now,
}: ProfileExtensionsViewProps): ReactElement {
  const reading = lens === null || lens.reading;
  const refresh =
    onRefresh === undefined ? undefined : (
      <UiButton
        disabled={refreshing || reading}
        aria-busy={refreshing || reading}
        onClick={onRefresh}
      >
        {refreshing || reading ? "Reading…" : "Read again"}
      </UiButton>
    );
  const notice =
    error === null ? null : (
      <InlineNotice tone="error" role="alert">
        {error}
      </InlineNotice>
    );
  if (lens === null && error !== null) {
    return (
      <div className="vf-ext" data-profile-extensions="">
        {notice}
      </div>
    );
  }
  if (lens === null || (lens.reading && lens.readAt === undefined)) {
    return (
      <div className="vf-ext" data-profile-extensions="" aria-busy="true">
        {notice}
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
      {notice}
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
              <ExtensionGridView lens={lens} model={model} />
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
