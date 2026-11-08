import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import {
  SparkHatch,
  type SparkHatchHandle,
  type SparkHatchSky,
} from "@vibefield/design-kit/spark-face";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, type Ref, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StillStarter } from "./ChatStarter";
import type { AgentMenuRow, EffortChoice, ProfileChip, SheetRefusal } from "./new-spark";
import {
  type Box,
  boxOf,
  movePortal,
  type PortalPhase,
  type PortalPlaces,
  placeGlass,
} from "./portal";
import type { Starter } from "./thread-items";
import "./new-spark-sheet.css";

// THE NEW SPARK SHEET, THE VIEW (SP-1c; DESIGN.md §8 "The New spark sheet"; the Sparks page's `ns-polaris`, `ns-brain`,
// `ns-profiles`) — controller-free, so the catalog mounts this exact markup on fixtures. The sky with its hatch; the
// name with ↻, which deals another face (NS-D2 B); the agent pill and its menu; its profiles once there is more than
// This Mac (NS-D5); Cancel and Create; each refusal under what it is about. ES-2: under the agent, the first job a
// starter on Chat's empty night carried, still, with its × (§8 "The New spark sheet", Its first job). ES-3b (§6, the
// portal): opened from Chat's empty night, it draws the window — the night's own canvas, lent, panel-sized at the
// night's place, over the glass, the hatch drawing its sky and its face there — and the glass that grows around it;
// the phase's motion is `portal.ts`'s.

