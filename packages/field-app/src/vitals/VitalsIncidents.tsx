import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { xOf } from "./trace-geometry";
import {
  INCIDENT_WORDS,
  incidentCountWords,
  incidentLineWords,
  incidentModel,
  incidentSpan,
  incidentTone,
  incidentWhatWords,
  incidentWhenWords,
  incidentWhoWords,
  liveHolds,
  type VitalsIncidentSummaryV1,
  type VitalsIncidentsState,
} from "./vitals-incidents";
import type { VitalsModel } from "./vitals-model";
import "./vitals-incidents.css";

// VT-4b (track VT, 2026-11-24; DESIGN.md §8 "Vitals", Incidents) — THE WINDOW'S INCIDENTS, DRAWN: a button that says
// how many are kept, the list it opens, a mark on the lanes at each one's moment, and the line that says the opened
// one. Controller-free like the view it mounts in: the summaries and the few read whole come in, and opening one
// asks the host (`onOpen`) for it whole when the lanes do not reach its moment.

export interface IncidentLens {
  /** the model the lanes draw: the live one, or the opened incident's own minute */
  model: VitalsModel;
  /** the span the lanes cover while an incident's own minute is drawn */
  span: { from: number; to: number } | null;
  /** the moment the lanes hold for the opened incident */
  moment: number | null;
  opened: VitalsIncidentSummaryV1 | null;
  /** whether the lanes draw the opened incident from its own readings */
  fromKept: boolean;
  listOpen: boolean;
  toggleList(): void;
  open(id: string): void;
}

/** What the view needs of the incidents: the lanes' model and moment, and the list's state. */
export function useIncidentLens(
  live: VitalsModel,
  incidents: VitalsIncidentsState,
  onOpen: ((id: string) => void) | undefined,
  initialOpen?: string,
): IncidentLens {
  const [listOpen, setListOpen] = useState(initialOpen !== undefined);
  const [openedId, setOpenedId] = useState<string | null>(initialOpen ?? null);
  const opened =
    openedId === null ? null : (incidents.list.find((summary) => summary.id === openedId) ?? null);

  // one that aged out of fieldd's keeping is let go
  useEffect(() => {
    if (openedId !== null && opened === null) setOpenedId(null);
  }, [openedId, opened]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpenedId(null);
      setListOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const older = opened !== null && !liveHolds(live, opened.at);
  const whole = opened === null ? undefined : incidents.wholes.get(opened.id);
  const missing = opened !== null && incidents.missing.has(opened.id);
  // the host is asked for one whole only when the lanes do not reach its moment, once each time it is wanted
  const ask = useRef(onOpen);
  ask.current = onOpen;
  const wanted = opened !== null && older && whole === undefined && !missing ? opened.id : null;
  useEffect(() => {
    if (wanted !== null) ask.current?.(wanted);
  }, [wanted]);

  const fromKept = older && whole !== undefined;
  const model = useMemo(
    () => (fromKept && whole !== undefined ? incidentModel(live, whole) : live),
    [fromKept, whole, live],
  );
  return {
    model,
    span: fromKept && opened !== null ? incidentSpan(opened) : null,
    moment: opened !== null && (!older || fromKept) ? opened.at : null,
    opened,
    fromKept,
    listOpen,
    toggleList: () => {
      if (listOpen) setOpenedId(null); // closing the list lets the opened one go
      setListOpen(!listOpen);
    },
    open: (id) => setOpenedId((current) => (current === id ? null : id)),
  };
}

/** The state line's button: how many are kept. None kept, no button. */
export function IncidentsButton(props: {
  count: number;
  open: boolean;
  onToggle: () => void;
}): ReactElement | null {
  if (props.count === 0) return null;
  return (
    <button
      type="button"
      className="vf-vitals__incidents"
      aria-expanded={props.open}
      onClick={props.onToggle}
    >
      {incidentCountWords(props.count)}
    </button>
  );
}

/** The list, newest first: a dot in the incident's hue, its moment, who, and what. */
export function IncidentList(props: {
  list: readonly VitalsIncidentSummaryV1[];
  opened: string | null;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <section className="vf-vitals__incident-list" aria-label={INCIDENT_WORDS.list}>
      {props.list.map((summary) => (
        <button
          type="button"
          key={summary.id}
          className="vf-vitals__incident"
          aria-pressed={props.opened === summary.id}
          onClick={() => props.onOpen(summary.id)}
        >
          <span className="vf-vitals__incident-dot" data-tone={incidentTone(summary.kind)} />
          <span className="vf-vitals__incident-when">{incidentWhenWords(summary.at)}</span>
          <span className="vf-vitals__incident-who">{incidentWhoWords(summary)}</span>
          <span className="vf-vitals__incident-what">{incidentWhatWords(summary)}</span>
        </button>
      ))}
    </section>
  );
}

/** The one line over the lanes while an incident is opened. */
export function IncidentLine(props: {
  opened: VitalsIncidentSummaryV1 | null;
  fromKept: boolean;
}): ReactElement | null {
  if (props.opened === null) return null;
  return (
    <p className="vf-vitals__incident-line">
      {incidentLineWords(props.opened)}
      {props.fromKept ? (
        <span className="vf-vitals__incident-kept"> {INCIDENT_WORDS.kept}</span>
      ) : null}
    </p>
  );
}

/** A hairline through every lane at each incident's moment, and a band for one that lasted. Takes no press. */
export function IncidentMarks(props: {
  list: readonly VitalsIncidentSummaryV1[];
  scale: { from: number; to: number } | null;
  width: number;
}): ReactElement | null {
  const { list, scale, width } = props;
  if (scale === null) return null;
  const box = { x: 0, width, top: 0, bottom: 0 };
  const at = (time: number): number =>
    Math.round(
      xOf(Math.min(scale.to, Math.max(scale.from, time)), box, { ...scale, max: 1 }) * 10,
    ) / 10;
  const shown = list.filter(
    (summary) => summary.at <= scale.to && (summary.endedAt ?? summary.at) >= scale.from,
  );
  if (shown.length === 0) return null;
  return (
    <div className="vf-vitals__incident-marks" aria-hidden="true">
      {shown.map((summary) => {
        const tone = incidentTone(summary.kind);
        const left = at(summary.at);
        return (
          <span key={summary.id}>
            {summary.endedAt !== undefined && summary.endedAt > summary.at ? (
              <span
                className="vf-vitals__incident-band"
                data-tone={tone}
                style={{ left, width: Math.max(1, at(summary.endedAt) - left) }}
              />
            ) : null}
            {summary.at >= scale.from ? (
              <span className="vf-vitals__incident-mark" data-tone={tone} style={{ left }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
