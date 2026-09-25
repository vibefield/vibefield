import type { TerminalConfigDiagnostic } from "@vibefield/contracts";
import { SegmentedControl, UiButton } from "@vibefield/design-kit";
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from "react";
import { labelCls } from "../settings-ui";
import { type ConfigLine, parseConfigLines, preferredNewline } from "./config-text";
import { KEY_BY_NAME, KEY_COUNTS, KEY_ENTRIES, KEY_GROUPS } from "./ghostty-key-groups";
import { GHOSTTY_KEYS_SOURCE } from "./ghostty-keys.generated";
import { DeviceUnavailable } from "./LookTab";
import type { TerminalPageModel } from "./page-model";
import { PageSection } from "./parts";

// Settings → Terminal → Config file (GT-7): config.ghostty itself, for what the
// controls don't cover. Every mark in the gutter is the LOADER's (ghosttea's
// validator, through `terminal.config.validate`), placed on the line it names;
// the page adds only what it can see in the text alone — a key the file sets
// twice, and a key ghosttea keeps without drawing.

export type MarkKind = "error" | "warning" | "info" | "kept" | "shadow";

export interface LineMark {
  readonly kind: MarkKind;
  readonly message: string;
  readonly code?: string;
}

const RANK: Record<MarkKind, number> = { error: 5, warning: 4, info: 3, shadow: 2, kept: 1 };

/** Keys a file may set many times on purpose; every other key's last line wins. */
const REPEATABLE = new Set(["font-family", "custom-shader", "keybind", "palette", "config-file"]);

function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && a.replace(/\/+$/u, "") === b.replace(/\/+$/u, "");
}

/** The loader's diagnostics, placed on this document's lines. A diagnostic
 * from another layer (the user's Ghostty file) belongs to that file and is
 * listed, not marked; one the loader gives no line (`recognized-not-applied`)
 * marks every line that sets its key. */
