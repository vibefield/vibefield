/**
 * ClockCard — v3 port of the v1 playground analog-clock card. Render body
 * (SVG face, tick marks, second-hand timer) is verbatim; only the v1
 * `createCardWidget({schema})` wrapper became `defineWidget({props})`.
 *
 * size: small
 */
import { useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import { CardShell } from "@vibefield/shell-ui";
import { type ReactElement, useEffect, useState } from "react";

const TYPE = "widgetlab.clock";

/** v1 iOS "small" preset — the app seeds Size at spawn. */
export const CLOCK_SIZE = { w: 155, h: 155 };

type ClockProps = { readonly timezone: string };

const TICK_DEGREES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function ClockView({ entity, world }: WidgetComponentProps): ReactElement {
  // Face is presentational; `timezone` is defaulted but unused (v1 parity) —
  // the hook keeps the widget subscribed to its props group.
  useWidgetProps<ClockProps>(world, entity, TYPE);
  const now = useNow();
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  // Degrees, 0 = 12 o'clock.
  const hourDeg = hours * 30 + minutes * 0.5;
  const minDeg = minutes * 6 + seconds * 0.1;
  const secDeg = seconds * 6;

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full flex-col justify-between bg-[#1C1C1E] p-4 text-white"
        style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider opacity-60">
          <span>Clock</span>
          <span>{now.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
        </div>
        <div className="flex items-center justify-center">
          <svg viewBox="-50 -50 100 100" className="h-[90px] w-[90px]">
            <title>Analog clock</title>
            <circle r="48" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            {TICK_DEGREES.map((deg) => {
              const a = (deg * Math.PI) / 180;
              const x1 = Math.sin(a) * 44;
              const y1 = -Math.cos(a) * 44;
              const x2 = Math.sin(a) * 48;
              const y2 = -Math.cos(a) * 48;
              return (
                <line
                  key={`tick-${deg}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={deg % 90 === 0 ? 2 : 1}
                  strokeLinecap="round"
                />
              );
            })}
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-26"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              transform={`rotate(${hourDeg})`}
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-38"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              transform={`rotate(${minDeg})`}
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-42"
              stroke="#FF9F0A"
              strokeWidth="1"
              strokeLinecap="round"
              transform={`rotate(${secDeg})`}
            />
            <circle r="2.5" fill="#FF9F0A" />
          </svg>
        </div>
        <div className="text-center font-semibold text-sm tabular-nums tracking-tight">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </CardShell>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships only the component.
export const CLOCK_TYPE = TYPE;
export { ClockView };
