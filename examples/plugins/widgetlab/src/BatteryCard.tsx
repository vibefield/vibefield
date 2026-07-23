/**
 * BatteryCard — v3 port of the v1 playground battery-rings card. Render body
 * (concentric SVG rings + labelled rows) is verbatim; the v1 zod schema became
 * `p.number` props (each 0–100, defaulted).
 *
 * size: small
 */
import { useWidgetProps, type WidgetComponentProps } from "@vibefield/plugin-sdk/canvas";
import { CardShell } from "@vibefield/plugin-sdk/ui";
import type { ReactElement } from "react";

/** v1 iOS "small" preset — the app seeds Size at spawn. */
export const BATTERY_SIZE = { w: 155, h: 155 };

const TYPE = "vibefield.widgetlab.battery";

type BatteryProps = {
  readonly phone: number;
  readonly watch: number;
  readonly airpods: number;
};

function Ring({ r, pct, color }: { r: number; pct: number; color: string }): ReactElement {
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  return (
    <g>
      <circle r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
      <circle
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90)"
        style={{ transition: "stroke-dasharray 400ms ease-out" }}
      />
    </g>
  );
}

function Row({ label, pct, color }: { label: string; pct: number; color: string }): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="flex-1 opacity-70">{label}</span>
      <span className="tabular-nums font-medium">{Math.round(pct)}%</span>
    </div>
  );
}

function BatteryView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<BatteryProps>(world, entity, TYPE);
  const phone = props?.phone ?? 82;
  const watch = props?.watch ?? 47;
  const airpods = props?.airpods ?? 91;

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full flex-col justify-between bg-[#1C1C1E] p-4 text-white"
        style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
      >
        <div className="text-[10px] font-medium uppercase tracking-wider opacity-60">Batteries</div>
        <div className="relative flex items-center justify-center">
          <svg viewBox="-50 -50 100 100" className="h-[90px] w-[90px]">
            <title>Battery rings</title>
            <Ring r={42} pct={phone} color="#30D158" />
            <Ring r={30} pct={watch} color="#FFD60A" />
            <Ring r={18} pct={airpods} color="#64D2FF" />
          </svg>
        </div>
        <div className="space-y-0.5 text-[10px]">
          <Row label="Phone" pct={phone} color="#30D158" />
          <Row label="Watch" pct={watch} color="#FFD60A" />
          <Row label="AirPods" pct={airpods} color="#64D2FF" />
        </div>
      </div>
    </CardShell>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships only the component.
export const BATTERY_TYPE = TYPE;
export { BatteryView };