export function lineMarks(
  lines: readonly ConfigLine[],
  diagnostics: readonly TerminalConfigDiagnostic[],
  documentPath: string,
): Map<number, LineMark[]> {
  const marks = new Map<number, LineMark[]>();
  const add = (line: number, mark: LineMark): void => {
    const list = marks.get(line) ?? [];
    list.push(mark);
    marks.set(line, list);
  };
  for (const diagnostic of diagnostics) {
    const kind: MarkKind =
      diagnostic.severity === "error"
        ? "error"
        : diagnostic.severity === "warning"
          ? "warning"
          : "info";
    const mark = { kind, message: diagnostic.message, code: diagnostic.code };
    if (diagnostic.line !== undefined && samePath(diagnostic.source, documentPath)) {
      add(diagnostic.line, mark);
    } else if (
      diagnostic.line === undefined &&
      diagnostic.source === undefined &&
      diagnostic.key !== undefined
    ) {
      for (const line of lines)
        if (line.kind === "setting" && line.key === diagnostic.key) add(line.number, mark);
    }
  }
  const lastValid = new Map<string, number>();
  for (const line of lines) {
    if (line.kind !== "setting" || line.key === undefined || REPEATABLE.has(line.key)) continue;
    if ((marks.get(line.number) ?? []).some((mark) => mark.kind === "error")) continue;
    lastValid.set(line.key, line.number);
  }
  for (const line of lines) {
    if (line.kind !== "setting" || line.key === undefined || marks.has(line.number)) continue;
    const later = lastValid.get(line.key);
    if (later !== undefined && later !== line.number && !REPEATABLE.has(line.key)) {
      add(line.number, {
        kind: "shadow",
        message: `Line ${later} sets ${line.key} again, and the later line wins.`,
      });
      continue;
    }
    const entry = KEY_BY_NAME.get(line.key);
    if (entry?.support === "parsed" && entry.note !== null)
      add(line.number, { kind: "kept", message: entry.note.note });
  }
  for (const [line, list] of marks)
    marks.set(
      line,
      list.sort((a, b) => RANK[b.kind] - RANK[a.kind]),
    );
  return marks;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

const SOURCE_WORDS: Record<string, string> = {
  "ghostty-default": "Your Ghostty file",
  included: "Included",
  "ghosttea-overlay": "config.ghostty — this page",
};

function Highlighted({ line }: { line: ConfigLine }): ReactNode {
  if (line.kind === "comment") return <span className="vf-ts-hl-comment">{line.raw}</span>;
  if (line.kind === "setting" && line.key !== undefined) {
    const separator = line.raw.indexOf("=");
    return (
      <>
        <span className="vf-ts-hl-key">{line.raw.slice(0, separator)}</span>
        <span className="vf-ts-hl-eq">=</span>
        <span className="vf-ts-hl-value">{line.raw.slice(separator + 1)}</span>
      </>
    );
  }
  return line.raw;
}

type SupportFilter = "All" | "Applied" | "Parsed" | "Ignored";
const SUPPORT_FILTERS: readonly SupportFilter[] = ["All", "Applied", "Parsed", "Ignored"];

export function ConfigFileTab({ model }: { model: TerminalPageModel }): ReactElement {
  const { device } = model;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [support, setSupport] = useState<SupportFilter>("All");
  const ready = device.kind === "ready" ? device : null;
  const lines = useMemo(() => (ready === null ? [] : parseConfigLines(ready.draft)), [ready]);
  const diagnostics = ready?.snapshot?.diagnostics ?? [];
  const marks = useMemo(
    () =>
      ready === null ? new Map<number, LineMark[]>() : lineMarks(lines, diagnostics, ready.path),
    [lines, diagnostics, ready],
  );

  if (ready === null) {
    return (
      <div className="vf-ts-tab" data-tab="file">
        <PageSection id="file" title="config.ghostty" scope="mac" when="after-save">
          <DeviceUnavailable model={model} />
        </PageSection>
      </div>
    );
  }

  const own = diagnostics.filter(
    (diagnostic) => samePath(diagnostic.source, ready.path) || diagnostic.source === undefined,
  );
  const inherited = diagnostics.filter(
    (diagnostic) => diagnostic.source !== undefined && !samePath(diagnostic.source, ready.path),
  );
  const count = (severity: string): number => own.filter((d) => d.severity === severity).length;
  const errors = count("error");
  const warnings = count("warning");
  const notes = count("info");
  const blocking = ready.validation?.blocking ?? [];
  const includesRefused = ready.validation !== null && !ready.validation.includesAllowed;

  const jumpTo = (lineNumber: number): void => {
    const element = textarea.current;
    if (element === null) return;
    const text = element.value.split(/\r\n|\r|\n/u);
    let offset = 0;
    for (let index = 0; index < lineNumber - 1 && index < text.length; index += 1) {
      offset += (text[index]?.length ?? 0) + 1;
    }
    element.focus();
    element.setSelectionRange(offset, offset + (text[lineNumber - 1]?.length ?? 0));
  };
  const addKey = (key: string): void => {
    const newline = preferredNewline(ready.draft);
    const body = ready.draft.replace(/(\r\n|\r|\n)*$/u, "");
    model.setDraft(`${body}${body === "" ? "" : newline}${key} = ${newline}`);
    requestAnimationFrame(() => jumpTo(body === "" ? 1 : body.split(/\r\n|\r|\n/u).length + 1));
  };

  const referenceNeedle = referenceQuery.trim().toLowerCase();
  const reference = KEY_ENTRIES.filter(
    (entry) =>
      (support === "All" ||
        (support === "Applied" && entry.support === "applied") ||
        (support === "Parsed" && entry.support === "parsed") ||
        (support === "Ignored" && entry.support === "unsupported")) &&
      (referenceNeedle === "" ||
        entry.key.includes(referenceNeedle) ||
        entry.group.label.toLowerCase().includes(referenceNeedle)),
  );

  return (
    <div className="vf-ts-tab" data-tab="file">
      <PageSection
        id="file-editor"
        title="config.ghostty"
        scope="mac"
        when="after-save"
        description="Loaded after your own Ghostty file, so a line here wins. Settings writes its controls into the managed block; every other line stays exactly as you wrote it."
        action={
          <>
            <UiButton onClick={model.onImport}>Import file…</UiButton>
            <UiButton onClick={model.onExport}>Export…</UiButton>
            <UiButton onClick={model.onReveal}>Show in Finder</UiButton>
          </>
        }
      >
        <p className={`vf-ts-path ${labelCls}`} title={ready.path}>
          <span className="vf-ui-mono">{ready.path}</span>
          {ready.exists ? "" : " — not created yet; saving creates it"}
        </p>
        {ready.blockMalformed && (
          <p className="vf-ts-notice" data-tone="attention" role="status">
            The managed block's start or end line is missing or repeated, so the page's controls
            can't write it. Fix the markers here, or remove them to let Settings start a new block.
          </p>
        )}
        {includesRefused && (
          <p className="vf-ts-notice" data-tone="attention" role="status">
            This text changes which files config.ghostty includes. Settings can keep includes
            exactly as they are, or remove them all — to change them, edit the file itself (Show in
            Finder). It wasn't checked, so nothing is marked below.
          </p>
        )}
        <div className="vf-ts-editor">
          <div className="vf-ts-editor-scroll">
            <div className="vf-ts-editor-gutter" aria-hidden="true">
              {(lines.length === 0 ? [{ number: 1 } as ConfigLine] : lines).map((line) => {
                const top = marks.get(line.number)?.[0];
                return (
                  <span key={line.number} data-mark={top?.kind} title={top?.message}>
                    {line.number}
                  </span>
                );
              })}
            </div>
            <div className="vf-ts-editor-body">
              <pre className="vf-ts-editor-highlight" aria-hidden="true">
                {lines.map((line) => (
                  <span
                    key={line.number}
                    className={line.managed ? "is-managed" : undefined}
                    data-mark={marks.get(line.number)?.[0]?.kind}
                  >
                    <Highlighted line={line} />
                    {"\n"}
                  </span>
                ))}
              </pre>
              <textarea
                ref={textarea}
                className="vf-ts-editor-input"
                value={ready.draft}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                rows={Math.max(8, lines.length + 1)}
                aria-label="config.ghostty"
                onChange={(event) => model.setDraft(event.currentTarget.value)}
              />
            </div>
          </div>
        </div>
      </PageSection>

      <PageSection
        id="file-check"
        title="Check"
        description={
          ready.checking
            ? "Checking with ghosttea's loader…"
            : errors + warnings + notes === 0
              ? "ghosttea's loader reads this file without a complaint."
              : `${errors} ${errors === 1 ? "error" : "errors"} · ${warnings} ${warnings === 1 ? "warning" : "warnings"} · ${notes} ${notes === 1 ? "note" : "notes"}${blocking.length > 0 ? " — errors keep Save off" : ""}`
        }
      >
        {own.length > 0 && (
          <ul className="vf-ts-diagnostics">
            {own.map((diagnostic, index) => (
              <li key={index} data-severity={diagnostic.severity}>
                <span className="vf-ts-diagnostic-dot" aria-hidden="true" />
                <span className="vf-ts-diagnostic-text">{diagnostic.message}</span>
                {diagnostic.line !== undefined ? (
                  <button
                    type="button"
                    className="vf-ts-linkish"
                    onClick={() => jumpTo(diagnostic.line ?? 1)}
                  >
                    line {diagnostic.line}
                  </button>
                ) : diagnostic.key !== undefined ? (
                  <code className={labelCls}>{diagnostic.key}</code>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {inherited.length > 0 && (
          <>
            <div className="vf-ts-eyebrow">
              From other files — they never block a save unless this file repeats them
            </div>
            <ul className="vf-ts-diagnostics">
              {inherited.map((diagnostic, index) => (
                <li key={index} data-severity={diagnostic.severity}>
                  <span className="vf-ts-diagnostic-dot" aria-hidden="true" />
                  <span className="vf-ts-diagnostic-text">{diagnostic.message}</span>
                  <code className={labelCls} title={diagnostic.source}>
                    {basename(diagnostic.source ?? "")}
                    {diagnostic.line !== undefined ? `:${diagnostic.line}` : ""}
                  </code>
                </li>
              ))}
            </ul>
          </>
        )}
        {ready.snapshot !== null && (
          <>
            <div className="vf-ts-eyebrow">Loaded in this order</div>
            <ol className="vf-ts-sources">
              <li>
                <span>Ghostty's defaults</span>
                <span className={labelCls}>
                  built into ghosttea (Ghostty {ready.snapshot.ghosttyVersion})
                </span>
              </li>
              {ready.snapshot.sources.map((source) => (
                <li key={`${source.kind}:${source.path}`}>
                  <span>{SOURCE_WORDS[source.kind] ?? source.kind}</span>
                  <span className={`vf-ui-mono ${labelCls}`} title={source.path}>
                    {source.path}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </PageSection>

      <PageSection
        id="file-reference"
        title="Every Ghostty key"
        scope="fact"
        description={`The ${KEY_COUNTS.known} keys of Ghostty ${GHOSTTY_KEYS_SOURCE.ghostty}, and what ghosttea ${GHOSTTY_KEYS_SOURCE.version} does with each: ${KEY_COUNTS.applied} applied, ${KEY_COUNTS.parsed} kept without drawing, ${KEY_COUNTS.unsupported} ignored.`}
        action={
          <SegmentedControl
            options={SUPPORT_FILTERS}
            value={support}
            onChange={setSupport}
            label="Show keys"
            size="small"
          />
        }
      >
        <input
          type="search"
          className="vf-ui-field vf-ts-reference-search"
          placeholder={`Search ${KEY_COUNTS.known} keys`}
          value={referenceQuery}
          onChange={(event) => setReferenceQuery(event.currentTarget.value)}
          aria-label="Search Ghostty keys"
        />
        <div className="vf-ts-reference">
          {KEY_GROUPS.map((group) => {
            const entries = reference.filter((entry) => entry.group.id === group.id);
            if (entries.length === 0) return null;
            return (
              <section key={group.id} aria-label={group.label}>
                <div className="vf-ts-eyebrow">{group.label}</div>
                {entries.map((entry) => (
                  <div
                    key={entry.key}
                    className="vf-ts-reference-row"
                    data-ts-anchor={`ref-${entry.key}`}
                  >
                    <code>{entry.key}</code>
                    <span className="vf-ts-tag" data-support={entry.support}>
                      {entry.support === "applied"
                        ? "Applied"
                        : entry.support === "parsed"
                          ? "Kept"
                          : "Ignored"}
                    </span>
                    <span className={labelCls}>
                      {entry.note?.note ??
                        (entry.support === "unsupported" ? "Recognized, not applied yet." : "")}
                    </span>
                    <UiButton
                      onClick={() => addKey(entry.key)}
                      aria-label={`Add a ${entry.key} line`}
                    >
                      Add
                    </UiButton>
                  </div>
                ))}
              </section>
            );
          })}
          {reference.length === 0 && <p className={labelCls}>No key matches “{referenceQuery}”.</p>}
        </div>
      </PageSection>
    </div>
  );
}
