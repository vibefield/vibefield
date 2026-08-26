import type { ReactElement, ReactNode } from "react";

const CONTENTS = { display: "contents" } as const;

/**
 * The host-owned half of plugin spec §11.5's CSS contract.
 *
 * `plugin-build` roots every artifact selector beneath this exact attribute.
 * `display: contents` keeps the boundary out of widget/surface layout and
 * containing-block math while preserving inheritance of the design tokens.
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
