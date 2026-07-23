/**
 * WeatherCard — v3 port of the v1 playground weather card. Render body
 * (gradient panel, temperature, hi/lo, and the four SVG condition glyphs) is
 * verbatim; the v1 `z.enum` condition became `p.enum`.
 *
 * size: medium
 */
import { useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import { CardShell } from "@vibefield/shell-ui";
import type { ReactElement } from "react";

const TYPE = "widgetlab.weather";

/** v1 iOS "medium" preset — the app seeds Size at spawn. */
export const WEATHER_SIZE = { w: 329, h: 155 };

type WeatherCondition = "sunny" | "cloudy" | "partly-cloudy" | "rainy";

type WeatherProps = {
  readonly location: string;
  readonly temp: number;
  readonly high: number;
  readonly low: number;
  readonly condition: WeatherCondition;
};

const SUN_RAY_DEGREES = [0, 45, 90, 135, 180, 225, 270, 315];

function ConditionGlyph({ condition }: { condition: WeatherCondition }): ReactElement {
  // Simple SVG glyphs so the playground widget has zero asset dependencies.
  switch (condition) {
    case "sunny":
      return (
        <svg viewBox="-12 -12 24 24" className="h-14 w-14">
          <title>Sunny</title>
          <circle r="6" fill="#FFD60A" />
          {SUN_RAY_DEGREES.map((deg) => {
            const a = (deg * Math.PI) / 180;
            return (
              <line
                key={`ray-${deg}`}
                x1={Math.cos(a) * 8}
                y1={Math.sin(a) * 8}
                x2={Math.cos(a) * 10.5}
                y2={Math.sin(a) * 10.5}
                stroke="#FFD60A"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      );
    case "cloudy":
      return (
        <svg viewBox="-14 -12 28 20" className="h-14 w-14">
          <title>Cloudy</title>
          <path
            d="M -10 4 q 0 -6 6 -6 q 1 -4 5 -4 q 5 0 5 5 q 4 0 4 4 q 0 4 -4 4 h -14 q -2 0 -2 -3 z"
            fill="rgba(255,255,255,0.9)"
          />
        </svg>
      );
    case "rainy":
      return (
        <svg viewBox="-14 -12 28 24" className="h-14 w-14">
          <title>Rainy</title>
          <path
            d="M -10 2 q 0 -6 6 -6 q 1 -4 5 -4 q 5 0 5 5 q 4 0 4 4 q 0 4 -4 4 h -14 q -2 0 -2 -3 z"
            fill="rgba(255,255,255,0.85)"
          />
          {[-5, 0, 5].map((x) => (
            <line
              key={x}
              x1={x}
              y1={6}
              x2={x - 2}
              y2={11}
              stroke="#5AC8FA"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))}
        </svg>
      );
    default:
      return (
        <svg viewBox="-14 -12 28 20" className="h-14 w-14">
          <title>Partly cloudy</title>
          <circle cx="-3" cy="-3" r="5" fill="#FFD60A" />
          <path
            d="M -8 5 q 0 -5 5 -5 q 1 -4 5 -4 q 5 0 5 5 q 4 0 4 4 q 0 3 -4 3 h -12 q -3 0 -3 -3 z"
            fill="rgba(255,255,255,0.92)"
          />
        </svg>
      );
  }
}

/** The card's sky gradient — exported for the folder preview minis (preview.ts). */
export const WEATHER_GRADIENT = "linear-gradient(135deg, #3A86FF 0%, #1D4ED8 55%, #0B2AB5 100%)";

function WeatherView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<WeatherProps>(world, entity, TYPE);
  const location = props?.location ?? "San Francisco";
  const temp = props?.temp ?? 64;
  const high = props?.high ?? 68;
  const low = props?.low ?? 58;
  const condition = props?.condition ?? "partly-cloudy";

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full items-stretch text-white"
        style={{
          fontFamily: "-apple-system, system-ui, sans-serif",
          background: WEATHER_GRADIENT,
        }}
      >
        <div className="flex flex-1 flex-col justify-between p-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-80">
              {location}
            </div>
            <div className="text-[10px] opacity-60">Partly Cloudy</div>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-light tabular-nums leading-none">
              {Math.round(temp)}
            </span>
            <span className="pb-1 text-sm opacity-70">°</span>
          </div>
          <div className="flex gap-3 text-[11px] opacity-80">
            <span>H:{Math.round(high)}°</span>
            <span>L:{Math.round(low)}°</span>
          </div>
        </div>
        <div className="flex items-center justify-center pr-6">
          <ConditionGlyph condition={condition} />
        </div>
      </div>
    </CardShell>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). WEATHER_CONDITIONS lived only in that call's
// p.enum(...) and is gone with it — the manifest's condition prop carries the
// same four options as inline data. This module ships only the component.
export const WEATHER_TYPE = TYPE;
export { WeatherView };
