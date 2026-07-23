/**
 * CalendarCard — v3 port of the v1 playground calendar card. Render body
 * (weekday + big day number + next-event footer, minute-rollover timer) is
 * verbatim.
 *
 * NOTE: v1's `dateIso` was a nullable string (null ⇒ use today). The props DSL
 * has no null string, so it maps to an empty-string sentinel: "" ⇒ use today.
 * `useToday`'s existing falsy check (`override ? … : new Date()`) preserves the
 * behaviour unchanged.
 *
 * size: small
 */
import { useWidgetProps, type WidgetComponentProps } from "@vibefield/plugin-sdk/canvas";
import { CardShell } from "@vibefield/plugin-sdk/ui";
import { type ReactElement, useEffect, useState } from "react";

/** v1 iOS "small" preset — the app seeds Size at spawn. */
export const CALENDAR_SIZE = { w: 155, h: 155 };

const TYPE = "vibefield.widgetlab.calendar";

type CalendarProps = {
  readonly dateIso: string;
  readonly nextEvent: string;
  readonly nextEventTime: string;
};

function useToday(override: string | null): Date {
  const [today, setToday] = useState(() => (override ? new Date(override) : new Date()));
  useEffect(() => {
    if (override) {
      setToday(new Date(override));
      return;
    }
    // Re-check every minute to roll over at midnight.
    const id = window.setInterval(() => setToday(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [override]);
  return today;
}

function CalendarView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<CalendarProps>(world, entity, TYPE);
  const dateIso = props?.dateIso ?? "";
  const nextEvent = props?.nextEvent ?? "Design review";
  const nextEventTime = props?.nextEventTime ?? "3:30 PM";

  const today = useToday(dateIso || null);
  const weekday = today.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const day = today.getDate();

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full flex-col bg-white p-3"
        style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
      >
        <div
          className="text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: "#FF3B30" }}
        >
          {weekday}
        </div>
        <div
          className="font-semibold leading-none text-black tabular-nums"
          style={{ fontSize: "56px", letterSpacing: "-0.04em" }}
        >
          {day}
        </div>
        <div className="mt-auto space-y-0.5">
          <div className="truncate text-[11px] font-semibold text-black">{nextEvent}</div>
          <div className="text-[10px] text-black/50">{nextEventTime}</div>
        </div>
      </div>
    </CardShell>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships only the component.
export const CALENDAR_TYPE = TYPE;
export { CalendarView };
