import type { PluginSurfaceProps } from "@vibefield/plugin-sdk";
import type { ReactElement } from "react";
import { widgetlabManifest } from "./manifest";

// P6 dogfood (§8.4/§13.2): a fixed surface bound to hud.panel — the SDK's proof
// that a plugin can contribute chrome, not just canvas widgets. A themed status
// card: the plugin id + its widget count, read from the plugin's own manifest
// (the surface knows what it ships). DESIGN.md tokens only — no hex literals: an
// iOS dark-elevated card (--vf-card reads on either theme, §2.2), white text
// ramp (§2.4), card radius (§4), the island shadow tier (§5).

export function StatusSurface({ slot }: PluginSurfaceProps): ReactElement {
  const widgetCount = widgetlabManifest.contributes?.widgets?.length ?? 0;
  return (
    <div
      style={{
        borderRadius: "var(--vf-radius-card)",
        background: "var(--vf-card)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
        padding: 16,
        color: "white",
        userSelect: "none",
      }}
    >
      {/* §3 eyebrow: uppercase, tracked, /60 */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          opacity: 0.6,
        }}
      >
        Widgetlab · status
      </div>
      {/* §3 data numeral: big + light + tabular-nums (the iOS weight inversion) */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 300,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {widgetCount}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>widgets</span>
      </div>
      {/* §3 mono for ids; §2.4 tertiary ramp */}
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          opacity: 0.4,
        }}
      >
        {widgetlabManifest.id} · {slot}
      </div>
    </div>
  );
}
