import {
  type TerminalConfigDiagnostic,
  TerminalConfigDocument,
  TerminalConfigWriteResult,
} from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { buttonCls, labelCls, SettingsSection } from "./settings-ui";

// The terminal's configuration, as the file it actually is (GT-3 rider).
//
// This is a RAW editor and not a form on purpose. The file is Ghostty syntax —
// a large, documented, evolving key space that this app does not own — and a
// form over it would be a second, smaller, always-stale vocabulary that
// silently drops the keys it had not heard of. The daemon owns the file; the
// panel owns showing it honestly and saying what the loader thought.
//
// Every state here is a fact from the daemon: the path it resolved, the
// revision the text was read at, and after a save the loader's own verdict.
// Nothing is optimistic — an applied save re-reads the document it was answered
// with rather than assuming the editor's text is now the file (the settings
// undo affordance's no-optimistic-echo rule, DESIGN.md §8).

/** The stack DESIGN.md §3 reserves for data, paths, and ids. */
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

/** What the panel is currently able to say. `unavailable` is a floor state, not
 * a failure of this surface — a daemon that cannot be asked has an honest face
 * (DESIGN.md §8: a state is rendered, never blank space). */
type Load =
  | { kind: "loading" }
  | { kind: "ready"; path: string; revision: string; exists: boolean }
  | { kind: "unavailable"; reason: string };

/** The outcome of the last save, in the words it earned. */
type Verdict =
  | { kind: "none" }
  | { kind: "saving" }
  | { kind: "saved"; changed: boolean; diagnostics: readonly TerminalConfigDiagnostic[] }
  | { kind: "conflict" }
  | { kind: "failed"; reason: string };

/** DESIGN.md §2.5: red is failure, orange is needs-attention, and anything the
 * loader merely noticed takes the muted ramp with no hue at all. */
