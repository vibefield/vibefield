import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { FieldView } from "./field";
import { SystemView } from "./system";
import { useTheme } from "./theme";

// Shell frame (B2): Field (the canvas — the product) + System (the Track A
// health page). The Field stays mounted across tab switches — the engine and
// its in-memory doc live for the window's lifetime. The frame chrome itself is
// control-room dark until the D2 island lands; the theme toggle governs the
// FIELD's ground and (via .dark/data-theme) every tokened surface.

export function App(): ReactElement {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  const [view, setView] = useState<"field" | "system">("field");
  const { dark, toggle } = useTheme();

  const overall =
    conn !== "ready"
      ? conn === "connecting" || conn === "reconnecting"
        ? { label: conn, cls: "warn" }
        : { label: conn, cls: "bad" }
      : h?.nativeConnected
        ? { label: "all systems", cls: "good" }
        : { label: "native down", cls: "bad" };

  return (
    <div className="frame">
      <header>
        <div className="brand">
          <span className="mark" />
          VibeField
          <nav className="tabs">
            <button
              type="button"
              className={view === "field" ? "active" : ""}
              onClick={() => setView("field")}
            >
              Field
            </button>
            <button
              type="button"
              className={view === "system" ? "active" : ""}
              onClick={() => setView("system")}
            >
              System
            </button>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={toggle}
            title={dark ? "Switch to light" : "Switch to dark"}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 15,
              padding: "4px 8px",
            }}
          >
            {dark ? "☀" : "☾"}
          </button>
          <div className={`pill ${overall.cls}`}>{overall.label}</div>
        </div>
      </header>

      <div className="view" style={{ display: view === "field" ? "flex" : "none" }}>
        <FieldView dark={dark} />
      </div>
      {view === "system" && (
        <div className="view">
          <SystemView h={h} subError={sub.error} />
        </div>
      )}
    </div>
  );
}
