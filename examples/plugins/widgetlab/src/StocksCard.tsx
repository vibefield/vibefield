/**
 * StocksCard — v3 port of the v1 playground stocks card. Render body (per-row
 * sparkline + price + change badge) is verbatim; the v1 nested-array zod schema
 * became a single `p.json` prop (the conflict-coarse escape hatch — one string
 * cell, whole-value last-writer-wins), parsed back to objects by the hook.
 *
 * size: medium
 */
import { defineWidget, p } from "@vibecook/ice";
import { useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import { CardShell } from "@vibefield/shell-ui";
import type { ReactElement } from "react";

const TYPE = "widgetlab.stocks";

/** v1 iOS "medium" preset — the app seeds Size at spawn. */
export const STOCKS_SIZE = { w: 329, h: 155 };

type Ticker = {
  readonly symbol: string;
  readonly price: number;
  readonly changePct: number;
  readonly history: number[];
};
type StocksProps = { readonly tickers: Ticker[] };

const DEFAULT_TICKERS: Ticker[] = [
  {
    symbol: "AAPL",
    price: 218.54,
    changePct: 2.14,
    history: [210, 211, 214, 213, 216, 215, 217, 218, 217, 218.54],
  },
  {
    symbol: "TSLA",
    price: 241.02,
    changePct: -1.32,
    history: [252, 249, 247, 246, 244, 243, 241, 242, 240, 241.02],
  },
  {
    symbol: "NVDA",
    price: 872.3,
    changePct: 4.72,
    history: [820, 828, 835, 840, 846, 855, 860, 865, 870, 872.3],
  },
];

function Sparkline({
  history,
  up,
  width = 62,
  height = 22,
}: {
  history: number[];
  up: boolean;
  width?: number;
  height?: number;
}): ReactElement {
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const stride = width / (history.length - 1);
  const points = history
    .map((v, i) => {
      const x = i * stride;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const color = up ? "#30D158" : "#FF453A";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[22px] w-[62px]">
      <title>Sparkline</title>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({ ticker }: { ticker: Ticker }): ReactElement {
  const up = ticker.changePct >= 0;
  const color = up ? "#30D158" : "#FF453A";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-white">{ticker.symbol}</div>
        <div className="text-[9px] text-white/40">NASDAQ</div>
      </div>
      <Sparkline history={ticker.history} up={up} />
      <div className="flex min-w-[64px] flex-col items-end">
        <div className="text-[12px] font-medium tabular-nums text-white">
          {ticker.price.toFixed(2)}
        </div>
        <div
          className="rounded px-1 text-[10px] font-medium tabular-nums"
          style={{ color: "#fff", backgroundColor: color }}
        >
          {up ? "+" : ""}
          {ticker.changePct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

function StocksView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<StocksProps>(world, entity, TYPE);
  const tickers = props?.tickers ?? DEFAULT_TICKERS;

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full flex-col justify-between bg-black px-4 py-3"
        style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
          <span className="text-white/60">Stocks</span>
          <span className="text-white/40">Market Open</span>
        </div>
        <div className="space-y-2">
          {tickers.slice(0, 3).map((t) => (
            <Row key={t.symbol} ticker={t} />
          ))}
        </div>
      </div>
    </CardShell>
  );
}

export const StocksCard = defineWidget({
  type: TYPE,
  defaultSize: { w: 329, h: 155 }, // v1 scene size — tray tiles and inserts match the demo grid
  props: {
    tickers: p.json(
      p.array(
        p.object({
          symbol: { kind: "string" },
          price: { kind: "number" },
          changePct: { kind: "number" },
          history: p.array({ kind: "number" }),
        }),
      ),
      { default: DEFAULT_TICKERS },
    ),
  },
  surface: "dom",
  component: StocksView,
  provides: ["widget"],
  interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
});
