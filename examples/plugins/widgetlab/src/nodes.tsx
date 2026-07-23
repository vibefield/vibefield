/**
 * Node-editor cards for widgetlab (2026-07-16, James: "add some node widgets i
 * can do wire connection") — the nodeboard trio re-dressed in the iOS card
 * look: CardShell chrome (rounded clip, drop shadow, drag-lift + 75% fade,
 * overlap glow) around a dark node body. The engine supplies everything
 * wire-shaped: hovering a node materializes its port dots (design-004 §6),
 * dragging FROM a dot routes the connect gesture (dashed preview → solid when
 * snapped to a compatible port), release commits the wire — all rendered by
 * the @ice/ground wires pass.
 *
 * PORT `accepts: ["signal"]` gates endpoint compatibility. Press-drag moves
 * (no long-press hold — nodes should feel snappy, nodeboard parity); they are
 * snap sources+targets like every widgetlab card, and NOT solid (nodes may
 * rest overlapping — rejecting drops would fight dense graph layouts).
 */
import { defineWidget, p } from "@vibecook/ice";
import { useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import { CardShell } from "@vibefield/shell-ui";
import type { CSSProperties, ReactElement } from "react";

/** Node preset (between the iOS "small" card and nodeboard's 150×84). */
export const NODE_SIZE = { w: 170, h: 96 } as const;

const INTERACTION = { selectable: true, movable: true, resizable: false, snap: "both" } as const;

function PortLabel({ side, label }: { side: "e" | "w"; label: string }): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "9px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
    pointerEvents: "none",
    ...(side === "e" ? { right: "8px" } : { left: "8px" }),
  };
  return <span style={style}>{side === "w" ? `▸ ${label}` : `${label} ▸`}</span>;
}

function NodeBody({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  children?: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div
      className="relative flex h-full w-full flex-col justify-between p-3 text-white"
      style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <span className="text-[10px] uppercase tracking-wider opacity-60">{title}</span>
      </div>
      <div className="text-center font-semibold text-sm tracking-tight opacity-90">{subtitle}</div>
      <div className="h-3" />
      {children}
    </div>
  );
}

/** Node shell tints by widget type — exported for the folder preview minis. */
export const NODE_BG = {
  "widgetlab.signal": "#1C2540",
  "widgetlab.filter": "#1F3327",
  "widgetlab.scope": "#33231C",
} as const;

// --- signal-node: a source. One "out" port (east). --------------------------

type SignalProps = { readonly hz: number };

function SignalNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<SignalProps>(world, entity, "widgetlab.signal");
  return (
    <CardShell world={world} entity={entity} background={NODE_BG["widgetlab.signal"]}>
      <NodeBody title="Signal" subtitle={`${props?.hz ?? 440} Hz`} accent="#5E9EFF">
        <PortLabel side="e" label="out" />
      </NodeBody>
    </CardShell>
  );
}

export const SignalNode = defineWidget({
  type: "widgetlab.signal",
  props: { hz: p.number({ default: 440, min: 1, max: 20000 }) },
  surface: "dom",
  component: SignalNodeView,
  sizeMode: "fixed",
  defaultSize: NODE_SIZE,
  minSize: { w: 140, h: 80 },
  interaction: INTERACTION,
  ports: [{ id: "out", side: "e", accepts: ["signal"] }],
  provides: ["widget"],
});

// --- filter-node: in (west) → out (east). ------------------------------------

type FilterProps = { readonly mode: "lowpass" | "highpass" | "bandpass" };

function FilterNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<FilterProps>(world, entity, "widgetlab.filter");
  return (
    <CardShell world={world} entity={entity} background={NODE_BG["widgetlab.filter"]}>
      <NodeBody title="Filter" subtitle={props?.mode ?? "lowpass"} accent="#4ADE80">
        <PortLabel side="w" label="in" />
        <PortLabel side="e" label="out" />
      </NodeBody>
    </CardShell>
  );
}

export const FilterNode = defineWidget({
  type: "widgetlab.filter",
  props: { mode: p.enum(["lowpass", "highpass", "bandpass"], { default: "lowpass" }) },
  surface: "dom",
  component: FilterNodeView,
  sizeMode: "fixed",
  defaultSize: NODE_SIZE,
  minSize: { w: 140, h: 80 },
  interaction: INTERACTION,
  ports: [
    { id: "in", side: "w", accepts: ["signal"] },
    { id: "out", side: "e", accepts: ["signal"] },
  ],
  provides: ["widget"],
});

// --- scope-node: a sink with TWO inputs (even side distribution). -------------

function ScopeNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  return (
    <CardShell world={world} entity={entity} background={NODE_BG["widgetlab.scope"]}>
      <NodeBody title="Scope" subtitle="A / B" accent="#FFB86C">
        <PortLabel side="w" label="a · b" />
      </NodeBody>
    </CardShell>
  );
}

export const ScopeNode = defineWidget({
  type: "widgetlab.scope",
  surface: "dom",
  component: ScopeNodeView,
  sizeMode: "fixed",
  defaultSize: NODE_SIZE,
  minSize: { w: 140, h: 80 },
  interaction: INTERACTION,
  ports: [
    { id: "in-a", side: "w", accepts: ["signal"] },
    { id: "in-b", side: "w", accepts: ["signal"] },
  ],
  provides: ["widget"],
});

export const NODE_WIDGETS = [SignalNode, FilterNode, ScopeNode];
