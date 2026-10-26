import { SegmentedControl, UiButton } from "@vibefield/design-kit";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { labelCls, SettingsRow, SettingsSwitch } from "../settings-ui";
import { parseConfigLines } from "./config-text";
import {
  actionLabel,
  bindingLine,
  defaultBindings,
  flaggedTrigger,
  KEYBOARD_GROUP_ORDER,
  type KeyboardRow,
  keyboardRows,
  reservedWords,
  routeWords,
  splitBinding,
  triggerFromKeyEvent,
  triggerKey,
} from "./keyboard-model";
import { DeviceUnavailable } from "./LookTab";
import type { TerminalPageModel } from "./page-model";
import { Keycaps, PageSection } from "./parts";

// Settings → Terminal → Keyboard (GT-7): Ghostty's shortcuts as this Mac's
// terminals will run them. The rows are the loader's effective list (the
// draft's, once checked) laid over Ghostty's defaults; an edit writes only a
// DIFFERENCE into the managed block — a new chord, or `unbind` for one — so the
// user's own Ghostty-file bindings stay theirs.

type Filter = "All" | "Changed" | "VibeField's" | "Not in ghosttea yet";
const FILTERS: readonly Filter[] = ["All", "Changed", "VibeField's", "Not in ghosttea yet"];

/** What VibeField suggests for a Ghostty default it keeps the chord of. */
const REHOME: Readonly<Record<string, { trigger: string; action: string }>> = {
  "super+k": { trigger: "ctrl+super+k", action: "clear_screen" },
};

function matchesFilter(row: KeyboardRow, filter: Filter): boolean {
  switch (filter) {
    case "Changed":
      return row.state !== "default";
    case "VibeField's":
      return row.reserved !== null;
    case "Not in ghosttea yet":
      return row.action !== null && row.reserved === null && !routeWords(row).runs;
    default:
      return true;
  }
}

export function KeyboardTab({ model }: { model: TerminalPageModel }): ReactElement {
  const { device, managed } = model;
  const [filter, setFilter] = useState<Filter>("All");
  const [recording, setRecording] = useState<string | null>(null);
  const ready = device.kind === "ready" ? device : null;

  const overlayBindings = useMemo(
    () =>
      ready === null
        ? []
        : parseConfigLines(ready.draft)
            .filter(
              (line) =>
                line.kind === "setting" && line.key === "keybind" && line.value !== undefined,
            )
            .map((line) => line.value ?? ""),
    [ready],
  );
  const rows = useMemo(
    () => (ready?.snapshot == null ? [] : keyboardRows(ready.snapshot, overlayBindings)),
    [ready, overlayBindings],
  );

  if (ready === null) {
    return (
      <div className="vf-ts-tab" data-tab="keyboard">
        <PageSection id="keyboard" title="Shortcuts" scope="mac" when="after-save">
          <DeviceUnavailable model={model} />
        </PageSection>
      </div>
    );
  }

  const binds = managed.keybinds ?? [];
  const writeBinds = (next: readonly string[], clearDefaults = managed.clearDefaults): void =>
    model.setManaged({
      ...managed,
      keybinds: next.length > 0 || clearDefaults ? [...next] : null,
      clearDefaults,
    });
  /** The managed lines that concern one chord, by identity. */
  const linesFor = (id: string): string[] =>
    binds.filter((line) => {
      const split = splitBinding(line);
      return split !== null && triggerKey(split.trigger) === id;
    });
  const without = (ids: readonly string[]): string[] =>
    binds.filter((line) => {
      const split = splitBinding(line);
      return split === null || !ids.includes(triggerKey(split.trigger) ?? "");
    });

  /** Whether a layer below this page (Ghostty's defaults, the user's Ghostty
   * file) binds the chord — then only an explicit `unbind` frees it; a chord
   * this Mac alone added is freed by dropping its line. */
  const boundBelow = (row: KeyboardRow): boolean =>
    row.setBy !== "this-mac" || row.defaultAction !== null;
  const rebind = (row: KeyboardRow, trigger: string): void => {
    const id = triggerKey(trigger);
    if (id === null || row.action === null) return;
    const next = without([row.id, id]);
    if (id !== row.id && boundBelow(row)) next.push(bindingLine(row.trigger, null));
    // The move keeps every one of the binding's flags, so a key that passed
    // through to the shell on its old chord still does on the new one — since
    // ghosttea 0.13.3 (#81) `unconsumed:` decides that too, not `performable:` alone.
    next.push(bindingLine(flaggedTrigger(trigger, row.flags), row.action));
    writeBinds(next);
  };
  const remove = (row: KeyboardRow): void => {
    const next = without([row.id]);
    if (boundBelow(row)) next.push(bindingLine(row.trigger, null));
    writeBinds(next);
  };
  const reset = (row: KeyboardRow): void => writeBinds(without([row.id]));

  const visible = rows.filter((row) => matchesFilter(row, filter));
  const counts = {
    runs: rows.filter((row) => row.action !== null && routeWords(row).runs).length,
    total: rows.filter((row) => row.action !== null).length,
  };

  return (
    <div className="vf-ts-tab" data-tab="keyboard">
      <PageSection
        id="keyboard"
        title="Shortcuts"
        scope="mac"
        when="after-save"
        description={`Ghostty's shortcuts, as every terminal on this Mac will run them after you save. ${counts.runs} of ${counts.total} do something in the deck today; the rest are Ghostty actions ghosttea doesn't have yet.`}
      >
        <SettingsRow
          title="Start from Ghostty's defaults"
          description={
            managed.clearDefaults
              ? "Off: Ghostty's defaults and every binding your Ghostty file adds are cleared, and only the ones this page lists are kept."
              : "On: Ghostty's defaults, then your Ghostty file's bindings, then the changes below."
          }
        >
          <SettingsSwitch
            checked={!managed.clearDefaults}
            onChange={(on) => writeBinds(binds, !on)}
            label="Start from Ghostty's defaults"
          />
        </SettingsRow>
        {/* A view of the list, not a setting — so it sits on the list, not
            in the section's head beside the facts. */}
        <div className="vf-ts-keyfilter">
          <SegmentedControl
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            label="Show shortcuts"
            size="small"
          />
        </div>
        {KEYBOARD_GROUP_ORDER.map((group) => {
          const groupRows = visible.filter((row) => row.group === group);
          if (groupRows.length === 0) return null;
          return (
            <section key={group} className="vf-ts-keygroup" aria-label={group}>
              <div className="vf-ts-eyebrow">{group}</div>
              {groupRows.map((row) => (
                <ShortcutRow
                  key={row.id}
                  row={row}
                  recording={recording === row.id}
                  hasOwnLines={linesFor(row.id).length > 0}
                  onRecord={() => setRecording(row.id)}
                  onRecorded={(trigger) => {
                    setRecording(null);
                    if (trigger !== null) rebind(row, trigger);
                  }}
                  onRemove={() => remove(row)}
                  onReset={() => reset(row)}
                  onRehome={(suggestion) =>
                    writeBinds([
                      ...without([triggerKey(suggestion.trigger) ?? ""]),
                      bindingLine(suggestion.trigger, suggestion.action),
                    ])
                  }
                  rehomed={
                    REHOME[row.id] !== undefined &&
                    linesFor(triggerKey(REHOME[row.id]?.trigger ?? "") ?? "").length > 0
                  }
                />
              ))}
            </section>
          );
        })}
        {visible.length === 0 && (
          <p className={`vf-ts-empty ${labelCls}`}>No shortcut matches this filter.</p>
        )}
        <p className={`vf-ts-keyfoot ${labelCls}`}>
          Ghostty's own table: {defaultBindings().size} chords on macOS, ghosttea's ⌘⇧O among them.
          VibeField keeps ⌘K, ⌘, and ⌘⇧V for itself, everywhere — a pane never sees them.
        </p>
      </PageSection>
    </div>
  );
}

