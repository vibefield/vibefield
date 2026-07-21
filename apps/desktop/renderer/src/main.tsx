import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { createRoot } from "react-dom/client";
import { DocManager } from "./doc-manager";
import { FieldView } from "./field";
import "./styles.css";

// The window IS the field (2026-07-21, James): no app bar, no tabs — chrome
// floats over the canvas (DESIGN.md §1); diagnostics live inside the Settings
// panel. The provider stays app-wide so any surface can read fieldd.
// B4: the app renders IMMEDIATELY under the loading veil; the DocManager runs
// the launch pipeline (last doc → most recent → the seeded default "Field")
// and FieldView applies sessions to the engine. A failed launch degrades to
// an in-memory board with persistence honestly detached.

async function boot(): Promise<void> {
  const conn = await window.vibefield.getConnection();
  const client = new FielddClient({ url: `ws://127.0.0.1:${conn.port}`, token: conn.token });
  client.connect();
  const manager = new DocManager(client);
  createRoot(document.getElementById("root")!).render(
    <FielddProvider client={client}>
      <FieldView manager={manager} />
    </FielddProvider>,
  );
}

void boot();

const dragRegion = document.createElement("div");
dragRegion.className = "app-drag";
dragRegion.setAttribute("aria-hidden", "true");
document.body.prepend(dragRegion);
