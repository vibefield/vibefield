import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import { useState, type ReactElement } from "react";
import { FieldView } from "./field";
import { SystemView } from "./system";

// Shell frame (B2): Field (the canvas — the product) + System (the Track A
// health page). The Field stays mounted across tab switches — the engine and
// its in-memory doc live for the window's lifetime.

export function App(): ReactElement {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  const [view, setView] = useState<"field" | "system">("field");

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
        <div className={`pill ${overall.cls}`}>{overall.label}</div>
      </header>

      <div className="view" style={{ display: view === "field" ? "flex" : "none" }}>
        <FieldView />
      </div>
      {view === "system" && (
        <div className="view">
          <SystemView h={h} subError={sub.error} />
        </div>
      )}
    </div>
  );
}