function ShortcutRow({
  row,
  recording,
  hasOwnLines,
  onRecord,
  onRecorded,
  onRemove,
  onReset,
  onRehome,
  rehomed,
}: {
  row: KeyboardRow;
  recording: boolean;
  hasOwnLines: boolean;
  onRecord: () => void;
  onRecorded: (trigger: string | null) => void;
  onRemove: () => void;
  onReset: () => void;
  onRehome: (suggestion: { trigger: string; action: string }) => void;
  rehomed: boolean;
}): ReactElement {
  const recorder = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (recording) recorder.current?.focus();
  }, [recording]);
  const words = routeWords(row);
  const label = actionLabel(row.action ?? row.defaultAction ?? "");
  const suggestion = row.reserved !== null ? REHOME[row.id] : undefined;
  return (
    <div className="vf-ts-shortcut" data-ts-anchor={`key-${row.id}`} data-state={row.state}>
      <div className="vf-ts-shortcut-chord">
        {recording ? (
          <button
            ref={recorder}
            type="button"
            className="vf-ts-recorder"
            onKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                onRecorded(null);
                return;
              }
              const trigger = triggerFromKeyEvent(event.nativeEvent);
              if (trigger !== null) onRecorded(trigger);
            }}
            onBlur={() => onRecorded(null)}
          >
            Press a shortcut… <span className={labelCls}>Esc cancels</span>
          </button>
        ) : (
          <Keycaps trigger={row.trigger} label={`${row.trigger} — ${label}`} />
        )}
      </div>
      <div className="vf-ts-shortcut-copy">
        <div className="vf-ts-shortcut-name">
          {label}
          {row.state === "changed" && <span className="vf-ts-tag">Changed</span>}
          {row.state === "added" && <span className="vf-ts-tag">Added</span>}
          {row.state === "removed" && <span className="vf-ts-tag">Removed</span>}
          {row.setBy === "your-ghostty" && row.state !== "default" && (
            <span className="vf-ts-tag" title="Set in your own Ghostty config file">
              Your Ghostty file
            </span>
          )}
        </div>
        <div
          className="vf-ts-shortcut-route"
          data-tone={row.reserved !== null ? "vibefield" : words.runs ? "runs" : "idle"}
        >
          {row.reserved !== null ? reservedWords(row.reserved, row.defaultAction) : words.text}
        </div>
      </div>
      <div className="vf-ts-shortcut-acts">
        {suggestion !== undefined && !rehomed && (
          <UiButton onClick={() => onRehome(suggestion)}>
            Use <Keycaps trigger={suggestion.trigger} /> instead
          </UiButton>
        )}
        {row.reserved === null && row.action !== null && !recording && (
          <UiButton onClick={onRecord} aria-label={`Change the shortcut for ${label}`}>
            Change
          </UiButton>
        )}
        {row.reserved === null && row.action !== null && (
          <UiButton onClick={onRemove} aria-label={`Remove the shortcut ${row.trigger}`}>
            Remove
          </UiButton>
        )}
        {hasOwnLines && (
          <UiButton onClick={onReset} aria-label={`Undo this Mac's change to ${row.trigger}`}>
            Reset
          </UiButton>
        )}
      </div>
    </div>
  );
}
