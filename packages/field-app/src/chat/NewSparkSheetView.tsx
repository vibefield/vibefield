import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import { SparkHatch, type SparkHatchHandle } from "@vibefield/design-kit/spark-face";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, type Ref, useEffect, useRef } from "react";
import type { AgentMenuRow, EffortChoice, ProfileChip, SheetRefusal } from "./new-spark";
import "./new-spark-sheet.css";

// THE NEW SPARK SHEET, THE VIEW (SP-1c; DESIGN.md §8 "The New spark sheet"; the Sparks page's `ns-polaris`, `ns-brain`,
// `ns-profiles`) — controller-free, so the catalog mounts this exact markup on fixtures. The sky with its hatch; the
// name with ↻, which deals another face (NS-D2 B); the agent pill and its menu; its profiles once there is more than
// This Mac (NS-D5); Cancel and Create; each refusal under what it is about.

export interface NewSparkSheetViewProps {
  /** false while it leaves (240 ms on the retract curve), its controls out of reach */
  open?: boolean | undefined;
  /** the name takes the keyboard as the sheet opens, selected, so typing replaces it (the product's; never a plate's) */
  focusName?: boolean | undefined;
  name: string;
  /** the face dealt, and how many times the hatch has played */
  seed: number;
  play: number;
  /** the agent it thinks with (its mark on the pill), when one can be a spark */
  agentId?: string | undefined;
  agentLine: string;
  /** the thinks-under profile's label, once there is more than This Mac */
  profileLabel?: string | undefined;
  menuOpen: boolean;
  menu: readonly AgentMenuRow[];
  effort?: EffortChoice | undefined;
  profiles?: { readonly chips: readonly ProfileChip[]; readonly reach: string } | undefined;
  refusal: SheetRefusal | null;
  creating: boolean;
  hatchRef?: Ref<SparkHatchHandle> | undefined;
  onName?: (name: string) => void;
  onReroll?: () => void;
  onMenu?: (open: boolean) => void;
  onAgent?: (agent: string) => void;
  onModel?: (model: string | null) => void;
  onEffort?: (value: string) => void;
  onProfile?: (profile: string) => void;
  onCancel?: () => void;
  onCreate?: () => void;
}

export function NewSparkSheetView({
  open = true,
  focusName = false,
  name,
  seed,
  play,
  agentId,
  agentLine,
  profileLabel,
  menuOpen,
  menu,
  effort,
  profiles,
  refusal,
  creating,
  hatchRef,
  onName,
  onReroll,
  onMenu,
  onAgent,
  onModel,
  onEffort,
  onProfile,
  onCancel,
  onCreate,
}: NewSparkSheetViewProps): ReactElement {
  const said = (at: SheetRefusal["at"]): ReactElement | null =>
    refusal?.at === at ? (
      <p className="vf-new-spark-refusal" role="alert">
        {refusal.words}
      </p>
    ) : null;
  const trimmed = name.trim();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [focusName]);
  return (
    <div className="vf-new-spark" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="vf-new-spark-scrim"
        aria-label="Cancel"
        tabIndex={-1}
        onClick={onCancel}
      />
      <section
        className="vf-new-spark-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="New spark"
      >
        <SparkHatch className="vf-new-spark-sky" seed={seed} play={play} ref={hatchRef} />
        <div className="vf-new-spark-form">
          <div className="vf-new-spark-namerow">
            <span aria-hidden="true" />
            <input
              ref={nameRef}
              className="vf-new-spark-name"
              aria-label="Name"
              value={name}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onName?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && trimmed !== "" && !creating) onCreate?.();
              }}
            />
            <button
              type="button"
              className="vf-new-spark-another"
              aria-label="Another face"
              title="Another face"
              onClick={onReroll}
            >
              <FieldGlyph name="reset" size={15} />
            </button>
          </div>
          {said("name")}
          <button
            type="button"
            className="vf-new-spark-agent"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => onMenu?.(!menuOpen)}
          >
            {agentId === undefined ? null : (
              <span className="vf-new-spark-agent-mark" aria-hidden="true">
                <AgentIcon providerId={agentId} />
              </span>
            )}
            <span className="vf-new-spark-agent-line">{agentLine}</span>
            {profileLabel === undefined ? null : (
              <span className="vf-new-spark-agent-profile">{profileLabel}</span>
            )}
            <FieldGlyph name="chevron" size={12} />
          </button>
          {said("agent")}
          {menuOpen ? (
            <div className="vf-new-spark-menu" role="menu">
              {menu.map((row, index) => menuRow(row, index, onAgent, onModel))}
              {effort === undefined ? null : (
                <div className="vf-new-spark-effort">
                  <span>{effort.label}</span>
                  <span className="vf-new-spark-segments">
                    {effort.values.map((value) => (
                      <button
                        key={value.id}
                        type="button"
                        aria-pressed={value.on}
                        onClick={() => onEffort?.(value.id)}
                      >
                        {value.label}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
          ) : null}
          {profiles === undefined ? null : (
            <div className="vf-new-spark-profiles">
              <div className="vf-new-spark-chips">
                <span className="vf-new-spark-chips-label">Profiles</span>
                {profiles.chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className="vf-new-spark-chip"
                    aria-pressed={chip.checked}
                    {...(chip.home ? { "aria-disabled": true, "data-home": "true" } : {})}
                    onClick={() => {
                      if (!chip.home) onProfile?.(chip.id);
                    }}
                  >
                    {chip.label}
                    {chip.checked ? <FieldGlyph name="check" size={10} /> : null}
                  </button>
                ))}
              </div>
              <p className="vf-new-spark-reach">{profiles.reach}</p>
              {said("profiles")}
            </div>
          )}
        </div>
        {said("foot")}
        <div className="vf-new-spark-foot">
          <UiButton onClick={onCancel}>Cancel</UiButton>
          <UiButton
            variant="primary"
            disabled={trimmed === "" || creating}
            onClick={() => onCreate?.()}
          >
            {trimmed === "" ? "Create" : `Create ${trimmed}`}
          </UiButton>
        </div>
      </section>
    </div>
  );
}

function menuRow(
  row: AgentMenuRow,
  index: number,
  onAgent: ((agent: string) => void) | undefined,
  onModel: ((model: string | null) => void) | undefined,
): ReactElement {
  if (row.kind === "agent") {
    return row.agent.takes ? (
      <button
        key={`agent-${row.agent.id}`}
        type="button"
        role="menuitem"
        className="vf-new-spark-menu-head"
        onClick={() => onAgent?.(row.agent.id)}
      >
        <span>{row.agent.label}</span>
        {row.under === undefined ? null : <small>{row.under}</small>}
      </button>
    ) : (
      <div
        key={`agent-${row.agent.id}`}
        role="menuitem"
        tabIndex={-1}
        aria-disabled="true"
        className="vf-new-spark-menu-head"
        data-off="true"
      >
        <span>{row.agent.label}</span>
        <small>{row.agent.why}</small>
      </div>
    );
  }
  if (row.kind === "model") {
    return (
      <button
        key={`model-${row.id ?? "own"}`}
        type="button"
        role="menuitemradio"
        aria-checked={row.on}
        className="vf-new-spark-menu-row"
        onClick={() => onModel?.(row.id)}
      >
        <span>{row.label}</span>
        {row.on ? <FieldGlyph name="check" size={12} /> : null}
      </button>
    );
  }
  return (
    <p key={`note-${index}`} className="vf-new-spark-menu-note">
      {row.words}
    </p>
  );
}