function diagnosticColor(severity: string): string | undefined {
  if (severity === "error") return "var(--vf-red)";
  if (severity === "warning") return "var(--vf-orange)";
  return undefined;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function TerminalSection(): ReactElement {
  const client = useFielddClient();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [verdict, setVerdict] = useState<Verdict>({ kind: "none" });
  /** The editor's text, and the text it was loaded with. Two values rather than
   * a dirty flag: "has this changed" must survive a save that answers with
   * different bytes than were sent (it cannot today, but the file is the
   * daemon's and the editor should not be the one assuming otherwise). */
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState("");

  const read = useCallback(async (): Promise<void> => {
    setLoad({ kind: "loading" });
    try {
      const document = TerminalConfigDocument.parse(
        await client.request("terminal.config.read", {}),
      );
      setLoad({
        kind: "ready",
        path: document.path,
        revision: document.revision,
        exists: document.exists,
      });
      setText(document.text);
      setLoaded(document.text);
      setVerdict({ kind: "none" });
    } catch (error) {
      setLoad({ kind: "unavailable", reason: message(error) });
    }
  }, [client]);

  useEffect(() => {
    void read();
  }, [read]);

  const save = async (): Promise<void> => {
    if (load.kind !== "ready") return;
    setVerdict({ kind: "saving" });
    try {
      const result = TerminalConfigWriteResult.parse(
        await client.request("terminal.config.write", { text, revision: load.revision }),
      );
      // The document the daemon answered with IS the new truth — including the
      // revision the next save has to carry.
      setLoad({
        kind: "ready",
        path: result.document.path,
        revision: result.document.revision,
        exists: result.document.exists,
      });
      setText(result.document.text);
      setLoaded(result.document.text);
      setVerdict({
        kind: "saved",
        changed: result.effectiveChanged,
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      // A conflict is the one refusal with a next action, so it gets its own
      // state and its own sentence instead of a transport error's wording. The
      // daemon's classification is read from the error's kind, never guessed
      // from its prose.
      if (error instanceof FielddRpcError && error.kind === "CONFLICT") {
        setVerdict({ kind: "conflict" });
      } else {
        setVerdict({ kind: "failed", reason: message(error) });
      }
    }
  };

  if (load.kind === "unavailable") {
    return (
      <SettingsSection
        title="Terminal configuration"
        description="Ghostty-syntax settings that every terminal on this device loads."
      >
        <div className="py-2 text-[13px] text-black/70 dark:text-white/70">
          The terminal configuration is unavailable.
        </div>
        <div className={`pb-3 ${labelCls}`} style={{ fontFamily: MONO }}>
          {load.reason}
        </div>
        <button type="button" className={buttonCls} onClick={() => void read()}>
          Try again
        </button>
      </SettingsSection>
    );
  }

  const busy = verdict.kind === "saving";
  const dirty = text !== loaded;
  return (
    <SettingsSection
      title="Terminal configuration"
      description="Ghostty-syntax settings that every terminal on this device loads. Your existing Ghostty config files are imported first; this file refines them."
    >
      <div className={`pb-2 ${labelCls}`} style={{ fontFamily: MONO }}>
        {load.kind === "loading"
          ? "reading…"
          : `${load.path}${load.exists ? "" : " · not created yet"}`}
      </div>
      <textarea
        aria-label="Terminal configuration"
        spellCheck={false}
        disabled={load.kind === "loading" || busy}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="h-64 w-full resize-y rounded-[12px] border border-black/10 bg-white p-3 text-[12px] leading-5 text-black/80 outline-none transition-[border-color,box-shadow] focus:border-black/25 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/85 dark:focus:border-white/25 dark:focus:shadow-[0_0_0_3px_rgba(255,255,255,0.07)]"
        style={{ fontFamily: MONO }}
      />
      <div className="flex items-center justify-between gap-4 pt-3">
        <div aria-live="polite" className="min-w-0 flex-1">
          <VerdictLine verdict={verdict} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={buttonCls}
            disabled={busy || !dirty}
            onClick={() => {
              setText(loaded);
              setVerdict({ kind: "none" });
            }}
          >
            Revert
          </button>
          <button
            type="button"
            className={buttonCls}
            disabled={busy || load.kind === "loading" || !dirty}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

function VerdictLine({ verdict }: { verdict: Verdict }): ReactElement | null {
  if (verdict.kind === "none" || verdict.kind === "saving") return null;
  if (verdict.kind === "conflict") {
    return (
      <span className="text-[12px]" style={{ color: "var(--vf-orange)" }}>
        The file changed since it was read. Reopen this page to see it before saving again.
      </span>
    );
  }
  if (verdict.kind === "failed") {
    return (
      <span className="text-[12px]" style={{ color: "var(--vf-red)" }}>
        {verdict.reason}
      </span>
    );
  }
  // Saved. What the loader made of it is the news, not the fact that bytes were
  // written — and "nothing changed" is worth saying, because a comment-only
  // edit reloads honestly and restyles nothing.
  return (
    <span className="flex flex-col gap-0.5">
      <span className={labelCls}>
        {verdict.changed
          ? "Saved and reloaded · every session picked it up"
          : "Saved · nothing in the effective configuration changed"}
      </span>
      {verdict.diagnostics.map((diagnostic) => (
        <span
          key={`${diagnostic.code}:${diagnostic.source ?? ""}:${diagnostic.line ?? ""}:${diagnostic.message}`}
          className="text-[12px]"
          style={{ color: diagnosticColor(diagnostic.severity) }}
        >
          {/* WHICH FILE, whenever the loader named one. A reload reports on
              every config it read, and the user's own imported Ghostty files
              are among them — so a warning about a shader nobody edited here
              can arrive from a save of this file. Without the source that reads
              as this editor's fault; with it, it is a fact about a neighbour
              (DESIGN.md §9: states carry provenance). */}
          {diagnostic.source !== undefined && diagnostic.source !== "" && (
            <span style={{ fontFamily: MONO }}>
              {diagnostic.source.split("/").pop()}
              {" · "}
            </span>
          )}
          {diagnostic.line !== undefined && (
            <span className="tabular-nums" style={{ fontFamily: MONO }}>
              line {diagnostic.line}
              {" · "}
            </span>
          )}
          {diagnostic.message}
        </span>
      ))}
    </span>
  );
}
