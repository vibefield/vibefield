import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { createRoot } from "react-dom/client";
import { FieldView } from "./field";
import "./styles.css";

// The window IS the field (2026-07-21, James): no app bar, no tabs — chrome
// floats over the canvas (DESIGN.md §1); diagnostics live inside the Settings
// panel. The provider stays app-wide so any surface can read fieldd.

async function boot(): Promise<void> {
  const conn = await window.vibefield.getConnection();
  const client = new FielddClient({ url: `ws://127.0.0.1:${conn.port}`, token: conn.token });
  client.connect();
  createRoot(document.getElementById("root")!).render(
    <FielddProvider client={client}>
      <FieldView />
    </FielddProvider>,
  );
}

void boot();

const dragRegion = document.createElement("div");
dragRegion.className = "app-drag";
dragRegion.setAttribute("aria-hidden", "true");
document.body.prepend(dragRegion);