/** ES-3b — the portal, as the controller hands it: the night lent, and where the portal stands. */
export interface SheetPortal {
  /** the night's place (its client rect): the window stands there and the glass grows from there */
  readonly from: DOMRectReadOnly;
  /** the night's edge as it stood (at rest, or leaning) */
  readonly clip: string;
  /** the night's own moment: the window's first frame is drawn at it */
  readonly t: number;
  readonly phase: PortalPhase | "folded";
  /** reduced motion (M6): fades in place of the close */
  readonly reduced: boolean;
  /** the window's first frame is drawn: the night may step aside */
  readonly onDrawn: () => void;
  /** the window could not draw (no WebGL2): the sheet rises as it always has */
  readonly onFailed: () => void;
  /** ES-3d — a phase's motion has finished (its own animations, or its own time where nothing animates) */
  readonly onMoved: (motion: PortalPhase) => void;
}

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
  /** what Create needs is read: the agent it thinks with and the profile it thinks under, read as the sheet opens.
   * Until then Create waits, disabled (item 149: an enabled Create pressed before them hatched nothing, in silence) */
  ready?: boolean | undefined;
  hatchRef?: Ref<SparkHatchHandle> | undefined;
  /** ES-3b — opened through the portal: the night lent, and where the portal stands; absent, the sheet rises */
  portal?: SheetPortal | undefined;
  /** ES-2 — the first job this opening carries from Chat's empty night; absent, none */
  job?: Starter | undefined;
  /** ES-2 — its × was pressed: the row folds away as the sheet settles to its height (240ms, island) */
  jobLeaving?: boolean | undefined;
  /** ES-2 — the first job's ×, "Remove its first job" */
  onDropJob?: (() => void) | undefined;
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
  ready = true,
  hatchRef,
  portal,
  job,
  jobLeaving = false,
  onDropJob,
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
  // ES-3b — the portal's parts and places, measured once the sheet stands where it will (before its first frame)
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const [places, setPlaces] = useState<PortalPlaces | null>(null);
  // the places as the sheet has grown since it opened (its reads come in after): the glass and the leave follow them
  const grown = useRef<PortalPlaces | null>(null);
  const [lentSky, setLentSky] = useState<SparkHatchSky | undefined>(undefined);
  const lent = portal !== undefined;
  const handed = useRef(portal);
  handed.current = portal;
  useLayoutEffect(() => {
    const given = handed.current;
    const layer = layerRef.current;
    const sheet = sheetRef.current;
    const slot = sheet?.querySelector(".vf-new-spark-sky");
    const pane = windowRef.current;
    const glass = glassRef.current;
    const face = faceRef.current;
    const sky = skyRef.current;
    if (
      !lent ||
      given === undefined ||
      !layer ||
      !sheet ||
      !slot ||
      !pane ||
      !glass ||
      !face ||
      !sky
    ) {
      grown.current = null;
      setPlaces(null);
      setLentSky(undefined);
      return;
    }
    const local = (rect: DOMRectReadOnly): Box => {
      const origin = layer.getBoundingClientRect();
      return boxOf({
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
    };
    // the sheet stands where it opened for the portal's life, so its sky never moves under the window: what its reads
    // add (its profiles, a refusal) grows it downward
    const at = local(sheet.getBoundingClientRect());
    Object.assign(sheet.style, { position: "absolute", left: `${at.x}px`, top: `${at.y}px` });
    const panel = local(given.from);
    const skyPlace = local(slot.getBoundingClientRect());
    Object.assign(pane.style, {
      left: `${panel.x}px`,
      top: `${panel.y}px`,
      width: `${panel.w}px`,
      height: `${panel.h}px`,
    });
    Object.assign(face.style, {
      left: `${skyPlace.x - panel.x}px`,
      top: `${skyPlace.y - panel.y}px`,
      width: `${skyPlace.w}px`,
      height: `${skyPlace.h}px`,
    });
    const placed: PortalPlaces = { panel, sky: skyPlace, sheet: at, clip: given.clip };
    grown.current = placed;
    setPlaces(placed);
    setLentSky({
      canvas: sky,
      face,
      t: given.t,
      onDrawn: () => handed.current?.onDrawn(),
      onFailed: () => handed.current?.onFailed(),
    });
    // as it grows, the glass grown around the window follows it
    const growth =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            const held = grown.current;
            if (held === null) return;
            const now = local(sheet.getBoundingClientRect());
            grown.current = { ...held, sheet: now };
            const phase = handed.current?.phase;
            if (phase === "closing" || phase === "open") placeGlass(glass, now);
          })
        : null;
    growth?.observe(sheet);
    return () => {
      growth?.disconnect();
      for (const property of ["position", "left", "top"]) sheet.style.removeProperty(property);
    };
  }, [lent]);
  const phase = portal?.phase;
  const reduced = portal?.reduced ?? false;
  // folded is the fold run on (the night handed back under it): its motion is the fold's, never run again
  const motion = phase === "folded" ? "folding" : phase;
  useLayoutEffect(() => {
    const pane = windowRef.current;
    const glass = glassRef.current;
    const now = grown.current ?? places;
    if (motion === undefined || places === null || now === null || !pane || !glass) return;
    const moving = movePortal(motion, { window: pane, glass }, now, reduced);
    // ES-3d: what follows the phase follows its motion's own finish
    void moving.finished.then(() => handed.current?.onMoved(motion));
    return moving.stop;
  }, [motion, places, reduced]);
  return (
    <div
      ref={layerRef}
      className="vf-new-spark"
      data-open={open ? "true" : "false"}
      {...(phase === undefined ? {} : { "data-portal": phase })}
    >
      <button
        type="button"
        className="vf-new-spark-scrim"
        aria-label="Cancel"
        tabIndex={-1}
        onClick={onCancel}
      />
      {lent ? <div ref={glassRef} className="vf-new-spark-glass" aria-hidden="true" /> : null}
      <section
        ref={sheetRef}
        className="vf-new-spark-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="New spark"
      >
        <SparkHatch
          className="vf-new-spark-sky"
          seed={seed}
          play={play}
          ref={hatchRef}
          {...(lent && lentSky !== undefined ? { sky: lentSky } : {})}
        />
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
          {job === undefined ? null : (
            <div className="vf-new-spark-job" {...(jobLeaving ? { "data-leaving": "true" } : {})}>
              <p className="vf-new-spark-job-label">Its first job</p>
              <StillStarter
                starter={job}
                remove={{ label: "Remove its first job", onPress: () => onDropJob?.() }}
              />
            </div>
          )}
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
            disabled={trimmed === "" || creating || !ready}
            onClick={() => onCreate?.()}
          >
            {trimmed === "" ? "Create" : `Create ${trimmed}`}
          </UiButton>
        </div>
      </section>
      {lent ? (
        <div ref={windowRef} className="vf-new-spark-window" aria-hidden="true">
          <canvas ref={skyRef} className="vf-new-spark-window-sky" />
          <canvas ref={faceRef} className="vf-new-spark-window-face" />
        </div>
      ) : null}
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
