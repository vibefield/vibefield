import type { ReactElement, ReactNode } from "react";

const CONTENTS = { display: "contents" } as const;

/**
 * The host-owned half of plugin spec §11.5's CSS contract.
 *
 * `plugin-build` roots every artifact selector beneath this exact attribute.
 * `display: contents` keeps the boundary out of a surface's layout and
 * containing-block math while preserving inheritance of the design tokens.
 * Since the widget faces left (DK-8) its one mount is the HUD surface host
 * (`hud/PluginSurfaceSlot.tsx`) — the retire table's "CSS scoping for HUD
 * surfaces only".
 */
export function PluginStyleBoundary({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div data-vf-plugin={pluginId} style={CONTENTS}>
      {children}
    </div>
  );
}
